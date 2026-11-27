import type { ChapterMeta, Question, QuestionType } from '../../types/quiz';
import { computeV1BankCounts } from '../bankCatalog';
import type { BankRecord, DraftQuestion, ImportIssue, ImportSourceFormat } from '../quizImportTypes';

const TRUE_TOKENS = new Set([
  '对',
  '正确',
  '是',
  '对的',
  '真',
  '√',
  '✓',
  '✔',
  't',
  'true',
  'y',
  'yes',
  '1',
]);

const FALSE_TOKENS = new Set([
  '错',
  '错误',
  '否',
  '错的',
  '假',
  '×',
  '✗',
  '✘',
  'x',
  'f',
  'false',
  'n',
  'no',
  '0',
]);

export function formatSourceFormatLabel(format: ImportSourceFormat | 'manual'): string {
  switch (format) {
    case 'xlsx':
      return 'Excel 导入';
    case 'csv':
      return 'CSV/TSV 导入';
    case 'docx':
      return 'Word 导入';
    case 'txt':
      return '文本导入';
    case 'json':
      return 'JSON 导入';
    case 'manual':
      return '手动录入';
  }
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function normalizeFullwidthAscii(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x3000) {
      out += ' ';
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else {
      out += text[i]!;
    }
  }
  return out;
}

export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  return stripBom(str)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function suggestBankNameFromFile(fileName?: string, fallback = '自定义题库'): string {
  const cleaned = cleanText(fileName);
  if (!cleaned) return fallback;
  const base = cleaned.split(/[\\/]/).pop() ?? cleaned;
  const stripped = base
    .replace(/\.quizhub\.json$/i, '')
    .replace(/\.(xlsx|xls|csv|tsv|docx|txt|md|markdown|json)$/i, '')
    .trim();
  return stripped || fallback;
}

export function stripOptionLabelPrefix(opt: string): string {
  return opt
    .replace(/^\s*[(\[（【]?[A-Za-z][)\]）】.、:：\s]\s*/u, '')
    .trim();
}

export function isTfToken(raw: string): boolean | null {
  const norm = normalizeFullwidthAscii(cleanText(raw)).toLowerCase();
  if (!norm) return null;
  if (TRUE_TOKENS.has(norm)) return true;
  if (FALSE_TOKENS.has(norm)) return false;
  return null;
}

export function parseQuestionType(
  rawType: string,
  ctx: { options?: string[]; rawAnswer?: string; stem?: string } = {},
): QuestionType {
  const t = normalizeFullwidthAscii(cleanText(rawType)).toLowerCase();

  if (t) {
    if (/(多选|多项|不定项|multi|multiple|checkbox)/i.test(t)) {
      return 'multi';
    }
    if (/(判断|是非|正误|对错|\btf\b|true\s*\/?\s*false|boolean|bool)/i.test(t)) {
      return 'tf';
    }
    if (/(单选|单项|选择|single|choice|radio)/i.test(t)) {
      return 'choice';
    }
    if (/(综合|案例|分析|论述|材料|analysis|essay|case)/i.test(t)) {
      return 'analysis';
    }
    if (/(简答|问答|填空|名词解释|主观|背诵|概念|short|qa|fill|blank|term)/i.test(t)) {
      return 'short';
    }
  }

  const options = ctx.options ?? [];
  const rawAns = normalizeFullwidthAscii(cleanText(ctx.rawAnswer ?? ''));

  if (options.length >= 2) {
    if (
      options.length === 2 &&
      options.every((opt) => isTfToken(stripOptionLabelPrefix(opt)) !== null) &&
      isTfToken(rawAns) !== null
    ) {
      return 'tf';
    }
    const strippedAns = rawAns.replace(/^(?:答案|正确答案|参考答案)[:：\s]*/i, '').trim();
    if (/^[A-Za-z](?:[\s,，、;；|/]*[A-Za-z])+$/.test(strippedAns)) {
      const letters = new Set(strippedAns.toUpperCase().match(/[A-Z]/g) ?? []);
      if (letters.size >= 2) {
        return 'multi';
      }
    }
    return 'choice';
  }

  if (isTfToken(rawAns) !== null) {
    return 'tf';
  }

  if (ctx.stem && /(综合分析|案例分析|论述题)/.test(ctx.stem)) {
    return 'analysis';
  }

  return 'short';
}

