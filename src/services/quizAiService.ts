import type { MasteryLevel, Question, QuestionType, UserRecord } from '../types/quiz';
import type { DraftQuestion } from '../utils/quizImportTypes';
import {
  annotateDuplicateStems,
  cleanText,
  formatDraftRawAnswer,
  parseAnswer,
  parseQuestionType,
  validateDraftQuestion,
} from '../utils/importers/normalize';
import { formatAnswerText, getOptionLabel, getTypeLabel } from '../core/questionUtils';
import {
  isApiConfigReady,
  isValidHttpUrl,
  loadApiConfig,
  normalizeBaseUrl,
} from './apiConfig';
import {
  LlmApiError,
  chatCompletion,
  chatCompletionJson,
  extractJsonFromText,
  streamChatCompletion,
  type ApiErrorCode,
  type ChatMessage,
  type LlmCompletionResult,
  type LlmRequestOptions,
} from './llmClient';

export { LlmApiError as ApiClientError } from './llmClient';

export interface QuestionExplainContext {
  userRecord?: UserRecord;
  chapterTitle?: string;
  previousExplanation?: string;
  bankName?: string;
}

export interface SubjectiveGradeFeedback {
  score: number;
  suggestedLevel: MasteryLevel;
  recommendedMastery: MasteryLevel;
  matchedPoints: string[];
  missingPoints: string[];
  comment: string;
  summary: string;
  improvedAnswer: string;
}

export interface ShortAnswerGradeInput {
  stem: string;
  answer: string | number | number[] | boolean;
  explain?: string;
  keyPoints?: string[];
  userAnswer: string;
  type?: QuestionType;
  chapter?: number;
}

export interface SubjectiveGradeFallback {
  improvedAnswer?: string;
  comment?: string;
}

export interface GenerateQuestionsOptions extends LlmRequestOptions {
  chapter: number;
  count?: number;
  types?: QuestionType[];
  sourceFile?: string;
}

export interface WashQuestionsOptions extends LlmRequestOptions {
  allowedTypes?: QuestionType[];
  targetChapter?: number;
  chapterName?: string;
  autoFillExplain?: boolean;
  autoTag?: boolean;
  chunkSizeChars?: number;
  concurrency?: number;
  sourceFile?: string;
}

export interface FailedWashChunk {
  chunkIndex: number;
  totalChunks: number;
  rawText: string;
  errorMessage: string;
  errorCode?: ApiErrorCode;
}

export interface WashProgressEvent {
  completedChunks: number;
  totalChunks: number;
  statusText: string;
  draftsSoFar: DraftQuestion[];
  failedChunks: FailedWashChunk[];
}

export interface WashQuestionsCallbacks {
  onProgress?: (event: WashProgressEvent) => void;
}

export interface WashQuestionsResult {
  drafts: DraftQuestion[];
  failedChunks: FailedWashChunk[];
  totalChunks: number;
  cancelled: boolean;
}

function assertPracticeApiReady(options: LlmRequestOptions = {}): void {
  const stored = loadApiConfig(options.practiceScope);
  const effective = {
    ...stored,
    ...(options.config ?? {}),
  };
  effective.baseUrl = normalizeBaseUrl(effective.baseUrl);
  effective.apiKey = effective.apiKey.trim();
  effective.model = effective.model.trim();
  if (!isValidHttpUrl(effective.baseUrl)) {
    throw new LlmApiError(
      'INVALID_URL',
      'API Base URL 格式无效，请填写以 http:// 或 https:// 开头的地址。',
    );
  }
  if (!isApiConfigReady(effective)) {
    throw new LlmApiError(
      'NOT_CONFIGURED',
      '尚未完成 API 配置，请先点击顶部“API 设置”填写 API Key 和模型名称。',
    );
  }
}

function formatQuestionPromptBlock(q: Question, context: QuestionExplainContext = {}): string {
  const lines: string[] = [];
  if (context.bankName?.trim()) {
    lines.push(`【所属题库】${context.bankName.trim()}`);
  }
  lines.push(
    `【题型】${getTypeLabel(q.type)}`,
    `【章节】第 ${q.chapter} 章${context.chapterTitle ? ` · ${context.chapterTitle}` : ''}`,
    `【题干】${q.stem}`,
  );

  if (Array.isArray(q.options) && q.options.length > 0) {
    lines.push('【选项】');
    q.options.forEach((opt, idx) => {
      lines.push(`${getOptionLabel(idx)}. ${opt}`);
    });
  }

  lines.push(`【标准答案】${formatAnswerText(q)}`);

  if (Array.isArray(q.keyPoints) && q.keyPoints.length > 0) {
    lines.push(`【采分要点】${q.keyPoints.join('；')}`);
  }
  const baseExplain = q.explanation?.trim() || q.explain?.trim();
  if (baseExplain) {
    lines.push(`【原题解析】${baseExplain}`);
  }

  return lines.join('\n');
}

function formatUserAttemptLine(q: Question, record?: UserRecord): string {
  if (!record) return '用户尚未作答或正在复习本题。';
  let choiceStr = '';
  if (q.type === 'choice' && typeof record.choice === 'number') {
    choiceStr = `${getOptionLabel(record.choice)}${q.options?.[record.choice] ? `. ${q.options[record.choice]}` : ''}`;
  } else if (q.type === 'multi' && Array.isArray(record.choice)) {
    choiceStr = record.choice.map((i) => getOptionLabel(i)).join('、');
  } else if (q.type === 'tf' && typeof record.choice === 'boolean') {
    choiceStr = record.choice ? '正确' : '错误';
  }
  const verdict = record.ok === 1 ? '已答对/已掌握' : '答错/待巩固';
  return choiceStr ? `用户作答：${choiceStr}（${verdict}）` : `用户自评状态：${verdict}`;
}

