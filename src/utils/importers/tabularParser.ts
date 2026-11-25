import type { ImportSourceFormat } from '../quizImportTypes';
import type { DraftQuestion } from '../quizImportTypes';
import {
  annotateDuplicateStems,
  cleanText,
  extractChapterInfo,
  normalizeFullwidthAscii,
  parseAnswer,
  parseQuestionType,
  stripBom,
  stripOptionLabelPrefix,
  validateDraftQuestion,
} from './normalize';

type CanonicalField =
  | 'stem'
  | 'type'
  | 'options'
  | 'answer'
  | 'explain'
  | 'chapter'
  | 'keyPoints'
  | 'tags'
  | 'sourceRef'
  | 'term'
  | 'definition';

interface ColumnMapping {
  headerRowIndex: number;
  fields: Partial<Record<CanonicalField, number>>;
  optionCols: { index: number; slot: number }[];
}

const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  stem: [
    '题干',
    '题目',
    '题目内容',
    '题目名称',
    '问题',
    '试题',
    '试题内容',
    '标题',
    'stem',
    'question',
    'prompt',
    'title',
  ],
  type: ['题型', '题目类型', '试题类型', '类型', 'type', 'questiontype', 'qtype'],
  options: ['选项', '候选选项', '全部选项', 'options', 'choices'],
  answer: [
    '答案',
    '正确答案',
    '参考答案',
    '标准答案',
    'answer',
    'correct',
    'correctanswer',
    'ans',
  ],
  explain: ['解析', '答案解析', '试题解析', '解题思路', '说明', 'explain', 'explanation', 'rationale'],
  chapter: [
    '章节',
    '所属章节',
    '章',
    '单元',
    '分类',
    '目录',
    '知识点',
    '模块',
    'chapter',
    'category',
    'unit',
    'section',
  ],
  keyPoints: ['要点', '采分点', '采分要点', '关键词', 'keypoints', 'points'],
  tags: ['标签', '标签词', '考点', 'tags', 'tag'],
  sourceRef: ['编号', '题号', '来源编号', '出处', 'ref', 'sourceref', 'id'],
  term: ['词语', '术语', '正面', 'term', 'front'],
  definition: ['定义', '释义', '背面', 'definition', 'back'],
};

const OPTION_HEADER_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function normalizeHeaderCell(raw: string): string {
  return normalizeFullwidthAscii(cleanText(raw))
    .replace(/[(（]\s*(?:必填|选填|可选|required|optional)\s*[)）]/gi, '')
    .replace(/[*＊:：_\-\s]/g, '')
    .toLowerCase();
}

function matchCanonicalField(normalizedHeader: string): CanonicalField | null {
  if (!normalizedHeader) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [
    CanonicalField,
    string[],
  ][]) {
    if (aliases.includes(normalizedHeader)) {
      return field;
    }
  }
  if (normalizedHeader.includes('题干') || normalizedHeader.includes('题目内容')) {
    return 'stem';
  }
  if (normalizedHeader.includes('解析')) {
    return 'explain';
  }
  if (normalizedHeader.includes('正确答案') || normalizedHeader.includes('参考答案')) {
    return 'answer';
  }
  if (normalizedHeader.includes('题型') || normalizedHeader.includes('题目类型')) {
    return 'type';
  }
  return null;
}

function matchOptionColumnSlot(normalizedHeader: string): number | null {
  if (!normalizedHeader) return null;
  const letterIdx = OPTION_HEADER_LETTERS.indexOf(normalizedHeader);
  if (letterIdx >= 0) return letterIdx;

  const optLetter = normalizedHeader.match(/^(?:选项|选择|option|choice|opt)([a-h])$/);
  if (optLetter) {
    return OPTION_HEADER_LETTERS.indexOf(optLetter[1]!);
  }

  const optNum = normalizedHeader.match(/^(?:选项|选择|option|choice|opt)(\d+)$/);
  if (optNum) {
    const n = Number.parseInt(optNum[1]!, 10);
    if (n >= 1 && n <= 8) return n - 1;
  }

  return null;
}