function matchOptionByText(token: string, options: string[]): number {
  const target = normalizeFullwidthAscii(cleanText(token)).toLowerCase();
  if (!target) return -1;
  for (let i = 0; i < options.length; i++) {
    const optFull = normalizeFullwidthAscii(cleanText(options[i] ?? '')).toLowerCase();
    const optBare = normalizeFullwidthAscii(stripOptionLabelPrefix(options[i] ?? '')).toLowerCase();
    if (target === optFull || (optBare && target === optBare)) {
      return i;
    }
  }
  return -1;
}

export function parseAnswer(
  type: QuestionType,
  rawAnswer: string,
  options: string[],
): { answer: number | number[] | boolean | string; issues: ImportIssue[] } {
  const cleanedRaw = cleanText(rawAnswer);

  if (type === 'short' || type === 'analysis') {
    if (!cleanedRaw) {
      return {
        answer: '',
        issues: [
          {
            severity: 'error',
            field: 'answer',
            message: `${type === 'analysis' ? '综合分析题' : '简答题'}缺少参考答案`,
          },
        ],
      };
    }
    return { answer: cleanedRaw, issues: [] };
  }

  if (type === 'tf') {
    const direct = isTfToken(cleanedRaw);
    if (direct !== null) {
      return { answer: direct, issues: [] };
    }
    const stripped = normalizeFullwidthAscii(cleanedRaw)
      .replace(/^(?:答案|正确答案|参考答案)[:：\s]*/i, '')
      .trim()
      .toUpperCase();
    const tfRetry = isTfToken(stripped);
    if (tfRetry !== null) {
      return { answer: tfRetry, issues: [] };
    }
    if ((stripped === 'A' || stripped === 'B') && options.length === 2) {
      const picked = options[stripped === 'A' ? 0 : 1] ?? '';
      const mapped = isTfToken(stripOptionLabelPrefix(picked));
      if (mapped !== null) {
        return { answer: mapped, issues: [] };
      }
    }
    return {
      answer: '',
      issues: [
        {
          severity: 'error',
          field: 'answer',
          message: cleanedRaw
            ? `无法识别判断题答案“${cleanedRaw}”（支持 正确/错误、对/错、√/×、T/F）`
            : '判断题缺少答案',
        },
      ],
    };
  }

  if (type === 'choice') {
    if (!cleanedRaw) {
      return {
        answer: -1,
        issues: [{ severity: 'error', field: 'answer', message: '单选题缺少正确答案' }],
      };
    }
    if (options.length === 0) {
      return {
        answer: -1,
        issues: [{ severity: 'error', field: 'options', message: '单选题缺少选项' }],
      };
    }

    const textIdx = matchOptionByText(cleanedRaw, options);
    if (textIdx >= 0) {
      return { answer: textIdx, issues: [] };
    }

    const norm = normalizeFullwidthAscii(cleanedRaw)
      .replace(/^(?:答案|正确答案|参考答案)[:：\s]*/i, '')
      .trim();

    const letterMatch = norm.match(/^[(\[（【]?\s*([A-Za-z])\s*[)\]）】.、:：]?$/);
    if (letterMatch) {
      const idx = letterMatch[1]!.toUpperCase().charCodeAt(0) - 65;
      if (idx >= 0 && idx < options.length) {
        return { answer: idx, issues: [] };
      }
      return {
        answer: -1,
        issues: [
          {
            severity: 'error',
            field: 'answer',
            message: `单选题答案“${cleanedRaw}”超出当前 ${options.length} 个选项范围`,
          },
        ],
      };
    }

    if (/^\d+$/.test(norm)) {
      const num = Number.parseInt(norm, 10);
      if (num >= 1 && num <= options.length) {
        return { answer: num - 1, issues: [] };
      }
    }

    return {
      answer: -1,
      issues: [
        {
          severity: 'error',
          field: 'answer',
          message: `无法识别单选题答案“${cleanedRaw}”`,
        },
      ],
    };
  }

  if (!cleanedRaw) {
    return {
      answer: [],
      issues: [{ severity: 'error', field: 'answer', message: '多选题缺少正确答案' }],
    };
  }
  if (options.length === 0) {
    return {
      answer: [],
      issues: [{ severity: 'error', field: 'options', message: '多选题缺少选项' }],
    };
  }

  const stripped = normalizeFullwidthAscii(cleanedRaw)
    .replace(/^(?:答案|正确答案|参考答案)[:：\s]*/i, '')
    .trim();

  const tokens = stripped
    .split(/[,，、;；|\n/]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length > 0 && tokens.some((t) => t.length > 1)) {
    const matchedByText = tokens.map((t) => matchOptionByText(t, options));
    if (matchedByText.every((idx) => idx >= 0)) {
      const uniqueSorted = Array.from(new Set(matchedByText)).sort((a, b) => a - b);
      const issues: ImportIssue[] =
        uniqueSorted.length === 1
          ? [
              {
                severity: 'warning',
                field: 'answer',
                message: '多选题仅匹配到 1 个正确选项，请核对是否漏选',
              },
            ]
          : [];
      return { answer: uniqueSorted, issues };
    }
  }

  if (/^[A-Za-z\s,，、;；|/.\[\]()（）]+$/.test(stripped)) {
    const letters = stripped.toUpperCase().match(/[A-Z]/g) ?? [];
    if (letters.length > 0) {
      const indices = letters.map((ch) => ch.charCodeAt(0) - 65);
      const oob = indices.filter((idx) => idx < 0 || idx >= options.length);
      if (oob.length > 0) {
        return {
          answer: [],
          issues: [
            {
              severity: 'error',
              field: 'answer',
              message: `多选题答案“${cleanedRaw}”包含超出 ${options.length} 个选项范围的字母`,
            },
          ],
        };
      }
      const uniqueSorted = Array.from(new Set(indices)).sort((a, b) => a - b);
      const issues: ImportIssue[] =
        uniqueSorted.length === 1
          ? [
              {
                severity: 'warning',
                field: 'answer',
                message: '多选题仅匹配到 1 个正确选项，请核对是否漏选',
              },
            ]
          : [];
      return { answer: uniqueSorted, issues };
    }
  }

  if (/^[1-9\s,，、;；|/]+$/.test(stripped)) {
    const nums = (stripped.match(/[1-9]/g) ?? []).map((d) => Number.parseInt(d, 10) - 1);
    if (nums.length > 0 && nums.every((idx) => idx >= 0 && idx < options.length)) {
      const uniqueSorted = Array.from(new Set(nums)).sort((a, b) => a - b);
      const issues: ImportIssue[] =
        uniqueSorted.length === 1
          ? [
              {
                severity: 'warning',
                field: 'answer',
                message: '多选题仅匹配到 1 个正确选项，请核对是否漏选',
              },
            ]
          : [];
      return { answer: uniqueSorted, issues };
    }
  }

  return {
    answer: [],
    issues: [
      {
        severity: 'error',
        field: 'answer',
        message: `无法识别多选题答案“${cleanedRaw}”`,
      },
    ],
  };
}