export async function explainQuestionStream(
  question: Question,
  context: QuestionExplainContext = {},
  onChunk?: (chunk: string, accumulated: string) => void,
  options: LlmRequestOptions = {},
): Promise<LlmCompletionResult> {
  assertPracticeApiReady(options);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是 QuizHub AI 学习助教。请用简洁清晰的中文对当前题目做深度解析，严格紧扣题目与标准答案，不要编造与标准答案矛盾的结论。支持 Markdown 排版与 LaTeX 数学公式（行内使用 $...$，独立公式块使用 $$...$$）。
请严格按照以下三个 Markdown 三级标题依次输出：
### 【核心考点】
（提炼考查概念、定理或方法论）

### 【解题思路】
（分步推导或判断依据，必要时结合公式）

### 【逐项排错】
（逐个分析选项正误或常见易错点、干扰项陷阱）`,
    },
    {
      role: 'user',
      content: `${formatQuestionPromptBlock(question, context)}\n\n${formatUserAttemptLine(question, context.userRecord)}\n\n请按照【核心考点】【解题思路】【逐项排错】结构给出精准、易懂的深度解析。`,
    },
  ];

  return streamChatCompletion(messages, options, onChunk);
}

export async function askQuestionFollowUpStream(
  question: Question,
  history: ChatMessage[],
  userQuestion: string,
  context: QuestionExplainContext = {},
  onChunk?: (chunk: string, accumulated: string) => void,
  options: LlmRequestOptions = {},
): Promise<LlmCompletionResult> {
  assertPracticeApiReady(options);
  const trimmedHistory = history
    .filter((msg) => typeof msg.content === 'string' && msg.content.trim().length > 0)
    .slice(-20);

  const systemParts = [
    '你是 QuizHub AI 学习助教，正在辅导学习者理解下面这道题目。请用简明准确的中文直接回答追问，必要时给出直观示例、易混对比或同类变式思路；涉及数学表达式时请使用 Markdown 与 LaTeX（$...$ / $$...$$）。',
    '',
    formatQuestionPromptBlock(question, context),
    formatUserAttemptLine(question, context.userRecord),
  ];

  if (context.previousExplanation?.trim()) {
    systemParts.push('', `【已有解析参考】\n${context.previousExplanation.trim().slice(0, 2400)}`);
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemParts.join('\n'),
    },
    ...trimmedHistory,
    { role: 'user', content: userQuestion.trim() },
  ];

  return streamChatCompletion(messages, options, onChunk);
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
      .split(/[\n；;]+/)
      .map((item) => item.replace(/^(?:[-*•]\s+|\d+[.、)]\s*)/, '').trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

export function mapScoreToMasteryLevel(score: number): MasteryLevel {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return 0;
  }
  const clamped = Math.min(100, Math.max(0, score));
  if (clamped >= 80) return 2;
  if (clamped >= 50) return 1;
  return 0;
}

function parseMasteryLevel(value: unknown): MasteryLevel | null {
  if (value === 0 || value === 1 || value === 2) {
    return value;
  }
  if (value === '0' || value === '1' || value === '2') {
    return Number(value) as MasteryLevel;
  }
  return null;
}

const GRADING_OBJECT_KEYS = [
  'score',
  'suggestedLevel',
  'recommendedMastery',
  'matchedPoints',
  'missingPoints',
  'comment',
  'summary',
  'improvedAnswer',
] as const;

function hasGradingKey(obj: Record<string, unknown>): boolean {
  return GRADING_OBJECT_KEYS.some(
    (key) => Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined,
  );
}

function extractGradeObjectFromText(raw: string): Record<string, unknown> {
  const withoutClosedThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const cleaned = withoutClosedThink.replace(/<\/?think>/gi, '').trim();

  const tryParseObject = (text: string): Record<string, unknown> | null => {
    const repaired = repairSingleBackslashLatexInJson(text);
    const variants = repaired !== text ? [repaired, text] : [text];
    for (const variant of variants) {
      try {
        const parsed = JSON.parse(variant) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // continue
      }
    }
    return null;
  };

  const findBestObjectInSegment = (
    segment: string,
  ): { obj: Record<string, unknown>; hasGradeKeys: boolean } | null => {
    const trimmed = segment.trim();
    if (!trimmed) return null;

    const direct = tryParseObject(trimmed);
    if (direct && hasGradingKey(direct)) {
      return { obj: direct, hasGradeKeys: true };
    }

    let fallbackObj: Record<string, unknown> | null = direct;

    for (let start = 0; start < segment.length; start += 1) {
      if (segment[start] !== '{') continue;

      let depth = 0;
      let inString = false;
      let i = start;
      let foundEnd = -1;

      while (i < segment.length) {
        const ch = segment[i]!;
        if (inString) {
          if (ch === '\\') {
            i += 2;
            continue;
          }
          if (ch === '"') {
            inString = false;
          }
          i += 1;
          continue;
        }

        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          depth += 1;
        } else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            foundEnd = i;
            break;
          }
        }
        i += 1;
      }

      if (foundEnd > start) {
        const slice = segment.slice(start, foundEnd + 1);
        const parsed = tryParseObject(slice);
        if (parsed) {
          if (hasGradingKey(parsed)) {
            return { obj: parsed, hasGradeKeys: true };
          }
          if (!fallbackObj) {
            fallbackObj = parsed;
          }
          start = foundEnd;
        }
      }
    }

    return fallbackObj ? { obj: fallbackObj, hasGradeKeys: false } : null;
  };

  if (cleaned) {
    const jsonFences: string[] = [];
    const otherFences: string[] = [];
    const fenceRegex = /```([a-zA-Z0-9_+-]*)\s*([\s\S]*?)```/g;
    for (const match of cleaned.matchAll(fenceRegex)) {
      const lang = (match[1] ?? '').trim().toLowerCase();
      const body = (match[2] ?? '').trim();
      if (!body) continue;
      if (lang === 'json') {
        jsonFences.push(body);
      } else {
        otherFences.push(body);
      }
    }

    let fallbackObj: Record<string, unknown> | null = null;

    for (const block of [...jsonFences, ...otherFences]) {
      const found = findBestObjectInSegment(block);
      if (found?.hasGradeKeys) {
        return found.obj;
      }
      if (found && !fallbackObj) {
        fallbackObj = found.obj;
      }
    }

    const fromCleaned = findBestObjectInSegment(cleaned);
    if (fromCleaned?.hasGradeKeys) {
      return fromCleaned.obj;
    }
    if (fromCleaned && !fallbackObj) {
      fallbackObj = fromCleaned.obj;
    }
    if (fallbackObj) {
      return fallbackObj;
    }
  }

  const fallback = extractJsonFromText<unknown>(raw);
  if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
    return fallback as Record<string, unknown>;
  }
  throw new LlmApiError('PARSE_ERROR', '模型返回的批改结果不是合法 JSON 对象，请重试。');
}

export function parseSubjectiveGradeResponse(
  raw: string | Record<string, unknown>,
  fallback?: SubjectiveGradeFallback | string,
): SubjectiveGradeFeedback {
  let data: Record<string, unknown>;
  if (typeof raw === 'string') {
    data = extractGradeObjectFromText(raw);
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    data = raw;
  } else {
    throw new LlmApiError('PARSE_ERROR', '模型返回的批改结果格式无效，请重试。');
  }

  if (!hasGradingKey(data)) {
    throw new LlmApiError('PARSE_ERROR', 'AI 批改返回格式异常，缺少评分字段，请重试。');
  }

  let rawScore = 0;
  if (typeof data.score === 'number' && Number.isFinite(data.score)) {
    rawScore = data.score;
  } else if (typeof data.score === 'string') {
    const trimmed = data.score.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const parsedNum = Number(trimmed);
      if (Number.isFinite(parsedNum)) {
        rawScore = parsedNum;
      }
    }
  }
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  const suggestedLevel: MasteryLevel =
    parseMasteryLevel(data.suggestedLevel) ??
    parseMasteryLevel(data.recommendedMastery) ??
    mapScoreToMasteryLevel(score);

  const fallbackObj: SubjectiveGradeFallback =
    typeof fallback === 'string' ? { improvedAnswer: fallback } : (fallback ?? {});
  const fallbackComment =
    fallbackObj.comment?.trim() || '已完成对比批改，请结合下方采分要点查漏补缺。';
  const commentText =
    (typeof data.comment === 'string' && data.comment.trim()) ||
    (typeof data.summary === 'string' && data.summary.trim()) ||
    fallbackComment;
  const improvedAnswer =
    typeof data.improvedAnswer === 'string' && data.improvedAnswer.trim()
      ? data.improvedAnswer.trim()
      : (fallbackObj.improvedAnswer ?? '').trim();

  return {
    score,
    suggestedLevel,
    recommendedMastery: suggestedLevel,
    matchedPoints: toStringList(data.matchedPoints),
    missingPoints: toStringList(data.missingPoints),
    comment: commentText,
    summary: commentText,
    improvedAnswer,
  };
}

export async function gradeSubjectiveDraft(
  question: Question,
  userDraft: string,
  options: LlmRequestOptions = {},
): Promise<{ feedback: SubjectiveGradeFeedback; raw: LlmCompletionResult }> {
  assertPracticeApiReady(options);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是 QuizHub AI 阅卷助教。请对照标准参考答案和采分要点，客观批改学习者的主观题作答，并严格返回合法 JSON 对象（不要输出多余解释）：{"score":0到100的整数,"suggestedLevel":0或1或2,"recommendedMastery":0或1或2,"matchedPoints":["已命中的要点"],"missingPoints":["遗漏或需补充的要点"],"comment":"简明点评与改进建议","summary":"一句话总体评价","improvedAnswer":"基于用户作答润色后的高分示范回答"}。评分映射：>=80 对应 2（完全会），50~79 对应 1（有点模糊），<50 对应 0（不会）。',
    },
    {
      role: 'user',
      content: `${formatQuestionPromptBlock(question)}\n\n【用户作答】\n${userDraft.trim()}\n\n请输出 JSON 格式批改结果。`,
    },
  ];

  const reqOptions: LlmRequestOptions = {
    temperature: 0.2,
    maxTokens: 900,
    ...options,
  };

  let raw: LlmCompletionResult;
  try {
    raw = await chatCompletion(messages, { ...reqOptions, jsonMode: true });
  } catch (err) {
    if (err instanceof LlmApiError && err.statusCode === 400) {
      raw = await chatCompletion(messages, { ...reqOptions, jsonMode: false });
    } else {
      throw err;
    }
  }

  const feedback = parseSubjectiveGradeResponse(raw.content, {
    improvedAnswer: formatAnswerText(question),
  });

  return { feedback, raw };
}

export async function gradeShortAnswer(
  input: ShortAnswerGradeInput,
  options: LlmRequestOptions = {},
): Promise<{ feedback: SubjectiveGradeFeedback; raw: LlmCompletionResult }> {
  const question: Question = {
    id: '__short_answer__',
    type: input.type ?? 'short',
    chapter: input.chapter ?? 1,
    stem: input.stem,
    answer: input.answer,
    explain: input.explain ?? '',
    ...(Array.isArray(input.keyPoints) && input.keyPoints.length > 0
      ? { keyPoints: input.keyPoints }
      : {}),
    source: { origin: 'comprehensive_bank', file: '', ref: '' },
  };
  return gradeSubjectiveDraft(question, input.userAnswer, options);
}

const ALLOWED_TYPES = new Set<QuestionType>(['choice', 'multi', 'tf', 'short', 'analysis']);

function coerceGeneratedQuestion(
  item: unknown,
  idx: number,
  chapter: number,
  sourceFile: string,
): Question | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const type =
    typeof obj.type === 'string' && ALLOWED_TYPES.has(obj.type as QuestionType)
      ? (obj.type as QuestionType)
      : null;
  const stem = typeof obj.stem === 'string' ? obj.stem.trim() : '';
  const explain = typeof obj.explain === 'string' ? obj.explain.trim() : '';
  if (!type || !stem) return null;

  const id = `ai-c${chapter}-${type}-${Date.now()}-${idx + 1}`;
  const baseSource = {
    origin: 'review_notes_synthesized' as const,
    file: sourceFile,
    ref: `AI生成 #${idx + 1}`,
  };

  if (type === 'choice') {
    const options = toStringList(obj.options);
    const answer = typeof obj.answer === 'number' && Number.isInteger(obj.answer) ? obj.answer : -1;
    if (options.length < 2 || answer < 0 || answer >= options.length) return null;
    return { id, type, chapter, stem, options, answer, explain, source: baseSource };
  }

  if (type === 'multi') {
    const options = toStringList(obj.options);
    const answer = Array.isArray(obj.answer)
      ? Array.from(
          new Set(
            obj.answer.filter(
              (n): n is number =>
                typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < options.length,
            ),
          ),
        ).sort((a, b) => a - b)
      : [];
    if (options.length < 2 || answer.length === 0) return null;
    return { id, type, chapter, stem, options, answer, explain, source: baseSource };
  }

  if (type === 'tf') {
    if (typeof obj.answer !== 'boolean') return null;
    return { id, type, chapter, stem, answer: obj.answer, explain, source: baseSource };
  }

  const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
  if (!answer) return null;
  const keyPoints = toStringList(obj.keyPoints);
  return {
    id,
    type,
    chapter,
    stem,
    answer,
    explain,
    ...(keyPoints.length > 0 ? { keyPoints } : {}),
    source: baseSource,
  };
}

