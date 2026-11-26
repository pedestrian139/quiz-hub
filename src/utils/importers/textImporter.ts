import type { QuestionType } from '../../types/quiz';
import type { DraftQuestion, ImportParseResult, ImportSourceFormat } from '../quizImportTypes';
import {
  annotateDuplicateStems,
  cleanText,
  extractChapterInfo,
  isTfToken,
  normalizeFullwidthAscii,
  parseAnswer,
  parseChineseNumeral,
  parseQuestionType,
  suggestBankNameFromFile,
  validateDraftQuestion,
} from './normalize';

export const STANDARD_TXT_TEMPLATE = `# 第一章 基础概念

一、单选题
1. 【单选题】下列哪一项通常被用来衡量计算机系统的响应延迟？
A. 吞吐量（Throughput）
B. 往返时延（RTT）
C. 磁盘容量（TB）
D. 屏幕刷新率（Hz）
答案：B
解析：往返时延（RTT）直接反映请求发出到接收响应的往返延迟时间。

2. 在经典结构中，负责协调取指、译码并产生控制信号的部件是（ B ）。
A. 运算器
B. 控制器
C. 高速缓存
D. 总线桥

二、多选题
3. 下列哪些属于无监督学习的典型任务？
A. K-Means 聚类   B. 主成分分析降维   C. 逻辑回归二分类   D. 关联规则挖掘
答案：ABD
解析：逻辑回归需要标注标签，属于监督学习。

三、判断题
4. TCP 协议通过三次握手建立可靠连接，并支持流量控制与拥塞控制。
答案：正确
解析：TCP 是面向连接的可靠传输层协议。

# 第二章 综合与问答题

四、简答题
5. 简述 HTTP 与 HTTPS 的主要区别。
答案：1. HTTPS 在 HTTP 下层加入了 TLS/SSL 加密传输层，防止窃听与篡改；
2. HTTPS 需要配置数字证书进行身份认证，默认端口为 443（HTTP 默认为 80）。
要点：TLS/SSL 加密；身份认证；默认端口差异
解析：传输层安全性是 HTTPS 的核心改进。
`;

const INLINE_TYPE_TAG_RE =
  /^\s*(?:【([^】]+)】|\[([^\]]+)\]|[(（](单选|单选题|多选|多选题|判断|判断题|简答|简答题|分析|综合分析|综合分析题|填空|问答)[)）])\s*(.*)$/;