export function validateDraftQuestion(draft: DraftQuestion): DraftQuestion {
  const issues: ImportIssue[] = [];
  const stem = cleanText(draft.stem);
  const cleanedOptions = draft.options.map((o) => cleanText(o));
  const nonEmptyOptions = cleanedOptions.filter((o) => o.length > 0);

  if (!stem) {
    issues.push({ severity: 'error', field: 'stem', message: '题干不能为空' });
  } else if (stem.length < 3) {
    issues.push({
      severity: 'warning',
      field: 'stem',
      message: '题干内容过短，建议检查是否缺失上下文',
    });
  }

  if (draft.type === 'choice' || draft.type === 'multi') {
    if (nonEmptyOptions.length < 2) {
      issues.push({
        severity: 'error',
        field: 'options',
        message: `${draft.type === 'multi' ? '多选题' : '单选题'}至少需要 2 个有效选项`,
      });
    } else if (cleanedOptions.some((o) => o.length === 0)) {
      issues.push({
        severity: 'warning',
        field: 'options',
        message: '存在空白选项，入库前将自动移除空白项',
      });
    }

    if (draft.type === 'choice') {
      if (
        typeof draft.answer !== 'number' ||
        !Number.isInteger(draft.answer) ||
        draft.answer < 0 ||
        draft.answer >= cleanedOptions.length
      ) {
        const parsed = parseAnswer('choice', draft.rawAnswer, nonEmptyOptions);
        if (parsed.issues.length > 0) {
          issues.push(...parsed.issues);
        } else {
          issues.push({
            severity: 'error',
            field: 'answer',
            message: '请选择或修正有效的正确答案选项',
          });
        }
      } else if (cleanedOptions[draft.answer]!.length === 0) {
        issues.push({
          severity: 'error',
          field: 'answer',
          message: '所选答案指向空选项，请填写选项内容或重新选择答案',
        });
      }
    } else {
      if (
        !Array.isArray(draft.answer) ||
        draft.answer.length === 0 ||
        draft.answer.some(
          (idx) => !Number.isInteger(idx) || idx < 0 || idx >= cleanedOptions.length,
        )
      ) {
        const parsed = parseAnswer('multi', draft.rawAnswer, nonEmptyOptions);
        if (parsed.issues.length > 0) {
          issues.push(...parsed.issues);
        } else {
          issues.push({
            severity: 'error',
            field: 'answer',
            message: '请勾选至少 1 个有效的正确选项',
          });
        }
      } else if (draft.answer.some((idx) => cleanedOptions[idx]!.length === 0)) {
        issues.push({
          severity: 'error',
          field: 'answer',
          message: '所选答案包含空选项，请填写选项内容或取消勾选空选项',
        });
      } else if (new Set(draft.answer).size === 1) {
        issues.push({
          severity: 'warning',
          field: 'answer',
          message: '多选题仅设置了 1 个正确选项，请核对是否漏选',
        });
      }
    }
  } else if (draft.type === 'tf') {
    if (typeof draft.answer !== 'boolean') {
      const parsed = parseAnswer('tf', draft.rawAnswer, nonEmptyOptions);
      issues.push(
        ...(parsed.issues.length > 0
          ? parsed.issues
          : [
              {
                severity: 'error' as const,
                field: 'answer' as const,
                message: '请指定判断题答案（正确 / 错误）',
              },
            ]),
      );
    }
  } else {
    if (typeof draft.answer !== 'string' || cleanText(draft.answer).length === 0) {
      issues.push({
        severity: 'error',
        field: 'answer',
        message: `${draft.type === 'analysis' ? '综合分析题' : '简答题'}缺少参考答案`,
      });
    }
  }

  return {
    ...draft,
    issues,
  };
}

