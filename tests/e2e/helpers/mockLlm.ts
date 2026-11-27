import type { Page, Route } from '@playwright/test';
import type { QuestionType } from './storage.ts';

export const MOCK_API_BASE = 'https://mock-llm.example.test/v1';
export const API_CONFIG_STORAGE_KEY = 'ai-intro-quiz-api-config-v1';

export interface ApiConfigSeed {
  provider?:
    | 'deepseek'
    | 'openai'
    | 'siliconflow'
    | 'zhipu'
    | 'dashscope'
    | 'moonshot'
    | 'gemini'
    | 'custom';
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  storageScope?: 'local' | 'session';
}

export interface MockChatMessage {
  role: string;
  content: string;
}

export interface MockChatCompletionsBody {
  model?: string;
  messages?: MockChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type?: string };
  [key: string]: unknown;
}

export interface RecordedLlmRequest {
  url: string;
  method: string;
  body: MockChatCompletionsBody | null;
  headers: Record<string, string>;
  timestamp: number;
}

export interface MockWashedQuestion {
  type: QuestionType;
  stem: string;
  options?: string[];
  answer: number | number[] | boolean | string;
  explain?: string;
  keyPoints?: string[];
  tags?: string[];
  chapter?: number;
  aiInferredAnswer?: boolean;
}

export type MockLlmHandler = (
  ctx: {
    url: string;
    method: string;
    body: MockChatCompletionsBody;
    headers: Record<string, string>;
    attempt: number;
  },
  route: Route,
) => Promise<boolean | void> | boolean | void;

export interface MockLlmOptions {
  baseUrl?: string;
  model?: string;
  models?: string[];
  chunkDelayMs?: number;
  delayMs?: number;
  explainContent?: string;
  followUpReply?: string | ((lastUser: string, messages: MockChatMessage[]) => string);
  washQuestions?:
    | MockWashedQuestion[]
    | ((chunkText: string, userContent: string, attempt: number) => MockWashedQuestion[]);
  failOnMatch?: string | RegExp;
  failCount?: number;
  failStatus?: number;
  failBody?: unknown;
  customHandler?: MockLlmHandler;
}

export interface MockLlmController {
  requests: RecordedLlmRequest[];
  setHandler: (handler: MockLlmHandler | null) => void;
  clear: () => void;
  unroute: () => Promise<void>;
}

const DEFAULT_EXPLAIN_MARKDOWN = [
  '### 【核心考点】',
  '本题主要考察核心概念辨析与公式推导（如二次函数 $x^2$ 与约束条件的对应关系）。',
  '',
  '### 【解题思路】',
  '1. 先提取题干中的关键前提与限定范围。',
  '2. 结合定义与数学关系 $f(x) = x^2$ 逐一核对判定条件。',
  '',
  '### 【逐项排错】',
  '- **正确项**：与标准定义及推理链条完全一致。',
  '- **干扰项**：常见陷阱在于混淆因果顺序或遗漏边界约束。',
].join('\n');

export function buildDefaultApiConfig(overrides?: Partial<ApiConfigSeed>): Required<ApiConfigSeed> {
  return {
    provider: overrides?.provider ?? 'custom',
    baseUrl: overrides?.baseUrl ?? MOCK_API_BASE,
    apiKey: overrides?.apiKey ?? 'sk-e2e-mock-quizhub-key',
    model: overrides?.model ?? 'mock-quizhub-chat',
    temperature: overrides?.temperature ?? 0.3,
    maxTokens: overrides?.maxTokens ?? 1200,
    timeoutMs: overrides?.timeoutMs ?? 45000,
    storageScope: overrides?.storageScope ?? 'local',
  };
}

export async function seedGuestApiConfig(
  page: Page,
  overrides?: Partial<ApiConfigSeed>,
): Promise<void> {
  const cfg = buildDefaultApiConfig(overrides);
  await page.addInitScript(
    ([key, value]) => {
      const target = JSON.parse(value).storageScope === 'session' ? sessionStorage : localStorage;
      target.setItem(key, value);
    },
    [API_CONFIG_STORAGE_KEY, JSON.stringify(cfg)] as const,
  );
}

export async function clearGuestApiConfig(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }, API_CONFIG_STORAGE_KEY);
}

function buildSseBody(text: string, model: string, chunkCount = 4): string {
  const size = Math.max(1, Math.ceil(text.length / chunkCount));
  const frames: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    const chunk = text.slice(i, i + size);
    frames.push(
      `data: ${JSON.stringify({
        id: 'mock-chatcmpl-1',
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
      })}\n\n`,
    );
  }
  frames.push('data: [DONE]\n\n');
  return frames.join('');
}

function matchesFailPattern(text: string, pattern: string | RegExp): boolean {
  if (typeof pattern === 'string') return text.includes(pattern);
  const flags = pattern.flags.replace('g', '');
  return new RegExp(pattern.source, flags).test(text);
}

function extractRawSourceText(userContent: string): string {
  const markerIdx = userContent.indexOf('：\n');
  if (markerIdx >= 0) {
    return userContent.slice(markerIdx + 2).trim();
  }
  return userContent.trim();
}

