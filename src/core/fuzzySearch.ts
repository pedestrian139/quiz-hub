import type { ChapterMeta, Question } from '../types/quiz';

/** Field identifiers ordered from highest to lowest default relevance weight. */
export type FuzzySearchField = 'stem' | 'options' | 'chapter' | 'tags' | 'explanation';

/** Half-open UTF-16 range `[start, end)` mapped back to the original unnormalized `question.stem`. */
export interface HighlightRange {
  start: number;
  end: number;
}

/** Minimal question contract accepted by the fuzzy search engine. */
export type SearchableQuestion = Pick<
  Question,
  'id' | 'stem' | 'options' | 'chapter' | 'tags' | 'explain' | 'explanation' | 'aiAnalysis' | 'keyPoints'
> & {
  chapterName?: string;
};

/** Single matched question result with spoiler-free field metadata and raw stem highlight spans. */
export interface FuzzySearchMatch<T extends SearchableQuestion = Question> {
  question: T;
  score: number;
  matchedFields: FuzzySearchField[];
  /** `true` when the query matched only non-stem fields (e.g. options, chapter, tags, explanation). */
  matchedNonStemOnly: boolean;
  /** Non-overlapping sorted `[start, end)` ranges on raw `question.stem`; empty when stem did not match. */
  stemHighlights: HighlightRange[];
}

/** Optional search configuration. */
export interface FuzzySearchOptions {
  chapters?:
    | readonly ChapterMeta[]
    | ReadonlyMap<number, ChapterMeta | string>
    | Readonly<Record<number, string>>;
  limit?: number;
  minScore?: number;
  fieldWeights?: Partial<Record<FuzzySearchField, number>>;
}

/** Pre-indexed searchable representation of a question collection for fast repeated queries. */
export interface QuestionSearchIndex<T extends SearchableQuestion = Question> {
  readonly size: number;
  search: (query: string, options?: Omit<FuzzySearchOptions, 'chapters'>) => FuzzySearchMatch<T>[];
}

/** Pre-normalized text alongside UTF-16 offset mapping and extracted ASCII word spans. */
export interface IndexedWord {
  word: string;
  start: number;
  end: number;
}

export interface NormalizedText {
  raw: string;
  text: string;
  /** `indexMap[normIdx]` gives the raw UTF-16 code-unit start offset in `raw`. */
  indexMap: Int32Array;
  words: readonly IndexedWord[];
}

export const DEFAULT_FIELD_WEIGHTS: Readonly<Record<FuzzySearchField, number>> = {
  stem: 4.0,
  options: 2.4,
  chapter: 1.8,
  tags: 1.8,
  explanation: 1.0,
};

const FIELD_ORDER: readonly FuzzySearchField[] = [
  'stem',
  'options',
  'chapter',
  'tags',
  'explanation',
];

const DEFAULT_MIN_SCORE = 0.42;

interface IndexedQuestion<T extends SearchableQuestion> {
  question: T;
  orderIndex: number;
  stem: NormalizedText;
  options: readonly NormalizedText[];
  chapter: readonly NormalizedText[];
  tags: readonly NormalizedText[];
  explanation: readonly NormalizedText[];
}

interface FieldTokenResult {
  score: number;
  ranges: HighlightRange[];
}

const defaultIndexCache = new WeakMap<
  readonly SearchableQuestion[],
  QuestionSearchIndex<SearchableQuestion>
>();

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isAsciiLower(code: number): boolean {
  return code >= 0x61 && code <= 0x7a;
}

function isAsciiWordChar(code: number): boolean {
  return isAsciiLower(code) || isAsciiDigit(code);
}

function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0x3040 && code <= 0x30ff) || // Hiragana & Katakana
    (code >= 0xac00 && code <= 0xd7af) // Hangul Syllables
  );
}

function isExtendedLetter(code: number): boolean {
  return (
    (code >= 0x00c0 && code <= 0x024f && code !== 0x00d7 && code !== 0x00f7) || // Latin Extended
    (code >= 0x0370 && code <= 0x03ff) || // Greek
    (code >= 0x20000 && code <= 0x2ebef) // CJK Extensions B-F
  );
}