export function annotateDuplicateStems(drafts: DraftQuestion[]): DraftQuestion[] {
  const seen = new Set<string>();
  return drafts.map((draft) => {
    const filteredIssues = draft.issues.filter(
      (issue) => !issue.message.startsWith('检测到重复题干'),
    );
    const key = cleanText(draft.stem).replace(/\s+/g, '').toLowerCase();
    if (key.length > 0 && seen.has(key)) {
      return {
        ...draft,
        issues: [
          ...filteredIssues,
          {
            severity: 'warning',
            field: 'stem',
            message: '检测到重复题干，请核对是否需要取消勾选剔除',
          },
        ],
      };
    }
    if (key.length > 0) {
      seen.add(key);
    }
    return {
      ...draft,
      issues: filteredIssues,
    };
  });
}

export function formatDraftRawAnswer(
  type: QuestionType,
  answer: number | number[] | boolean | string,
): string {
  if (type === 'choice' && typeof answer === 'number' && answer >= 0) {
    return answer < 26 ? String.fromCharCode(65 + answer) : String(answer + 1);
  }
  if (type === 'multi' && Array.isArray(answer)) {
    return answer
      .filter((idx) => Number.isInteger(idx) && idx >= 0)
      .map((idx) => (idx < 26 ? String.fromCharCode(65 + idx) : String(idx + 1)))
      .join('');
  }
  if (type === 'tf' && typeof answer === 'boolean') {
    return answer ? '正确' : '错误';
  }
  return typeof answer === 'string' ? answer : '';
}