function buildDefaultWashQuestions(userContent: string): MockWashedQuestion[] {
  const raw = extractRawSourceText(userContent);
  const blocks = raw
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !b.startsWith('#'));

  const results: MockWashedQuestion[] = [];
  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx]!;
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const answerLine = lines.find((l) => /^(?:答案|参考答案|Answer)\s*[:：]/i.test(l));
    const hasExplicitAnswer = Boolean(answerLine);
    const answerVal = answerLine
      ? answerLine.replace(/^(?:答案|参考答案|Answer)\s*[:：]\s*/i, '').trim()
      : '';

    const optionLines = lines.filter((l) => /^[A-F][.、)）]\s*/.test(l));
    const stemLine = lines.find(
      (l) => !/^(?:答案|参考答案|Answer|解析)\s*[:：]/i.test(l) && !/^[A-F][.、)）]\s*/.test(l),
    );
    const stem = (stemLine ?? `洗题识别题目 ${idx + 1}`).replace(/^\d+[.、)）]\s*/, '').trim();

    if (optionLines.length >= 2) {
      const options = optionLines.map((l) => l.replace(/^[A-F][.、)）]\s*/, '').trim());
      const letters = answerVal.toUpperCase().match(/[A-F]/g) ?? [];
      if (letters.length > 1) {
        const indices = Array.from(
          new Set(letters.map((c) => c.charCodeAt(0) - 65).filter((n) => n >= 0 && n < options.length)),
        ).sort((a, b) => a - b);
        results.push({
          type: 'multi',
          stem,
          options,
          answer: indices.length > 0 ? indices : [0, 1],
          explain: 'AI 智能洗题自动解析：核对全部正确选项组合。',
          tags: ['智能洗题', '多选'],
          aiInferredAnswer: !hasExplicitAnswer,
        });
      } else {
        const idxAns =
          letters[0] !== undefined
            ? Math.min(options.length - 1, Math.max(0, letters[0].charCodeAt(0) - 65))
            : 0;
        results.push({
          type: 'choice',
          stem,
          options,
          answer: idxAns,
          explain: hasExplicitAnswer
            ? 'AI 智能洗题解析：定位关键词即可锁定唯一正确选项。'
            : '原文未给出答案，AI 已结合语义推断最合理选项。',
          tags: ['智能洗题', '单选'],
          aiInferredAnswer: !hasExplicitAnswer,
        });
      }
      continue;
    }

    if (/^(?:正确|错误|对|错|true|false)$/i.test(answerVal) || /判断/.test(block)) {
      const boolAns = /^(?:正确|对|true)$/i.test(answerVal)
        ? true
        : /^(?:错误|错|false)$/i.test(answerVal)
          ? false
          : true;
      results.push({
        type: 'tf',
        stem,
        answer: boolAns,
        explain: 'AI 智能洗题解析：根据核心概念判定命题真伪。',
        tags: ['智能洗题', '判断'],
        aiInferredAnswer: !hasExplicitAnswer,
      });
      continue;
    }

    if (answerVal.length > 0 && !/无答案/.test(block)) {
      results.push({
        type: 'short',
        stem,
        answer: answerVal,
        keyPoints: [answerVal.slice(0, 24)],
        explain: 'AI 智能洗题解析：提炼参考答案核心要点。',
        tags: ['智能洗题', '简答'],
        aiInferredAnswer: false,
      });
    } else {
      results.push({
        type: 'choice',
        stem,
        options: ['核心定义准确描述', '混淆边界条件描述', '无关干扰陈述', '片面局部概括'],
        answer: 0,
        explain: '原文未附带答案，已由 AI 自动补全选项并推断答案。',
        tags: ['智能洗题', 'AI推断'],
        aiInferredAnswer: true,
      });
    }
  }

  if (results.length > 0) return results;

  const snippet = raw.slice(0, 28).replace(/\s+/g, ' ');
  return [
    {
      type: 'choice',
      stem: `基于导入文本「${snippet}」的核心概念题`,
      options: ['符合标准定义', '违背前提条件', '范围过度扩大', '概念张冠李戴'],
      answer: 0,
      explain: 'AI 智能洗题结构化解析。',
      tags: ['智能洗题'],
      aiInferredAnswer: !/答案|Answer/.test(raw),
    },
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function installMockLlm(
  page: Page,
  options: MockLlmOptions = {},
): Promise<MockLlmController> {
  const baseUrl = (options.baseUrl ?? MOCK_API_BASE).replace(/\/+$/, '');
  const model = options.model ?? 'mock-quizhub-chat';
  const models = options.models ?? [model, 'mock-quizhub-fast'];
  const requests: RecordedLlmRequest[] = [];
  const attemptCounts = new Map<string, number>();
  let customHandler: MockLlmHandler | null = options.customHandler ?? null;

  const modelsPattern = `${baseUrl}/models`;
  const completionsPattern = `${baseUrl}/chat/completions`;

  const modelsRouteHandler = async (route: Route) => {
    const request = route.request();
    requests.push({
      url: request.url(),
      method: request.method(),
      body: null,
      headers: request.headers(),
      timestamp: Date.now(),
    });
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: models.map((id) => ({ id })),
        }),
      });
    } catch {
      // Request aborted or page closed
    }
  };

  const completionsRouteHandler = async (route: Route) => {
    const request = route.request();
    let body: MockChatCompletionsBody = {};
    try {
      body = (request.postDataJSON() ?? {}) as MockChatCompletionsBody;
    } catch {
      body = {};
    }

    const headers = request.headers();
    requests.push({
      url: request.url(),
      method: request.method(),
      body,
      headers,
      timestamp: Date.now(),
    });

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const systemContent = messages.find((m) => m.role === 'system')?.content ?? '';
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const userContent = lastUserMessage?.content ?? '';
    const attemptKey = `${Boolean(body.stream)}:${userContent.slice(0, 120)}`;
    const attempt = (attemptCounts.get(attemptKey) ?? 0) + 1;
    attemptCounts.set(attemptKey, attempt);

    if (customHandler) {
      const result = await customHandler(
        { url: request.url(), method: request.method(), body, headers, attempt },
        route,
      );
      if (result !== false) {
        return;
      }
    }

    if (options.delayMs && options.delayMs > 0) {
      await sleep(options.delayMs);
    }

    if (
      options.failOnMatch &&
      matchesFailPattern(userContent, options.failOnMatch) &&
      attempt <= (options.failCount ?? 1)
    ) {
      try {
        await route.fulfill({
          status: options.failStatus ?? 500,
          contentType: 'application/json',
          body: JSON.stringify(
            options.failBody ?? {
              error: { message: `Mock LLM error on attempt ${attempt}` },
            },
          ),
        });
      } catch {
        // Request aborted or page closed
      }
      return;
    }

    const resolvedModel = typeof body.model === 'string' && body.model ? body.model : model;

    if (body.stream === true) {
      const assistantTurns = messages.filter((m) => m.role === 'assistant').length;
      const isFollowUp =
        assistantTurns > 0 ||
        (/追问/.test(systemContent) && !userContent.includes('深度解析'));

      let text: string;
      if (isFollowUp) {
        if (typeof options.followUpReply === 'function') {
          text = options.followUpReply(userContent, messages);
        } else if (typeof options.followUpReply === 'string') {
          text = options.followUpReply;
        } else if (/干扰项/.test(userContent)) {
          text = `针对追问「${userContent}」：干扰项通常混淆了充分条件与必要条件（已携带前文 ${assistantTurns} 轮上下文）。`;
        } else if (/变式/.test(userContent)) {
          text = `针对追问「${userContent}」：同类变式题建议对比 $y = x^2 + 1$ 的单调区间变化（已携带前文 ${assistantTurns} 轮上下文）。`;
        } else {
          text = `针对你的追问「${userContent}」：结合前文 ${assistantTurns} 轮解析上下文，核心在于紧扣边界条件与定义域。`;
        }
      } else {
        text = options.explainContent ?? DEFAULT_EXPLAIN_MARKDOWN;
      }

      if (options.chunkDelayMs && options.chunkDelayMs > 0) {
        await sleep(options.chunkDelayMs * 4);
      }

      try {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
          },
          body: buildSseBody(text, resolvedModel, 4),
        });
      } catch {
        // Request aborted or page closed
      }
      return;
    }

    // Non-streaming requests
    if (userContent.trim() === 'Reply with OK only.') {
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            model: resolvedModel,
            choices: [{ message: { content: 'OK' } }],
          }),
        });
      } catch {
        // Request aborted or page closed
      }
      return;
    }

    if (/阅卷助教|recommendedMastery/.test(systemContent)) {
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            model: resolvedModel,
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 88,
                    recommendedMastery: 2,
                    summary: '核心概念表述准确，逻辑清晰。',
                    matchedPoints: ['核心机制准确'],
                    missingPoints: ['可补充典型应用案例'],
                    improvedAnswer: '示范回答：结合核心机制与典型应用场景完整作答。',
                  }),
                },
              },
            ],
          }),
        });
      } catch {
        // Request aborted or page closed
      }
      return;
    }

    // AI Smart Washing / Question Generation JSON response
    const chunkText = extractRawSourceText(userContent);
    const washed =
      typeof options.washQuestions === 'function'
        ? options.washQuestions(chunkText, userContent, attempt)
        : Array.isArray(options.washQuestions)
          ? options.washQuestions
          : buildDefaultWashQuestions(userContent);

    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: resolvedModel,
          choices: [
            {
              message: {
                content: JSON.stringify({ questions: washed }),
              },
            },
          ],
        }),
      });
    } catch {
      // Request aborted or page closed
    }
  };

  await page.route(modelsPattern, modelsRouteHandler);
  await page.route(completionsPattern, completionsRouteHandler);

  return {
    requests,
    setHandler: (handler: MockLlmHandler | null) => {
      customHandler = handler;
    },
    clear: () => {
      requests.length = 0;
      attemptCounts.clear();
      customHandler = options.customHandler ?? null;
    },
    unroute: async () => {
      await page.unroute(modelsPattern, modelsRouteHandler);
      await page.unroute(completionsPattern, completionsRouteHandler);
    },
  };
}