/** Map a single Unicode code point to its normalized lowercase half-width character, or `null` to skip. */
function normalizeCodePoint(code: number): { ch: string; isAsciiWord: boolean; isCjk: boolean } | null {
  let mapped = code;
  if (mapped === 0x3000) {
    return null;
  }
  // Full-width ASCII variants (`！`..`～`) -> half-width (`!`..`~`)
  if (mapped >= 0xff01 && mapped <= 0xff5e) {
    mapped -= 0xfee0;
  }
  // Uppercase ASCII -> lowercase
  if (mapped >= 0x41 && mapped <= 0x5a) {
    mapped += 32;
  }
  if (isAsciiWordChar(mapped)) {
    return { ch: String.fromCharCode(mapped), isAsciiWord: true, isCjk: false };
  }
  if (isCjkCodePoint(mapped)) {
    return { ch: String.fromCodePoint(mapped), isAsciiWord: false, isCjk: true };
  }
  if (isExtendedLetter(mapped)) {
    const ch = String.fromCodePoint(mapped).toLowerCase();
    return { ch, isAsciiWord: false, isCjk: false };
  }
  return null;
}

/**
 * Normalize raw text for search (lowercase, full-width->half-width, strip punctuation & spaces)
 * while tracking exact UTF-16 start indices back to `raw` and extracting ASCII word spans.
 */
export function normalizeSearchText(raw: string): NormalizedText {
  if (!raw) {
    return { raw: '', text: '', indexMap: new Int32Array(0), words: [] };
  }

  let text = '';
  const offsets: number[] = [];
  const words: IndexedWord[] = [];
  let wordBuf = '';
  let wordStart = -1;

  const flushWord = () => {
    if (wordBuf.length > 0 && wordStart >= 0) {
      words.push({
        word: wordBuf,
        start: wordStart,
        end: wordStart + wordBuf.length,
      });
    }
    wordBuf = '';
    wordStart = -1;
  };

  for (let i = 0; i < raw.length; ) {
    const cp = raw.codePointAt(i) ?? raw.charCodeAt(i);
    const step = cp > 0xffff ? 2 : 1;
    const norm = normalizeCodePoint(cp);

    if (!norm) {
      flushWord();
      i += step;
      continue;
    }

    const normIdx = text.length;
    text += norm.ch;
    if (norm.ch.length === 2) {
      offsets.push(i, i);
    } else {
      offsets.push(i);
    }

    if (norm.isAsciiWord) {
      if (wordStart < 0) {
        wordStart = normIdx;
      }
      wordBuf += norm.ch;
    } else {
      flushWord();
    }

    i += step;
  }

  flushWord();

  return {
    raw,
    text,
    indexMap: Int32Array.from(offsets),
    words,
  };
}

/** Split a user query on whitespace/full-width spaces, normalize each token, and deduplicate. */
export function tokenizeQuery(rawQuery: string): string[] {
  if (typeof rawQuery !== 'string') return [];
  const parts = rawQuery.split(/[\s\u3000]+/);
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    const normalized = normalizeSearchText(part).text;
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tokens.push(normalized);
  }

  return tokens;
}

function isPureAsciiToken(token: string): boolean {
  for (let i = 0; i < token.length; i++) {
    if (!isAsciiWordChar(token.charCodeAt(i))) {
      return false;
    }
  }
  return token.length > 0;
}

function hasCjkChars(token: string): boolean {
  for (let i = 0; i < token.length; ) {
    const cp = token.codePointAt(i) ?? token.charCodeAt(i);
    if (isCjkCodePoint(cp)) return true;
    i += cp > 0xffff ? 2 : 1;
  }
  return false;
}

function rawEndOffset(raw: string, startOffset: number): number {
  const cp = raw.codePointAt(startOffset);
  return startOffset + (cp !== undefined && cp > 0xffff ? 2 : 1);
}