/**
 * Reusable AI question generator producing strict V1 `Question[]` records.
 */
export async function generateQuestionsFromText(
  rawText: string,
  options: GenerateQuestionsOptions,
): Promise<{ questions: Question[]; raw: LlmCompletionResult }> {
  assertPracticeApiReady(options);
  const count = Math.min(20, Math.max(1, Math.round(options.count ?? 5)));
  const types = options.types && options.types.length > 0 ? options.types : ['choice', 'tf', 'short'];
  const sourceFile = options.sourceFile?.trim() || 'AI智能出题';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是 QuizHub 出题专家。请根据给定学习材料生成 ${count} 道高质量试题，题型限定在 [${types.join(', ')}] 中，并严格返回 JSON 对象 {"questions":[...]}。每题字段必须严格遵守：
- choice: { "type":"choice", "stem":"...", "options":["A内容","B内容","C内容","D内容"], "answer":0, "explain":"..." } (answer 为 0-based 下标，options 不含 A./B. 前缀)
- multi: { "type":"multi", "stem":"...", "options":[...], "answer":[0,2], "explain":"..." }
- tf: { "type":"tf", "stem":"...", "answer":true, "explain":"..." }
- short / analysis: { "type":"short", "stem":"...", "answer":"参考答案", "keyPoints":["要点1","要点2"], "explain":"..." }`,
    },
    {
      role: 'user',
      content: `请基于以下学习材料生成 ${count} 道第 ${options.chapter} 章试题：\n\n${rawText.trim().slice(0, 8000)}`,
    },
  ];

  const { data, raw } = await chatCompletionJson<{ questions?: unknown[] } | unknown[]>(messages, {
    temperature: 0.3,
    maxTokens: 2400,
    ...options,
  });

  const rawList = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : [];
  const questions = rawList
    .map((item, idx) => coerceGeneratedQuestion(item, idx, options.chapter, sourceFile))
    .filter((q): q is Question => q !== null);

  return { questions, raw };
}

const QUESTION_BOUNDARY_RE =
  /^(?:\d{1,3}(?:[.、](?!\d)|[)）])|[（(]\d{1,3}[)）]|第\s*\d+\s*题|[Qq]\s*\d{1,3}(?:[.:：、)）]|\s)|【?(?:单选|多选|判断|简答|分析)题?】?)/;

const PUNCTUATED_OPTION_PREFIX_RE =
  /^(?:[A-Ha-h][.)）．、:：]\s*|[（(][A-Ha-h][)）]\s*|[【\[][A-Ha-h][】\]]\s*)/;
const UNPUNCTUATED_OPTION_PREFIX_RE = /^[A-Ha-h]\s+/;

function parseBooleanFlag(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

function extractOptionLabelLetter(opt: string): string | null {
  const trimmed = opt.trim();
  const punct = trimmed.match(
    /^(?:([A-Ha-h])[.)）．、:：]|[（(]([A-Ha-h])[)）]|[【\[]([A-Ha-h])[】\]])/,
  );
  if (punct) {
    return (punct[1] ?? punct[2] ?? punct[3] ?? '').toUpperCase();
  }
  const space = trimmed.match(/^([A-Ha-h])\s+/);
  if (space) {
    return space[1]!.toUpperCase();
  }
  return null;
}

function hasSequentialLetterLabels(allRawOptions: string[]): boolean {
  if (allRawOptions.length < 2 || allRawOptions.length > 8) {
    return false;
  }
  return allRawOptions.every(
    (opt, idx) => extractOptionLabelLetter(opt) === String.fromCharCode(65 + idx),
  );
}

function cleanWashedOptionText(rawOpt: string, allRawOptions: string[]): string {
  const trimmed = cleanText(rawOpt);
  if (!trimmed) return '';
  if (PUNCTUATED_OPTION_PREFIX_RE.test(trimmed)) {
    return trimmed.replace(PUNCTUATED_OPTION_PREFIX_RE, '').trim();
  }
  if (hasSequentialLetterLabels(allRawOptions) && UNPUNCTUATED_OPTION_PREFIX_RE.test(trimmed)) {
    return trimmed.replace(UNPUNCTUATED_OPTION_PREFIX_RE, '').trim();
  }
  return trimmed;
}

function splitBlockByLines(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];
  const lines = block.split('\n');
  const groups: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    const isBoundary = current.length > 0 && QUESTION_BOUNDARY_RE.test(line.trim());
    if (isBoundary || (currentLen + line.length + 1 > maxChars && current.length > 0)) {
      const joined = current.join('\n').trim();
      if (joined) groups.push(joined);
      current = [];
      currentLen = 0;
    }

    if (line.length > maxChars) {
      if (current.length > 0) {
        const joined = current.join('\n').trim();
        if (joined) groups.push(joined);
        current = [];
        currentLen = 0;
      }
      for (let i = 0; i < line.length; i += maxChars) {
        const piece = line.slice(i, i + maxChars).trim();
        if (piece) groups.push(piece);
      }
    } else {
      current.push(line);
      currentLen += line.length + 1;
    }
  }

  if (current.length > 0) {
    const joined = current.join('\n').trim();
    if (joined) groups.push(joined);
  }
  return groups;
}

function splitOversizedUnit(unit: string, maxChars: number): string[] {
  if (unit.length <= maxChars) return [unit];
  const paragraphs = unit
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      pieces.push(para);
    } else {
      pieces.push(...splitBlockByLines(para, maxChars));
    }
  }
  return pieces;
}

export function splitTextIntoWashChunks(rawText: string, chunkSizeChars = 2800): string[] {
  const normalized = rawText.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const maxChars = Math.max(400, Math.round(chunkSizeChars));
  if (normalized.length <= maxChars) return [normalized];

  // Group lines into question units at QUESTION_BOUNDARY_RE so stem + blank lines + options + answer stay intact
  const lines = normalized.split('\n');
  const rawUnits: string[] = [];
  let unitLines: string[] = [];
  let unitHasQuestion = false;

  for (const line of lines) {
    const isBoundary = QUESTION_BOUNDARY_RE.test(line.trim());
    if (isBoundary && unitLines.length > 0) {
      const finished = unitLines.join('\n').trim();
      if (finished) {
        rawUnits.push(finished);
      }
      unitLines = [line];
      unitHasQuestion = true;
      continue;
    }
    if (isBoundary) {
      unitHasQuestion = true;
    }
    if (unitHasQuestion || line.trim().length > 0 || unitLines.length > 0) {
      unitLines.push(line);
    }
  }

  if (unitLines.length > 0) {
    const finished = unitLines.join('\n').trim();
    if (finished) {
      rawUnits.push(finished);
    }
  }

  const atomicBlocks: string[] = [];
  for (const unit of rawUnits) {
    atomicBlocks.push(...splitOversizedUnit(unit, maxChars));
  }

  const chunks: string[] = [];
  let current = '';
  for (const block of atomicBlocks) {
    if (!current) {
      current = block;
      continue;
    }
    if (current.length + 2 + block.length <= maxChars) {
      current = `${current}\n\n${block}`;
    } else {
      chunks.push(current);
      current = block;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function rawAnswerToString(rawAnswer: unknown, options: string[]): string {
  if (typeof rawAnswer === 'string') return cleanText(rawAnswer);
  if (typeof rawAnswer === 'boolean') return rawAnswer ? '正确' : '错误';
  if (typeof rawAnswer === 'number' && Number.isInteger(rawAnswer) && rawAnswer >= 0) {
    return rawAnswer < options.length ? getOptionLabel(rawAnswer) : String(rawAnswer);
  }
  if (Array.isArray(rawAnswer)) {
    return rawAnswer
      .map((item) => {
        if (typeof item === 'number' && Number.isInteger(item) && item >= 0) {
          return getOptionLabel(item);
        }
        return cleanText(item);
      })
      .filter(Boolean)
      .join(',');
  }
  return '';
}

function coerceWashedDraft(
  item: unknown,
  chunkIndex: number,
  itemIndex: number,
  options: WashQuestionsOptions,
): DraftQuestion | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const stem = cleanText(obj.stem ?? obj.question ?? obj.title);
  if (!stem) return null;

  const rawOptionsInput = Array.isArray(obj.options)
    ? obj.options.map((o) => cleanText(o)).filter(Boolean)
    : [];
  const cleanedOptions = rawOptionsInput
    .map((o) => cleanWashedOptionText(o, rawOptionsInput))
    .filter(Boolean);

  const rawAnswerStr = rawAnswerToString(obj.answer, cleanedOptions);
  const rawTypeStr = cleanText(obj.type);
  const type = parseQuestionType(rawTypeStr, {
    options: cleanedOptions,
    rawAnswer: rawAnswerStr,
    stem,
  });

  let answer: number | number[] | boolean | string;
  let rawAnswer = rawAnswerStr;

  if (type === 'choice') {
    if (
      typeof obj.answer === 'number' &&
      Number.isInteger(obj.answer) &&
      obj.answer >= 0 &&
      obj.answer < cleanedOptions.length
    ) {
      answer = obj.answer;
      rawAnswer = formatDraftRawAnswer('choice', answer);
    } else {
      const parsed = parseAnswer('choice', rawAnswerStr, cleanedOptions);
      answer = parsed.answer;
      if (typeof answer === 'number' && answer >= 0) {
        rawAnswer = formatDraftRawAnswer('choice', answer);
      }
    }
  } else if (type === 'multi') {
    if (
      Array.isArray(obj.answer) &&
      obj.answer.length > 0 &&
      obj.answer.every(
        (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < cleanedOptions.length,
      )
    ) {
      answer = Array.from(new Set(obj.answer as number[])).sort((a, b) => a - b);
      rawAnswer = formatDraftRawAnswer('multi', answer);
    } else {
      const parsed = parseAnswer('multi', rawAnswerStr, cleanedOptions);
      answer = parsed.answer;
      if (Array.isArray(answer) && answer.length > 0) {
        rawAnswer = formatDraftRawAnswer('multi', answer);
      }
    }
  } else if (type === 'tf') {
    if (typeof obj.answer === 'boolean') {
      answer = obj.answer;
      rawAnswer = formatDraftRawAnswer('tf', answer);
    } else {
      const parsed = parseAnswer('tf', rawAnswerStr, cleanedOptions);
      answer = parsed.answer;
      if (typeof answer === 'boolean') {
        rawAnswer = formatDraftRawAnswer('tf', answer);
      }
    }
  } else {
    answer = cleanText(obj.answer);
    rawAnswer = typeof answer === 'string' ? answer : '';
  }

  const chapter =
    typeof obj.chapter === 'number' && Number.isInteger(obj.chapter) && obj.chapter > 0
      ? obj.chapter
      : (options.targetChapter ?? 1);
  const chapterName =
    cleanText(obj.chapterName) || options.chapterName?.trim() || `第 ${chapter} 章`;

  const explain = cleanText(obj.explain ?? obj.explanation);
  const keyPoints = toStringList(obj.keyPoints);
  const tags = options.autoTag === false ? [] : toStringList(obj.tags);
  const aiInferredAnswer = parseBooleanFlag(obj.aiInferredAnswer ?? obj.answerInferred);

  const draft: DraftQuestion = {
    tempId: `wash-${Date.now().toString(36)}-${chunkIndex + 1}-${itemIndex + 1}-${Math.random().toString(36).slice(2, 6)}`,
    sourceLoc: `AI洗题 · 第 ${chunkIndex + 1} 批 #${itemIndex + 1}`,
    sourceFormat: 'txt',
    type,
    chapter,
    chapterName,
    stem,
    options: type === 'choice' || type === 'multi' ? cleanedOptions : [],
    answer,
    rawAnswer,
    explain,
    keyPoints,
    tags,
    sourceRef: options.sourceFile?.trim()
      ? `${options.sourceFile.trim()} #${chunkIndex + 1}.${itemIndex + 1}`
      : `AI洗题 #${chunkIndex + 1}.${itemIndex + 1}`,
    sourceNote: aiInferredAnswer ? 'AI 洗题（含 AI 推断答案）' : 'AI 智能洗题',
    preserveOrigin: 'video_popup',
    aiInferredAnswer,
    washedByAi: true,
    issues: [],
    included: true,
  };

  return validateDraftQuestion(draft);
}