export function parseChineseNumeral(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return n > 0 ? n : null;
  }
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (trimmed === '十') return 10;
  if (trimmed.includes('十')) {
    const [tensPart, onesPart] = trimmed.split('十');
    const tens = tensPart ? (digits[tensPart] ?? 0) : 1;
    const ones = onesPart ? (digits[onesPart] ?? 0) : 0;
    const total = tens * 10 + ones;
    return total > 0 ? total : null;
  }
  if (trimmed.length === 1 && trimmed in digits && digits[trimmed]! > 0) {
    return digits[trimmed]!;
  }
  return null;
}

export function extractChapterInfo(
  rawChapter: string,
  fallbackId = 1,
): { chapter: number; chapterName: string } {
  const cleaned = cleanText(rawChapter);
  if (!cleaned) {
    return { chapter: fallbackId, chapterName: `第 ${fallbackId} 章` };
  }

  const cnMatch = cleaned.match(
    /^第\s*([0-9一二三四五六七八九十两]+)\s*[章讲单元节]\s*[·:：.\s-]*(.*)$/,
  );
  if (cnMatch) {
    const parsedNum = parseChineseNumeral(cnMatch[1]!) ?? fallbackId;
    const shortPart = cleanText(cnMatch[2]);
    return {
      chapter: parsedNum,
      chapterName: shortPart || `第 ${parsedNum} 章`,
    };
  }

  const enMatch = cleaned.match(/^(?:chapter|ch\.?)\s*(\d+)\s*[·:：.\s-]*(.*)$/i);
  if (enMatch) {
    const parsedNum = Number.parseInt(enMatch[1]!, 10) || fallbackId;
    const shortPart = cleanText(enMatch[2]);
    return {
      chapter: parsedNum,
      chapterName: shortPart || `第 ${parsedNum} 章`,
    };
  }

  if (/^\d+$/.test(cleaned)) {
    const num = Math.max(1, Number.parseInt(cleaned, 10));
    return { chapter: num, chapterName: `第 ${num} 章` };
  }

  return { chapter: 0, chapterName: cleaned };
}

