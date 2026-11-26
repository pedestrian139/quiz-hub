import type { QuestionOrigin, QuestionType } from '../../types/quiz';
import {
  QUIZHUB_SHARE_SCHEMA,
  type DraftQuestion,
  type ImportParseResult,
} from '../quizImportTypes';
import {
  annotateDuplicateStems,
  cleanText,
  extractChapterInfo,
  formatDraftRawAnswer,
  normalizeFullwidthAscii,
  parseAnswer,
  parseQuestionType,
  stripOptionLabelPrefix,
  suggestBankNameFromFile,
  validateDraftQuestion,
} from './normalize';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const VALID_V1_ORIGINS = new Set<QuestionOrigin>([
  'comprehensive_bank',
  'video_popup',
  'review_notes_synthesized',
]);

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.getOwnPropertyNames(value);
  return !keys.some((k) => DANGEROUS_KEYS.has(k));
}

function normalizeJsonOptions(item: Record<string, unknown>): string[] {
  const rawOpts = item.options ?? item.choices ?? item.选项;
  if (Array.isArray(rawOpts)) {
    return rawOpts
      .map((entry) => {
        if (typeof entry === 'string') return stripOptionLabelPrefix(cleanText(entry));
        if (isSafeRecord(entry)) {
          return stripOptionLabelPrefix(
            cleanText(entry.text ?? entry.label ?? entry.content ?? entry.value),
          );
        }
        return cleanText(entry);
      })
      .filter(Boolean);
  }

  if (isSafeRecord(rawOpts)) {
    const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const collected: string[] = [];
    for (const k of keys) {
      const v = rawOpts[k] ?? rawOpts[k.toLowerCase()];
      const txt = cleanText(v);
      if (txt) collected.push(stripOptionLabelPrefix(txt));
    }
    if (collected.length > 0) return collected;
  }

  const flatLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const flatOpts: string[] = [];
  for (const letter of flatLetters) {
    const rawVal =
      item[`option${letter}`] ??
      item[`option_${letter.toLowerCase()}`] ??
      item[`选项${letter}`] ??
      item[letter];
    const txt = cleanText(rawVal);
    if (txt) flatOpts.push(stripOptionLabelPrefix(txt));
  }
  return flatOpts;
}

function normalizeStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => cleanText(v)).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,，;；|\n、]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function parseExternalQuestionArray(
  items: unknown[],
  chapterNameById: Map<number, string>,
): DraftQuestion[] {
  const drafts: DraftQuestion[] = [];

  items.forEach((rawItem, idx) => {
    if (!isSafeRecord(rawItem)) return;

    const stem = cleanText(
      rawItem.stem ??
        rawItem.question ??
        rawItem.title ??
        rawItem.content ??
        rawItem.prompt ??
        rawItem.题干 ??
        rawItem.题目 ??
        rawItem.问题,
    );

    const options = normalizeJsonOptions(rawItem);
    const rawAnsVal =
      rawItem.answer ??
      rawItem.correctAnswer ??
      rawItem.correct ??
      rawItem.right ??
      rawItem.ans ??
      rawItem.答案 ??
      rawItem.正确答案 ??
      rawItem.参考答案;

    let rawAnsStr = '';
    if (Array.isArray(rawAnsVal)) {
      if (rawAnsVal.every((v) => typeof v === 'number' && Number.isInteger(v))) {
        rawAnsStr = (rawAnsVal as number[])
          .map((n) => (n >= 0 && n < 26 ? String.fromCharCode(65 + n) : String(n)))
          .join('');
      } else {
        rawAnsStr = rawAnsVal.map((v) => cleanText(v)).join(',');
      }
    } else if (typeof rawAnsVal === 'boolean') {
      rawAnsStr = rawAnsVal ? '正确' : '错误';
    } else if (typeof rawAnsVal === 'number' && Number.isInteger(rawAnsVal)) {
      rawAnsStr =
        rawAnsVal >= 0 && rawAnsVal < 26
          ? String.fromCharCode(65 + rawAnsVal)
          : String(rawAnsVal);
    } else {
      rawAnsStr = cleanText(rawAnsVal);
    }

    const rawTypeStr = cleanText(
      rawItem.type ?? rawItem.questionType ?? rawItem.qtype ?? rawItem.题型 ?? rawItem.题目类型,
    );
    const inferredType: QuestionType = parseQuestionType(rawTypeStr, {
      options,
      rawAnswer: rawAnsStr,
      stem,
    });

    // If native numeric 0-based index was supplied for choice/multi
    let typedAnswer: number | number[] | boolean | string;
    let answerIssues: DraftQuestion['issues'] = [];

    if (
      inferredType === 'choice' &&
      typeof rawAnsVal === 'number' &&
      Number.isInteger(rawAnsVal) &&
      rawAnsVal >= 0 &&
      rawAnsVal < options.length
    ) {
      typedAnswer = rawAnsVal;
      rawAnsStr = formatDraftRawAnswer('choice', rawAnsVal);
    } else if (
      inferredType === 'multi' &&
      Array.isArray(rawAnsVal) &&
      rawAnsVal.length > 0 &&
      rawAnsVal.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < options.length)
    ) {
      const sorted = Array.from(new Set(rawAnsVal as number[])).sort((a, b) => a - b);
      typedAnswer = sorted;
      rawAnsStr = formatDraftRawAnswer('multi', sorted);
    } else if (inferredType === 'tf' && typeof rawAnsVal === 'boolean') {
      typedAnswer = rawAnsVal;
      rawAnsStr = rawAnsVal ? '正确' : '错误';
    } else {
      const parsed = parseAnswer(inferredType, normalizeFullwidthAscii(rawAnsStr), options);
      typedAnswer = parsed.answer;
      answerIssues = parsed.issues;
    }

    const rawCh = rawItem.chapter ?? rawItem.chapterId ?? rawItem.category ?? rawItem.section ?? rawItem.章节;
    const rawChName = cleanText(rawItem.chapterName ?? rawItem.章节名称);
    let chapter = 1;
    let chapterName = '第 1 章';

    if (typeof rawCh === 'number' && Number.isInteger(rawCh) && rawCh > 0) {
      chapter = rawCh;
      chapterName = rawChName || chapterNameById.get(rawCh) || `第 ${rawCh} 章`;
    } else if (typeof rawCh === 'string' && rawCh.trim()) {
      const info = extractChapterInfo(rawCh, 1);
      chapter = info.chapter;
      chapterName = rawChName || info.chapterName;
    } else if (rawChName) {
      const info = extractChapterInfo(rawChName, 1);
      chapter = info.chapter;
      chapterName = info.chapterName;
    }

    const explainCandidates = [
      rawItem.explain,
      rawItem.explanation,
      rawItem.aiAnalysis,
      rawItem.analysis,
      rawItem.rationale,
      rawItem.解析,
      rawItem.答案解析,
    ];
    let explain = '';
    for (const candidate of explainCandidates) {
      if (
        typeof candidate !== 'string' &&
        !(typeof candidate === 'number' && Number.isFinite(candidate))
      ) {
        continue;
      }
      const cleaned = cleanText(candidate);
      if (cleaned) {
        explain = cleaned;
        break;
      }
    }
    const keyPoints = normalizeStringList(rawItem.keyPoints ?? rawItem.points ?? rawItem.要点 ?? rawItem.采分点);
    const tags = normalizeStringList(rawItem.tags ?? rawItem.标签);
    const aiInferredAnswer = rawItem.aiInferredAnswer === true;

    let sourceRef = `JSON #${idx + 1}`;
    let sourceNote: string | undefined;
    let preserveOrigin: DraftQuestion['preserveOrigin'];

    if (isSafeRecord(rawItem.source)) {
      const ref = cleanText(rawItem.source.ref);
      if (ref) sourceRef = ref;
      const note = cleanText(rawItem.source.note);
      if (note) sourceNote = note;
      const orig = cleanText(rawItem.source.origin) as QuestionOrigin;
      if (VALID_V1_ORIGINS.has(orig)) {
        preserveOrigin = orig;
      }
    }

    const draft: DraftQuestion = {
      tempId: `json-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
      sourceLoc: `第 ${idx + 1} 项`,
      sourceFormat: 'json',
      type: inferredType,
      chapter,
      chapterName,
      stem,
      options: inferredType === 'choice' || inferredType === 'multi' ? options : [],
      answer: typedAnswer,
      rawAnswer: rawAnsStr,
      explain,
      keyPoints,
      tags,
      sourceRef,
      ...(sourceNote ? { sourceNote } : {}),
      ...(preserveOrigin ? { preserveOrigin } : {}),
      ...(aiInferredAnswer ? { aiInferredAnswer: true } : {}),
      issues: answerIssues,
      included: true,
    };

    drafts.push(validateDraftQuestion(draft));
  });

  return annotateDuplicateStems(drafts);
}

export function parseJsonBank(rawText: string, fileName?: string): ImportParseResult {
  const defaultName = suggestBankNameFromFile(fileName, 'JSON 导入题库');
  const trimmed = cleanText(rawText);
  if (!trimmed) {
    return {
      format: 'json',
      suggestedName: defaultName,
      drafts: [],
      notes: [],
      fatalError: 'JSON 内容为空',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      format: 'json',
      suggestedName: defaultName,
      drafts: [],
      notes: [],
      fatalError: 'JSON 语法格式无效，请检查文件内容',
    };
  }

  if (Array.isArray(parsed)) {
    const drafts = parseExternalQuestionArray(parsed, new Map());
    return {
      format: 'json',
      suggestedName: defaultName,
      drafts,
      notes: drafts.length > 0 ? [`已从 JSON 数组识别 ${drafts.length} 道题目`] : [],
      ...(drafts.length === 0 ? { fatalError: 'JSON 数组中未找到有效题目对象' } : {}),
    };
  }

  if (!isSafeRecord(parsed)) {
    return {
      format: 'json',
      suggestedName: defaultName,
      drafts: [],
      notes: [],
      fatalError: '无效的 JSON 结构：根节点必须为安全对象或题目数组',
    };
  }

  // Case 1: QuizHub share package (.quizhub.json)
  if (parsed.schema === QUIZHUB_SHARE_SCHEMA && isSafeRecord(parsed.bank)) {
    const bankObj = parsed.bank;
    const bankData = isSafeRecord(bankObj.data) ? bankObj.data : null;
    if (!bankData || !Array.isArray(bankData.questions)) {
      return {
        format: 'json',
        suggestedName: defaultName,
        drafts: [],
        notes: [],
        fatalError: 'QuizHub 分享包缺少题目数据（bank.data.questions）',
      };
    }

    const chMap = new Map<number, string>();
    if (Array.isArray(bankData.chapters)) {
      for (const ch of bankData.chapters) {
        if (isSafeRecord(ch) && typeof ch.id === 'number') {
          chMap.set(ch.id, cleanText(ch.short || ch.title));
        }
      }
    }

    const drafts = parseExternalQuestionArray(bankData.questions, chMap);
    const pkgName = cleanText(bankObj.name) || defaultName;
    const pkgDesc = cleanText(bankObj.description) || undefined;
    return {
      format: 'json',
      suggestedName: pkgName,
      suggestedDescription: pkgDesc,
      drafts,
      notes: [`已无损解析 QuizHub 分享包《${pkgName}》，共 ${drafts.length} 题`],
    };
  }

  // Case 2: Native BankData ({ meta, chapters, questions })
  if (Array.isArray(parsed.questions)) {
    const chMap = new Map<number, string>();
    if (Array.isArray(parsed.chapters)) {
      for (const ch of parsed.chapters) {
        if (isSafeRecord(ch) && typeof ch.id === 'number') {
          chMap.set(ch.id, cleanText(ch.short || ch.title));
        }
      }
    }
    const metaTitle =
      isSafeRecord(parsed.meta) && typeof parsed.meta.title === 'string'
        ? cleanText(parsed.meta.title)
        : '';
    const drafts = parseExternalQuestionArray(parsed.questions, chMap);
    return {
      format: 'json',
      suggestedName: metaTitle || defaultName,
      drafts,
      notes: [`已解析 JSON 题库（共 ${drafts.length} 题）`],
    };
  }

  // Case 3: Common external wrappers { data | items | list | records | bank }
  for (const key of ['data', 'items', 'list', 'records', 'rows', 'bank'] as const) {
    const candidate = parsed[key];
    if (Array.isArray(candidate)) {
      const drafts = parseExternalQuestionArray(candidate, new Map());
      return {
        format: 'json',
        suggestedName: cleanText(parsed.name ?? parsed.title) || defaultName,
        drafts,
        notes:
          drafts.length > 0
            ? [`已兼容识别外部 JSON 字段（${key}），共 ${drafts.length} 题`]
            : [],
        ...(drafts.length === 0 ? { fatalError: `JSON 字段 "${key}" 中未包含有效题目` } : {}),
      };
    }
  }

  return {
    format: 'json',
    suggestedName: defaultName,
    drafts: [],
    notes: [],
    fatalError: '未能识别该 JSON 题库结构（支持 .quizhub.json 分享包、BankData 或常见题目数组）',
  };
}