function detectHeaderRow(rows: string[][]): ColumnMapping | null {
  const maxScan = Math.min(rows.length, 6);
  let bestMapping: ColumnMapping | null = null;
  let bestScore = 0;

  for (let r = 0; r < maxScan; r++) {
    const row = rows[r]!;
    const fields: Partial<Record<CanonicalField, number>> = {};
    const optionCols: { index: number; slot: number }[] = [];
    let score = 0;

    for (let c = 0; c < row.length; c++) {
      const norm = normalizeHeaderCell(row[c] ?? '');
      if (!norm) continue;

      const optSlot = matchOptionColumnSlot(norm);
      if (optSlot !== null) {
        optionCols.push({ index: c, slot: optSlot });
        score += 1;
        continue;
      }

      const field = matchCanonicalField(norm);
      if (field && fields[field] === undefined) {
        fields[field] = c;
        score += field === 'stem' || field === 'answer' || field === 'term' ? 3 : 2;
      }
    }

    const hasStemOrTerm = fields.stem !== undefined || fields.term !== undefined;
    const hasAnswerOrDef =
      fields.answer !== undefined || fields.definition !== undefined;
    if (hasStemOrTerm && (hasAnswerOrDef || optionCols.length >= 2) && score > bestScore) {
      bestScore = score;
      bestMapping = {
        headerRowIndex: r,
        fields,
        optionCols: optionCols.sort((a, b) => a.slot - b.slot),
      };
    }
  }

  return bestMapping;
}

export function splitCombinedOptions(raw: string): string[] {
  const cleaned = cleanText(raw);
  if (!cleaned) return [];

  if (cleaned.includes('\n')) {
    const lines = cleaned.split('\n').map((l) => stripOptionLabelPrefix(l)).filter(Boolean);
    if (lines.length >= 2) return lines;
  }

  if (/[|｜]|##|;;/.test(cleaned)) {
    const parts = cleaned
      .split(/\s*(?:\|\||[|｜]|##|;;)\s*/)
      .map((p) => stripOptionLabelPrefix(p))
      .filter(Boolean);
    if (parts.length >= 2) return parts;
  }

  const inline = normalizeFullwidthAscii(cleaned);
  const markerRegex = /(?:^|\s)[(\[（]?([A-Ha-h])[)\]）.、:：]\s*/g;
  const matches = Array.from(inline.matchAll(markerRegex));
  if (matches.length >= 2) {
    const parsed: string[] = [];
    for (let i = 0; i < matches.length; i++) {
      const start = (matches[i]!.index ?? 0) + matches[i]![0].length;
      const end =
        i + 1 < matches.length ? (matches[i + 1]!.index ?? inline.length) : inline.length;
      const item = cleanText(inline.slice(start, end));
      if (item) parsed.push(item);
    }
    if (parsed.length >= 2) return parsed;
  }

  return [stripOptionLabelPrefix(cleaned)].filter(Boolean);
}

export function decodeTextBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    try {
      return stripBom(new TextDecoder('gbk').decode(bytes));
    } catch {
      return stripBom(new TextDecoder('utf-8').decode(bytes));
    }
  }
}

function detectDelimiter(sample: string): ',' | '\t' | ';' {
  const firstLines = sample.split(/\r\n?|\n/).slice(0, 5).join('\n');
  let tabs = 0;
  let commas = 0;
  let semis = 0;
  let inQuotes = false;

  for (let i = 0; i < firstLines.length; i++) {
    const ch = firstLines[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === '\t') tabs += 1;
      else if (ch === ',') commas += 1;
      else if (ch === ';') semis += 1;
    }
  }

  if (tabs > 0 && tabs >= commas) return '\t';
  if (commas >= semis) return ',';
  return ';';
}