const DEFAULT_WASH_ALLOWED_TYPES: QuestionType[] = ['choice', 'multi', 'tf', 'short'];
const VALID_WASH_QUESTION_TYPES = new Set<QuestionType>([
  'choice',
  'multi',
  'tf',
  'short',
  'analysis',
]);

const WASH_TYPE_META: Record<QuestionType, { label: string; answerSpec: string }> = {
  choice: {
    label: '"choice"（单选题）',
    answerSpec: 'choice 为 0-based 整数下标（number，如 0）',
  },
  multi: {
    label: '"multi"（多选题）',
    answerSpec: 'multi 为升序 0-based 整数数组（number[]，如 [0, 2]）',
  },
  tf: {
    label: '"tf"（判断题）',
    answerSpec: 'tf 为布尔值（boolean：true 或 false）',
  },
  short: {
    label: '"short"（简答题）',
    answerSpec: 'short 为参考答案字符串（string）',
  },
  analysis: {
    label: '"analysis"（综合分析题）',
    answerSpec: 'analysis 为参考答案字符串（string）',
  },
};

function resolveAllowedWashTypes(allowedTypes?: QuestionType[]): QuestionType[] {
  if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) {
    return [...DEFAULT_WASH_ALLOWED_TYPES];
  }
  const seen = new Set<QuestionType>();
  const resolved: QuestionType[] = [];
  for (const t of allowedTypes) {
    if (VALID_WASH_QUESTION_TYPES.has(t) && !seen.has(t)) {
      seen.add(t);
      resolved.push(t);
    }
  }
  return resolved.length > 0 ? resolved : [...DEFAULT_WASH_ALLOWED_TYPES];
}