function mapNormalizedSpanToHighlight(field: NormalizedText, startNorm: number, endNorm: number): HighlightRange[] {
  if (startNorm < 0 || endNorm <= startNorm || startNorm >= field.indexMap.length) {
    return [];
  }
  const safeEndNorm = Math.min(endNorm, field.indexMap.length);
  const startRaw = field.indexMap[startNorm]!;
  const lastNormRaw = field.indexMap[safeEndNorm - 1]!;
  return [{ start: startRaw, end: rawEndOffset(field.raw, lastNormRaw) }];
}

function mapNormalizedIndicesToHighlights(field: NormalizedText, indices: readonly number[]): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  for (const idx of indices) {
    if (idx >= 0 && idx < field.indexMap.length) {
      const rawStart = field.indexMap[idx]!;
      ranges.push({ start: rawStart, end: rawEndOffset(field.raw, rawStart) });
    }
  }
  return ranges;
}

/** Merge overlapping or adjacent raw highlight ranges `[start, end)` clamped to `[0, maxLen]`. */
export function mergeHighlightRanges(ranges: readonly HighlightRange[], maxLen: number): HighlightRange[] {
  if (ranges.length === 0 || maxLen <= 0) return [];
  const clean: HighlightRange[] = [];
  for (const r of ranges) {
    const start = Math.max(0, Math.min(maxLen, r.start));
    const end = Math.max(0, Math.min(maxLen, r.end));
    if (end > start) {
      clean.push({ start, end });
    }
  }
  if (clean.length === 0) return [];

  clean.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: HighlightRange[] = [{ ...clean[0]! }];
  for (let i = 1; i < clean.length; i++) {
    const next = clean[i]!;
    const tail = merged[merged.length - 1]!;
    if (next.start <= tail.end) {
      if (next.end > tail.end) {
        tail.end = next.end;
      }
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

/**
 * Optimal String Alignment (bounded Damerau-Levenshtein distance) returning `maxDist + 1`
 * early whenever no alignment within `maxDist` edits is possible.
 */
function damerauLevenshteinBounded(a: string, b: string, maxDist: number): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > maxDist) return maxDist + 1;
  if (a === b) return 0;
  if (n === 0) return m <= maxDist ? m : maxDist + 1;
  if (m === 0) return n <= maxDist ? n : maxDist + 1;

  const inf = maxDist + 1;
  let prev2 = new Int32Array(m + 1);
  let prev1 = new Int32Array(m + 1);
  let curr = new Int32Array(m + 1);

  for (let j = 0; j <= m; j++) {
    prev1[j] = j;
  }

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    const ai = a.charCodeAt(i - 1);

    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      const cost = ai === bj ? 0 : 1;

      let best = Math.min(
        prev1[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev1[j - 1]! + cost, // substitution
      );

      if (
        i > 1 &&
        j > 1 &&
        ai === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === bj
      ) {
        const trans = prev2[j - 2]! + cost;
        if (trans < best) {
          best = trans;
        }
      }

      curr[j] = best;
      if (best < rowMin) {
        rowMin = best;
      }
    }

    if (rowMin > maxDist) {
      // Check if an upcoming swap could save it? Next row transposition uses prev2 (= current prev1),
      // whose values + cost >= min(prev1) + cost. If even prev1 row minimum > maxDist, bail out cleanly.
      let prev1Min = inf;
      for (let j = 0; j <= m; j++) {
        if (prev1[j]! < prev1Min) prev1Min = prev1[j]!;
      }
      if (prev1Min > maxDist) {
        return inf;
      }
    }

    const tmp = prev2;
    prev2 = prev1;
    prev1 = curr;
    curr = tmp;
  }

  return prev1[m]! <= maxDist ? prev1[m]! : inf;
}