const CHAPTER_HEADING_RE =
  /^\s*(?:#{1,6}\s*)?(?:\*{1,2})?(?:【\s*)?(第\s*[0-9一二三四五六七八九十两]+\s*[章讲单元]\s*(?:[·:：.\s-].*)?|(?:chapter|ch\.?)\s*\d+.*)$/i;

const SECTION_TYPE_HEADING_RE =
  /^\s*(?:#{1,6}\s*)?(?:\*{1,2})?(?:[一二三四五六七八九十]+、|【)?\s*(单选题?|多选题?|多项选择题?|不定项选择题?|判断题?|是非题?|简答题?|填空题?|名词解释|问答题?|论述题?|综合分析题?|案例分析题?)\s*(?:】)?(?:\*{1,2})?\s*[:：]?\s*(?:[(（].*[)）])?\s*$/;

const QUESTION_START_RE =
  /^\s*(?:#{1,6}\s*)?(?:[-*+]\s+)?(?:\*{1,2})?(?:Q?\d+[.、)）:：]|[(（]\d+[)）]|第\s*\d+\s*题)\s*(.*)$/i;

const OPTION_LINE_RE =
  /^\s*(?:[-*+]\s+)?(?:\*{1,2})?[(\[（【]?([A-Ha-h])(?:\*{1,2})?[)\]）】.、:：](?:\*{1,2})?\s*(.+)$/;

const ANSWER_LINE_RE =
  /^\s*(?:>\s*)?(?:[-*+]\s+)?(?:\*{1,2})?(?:参考答案|正确答案|标准答案|答案|答|Answer|Ans)(?:\*{1,2})?\s*[:：]\s*(?:\*{1,2})?\s*(.*)$/i;

const ANSWER_BRACKET_RE = /^\s*(?:>\s*)?(?:[-*+]\s+)?【(?:参考)?答案】\s*(.*)$/;
const EXPLAIN_LINE_RE =
  /^\s*(?:>\s*)?(?:[-*+]\s+)?(?:\*{1,2})?(?:答案解析|试题解析|解析|分析|详解|说明|Explanation|Explain)(?:\*{1,2})?\s*[:：]\s*(?:\*{1,2})?\s*(.*)$/i;
const EXPLAIN_BRACKET_RE = /^\s*(?:>\s*)?(?:[-*+]\s+)?【(?:答案)?解析】\s*(.*)$/;
const KEYPOINTS_LINE_RE =
  /^\s*(?:>\s*)?(?:[-*+]\s+)?(?:\*{1,2})?(?:核心)?(?:采分要点|采分点|评分标准|要点|KeyPoints)(?:\*{1,2})?\s*[:：]\s*(?:\*{1,2})?\s*(.*)$/i;
const TAGS_LINE_RE =
  /^\s*(?:>\s*)?(?:[-*+]\s+)?(?:\*{1,2})?(?:标签|考点|Tags)(?:\*{1,2})?\s*[:：]\s*(?:\*{1,2})?\s*(.*)$/i;
const QUESTION_LABEL_RE =
  /^\s*(?:>\s*)?(?:[-*+]\s+)?(?:\*{1,2})?(?:题目|题干|问题|问|Question|Q)(?:\*{1,2})?\s*[:：]\s*(?:\*{1,2})?\s*(.+)$/i;

function stripOrphanMdBold(text: string): string {
  const trimmed = cleanText(text);
  if (!trimmed) return '';
  const boldCount = (trimmed.match(/\*\*/g) ?? []).length;
  if (boldCount === 1) {
    return cleanText(trimmed.replace(/\*\*/g, ''));
  }
  return trimmed;
}

function matchSectionHeadingType(line: string): QuestionType | null {
  const norm = normalizeFullwidthAscii(cleanText(line));
  if (!norm || norm.length > 48) return null;
  const m = norm.match(SECTION_TYPE_HEADING_RE);
  if (!m) return null;
  return parseQuestionType(m[1]!);
}

function matchChapterHeading(line: string): { chapter: number; chapterName: string } | null {
  const norm = normalizeFullwidthAscii(cleanText(line))
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*{1,2}|\*{1,2}$/g, '')
    .replace(/^【|】$/g, '')
    .trim();
  if (!norm || norm.length > 60) return null;
  if (/^第\s*\d+\s*题/.test(norm)) return null;
  if (!CHAPTER_HEADING_RE.test(norm)) return null;
  if (/[？?]$/.test(norm) || /[（(]\s*[A-H对错√×]\s*[）)]/.test(norm)) return null;
  const info = extractChapterInfo(norm, 1);
  if (info.chapter <= 0) {
    const numMatch = norm.match(/([0-9一二三四五六七八九十两]+)/);
    const num = numMatch ? (parseChineseNumeral(numMatch[1]!) ?? 1) : 1;
    return { chapter: num, chapterName: norm };
  }
  return info;
}

function extractInlineOptionsFromLine(
  line: string,
): { prefixText: string; options: string[] } | null {
  const norm = normalizeFullwidthAscii(line);
  const markerRegex = /(?:^|\s)[(\[（]?([A-Ha-h])[)\]）.、:：]\s*/g;
  const matches = Array.from(norm.matchAll(markerRegex));
  if (matches.length < 2) return null;

  const firstLetter = matches[0]![1]!.toUpperCase();
  if (firstLetter !== 'A') return null;

  const prefixText = cleanText(norm.slice(0, matches[0]!.index ?? 0));
  const options: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = (matches[i]!.index ?? 0) + matches[i]![0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? norm.length) : norm.length;
    const item = cleanText(norm.slice(start, end));
    if (item) options.push(item);
  }
  if (options.length < 2) return null;
  return { prefixText, options };
}

function extractInlineAnswerFromStem(stem: string): {
  cleanedStem: string;
  extractedAnswer: string;
} {
  let extracted = '';
  const cleaned = stem.replace(/([（(])\s*([^()（）]{1,8})\s*([）)])/g, (full, open, inner, close) => {
    if (extracted) return full;
    const normInner = normalizeFullwidthAscii(inner).trim();
    const isLetters =
      /^[A-Ha-h](?:[\s,、]*[A-Ha-h])*$/.test(normInner) &&
      (normInner.length === 1 || normInner === normInner.toUpperCase());
    const tfVal = isTfToken(normInner);
    if (isLetters || tfVal !== null) {
      extracted = normInner.replace(/[\s,、]+/g, '');
      return `${open} ${close}`;
    }
    return full;
  });
  return { cleanedStem: cleanText(cleaned), extractedAnswer: extracted };
}

interface RawBlock {
  chapter: number;
  chapterName: string;
  sectionType: QuestionType | null;
  lines: string[];
  startLine: number;
}

export function parseTextQuestions(
  rawText: string,
  opts?: { sourceFormat?: ImportSourceFormat; fileName?: string },
): ImportParseResult {
  const sourceFormat: ImportSourceFormat = opts?.sourceFormat ?? 'txt';
  const suggestedName = suggestBankNameFromFile(opts?.fileName, '文本导入题库');
  const cleanedInput = cleanText(rawText);
  if (!cleanedInput) {
    return {
      format: sourceFormat,
      suggestedName,
      drafts: [],
      notes: [],
      fatalError: '输入内容为空，请粘贴或上传包含题目的 TXT / Markdown 内容',
    };
  }

  const lines = cleanedInput.split('\n');
  const blocks: RawBlock[] = [];
  let currentChapter = 1;
  let currentChapterName = '第 1 章';
  let currentSectionType: QuestionType | null = null;
  let currentBlock: RawBlock | null = null;
  let inAnswerOrExplain = false;
  let sawBlankLine = false;
  let answerListLastNum: number | null = null;

  const flushBlock = () => {
    if (currentBlock && currentBlock.lines.some((l) => l.trim().length > 0)) {
      blocks.push(currentBlock);
    }
    currentBlock = null;
    inAnswerOrExplain = false;
    answerListLastNum = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    if (!trimmed) {
      sawBlankLine = true;
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushBlock();
      sawBlankLine = false;
      continue;
    }

    const chHeading = matchChapterHeading(trimmed);
    if (chHeading) {
      flushBlock();
      currentChapter = chHeading.chapter > 0 ? chHeading.chapter : currentChapter + 1;
      currentChapterName = chHeading.chapterName;
      sawBlankLine = false;
      continue;
    }

    const secType = matchSectionHeadingType(trimmed);
    if (secType) {
      flushBlock();
      currentSectionType = secType;
      sawBlankLine = false;
      continue;
    }

    const isAnswerLine =
      ANSWER_LINE_RE.test(trimmed) ||
      ANSWER_BRACKET_RE.test(trimmed) ||
      EXPLAIN_LINE_RE.test(trimmed) ||
      EXPLAIN_BRACKET_RE.test(trimmed) ||
      KEYPOINTS_LINE_RE.test(trimmed) ||
      TAGS_LINE_RE.test(trimmed);

    const isOptionLine = OPTION_LINE_RE.test(normalizeFullwidthAscii(trimmed));
    const isExplicitTagStart = INLINE_TYPE_TAG_RE.test(trimmed);
    const qLabelMatch = QUESTION_LABEL_RE.test(trimmed);
    const numMatch = trimmed.match(/^\s*(\d+)[.、)）:：]\s*(.+)$/);
    const isNumberedStart = QUESTION_START_RE.test(trimmed);

    if (isAnswerLine) {
      if (!currentBlock) {
        currentBlock = {
          chapter: currentChapter,
          chapterName: currentChapterName,
          sectionType: currentSectionType,
          lines: [],
          startLine: i + 1,
        };
      }
      currentBlock.lines.push(trimmed);
      inAnswerOrExplain = true;
      const inlineAfterColon = trimmed.replace(/^[^:：】]+[:：】]\s*/, '');
      answerListLastNum = /^\s*[(（]?1[.、)）]/.test(inlineAfterColon) ? 1 : null;
      sawBlankLine = false;
      continue;
    }

    let startsNewQuestion = false;
    if (isExplicitTagStart || qLabelMatch) {
      startsNewQuestion = true;
    } else if (isNumberedStart && !isOptionLine) {
      if (!currentBlock) {
        startsNewQuestion = true;
      } else if (inAnswerOrExplain && !sawBlankLine && numMatch) {
        const n = Number.parseInt(numMatch[1]!, 10);
        if (answerListLastNum === null && n === 1) {
          answerListLastNum = 1;
          startsNewQuestion = false;
        } else if (answerListLastNum !== null && n === answerListLastNum + 1) {
          answerListLastNum = n;
          startsNewQuestion = false;
        } else {
          startsNewQuestion = true;
        }
      } else {
        startsNewQuestion = true;
      }
    } else if (sawBlankLine && currentBlock && inAnswerOrExplain) {
      startsNewQuestion = true;
    }

    if (startsNewQuestion) {
      flushBlock();
      currentBlock = {
        chapter: currentChapter,
        chapterName: currentChapterName,
        sectionType: currentSectionType,
        lines: [trimmed],
        startLine: i + 1,
      };
    } else {
      if (!currentBlock) {
        currentBlock = {
          chapter: currentChapter,
          chapterName: currentChapterName,
          sectionType: currentSectionType,
          lines: [],
          startLine: i + 1,
        };
      }
      currentBlock.lines.push(trimmed);
    }

    sawBlankLine = false;
  }

  flushBlock();

  const drafts: DraftQuestion[] = [];
  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const block = blocks[bIdx]!;
    let explicitTypeText = '';
    let hasExplicitQuestionMarker = false;
    let hasAnswerLine = false;
    const stemParts: string[] = [];
    const options: string[] = [];
    let rawAnswer = '';
    const answerParts: string[] = [];
    const explainParts: string[] = [];
    const keyPoints: string[] = [];
    const tags: string[] = [];

    let section: 'stem' | 'options' | 'answer' | 'explain' = 'stem';

    for (let lIdx = 0; lIdx < block.lines.length; lIdx++) {
      let line = block.lines[lIdx]!;

      if (lIdx === 0) {
        const numStrip = line.match(QUESTION_START_RE);
        if (numStrip) {
          hasExplicitQuestionMarker = true;
          line = stripOrphanMdBold(numStrip[1]!);
        }
        const qLabStrip = line.match(QUESTION_LABEL_RE);
        if (qLabStrip) {
          hasExplicitQuestionMarker = true;
          line = stripOrphanMdBold(qLabStrip[1]!);
        }
        const tagMatch = line.match(INLINE_TYPE_TAG_RE);
        if (tagMatch) {
          hasExplicitQuestionMarker = true;
          explicitTypeText = (tagMatch[1] ?? tagMatch[2] ?? tagMatch[3] ?? '').trim();
          line = stripOrphanMdBold(tagMatch[4] ?? '');
        }
      }

      const ansM = line.match(ANSWER_LINE_RE) ?? line.match(ANSWER_BRACKET_RE);
      if (ansM) {
        section = 'answer';
        hasAnswerLine = true;
        const val = stripOrphanMdBold(ansM[1]);
        if (val) answerParts.push(val);
        continue;
      }

      const expM = line.match(EXPLAIN_LINE_RE) ?? line.match(EXPLAIN_BRACKET_RE);
      if (expM) {
        section = 'explain';
        const val = stripOrphanMdBold(expM[1]);
        if (val) explainParts.push(val);
        continue;
      }

      const kpM = line.match(KEYPOINTS_LINE_RE);
      if (kpM) {
        const items = stripOrphanMdBold(kpM[1])
          .split(/[,，;；|、]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        keyPoints.push(...items);
        continue;
      }

      const tagM = line.match(TAGS_LINE_RE);
      if (tagM) {
        const items = stripOrphanMdBold(tagM[1])
          .split(/[,，;；|、]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        tags.push(...items);
        continue;
      }

      if (section === 'stem' || section === 'options') {
        const inlineOpts = extractInlineOptionsFromLine(line);
        if (inlineOpts) {
          if (inlineOpts.prefixText) {
            stemParts.push(inlineOpts.prefixText);
          }
          options.push(...inlineOpts.options);
          section = 'options';
          continue;
        }

        const optM = normalizeFullwidthAscii(line).match(OPTION_LINE_RE);
        if (optM) {
          options.push(stripOrphanMdBold(optM[2]));
          section = 'options';
          continue;
        }

        if (section === 'stem' && line) {
          stemParts.push(line);
        } else if (section === 'options' && options.length > 0 && line) {
          options[options.length - 1] = `${options[options.length - 1]} ${line}`.trim();
        }
      } else if (section === 'answer') {
        answerParts.push(line);
      } else if (section === 'explain') {
        explainParts.push(line);
      }
    }

    let stem = cleanText(stemParts.join('\n'));
    rawAnswer = cleanText(answerParts.join('\n'));

    if (!rawAnswer && stem) {
      const inlineAns = extractInlineAnswerFromStem(stem);
      if (inlineAns.extractedAnswer) {
        stem = inlineAns.cleanedStem;
        rawAnswer = inlineAns.extractedAnswer;
      }
    } else if (stem) {
      const inlineAns = extractInlineAnswerFromStem(stem);
      if (inlineAns.extractedAnswer) {
        stem = inlineAns.cleanedStem;
      }
    }

    if (!hasExplicitQuestionMarker && options.length === 0 && !hasAnswerLine) {
      continue;
    }

    const type = parseQuestionType(
      explicitTypeText || (block.sectionType ? block.sectionType : ''),
      { options, rawAnswer, stem },
    );

    const parsedAns = parseAnswer(type, rawAnswer, options);
    const explain = cleanText(explainParts.join('\n'));

    const draft: DraftQuestion = {
      tempId: `txt-${bIdx + 1}-${Math.random().toString(36).slice(2, 6)}`,
      sourceLoc: `第 ${block.startLine} 行`,
      sourceFormat,
      type,
      chapter: block.chapter,
      chapterName: block.chapterName,
      stem,
      options: type === 'choice' || type === 'multi' ? options : [],
      answer: parsedAns.answer,
      rawAnswer,
      explain,
      keyPoints,
      tags,
      sourceRef: `L${block.startLine}`,
      issues: parsedAns.issues,
      included: true,
    };

    drafts.push(validateDraftQuestion(draft));
  }

  const annotated = annotateDuplicateStems(drafts);
  const notes: string[] = [];
  if (annotated.length === 0) {
    notes.push('未能从文本中识别出有效题目，请参考标准 TXT 模板格式（题号 + 选项 + 答案：）');
  } else {
    notes.push(`已识别 ${annotated.length} 道题目（请核对题目详情与异常告警）`);
  }

  return {
    format: sourceFormat,
    suggestedName,
    drafts: annotated,
    notes,
  };
}

export function downloadTxtTemplate(): void {
  const blob = new Blob(['\uFEFF', STANDARD_TXT_TEMPLATE], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quizhub-template.txt';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