function buildWashSystemPrompt(
  allowedTypes: QuestionType[],
  autoFillExplain: boolean,
  autoTag: boolean,
): string {
  const allowedLabels = allowedTypes.map((t) => WASH_TYPE_META[t].label).join('、');
  const allowedEnum = allowedTypes.map((t) => `"${t}"`).join(' | ');
  const answerSpecs = allowedTypes.map((t) => WASH_TYPE_META[t].answerSpec).join('；');
  const includesChoiceOrMulti =
    allowedTypes.includes('choice') || allowedTypes.includes('multi');
  const includesSubjective =
    allowedTypes.includes('short') || allowedTypes.includes('analysis');

  const lines: string[] = [
    '你是 QuizHub AI 智能洗题引擎。请将用户提供的非结构化试题或学习文本清洗并标准化为 JSON 对象 {"questions":[...]}。',
    '',
    '必须严格遵守以下 4 条规则：',
    '1. 【纯 JSON 输出】仅输出合法的纯 JSON 对象 {"questions":[...]}，严禁输出 ```json / ``` 等 Markdown 代码块标记，严禁输出任何前置或后置解释性文本。',
    `2. 【严格题型过滤】本次仅允许提取以下题型：${allowedLabels}。原文中不属于上述已勾选题型的题目必须直接跳过，严禁强行改编、转换题型或编造题目；若当前片段没有任何符合勾选题型的题目，请返回 {"questions":[]}。`,
    '3. 【严格对齐 QuizHub 原生字段】每道题字段名与值类型必须严格遵守 src/types/quiz.ts 规范：',
    `   - "type": 仅限 ${allowedEnum}`,
    '   - "stem": 题干字符串（string，去除题号前缀如 "1."，保留必要的 Markdown 与 LaTeX 公式 $...$ / $$...$$）',
    includesChoiceOrMulti
      ? '   - "options": 字符串数组（string[]，仅 choice/multi 填写，必须去除 "A. "/"B、" 等选项前缀以防重复渲染；其余题型省略或留空）'
      : '   - "options": 本次不包含选择题，请省略或传空数组 []',
    `   - "answer": 严格匹配对应类型（${answerSpecs}）`,
    `   - "explain": ${autoFillExplain ? '解析说明字符串（string，若原文缺失解析请补充清晰准确的解析）' : '仅保留原文解析字符串（string），若无则填 ""'}`,
    `   - "tags": ${autoTag ? '1~3 个简短知识点标签字符串数组（string[]）' : '空数组 []'}`,
    '   - "aiInferredAnswer": 布尔值（boolean，原文未给出答案时严谨推导并填 true；原文已有明确答案填 false）',
  ];

  if (includesSubjective) {
    lines.push('   - "keyPoints": 主观题采分要点字符串数组（string[]，可选）');
  }

  lines.push(
    '4. 【LaTeX 反斜杠双转义】JSON 字符串中所有 LaTeX 命令的反斜杠必须进行双转义（例如使用 "\\\\frac{1}{2}"、"\\\\alpha"、"\\\\theta"、"\\\\beta"、"\\\\sqrt{x}"、"\\\\neq"），严禁输出未双转义的单反斜杠（如 "\\frac"），以免导致 JSON.parse 报错或控制字符误解析。',
  );

  return lines.join('\n');
}