export function finalizeDraftsToBank(
  drafts: DraftQuestion[],
  meta: { name: string; description?: string; sourceFormat?: ImportSourceFormat | 'manual' },
): {
  name: string;
  description?: string;
  sourceFormat?: ImportSourceFormat | 'manual';
  chapters: ChapterMeta[];
  questions: Question[];
} {
  const safeName = cleanText(meta.name) || '自定义导入题库';
  const safeDesc = cleanText(meta.description) || undefined;

  const validDrafts = drafts
    .map(validateDraftQuestion)
    .filter((d) => d.included && !d.issues.some((i) => i.severity === 'error'));

  const chapterByName = new Map<string, number>();
  const chapterMetaMap = new Map<number, ChapterMeta>();
  const usedIds = new Set<number>();

  for (const d of validDrafts) {
    if (d.chapter > 0) {
      usedIds.add(d.chapter);
      if (!chapterMetaMap.has(d.chapter)) {
        const shortName = cleanText(d.chapterName) || `第 ${d.chapter} 章`;
        chapterMetaMap.set(d.chapter, {
          id: d.chapter,
          short: shortName,
          title: shortName.startsWith('第') ? shortName : `第 ${d.chapter} 章 ${shortName}`,
        });
      }
      if (d.chapterName) {
        chapterByName.set(d.chapterName, d.chapter);
      }
    }
  }

  let nextChapterId = 1;
  const allocNextChapterId = (): number => {
    while (usedIds.has(nextChapterId)) {
      nextChapterId += 1;
    }
    usedIds.add(nextChapterId);
    return nextChapterId;
  };

  const questions: Question[] = validDrafts.map((d, idx) => {
    let chId = d.chapter;
    const chLabel = cleanText(d.chapterName) || '默认章节';

    if (chId <= 0) {
      const existing = chapterByName.get(chLabel);
      if (existing !== undefined) {
        chId = existing;
      } else {
        chId = allocNextChapterId();
        chapterByName.set(chLabel, chId);
        chapterMetaMap.set(chId, {
          id: chId,
          short: chLabel,
          title: chLabel.startsWith('第') ? chLabel : `第 ${chId} 章 ${chLabel}`,
        });
      }
    }

    let cleanedOptions: string[] | undefined;
    const indexRemap = new Map<number, number>();
    if (d.type === 'choice' || d.type === 'multi') {
      cleanedOptions = [];
      d.options.forEach((rawOpt, oldIdx) => {
        const cleaned = cleanText(rawOpt);
        if (cleaned) {
          indexRemap.set(oldIdx, cleanedOptions!.length);
          cleanedOptions!.push(cleaned);
        }
      });
    }

    let normalizedAnswer: number | number[] | boolean | string = d.answer;
    if (d.type === 'choice' && typeof d.answer === 'number') {
      const mapped = indexRemap.get(d.answer);
      normalizedAnswer = mapped !== undefined ? mapped : d.answer;
    } else if (d.type === 'multi' && Array.isArray(d.answer)) {
      const mapped = d.answer
        .map((oldIdx) => indexRemap.get(oldIdx))
        .filter((newIdx): newIdx is number => newIdx !== undefined);
      normalizedAnswer = Array.from(new Set(mapped)).sort((a, b) => a - b);
    } else if ((d.type === 'short' || d.type === 'analysis') && typeof d.answer === 'string') {
      normalizedAnswer = cleanText(d.answer);
    }

    const seq = String(idx + 1).padStart(3, '0');
    const formatNote = d.sourceNote || formatSourceFormatLabel(d.sourceFormat);
    const cleanedExplanation = cleanText(d.explanation);
    const cleanedAiAnalysis = cleanText(d.aiAnalysis);

    const q: Question = {
      id: `imp-c${chId}-${d.type}-${seq}`,
      type: d.type,
      chapter: chId,
      stem: cleanText(d.stem),
      ...(cleanedOptions ? { options: cleanedOptions } : {}),
      answer: normalizedAnswer,
      explain: cleanText(d.explain),
      ...(cleanedExplanation ? { explanation: cleanedExplanation } : {}),
      ...(cleanedAiAnalysis ? { aiAnalysis: cleanedAiAnalysis } : {}),
      ...(d.aiInferredAnswer === true ? { aiInferredAnswer: true } : {}),
      ...(d.keyPoints.length > 0 ? { keyPoints: [...d.keyPoints] } : {}),
      ...(d.tags.length > 0 ? { tags: [...d.tags] } : {}),
      source: {
        origin: d.preserveOrigin ?? 'comprehensive_bank',
        file: safeName,
        ref: d.sourceRef || `#${idx + 1}`,
        ...(formatNote ? { note: formatNote } : {}),
      },
    };
    return q;
  });

  if (chapterMetaMap.size === 0 && questions.length === 0) {
    chapterMetaMap.set(1, {
      id: 1,
      short: '默认章节',
      title: '第 1 章 默认章节',
    });
  }

  const chapters = Array.from(chapterMetaMap.values()).sort((a, b) => a.id - b.id);
  const detectedFormat = meta.sourceFormat ?? validDrafts[0]?.sourceFormat;

  return {
    name: safeName,
    description: safeDesc,
    ...(detectedFormat ? { sourceFormat: detectedFormat } : {}),
    chapters,
    questions,
  };
}