/** Layer 2: tightest-window ordered subsequence search (bounded iterations, O(N) worst case). */
function matchTightSubsequence(
  token: string,
  field: NormalizedText,
  collectHighlights: boolean,
): FieldTokenResult | null {
  const L = token.length;
  const hay = field.text;
  const H = hay.length;
  if (L < 2 || H < L) return null;

  const asciiMode = isPureAsciiToken(token);
  const maxSpan = Math.max(L * 8, L + 36);

  let bestScore = 0;
  let bestPositions: number[] | null = null;
  let searchFrom = 0;
  let windowsChecked = 0;

  while (windowsChecked < 8 && searchFrom <= H - L) {
    // Find forward subsequence positions
    const positions = new Array<number>(L);
    let cursor = searchFrom;
    let matched = true;

    for (let k = 0; k < L; k++) {
      const idx = hay.indexOf(token[k]!, cursor);
      if (idx === -1) {
        matched = false;
        break;
      }
      positions[k] = idx;
      cursor = idx + 1;
    }

    if (!matched) break;
    windowsChecked += 1;

    // Tighten backward from the matched end so start moves as close to end as possible
    let tightCursor = positions[L - 1]!;
    for (let k = L - 2; k >= 0; k--) {
      const ch = token[k]!;
      const idx = hay.lastIndexOf(ch, tightCursor - 1);
      if (idx >= positions[k]!) {
        positions[k] = idx;
        tightCursor = idx;
      } else {
        tightCursor = positions[k]!;
      }
    }

    const span = positions[L - 1]! - positions[0]! + 1;
    if (span <= maxSpan) {
      let adjacentPairs = 0;
      for (let k = 1; k < L; k++) {
        if (positions[k]! === positions[k - 1]! + 1) {
          adjacentPairs += 1;
        }
      }
      const density = L / span;
      const contiguity = adjacentPairs / (L - 1);

      if (!asciiMode || L < 4 || contiguity >= 0.35 || density >= 0.4) {
        const score = 0.56 + 0.18 * density + 0.14 * contiguity;
        if (score > bestScore) {
          bestScore = score;
          bestPositions = positions;
        }
      }
    }

    searchFrom = positions[0]! + 1;
  }

  if (bestScore <= 0 || !bestPositions) {
    return null;
  }

  return {
    score: bestScore,
    ranges: collectHighlights ? mapNormalizedIndicesToHighlights(field, bestPositions) : [],
  };
}

function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    counts.set(bg, (counts.get(bg) ?? 0) + 1);
  }
  let intersection = 0;
  for (let j = 0; j < b.length - 1; j++) {
    const bg = b.slice(j, j + 2);
    const c = counts.get(bg) ?? 0;
    if (c > 0) {
      intersection += 1;
      counts.set(bg, c - 1);
    }
  }
  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

/** Layer 3A: CJK local-window Bi-gram Dice + bounded Damerau-Levenshtein fuzzy match. */
function matchCjkFuzzy(
  token: string,
  field: NormalizedText,
  collectHighlights: boolean,
): FieldTokenResult | null {
  const L = token.length;
  const hay = field.text;
  const H = hay.length;
  if (L < 3 || H < 2 || !hasCjkChars(token)) return null;

  const maxEdit = L <= 4 ? 1 : 2;
  const candidates = new Set<number>();

  // Locate promising aligned window starts using query bigrams
  for (let i = 0; i < L - 1 && candidates.size < 16; i++) {
    const bg = token.slice(i, i + 2);
    let pos = hay.indexOf(bg);
    let hits = 0;
    while (pos !== -1 && hits < 4 && candidates.size < 16) {
      const approxStart = Math.max(0, pos - i);
      candidates.add(approxStart);
      if (approxStart > 0) candidates.add(approxStart - 1);
      pos = hay.indexOf(bg, pos + 1);
      hits += 1;
    }
  }

  // Fallback anchor for L === 3 with middle-char substitution (e.g. "图x试" vs "图灵试")
  if (candidates.size === 0 && L === 3) {
    const first = token[0]!;
    const last = token[2]!;
    let pos = hay.indexOf(first);
    let hits = 0;
    while (pos !== -1 && hits < 8 && candidates.size < 12) {
      if (pos + 2 < H && hay[pos + 2] === last) {
        candidates.add(pos);
      } else if (pos + 1 < H && hay[pos + 1] === last) {
        candidates.add(pos);
      }
      pos = hay.indexOf(first, pos + 1);
      hits += 1;
    }
  }

  let bestScore = 0;
  let bestStart = -1;
  let bestEnd = -1;

  for (const start of candidates) {
    const lenMin = Math.max(2, L - 1);
    const lenMax = Math.min(H - start, L + 1);
    for (let winLen = lenMin; winLen <= lenMax; winLen++) {
      const end = start + winLen;
      const slice = hay.slice(start, end);
      const dice = bigramDice(token, slice);
      const ed = damerauLevenshteinBounded(token, slice, maxEdit);

      if (ed > maxEdit && dice < 0.5) continue;

      const editSim = ed <= maxEdit ? 1 - ed / Math.max(L, slice.length) : 0;
      const sim = 0.65 * dice + 0.35 * editSim;
      if (sim < 0.45) continue;

      const score = 0.42 + 0.36 * sim;
      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
        bestEnd = end;
      }
    }
  }

  if (bestScore <= 0 || bestStart < 0) {
    return null;
  }

  return {
    score: bestScore,
    ranges: collectHighlights ? mapNormalizedSpanToHighlight(field, bestStart, bestEnd) : [],
  };
}