const AMBIGUOUS_LATEX_CMD_BY_INITIAL: Record<string, RegExp> = {
  b: /^(?:bar|bcancel|begin|beta|beth|between|bf|bfseries|big|Big|bigcap|bigcirc|bigcup|bigg|Bigg|biggl|Biggl|biggm|Biggm|biggr|Biggr|bigl|Bigl|bigm|Bigm|bigodot|bigoplus|bigotimes|bigr|Bigr|bigsqcup|bigstar|bigtriangledown|bigtriangleup|biguplus|bigvee|bigwedge|binom|blacklozenge|blacksquare|blacktriangle|blacktriangledown|blacktriangleleft|blacktriangleright|bm|bmod|boldsymbol|bot|bowtie|boxdot|boxed|boxminus|boxplus|boxtimes|brace|brack|breve|bullet|bumpeq|Bumpeq)(?![a-zA-Z])/,
  f: /^(?:fbox|flat|forall|frac|frown)(?![a-zA-Z])/,
  n: /^(?:nabla|natural|ncong|ne|nearrow|neg|neq|nexists|ngeq|ngeqq|ngeqslant|ngtr|newline|ni|nleftarrow|nLeftarrow|nleftrightarrow|nLeftrightarrow|nless|nleq|nleqq|nleqslant|nmid|nolimits|norm|not|notin|nparallel|nprec|npreceq|nrightarrow|nRightarrow|nshortmid|nshortparallel|nsim|nsubseteq|nsubseteqq|nsucc|nsucceq|nsupseteq|nsupseteqq|ntriangleleft|ntrianglelefteq|ntriangleright|ntrianglerighteq|nu|nwarrow)(?![a-zA-Z])/,
  r: /^(?:rangle|rbrace|rbrack|rceil|Re|rfloor|rhd|rho|right|rightarrow|Rightarrow|rightarrowtail|rightharpoondown|rightharpoonup|rightleftarrows|rightleftharpoons|rightrightarrows|rightsquigarrow|rightthreetimes|risingdotseq|rm|root|rtimes|rvert|rVert)(?![a-zA-Z])/,
  t: /^(?:tan|tanh|tau|tbinom|text|textbf|textit|textrm|textsf|textsc|textsl|textstyle|texttt|tfrac|therefore|theta|Theta|thickapprox|thicksim|thinspace|tilde|times|tiny|to|top|triangle|triangledown|triangleleft|trianglelefteq|triangleq|triangleright|trianglerighteq|tt|twoheadleftarrow|twoheadrightarrow)(?![a-zA-Z])/,
};

