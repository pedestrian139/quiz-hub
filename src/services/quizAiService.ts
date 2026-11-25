import type { MasteryLevel, Question, QuestionType, UserRecord } from '../types/quiz';
import { formatAnswerText, getOptionLabel, getTypeLabel } from '../core/questionUtils';
import {
  chatCompletionJson,
  streamChatCompletion,
  type ChatMessage,
  type LlmCompletionResult,
  type LlmRequestOptions,
} from './llmClient';

export interface QuestionExplainContext {
  userRecord?: UserRecord;
  chapterTitle?: string;
}

export interface SubjectiveGradeFeedback {
  score: number;
  recommendedMastery: MasteryLevel;
  summary: string;
  matchedPoints: string[];
  missingPoints: string[];
  improvedAnswer: string;
}

export interface GenerateQuestionsOptions extends LlmRequestOptions {
  chapter: number;
  count?: number;
  types?: QuestionType[];
  sourceFile?: string;
}

function formatQuestionPromptBlock(q: Question, chapterTitle?: string): string {
  const lines: string[] = [
    `【题型】${getTypeLabel(q.type)}`,
    `【章节】第 ${q.chapter} 章${chapterTitle ? ` · ${chapterTitle}` : ''}`,
    `【题干】${q.stem}`,
  ];

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
  if (q.explain) {
    lines.push(`【原题解析】${q.explain}`);
  }

  return lines.join('\n');
}

function formatUserAttemptLine(q: Question, record?: UserRecord): string {
  if (!record) return '学生尚未作答或正在复习本题。';
  let choiceStr = '';
  if (q.type === 'choice' && typeof record.choice === 'number') {
    choiceStr = `${getOptionLabel(record.choice)}${q.options?.[record.choice] ? `. ${q.options[record.choice]}` : ''}`;
  } else if (q.type === 'multi' && Array.isArray(record.choice)) {
    choiceStr = record.choice.map((i) => getOptionLabel(i)).join('、');
  } else if (q.type === 'tf' && typeof record.choice === 'boolean') {
    choiceStr = record.choice ? '正确' : '错误';
  }
  const verdict = record.ok === 1 ? '已答对/已掌握' : '答错/待巩固';
  return choiceStr ? `学生作答：${choiceStr}（${verdict}）` : `学生自评状态：${verdict}`;
}

export async function explainQuestionStream(
  question: Question,
  context: QuestionExplainContext = {},
  onChunk?: (chunk: string, accumulated: string) => void,
  options: LlmRequestOptions = {},
): Promise<LlmCompletionResult> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是《人工智能导论》大学期末复习助教。请用简洁清晰的中文做题目深度解析，严格紧扣题目本身，不要编造与标准答案矛盾的结论。输出分为：1) 核心考点与解题思路；2) 错因/干扰项辨析（若为选择题/判断题逐项点出关键点）；3) 一句话速记口诀。控制在 350 字以内。',
    },
    {
      role: 'user',
      content: `${formatQuestionPromptBlock(question, context.chapterTitle)}\n\n${formatUserAttemptLine(question, context.userRecord)}\n\n请针对本题给出精准、易懂的深度解析。`,
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
  const trimmedHistory = history.slice(-6);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是《人工智能导论》课程助教，正在辅导学生理解下面这道考题。请用简明准确的中文直接回答学生的追问，必要时举一个直观小例子帮助理解。\n\n${formatQuestionPromptBlock(question, context.chapterTitle)}\n${formatUserAttemptLine(question, context.userRecord)}`,
    },
    ...trimmedHistory,
    { role: 'user', content: userQuestion.trim() },
  ];

  return streamChatCompletion(messages, options, onChunk);
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

export async function gradeSubjectiveDraft(
  question: Question,
  userDraft: string,
  options: LlmRequestOptions = {},
): Promise<{ feedback: SubjectiveGradeFeedback; raw: LlmCompletionResult }> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是《人工智能导论》课程阅卷助教。请对照标准参考答案和采分要点，客观批改学生的主观题作答，并严格返回合法 JSON 对象（不要输出多余解释）：{"score":0到100的整数,"recommendedMastery":0或1或2,"summary":"一句话总体评价","matchedPoints":["已命中的要点"],"missingPoints":["遗漏或需补充的要点"],"improvedAnswer":"基于学生作答润色后的高分示范回答"}。评分映射：>=80 对应 2（完全会），50~79 对应 1（有点模糊），<50 对应 0（不会）。',
    },
    {
      role: 'user',
      content: `${formatQuestionPromptBlock(question)}\n\n【学生作答】\n${userDraft.trim()}\n\n请输出 JSON 格式批改结果。`,
    },
  ];

  const { data, raw } = await chatCompletionJson<Record<string, unknown>>(messages, {
    temperature: 0.2,
    maxTokens: 900,
    ...options,
  });

  const rawScore = typeof data.score === 'number' && Number.isFinite(data.score) ? data.score : 0;
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));
  const recommendedMastery: MasteryLevel =
    data.recommendedMastery === 2 || data.recommendedMastery === 1 || data.recommendedMastery === 0
      ? data.recommendedMastery
      : score >= 80
        ? 2
        : score >= 50
          ? 1
          : 0;

  const feedback: SubjectiveGradeFeedback = {
    score,
    recommendedMastery,
    summary:
      typeof data.summary === 'string' && data.summary.trim()
        ? data.summary.trim()
        : '已完成对比批改，请结合下方采分要点查漏补缺。',
    matchedPoints: toStringList(data.matchedPoints),
    missingPoints: toStringList(data.missingPoints),
    improvedAnswer:
      typeof data.improvedAnswer === 'string' && data.improvedAnswer.trim()
        ? data.improvedAnswer.trim()
        : formatAnswerText(question),
  };

  return { feedback, raw };
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
  const type = typeof obj.type === 'string' && ALLOWED_TYPES.has(obj.type as QuestionType)
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
 * Designed so the parallel Question Bank Import branch can invoke it directly.
 */
export async function generateQuestionsFromText(
  rawText: string,
  options: GenerateQuestionsOptions,
): Promise<{ questions: Question[]; raw: LlmCompletionResult }> {
  const count = Math.min(20, Math.max(1, Math.round(options.count ?? 5)));
  const types = options.types && options.types.length > 0 ? options.types : ['choice', 'tf', 'short'];
  const sourceFile = options.sourceFile?.trim() || 'AI智能出题';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是大学课程出题专家。请根据给定学习材料生成 ${count} 道高质量试题，题型限定在 [${types.join(', ')}] 中，并严格返回 JSON 对象 {"questions":[...]}。每题字段必须严格遵守：
- choice: { "type":"choice", "stem":"...", "options":["A内容","B内容","C内容","D内容"], "answer":0, "explain":"..." } (answer 为 0-based 下标，options 不含 A./B. 前缀)
- multi: { "type":"multi", "stem":"...", "options":[...], "answer":[0,2], "explain":"..." }
- tf: { "type":"tf", "stem":"...", "answer":true, "explain":"..." }
- short / analysis: { "type":"short", "stem":"...", "answer":"参考答案", "keyPoints":["要点1","要点2"], "explain":"..." }`,
    },
    {
      role: 'user',
      content: `请基于以下课程材料生成 ${count} 道第 ${options.chapter} 章试题：\n\n${rawText.trim().slice(0, 8000)}`,
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