/** Layer 3B: English / alphanumeric word Damerau-Levenshtein fuzzy match. */
function matchAsciiWordFuzzy(
  token: string,
  field: NormalizedText,
  collectHighlights: boolean,
): FieldTokenResult | null {
  const L = token.length;
  if (L < 3 || !isPureAsciiToken(token) || field.words.length === 0) {
    return null;
  }

  const maxDist = L <= 4 ? 1 : 2;
  let bestScore = 0;
  let bestWord: IndexedWord | null = null;

  for (const entry of field.words) {
    if (Math.abs(entry.word.length - L) > maxDist) continue;
    const dist = damerauLevenshteinBounded(token, entry.word, maxDist);
    if (dist > maxDist) continue;

    const sim = 1 - dist / Math.max(L, entry.word.length);
    if (sim < 0.6) continue;

    const score = 0.45 + 0.37 * sim;
    if (score > bestScore) {
      bestScore = score;
      bestWord = entry;
    }
  }

  if (bestScore <= 0 || !bestWord) {
    return null;
  }

  return {
    score: bestScore,
    ranges: collectHighlights ? mapNormalizedSpanToHighlight(field, bestWord.start, bestWord.end) : [],
  };
}

/** Score a single query token against one normalized field entry using the 4-layer cascade. */
function scoreTokenOnField(
  token: string,
  field: NormalizedText,
  collectHighlights: boolean,
): FieldTokenResult | null {
  if (!field.text || !token) return null;

  // Layer 1: Exact substring on normalized text (fast path)
  const exactIdx = field.text.indexOf(token);
  if (exactIdx !== -1) {
    const posBonus = 1 - exactIdx / Math.max(1, field.text.length);
    const score = 0.96 + 0.04 * posBonus;
    if (!collectHighlights) {
      return { score, ranges: [] };
    }
    const ranges: HighlightRange[] = [];
    let scan = exactIdx;
    let count = 0;
    while (scan !== -1 && count < 8) {
      ranges.push(...mapNormalizedSpanToHighlight(field, scan, scan + token.length));
      scan = field.text.indexOf(token, scan + token.length);
      count += 1;
    }
    return { score, ranges };
  }

  // Layer 2: Tightest-window ordered subsequence match
  const subseq = matchTightSubsequence(token, field, collectHighlights);
  if (subseq && subseq.score >= 0.72) {
    return subseq;
  }

  // Layer 3A / 3B: Fuzzy typo tolerance
  const cjkFuzzy = matchCjkFuzzy(token, field, collectHighlights);
  const asciiFuzzy = matchAsciiWordFuzzy(token, field, collectHighlights);

  let best: FieldTokenResult | null = subseq;
  if (cjkFuzzy && (!best || cjkFuzzy.score > best.score)) {
    best = cjkFuzzy;
  }
  if (asciiFuzzy && (!best || asciiFuzzy.score > best.score)) {
    best = asciiFuzzy;
  }
  return best;
}