function repairSingleBackslashLatexInJson(input: string): string {
  let out = '';
  let inString = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = false;
      out += ch;
      i += 1;
      continue;
    }

    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }

    const next = input[i + 1];
    if (next === undefined) {
      out += ch;
      i += 1;
      continue;
    }

    if (next === '\\' || next === '"' || next === '/') {
      out += ch + next;
      i += 2;
      continue;
    }

    if (next === 'u') {
      const hex = input.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += input.slice(i, i + 6);
        i += 6;
      } else {
        out += '\\\\';
        i += 1;
      }
      continue;
    }

    const cmdPattern = AMBIGUOUS_LATEX_CMD_BY_INITIAL[next];
    if (cmdPattern) {
      if (cmdPattern.test(input.slice(i + 1))) {
        out += '\\\\';
        i += 1;
      } else {
        out += ch + next;
        i += 2;
      }
      continue;
    }

    out += '\\\\';
    i += 1;
  }

  return out;
}

function extractWashCandidateSlices(raw: string): string[] {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : withoutThink).trim();
  if (!candidate) return [];

  const slices: string[] = [candidate];
  const objStart = candidate.indexOf('{');
  const objEnd = candidate.lastIndexOf('}');
  const arrStart = candidate.indexOf('[');
  const arrEnd = candidate.lastIndexOf(']');

  const nested: string[] = [];
  if (objStart >= 0 && objEnd > objStart) {
    nested.push(candidate.slice(objStart, objEnd + 1));
  }
  if (arrStart >= 0 && arrEnd > arrStart) {
    nested.push(candidate.slice(arrStart, arrEnd + 1));
  }
  nested.sort((a, b) => candidate.indexOf(a) - candidate.indexOf(b));
  for (const s of nested) {
    if (s !== candidate) slices.push(s);
  }
  return slices;
}