export function parseDelimitedText(text: string): string[][] {
  const cleanInput = stripBom(text).replace(/\r\n?/g, '\n');
  if (!cleanInput.trim()) return [];

  const delimiter = detectDelimiter(cleanInput);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleanInput.length; i++) {
    const ch = cleanInput[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (cleanInput[i + 1] === '"') {
          currentCell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (ch === '\n') {
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim().length > 0));
}

export function parseTabularRows(
  rawRows: string[][],
  opts: {
    sourceFormat: ImportSourceFormat;
    defaultChapterId?: number;
    defaultChapterName?: string;
    sheetName?: string;
  },
): { drafts: DraftQuestion[]; notes: string[] } {
  const rows = rawRows
    .map((r) => r.map((cell) => cleanText(cell)))
    .filter((r) => r.some((c) => c.length > 0));

  if (rows.length === 0) {
    return { drafts: [], notes: [] };
  }

  const notes: string[] = [];
  const mapping = detectHeaderRow(rows);
  const defaultChId = opts.defaultChapterId ?? 1;
  const defaultChName = cleanText(opts.defaultChapterName) || `第 ${defaultChId} 章`;

  if (!mapping) {
    const twoColLike = rows.filter((r) => r.filter(Boolean).length >= 2).length;
    if (twoColLike >= Math.max(1, Math.floor(rows.length * 0.6))) {
      notes.push(
        `${opts.sheetName ? `[${opts.sheetName}] ` : ''}未检测到标准表头，已按两列“题干/词语 — 答案/定义”格式解析`,
      );
      const drafts = rows.map((row, idx) => {
        const stem = cleanText(row[0]);
        const rawAnswer = cleanText(row[1]);
        const explain = cleanText(row[2]);
        const type = parseQuestionType('', { rawAnswer, stem });
        const parsedAns = parseAnswer(type, rawAnswer, []);
        const draft: DraftQuestion = {
          tempId: `tab-${opts.sheetName ?? 'sheet'}-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
          sourceLoc: `${opts.sheetName ? `${opts.sheetName} · ` : ''}第 ${idx + 1} 行`,
          sourceFormat: opts.sourceFormat,
          type,
          chapter: defaultChId,
          chapterName: defaultChName,
          stem,
          options: [],
          answer: parsedAns.answer,
          rawAnswer,
          explain,
          keyPoints: [],
          tags: [],
          sourceRef: `${opts.sheetName ? `${opts.sheetName} ` : ''}R${idx + 1}`,
          issues: parsedAns.issues,
          included: true,
        };
        return validateDraftQuestion(draft);
      });
      return { drafts: annotateDuplicateStems(drafts), notes };
    }

    notes.push(
      `${opts.sheetName ? `[${opts.sheetName}] ` : ''}未能识别表头（需包含“题干/题目/Term”与“答案/正确答案/Definition”列）`,
    );
    return { drafts: [], notes };
  }

  const drafts: DraftQuestion[] = [];
  const startRow = mapping.headerRowIndex + 1;
  const stemCol = mapping.fields.stem ?? mapping.fields.term;
  const ansCol = mapping.fields.answer ?? mapping.fields.definition;

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r]!;
    const stem = stemCol !== undefined ? cleanText(row[stemCol]) : '';
    const rawType = mapping.fields.type !== undefined ? cleanText(row[mapping.fields.type]) : '';
    const rawAnswer = ansCol !== undefined ? cleanText(row[ansCol]) : '';
    const explain =
      mapping.fields.explain !== undefined ? cleanText(row[mapping.fields.explain]) : '';
    const rawChapter =
      mapping.fields.chapter !== undefined ? cleanText(row[mapping.fields.chapter]) : '';
    const rawKeyPoints =
      mapping.fields.keyPoints !== undefined ? cleanText(row[mapping.fields.keyPoints]) : '';
    const rawTags = mapping.fields.tags !== undefined ? cleanText(row[mapping.fields.tags]) : '';
    const sourceRef =
      mapping.fields.sourceRef !== undefined ? cleanText(row[mapping.fields.sourceRef]) : '';

    let options: string[] = [];
    if (mapping.optionCols.length > 0) {
      const collected: string[] = [];
      for (const col of mapping.optionCols) {
        const val = cleanText(row[col.index]);
        if (val) {
          collected.push(stripOptionLabelPrefix(val));
        }
      }
      options = collected;
    } else if (mapping.fields.options !== undefined) {
      options = splitCombinedOptions(row[mapping.fields.options] ?? '');
    }

    if (!stem && !rawAnswer && options.length === 0) {
      continue;
    }

    const type = parseQuestionType(rawType, { options, rawAnswer, stem });
    const parsedAns = parseAnswer(type, rawAnswer, options);

    const chInfo = rawChapter
      ? extractChapterInfo(rawChapter, defaultChId)
      : { chapter: defaultChId, chapterName: defaultChName };

    const keyPoints = rawKeyPoints
      ? rawKeyPoints.split(/[,，;；|\n、]+/).map((s) => s.trim()).filter(Boolean)
      : [];
    const tags = rawTags
      ? rawTags.split(/[,，;；|\n、]+/).map((s) => s.trim()).filter(Boolean)
      : [];

    const draft: DraftQuestion = {
      tempId: `tab-${opts.sheetName ?? 'sheet'}-${r + 1}-${Math.random().toString(36).slice(2, 6)}`,
      sourceLoc: `${opts.sheetName ? `${opts.sheetName} · ` : ''}第 ${r + 1} 行`,
      sourceFormat: opts.sourceFormat,
      type,
      chapter: chInfo.chapter,
      chapterName: chInfo.chapterName,
      stem,
      options: type === 'choice' || type === 'multi' ? options : [],
      answer: parsedAns.answer,
      rawAnswer,
      explain,
      keyPoints,
      tags,
      sourceRef: sourceRef || `${opts.sheetName ? `${opts.sheetName} ` : ''}R${r + 1}`,
      issues: parsedAns.issues,
      included: true,
    };

    drafts.push(validateDraftQuestion(draft));
  }

  return { drafts: annotateDuplicateStems(drafts), notes };
}