function buildChapterLabelLookup(
  chapters?: FuzzySearchOptions['chapters'],
): Map<number, string> {
  const map = new Map<number, string>();
  if (!chapters) return map;

  if (chapters instanceof Map) {
    chapters.forEach((val, key) => {
      if (typeof val === 'string') {
        if (val.trim()) map.set(key, val.trim());
      } else if (val && typeof val === 'object') {
        const text = [val.short, val.title].filter(Boolean).join(' ');
        if (text) map.set(key, text);
      }
    });
    return map;
  }

  if (Array.isArray(chapters)) {
    for (const ch of chapters) {
      const text = [ch.short, ch.title].filter(Boolean).join(' ');
      if (text) map.set(ch.id, text);
    }
    return map;
  }

  const record = chapters as Readonly<Record<number, string>>;
  for (const key of Object.keys(record)) {
    const id = Number(key);
    const val = record[id];
    if (Number.isInteger(id) && typeof val === 'string' && val.trim()) {
      map.set(id, val.trim());
    }
  }
  return map;
}

function buildNormalizedList(strings: readonly (string | undefined | null)[]): NormalizedText[] {
  const out: NormalizedText[] = [];
  for (const raw of strings) {
    if (typeof raw !== 'string') continue;
    if (!raw.trim()) continue;
    const norm = normalizeSearchText(raw);
    if (norm.text.length > 0) {
      out.push(norm);
    }
  }
  return out;
}

function resolveWeights(overrides?: Partial<Record<FuzzySearchField, number>>): Record<FuzzySearchField, number> {
  return {
    stem: overrides?.stem ?? DEFAULT_FIELD_WEIGHTS.stem,
    options: overrides?.options ?? DEFAULT_FIELD_WEIGHTS.options,
    chapter: overrides?.chapter ?? DEFAULT_FIELD_WEIGHTS.chapter,
    tags: overrides?.tags ?? DEFAULT_FIELD_WEIGHTS.tags,
    explanation: overrides?.explanation ?? DEFAULT_FIELD_WEIGHTS.explanation,
  };
}

/**
 * Build a reusable normalized search index over a question array.
 * Ideal for interactive search-as-you-type UIs where `query` updates on every keystroke.
 */