function extractWashJsonFromText<T = unknown>(raw: string): T {
  try {
    const parsed = extractJsonFromText<T>(raw);
    const slices = extractWashCandidateSlices(raw);
    for (const slice of slices) {
      try {
        JSON.parse(slice);
      } catch {
        continue;
      }
      const repaired = repairSingleBackslashLatexInJson(slice);
      if (repaired !== slice) {
        try {
          return JSON.parse(repaired) as T;
        } catch {
          return parsed;
        }
      }
      return parsed;
    }
    return parsed;
  } catch (err) {
    if (!(err instanceof LlmApiError) || err.code !== 'PARSE_ERROR') {
      throw err;
    }
    const slices = extractWashCandidateSlices(raw);
    for (const slice of slices) {
      const repaired = repairSingleBackslashLatexInJson(slice);
      try {
        return JSON.parse(repaired) as T;
      } catch {
        // continue to next candidate slice
      }
    }
    throw err;
  }
}

async function washCompletionJson<T>(
  messages: ChatMessage[],
  options: LlmRequestOptions = {},
): Promise<{ data: T; raw: LlmCompletionResult }> {
  let raw: LlmCompletionResult;
  try {
    raw = await chatCompletion(messages, { ...options, jsonMode: true });
  } catch (err) {
    if (err instanceof LlmApiError && err.statusCode === 400) {
      raw = await chatCompletion(messages, { ...options, jsonMode: false });
    } else {
      throw err;
    }
  }
  return { data: extractWashJsonFromText<T>(raw.content), raw };
}

async function washSingleChunk(
  chunkText: string,
  chunkIndex: number,
  totalChunks: number,
  options: WashQuestionsOptions,
): Promise<DraftQuestion[]> {
  const autoFillExplain = options.autoFillExplain ?? true;
  const autoTag = options.autoTag ?? true;
  const targetChapter = options.targetChapter ?? 1;
  const allowedTypes = resolveAllowedWashTypes(options.allowedTypes);
  const allowedTypeSet = new Set<QuestionType>(allowedTypes);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildWashSystemPrompt(allowedTypes, autoFillExplain, autoTag),
    },
    {
      role: 'user',
      content: `请清洗以下第 ${chunkIndex + 1}/${totalChunks} 段文本（默认章节编号 ${targetChapter}）：\n\n${chunkText}`,
    },
  ];

  const { data } = await washCompletionJson<{ questions?: unknown[] } | unknown[]>(messages, {
    temperature: 0.1,
    maxTokens: options.maxTokens ?? 4096,
    signal: options.signal,
    practiceScope: options.practiceScope,
    config: options.config,
    timeoutMs: options.timeoutMs,
  });

  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(data?.questions)
      ? data.questions
      : [];

  return rawList
    .map((item, idx) => coerceWashedDraft(item, chunkIndex, idx, options))
    .filter((d): d is DraftQuestion => d !== null && allowedTypeSet.has(d.type));
}

export async function washQuestionsChunked(
  rawText: string,
  options: WashQuestionsOptions = {},
  callbacks: WashQuestionsCallbacks = {},
): Promise<WashQuestionsResult> {
  assertPracticeApiReady(options);
  const chunks = splitTextIntoWashChunks(rawText, options.chunkSizeChars);
  const totalChunks = chunks.length;

  if (totalChunks === 0) {
    return {
      drafts: [],
      failedChunks: [],
      totalChunks: 0,
      cancelled: Boolean(options.signal?.aborted),
    };
  }

  if (options.signal?.aborted) {
    return {
      drafts: [],
      failedChunks: [],
      totalChunks,
      cancelled: true,
    };
  }

  const concurrency = Math.min(4, Math.max(1, Math.round(options.concurrency ?? 2)));
  const draftsByChunk: Array<DraftQuestion[] | undefined> = new Array(totalChunks);
  const failedChunks: FailedWashChunk[] = [];
  let completedChunks = 0;
  let nextIndex = 0;
  let cancelled = false;

  const collectOrderedDrafts = (): DraftQuestion[] => {
    const flat: DraftQuestion[] = [];
    for (const chunkDrafts of draftsByChunk) {
      if (chunkDrafts) flat.push(...chunkDrafts);
    }
    return annotateDuplicateStems(flat);
  };

  const emitProgress = (statusText: string) => {
    callbacks.onProgress?.({
      completedChunks,
      totalChunks,
      statusText,
      draftsSoFar: collectOrderedDrafts(),
      failedChunks: [...failedChunks].sort((a, b) => a.chunkIndex - b.chunkIndex),
    });
  };

  emitProgress(`正在识别第 0/${totalChunks} 批题目...`);

  const worker = async () => {
    while (true) {
      if (options.signal?.aborted || cancelled) {
        cancelled = true;
        return;
      }
      const chunkIndex = nextIndex;
      nextIndex += 1;
      if (chunkIndex >= totalChunks) return;

      const chunkText = chunks[chunkIndex]!;
      try {
        const parsed = await washSingleChunk(chunkText, chunkIndex, totalChunks, options);
        draftsByChunk[chunkIndex] = parsed;
      } catch (err) {
        if (
          options.signal?.aborted ||
          (err instanceof LlmApiError && err.code === 'ABORTED')
        ) {
          cancelled = true;
          return;
        }
        failedChunks.push({
          chunkIndex,
          totalChunks,
          rawText: chunkText,
          errorMessage:
            err instanceof LlmApiError
              ? err.userMessage
              : err instanceof Error
                ? err.message
                : 'AI 洗题片段处理失败',
          errorCode: err instanceof LlmApiError ? err.code : undefined,
        });
      }

      completedChunks += 1;
      emitProgress(`正在识别第 ${completedChunks}/${totalChunks} 批题目...`);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, totalChunks) }, () => worker()),
  );

  failedChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

  return {
    drafts: collectOrderedDrafts(),
    failedChunks,
    totalChunks,
    cancelled,
  };
}

export async function retryWashChunk(
  chunk: FailedWashChunk,
  options: WashQuestionsOptions = {},
  _callbacks: WashQuestionsCallbacks = {},
): Promise<DraftQuestion[]> {
  assertPracticeApiReady(options);
  return washSingleChunk(chunk.rawText, chunk.chunkIndex, chunk.totalChunks, options);
}