function normalizeChapterKey(label: string): string {
  return cleanText(label).replace(/\s+/g, '').toLowerCase();
}

function isGenericChapterLabel(label: string, chapterId: number): boolean {
  const norm = normalizeChapterKey(label);
  return (
    !norm ||
    norm === '默认章节' ||
    norm === `第${chapterId}章` ||
    /^第[零一二三四五六七八九十百两\d]+章$/.test(norm)
  );
}

function stripLeadingChapterPrefix(title: string): string {
  return cleanText(title)
    .replace(/^第\s*[0-9一二三四五六七八九十两]+\s*[章讲单元节]\s*[·:：.\s-]*/i, '')
    .trim();
}

export function appendDraftsToBank(
  existingBank: BankRecord,
  drafts: DraftQuestion[],
  meta?: { sourceFormat?: ImportSourceFormat | 'manual' },
): BankRecord {
  const validDrafts = drafts
    .map(validateDraftQuestion)
    .filter((d) => d.included && !d.issues.some((i) => i.severity === 'error'));

  const chapterMetaMap = new Map<number, ChapterMeta>();
  const chapterIdByLabel = new Map<string, number>();

  const registerLabel = (label: string, id: number) => {
    const key = normalizeChapterKey(label);
    if (key && !isGenericChapterLabel(label, id) && !chapterIdByLabel.has(key)) {
      chapterIdByLabel.set(key, id);
    }
  };

  for (const ch of existingBank.data.chapters) {
    chapterMetaMap.set(ch.id, { ...ch });
    registerLabel(ch.short, ch.id);
    registerLabel(ch.title, ch.id);
    const strippedTitle = stripLeadingChapterPrefix(ch.title);
    if (strippedTitle) {
      registerLabel(strippedTitle, ch.id);
    }
  }

  let maxChapterId = Math.max(
    0,
    ...chapterMetaMap.keys(),
    ...existingBank.data.questions.map((q) => (Number.isInteger(q.chapter) ? q.chapter : 0)),
  );

  const usedQuestionIds = new Set(existingBank.data.questions.map((q) => q.id));
  let nextSeq = existingBank.data.questions.length + 1;

  const allocQuestionId = (chId: number, type: QuestionType): string => {
    let candidate = `imp-c${chId}-${type}-${String(nextSeq).padStart(3, '0')}`;
    while (usedQuestionIds.has(candidate)) {
      nextSeq += 1;
      candidate = `imp-c${chId}-${type}-${String(nextSeq).padStart(3, '0')}`;
    }
    usedQuestionIds.add(candidate);
    nextSeq += 1;
    return candidate;
  };

  const appendedQuestions: Question[] = validDrafts.map((d, idx) => {
    const chLabel = cleanText(d.chapterName);
    const labelKey = normalizeChapterKey(chLabel);
    const genericDraftLabel = d.chapter > 0 ? isGenericChapterLabel(chLabel, d.chapter) : !chLabel;

    let chId: number;
    const matchedByLabel =
      labelKey && !genericDraftLabel ? chapterIdByLabel.get(labelKey) : undefined;

    if (matchedByLabel !== undefined) {
      chId = matchedByLabel;
    } else if (d.chapter > 0) {
      const existingCh = chapterMetaMap.get(d.chapter);
      if (!existingCh) {
        chId = d.chapter;
        maxChapterId = Math.max(maxChapterId, chId);
        const shortName = chLabel || `第 ${chId} 章`;
        chapterMetaMap.set(chId, {
          id: chId,
          short: shortName,
          title: shortName.startsWith('第') ? shortName : `第 ${chId} 章 ${shortName}`,
        });
        registerLabel(shortName, chId);
      } else if (
        genericDraftLabel ||
        normalizeChapterKey(existingCh.short) === labelKey ||
        normalizeChapterKey(existingCh.title) === labelKey
      ) {
        chId = d.chapter;
      } else if (
        isGenericChapterLabel(existingCh.short, d.chapter) &&
        isGenericChapterLabel(existingCh.title, d.chapter)
      ) {
        chId = d.chapter;
        chapterMetaMap.set(chId, {
          id: chId,
          short: chLabel,
          title: chLabel.startsWith('第') ? chLabel : `第 ${chId} 章 ${chLabel}`,
        });
        registerLabel(chLabel, chId);
      } else {
        maxChapterId += 1;
        chId = maxChapterId;
        chapterMetaMap.set(chId, {
          id: chId,
          short: chLabel,
          title: chLabel.startsWith('第') ? chLabel : `第 ${chId} 章 ${chLabel}`,
        });
        registerLabel(chLabel, chId);
      }
    } else {
      maxChapterId += 1;
      chId = maxChapterId;
      const shortName = chLabel || '默认章节';
      chapterMetaMap.set(chId, {
        id: chId,
        short: shortName,
        title: shortName.startsWith('第') ? shortName : `第 ${chId} 章 ${shortName}`,
      });
      registerLabel(shortName, chId);
    }

    let cleanedOptions: string[] | undefined;
    const indexRemap = new Map<number, number>();
    if (d.type === 'choice' || d.type === 'multi') {
      cleanedOptions = [];
      d.options.forEach((rawOpt, oldIdx) => {
        const cleaned = cleanText(rawOpt);
        if (cleaned) {
          indexRemap.set(oldIdx, cleanedOptions!.length);
          cleanedOptions!.push(cleaned);
        }
      });
    }

    let normalizedAnswer: number | number[] | boolean | string = d.answer;
    if (d.type === 'choice' && typeof d.answer === 'number') {
      const mapped = indexRemap.get(d.answer);
      normalizedAnswer = mapped !== undefined ? mapped : d.answer;
    } else if (d.type === 'multi' && Array.isArray(d.answer)) {
      const mapped = d.answer
        .map((oldIdx) => indexRemap.get(oldIdx))
        .filter((newIdx): newIdx is number => newIdx !== undefined);
      normalizedAnswer = Array.from(new Set(mapped)).sort((a, b) => a - b);
    } else if ((d.type === 'short' || d.type === 'analysis') && typeof d.answer === 'string') {
      normalizedAnswer = cleanText(d.answer);
    }

    const formatNote = d.sourceNote || formatSourceFormatLabel(meta?.sourceFormat ?? d.sourceFormat);
    const cleanedExplanation = cleanText(d.explanation);
    const cleanedAiAnalysis = cleanText(d.aiAnalysis);

    return {
      id: allocQuestionId(chId, d.type),
      type: d.type,
      chapter: chId,
      stem: cleanText(d.stem),
      ...(cleanedOptions ? { options: cleanedOptions } : {}),
      answer: normalizedAnswer,
      explain: cleanText(d.explain),
      ...(cleanedExplanation ? { explanation: cleanedExplanation } : {}),
      ...(cleanedAiAnalysis ? { aiAnalysis: cleanedAiAnalysis } : {}),
      ...(d.aiInferredAnswer === true ? { aiInferredAnswer: true } : {}),
      ...(d.keyPoints.length > 0 ? { keyPoints: [...d.keyPoints] } : {}),
      ...(d.tags.length > 0 ? { tags: [...d.tags] } : {}),
      source: {
        origin: d.preserveOrigin ?? 'comprehensive_bank',
        file: existingBank.name,
        ref: d.sourceRef || `#${existingBank.data.questions.length + idx + 1}`,
        ...(formatNote ? { note: formatNote } : {}),
      },
    };
  });

  const mergedQuestions = [...existingBank.data.questions, ...appendedQuestions];
  const mergedChapters = Array.from(chapterMetaMap.values()).sort((a, b) => a.id - b.id);
  const counts = computeV1BankCounts(mergedQuestions);

  return {
    ...existingBank,
    updatedAt: Math.max(Date.now(), (existingBank.updatedAt || 0) + 1),
    data: {
      ...existingBank.data,
      meta: {
        ...existingBank.data.meta,
        counts,
      },
      chapters: mergedChapters,
      questions: mergedQuestions,
    },
  };
}