export function createQuestionSearchIndex<T extends SearchableQuestion = Question>(
  questions: readonly T[],
  options?: Pick<FuzzySearchOptions, 'chapters'>,
): QuestionSearchIndex<T> {
  const chapterLookup = buildChapterLabelLookup(options?.chapters);

  const indexed: IndexedQuestion<T>[] = questions.map((q, orderIndex) => {
    const chapterStrings: string[] = [];
    if (Number.isInteger(q.chapter) && q.chapter > 0) {
      chapterStrings.push(`第${q.chapter}章`);
      const chName = chapterLookup.get(q.chapter);
      if (chName) chapterStrings.push(chName);
    }
    if (q.chapterName) {
      chapterStrings.push(q.chapterName);
    }

    return {
      question: q,
      orderIndex,
      stem: normalizeSearchText(q.stem ?? ''),
      options: buildNormalizedList(q.options ?? []),
      chapter: buildNormalizedList(chapterStrings),
      tags: buildNormalizedList(q.tags ?? []),
      explanation: buildNormalizedList([
        q.explain,
        q.explanation,
        ...(q.keyPoints ?? []),
        q.aiAnalysis,
      ]),
    };
  });

  const search = (
    query: string,
    searchOptions?: Omit<FuzzySearchOptions, 'chapters'>,
  ): FuzzySearchMatch<T>[] => {
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0 || indexed.length === 0) {
      return [];
    }

    const weights = resolveWeights(searchOptions?.fieldWeights);
    const minScore = searchOptions?.minScore ?? DEFAULT_MIN_SCORE;
    const minTokensMatched =
      tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.6);

    const results: Array<{ match: FuzzySearchMatch<T>; orderIndex: number }> = [];

    for (const item of indexed) {
      let matchedTokens = 0;
      let weightedTokenSum = 0;
      const fieldBestWeighted = new Map<FuzzySearchField, number>();
      const rawStemRanges: HighlightRange[] = [];

      for (const token of tokens) {
        let primaryWeighted = 0;
        let secondaryWeightedSum = 0;
        let tokenMatched = false;

        // Evaluate all 5 fields independently so secondary hits break ties cleanly
        const fieldSources: readonly [FuzzySearchField, readonly NormalizedText[], boolean][] = [
          ['stem', [item.stem], true],
          ['options', item.options, false],
          ['chapter', item.chapter, false],
          ['tags', item.tags, false],
          ['explanation', item.explanation, false],
        ];

        for (const [fieldKey, entries, isStem] of fieldSources) {
          let bestEntryScore = 0;
          for (const entry of entries) {
            const hit = scoreTokenOnField(token, entry, isStem);
            if (!hit) continue;
            if (isStem && hit.ranges.length > 0) {
              rawStemRanges.push(...hit.ranges);
            }
            if (hit.score > bestEntryScore) {
              bestEntryScore = hit.score;
            }
          }

          if (bestEntryScore > 0) {
            tokenMatched = true;
            const weighted = bestEntryScore * weights[fieldKey];
            const prevBest = fieldBestWeighted.get(fieldKey) ?? 0;
            if (weighted > prevBest) {
              fieldBestWeighted.set(fieldKey, weighted);
            }
            if (weighted > primaryWeighted) {
              secondaryWeightedSum += primaryWeighted;
              primaryWeighted = weighted;
            } else {
              secondaryWeightedSum += weighted;
            }
          }
        }

        if (tokenMatched) {
          matchedTokens += 1;
          weightedTokenSum += primaryWeighted + secondaryWeightedSum * 0.08;
        }
      }

      if (matchedTokens < minTokensMatched) {
        continue;
      }

      const coverage = matchedTokens / tokens.length;
      const coverageMultiplier = coverage === 1 ? 1.25 : coverage * coverage;
      const finalScore = (weightedTokenSum / tokens.length) * coverageMultiplier;

      if (finalScore < minScore) {
        continue;
      }

      const matchedFields = FIELD_ORDER.filter((f) => fieldBestWeighted.has(f));
      matchedFields.sort(
        (a, b) => (fieldBestWeighted.get(b) ?? 0) - (fieldBestWeighted.get(a) ?? 0),
      );

      const hasStemMatch = matchedFields.includes('stem');
      const stemHighlights = hasStemMatch
        ? mergeHighlightRanges(rawStemRanges, item.stem.raw.length)
        : [];

      results.push({
        orderIndex: item.orderIndex,
        match: {
          question: item.question,
          score: Math.round(finalScore * 10000) / 10000,
          matchedFields,
          matchedNonStemOnly: !hasStemMatch,
          stemHighlights,
        },
      });
    }

    results.sort((a, b) => {
      if (b.match.score !== a.match.score) {
        return b.match.score - a.match.score;
      }
      if (a.match.matchedNonStemOnly !== b.match.matchedNonStemOnly) {
        return a.match.matchedNonStemOnly ? 1 : -1;
      }
      return a.orderIndex - b.orderIndex;
    });

    const matches = results.map((r) => r.match);
    if (searchOptions?.limit !== undefined && searchOptions.limit > 0) {
      return matches.slice(0, searchOptions.limit);
    }
    return matches;
  };

  return {
    size: indexed.length,
    search,
  };
}

/**
 * Search a collection of questions using the four-layer hybrid fuzzy retrieval engine.
 * Automatically caches a normalized index per array reference when `options.chapters` is omitted.
 */
export function searchQuestions<T extends SearchableQuestion = Question>(
  questions: readonly T[],
  query: string,
  options?: FuzzySearchOptions,
): FuzzySearchMatch<T>[] {
  if (!query || !query.trim() || questions.length === 0) {
    return [];
  }

  if (!options?.chapters) {
    let cached = defaultIndexCache.get(questions) as QuestionSearchIndex<T> | undefined;
    if (!cached || cached.size !== questions.length) {
      cached = createQuestionSearchIndex(questions);
      defaultIndexCache.set(
        questions,
        cached as unknown as QuestionSearchIndex<SearchableQuestion>,
      );
    }
    return cached.search(query, options);
  }

  return createQuestionSearchIndex(questions, { chapters: options.chapters }).search(
    query,
    options,
  );
}
