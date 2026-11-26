import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultApiConfig, saveApiConfig } from '../../src/services/apiConfig';
import {
  ApiClientError,
  LlmApiError,
  askQuestionFollowUpStream,
  explainQuestionStream,
  retryWashChunk,
  splitTextIntoWashChunks,
  washQuestionsChunked,
} from '../../src/services';
import { MOCK_QUESTIONS } from './fixtures/mockBank';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('quizAiService (M1 structured explain, 10-turn chat, and chunked Smart Wash)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('sessionStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects with NOT_CONFIGURED LlmApiError/ApiClientError when API key is missing', async () => {
    await expect(explainQuestionStream(MOCK_QUESTIONS[0])).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    await expect(askQuestionFollowUpStream(MOCK_QUESTIONS[0], [], '为什么？')).rejects.toBeInstanceOf(
      ApiClientError,
    );
    await expect(washQuestionsChunked('1. 测试题干\nA. 1\nB. 2')).rejects.toBeInstanceOf(
      LlmApiError,
    );
  });

  it('explainQuestionStream uses subject-agnostic QuizHub prompt with required 3 section headers', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [
            {
              message: {
                content: '### 【核心考点】\n考点\n### 【解题思路】\n思路\n### 【逐项排错】\n排错',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const chunks: string[] = [];
    const res = await explainQuestionStream(
      MOCK_QUESTIONS[0],
      { bankName: '高等数学测试库', chapterTitle: '第一章' },
      (c) => chunks.push(c),
    );

    expect(res.content).toContain('### 【核心考点】');
    expect(chunks.length).toBeGreaterThan(0);

    const reqBody = JSON.parse(String(mockFetch.mock.calls[0]![1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemPrompt = reqBody.messages[0]!.content;
    expect(systemPrompt).toContain('QuizHub');
    expect(systemPrompt).not.toContain('人工智能导论');
    expect(systemPrompt).toContain('### 【核心考点】');
    expect(systemPrompt).toContain('### 【解题思路】');
    expect(systemPrompt).toContain('### 【逐项排错】');
    expect(reqBody.messages[1]!.content).toContain('高等数学测试库');
  });

  it('askQuestionFollowUpStream includes previousExplanation and keeps up to 10 non-empty turns (20 messages)', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { content: '追问回答' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const history = Array.from({ length: 22 }, (_, idx) => ({
      role: (idx % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `历史消息 ${idx + 1}`,
    }));
    history.push({ role: 'user', content: '   ' });

    await askQuestionFollowUpStream(
      MOCK_QUESTIONS[0],
      history,
      '为什么不选干扰项？',
      { previousExplanation: '已有解析内容', bankName: '我的题库' },
    );

    const reqBody = JSON.parse(String(mockFetch.mock.calls[0]![1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    // 1 system + 20 non-empty history (10 turns) + 1 current user = 22
    expect(reqBody.messages).toHaveLength(22);
    expect(reqBody.messages[0]!.content).toContain('已有解析内容');
    expect(reqBody.messages[1]!.content).toBe('历史消息 3');
    expect(reqBody.messages[21]!.content).toBe('为什么不选干扰项？');
  });

  it('washQuestionsChunked splits chunks, parses types + AI inferred answers, handles failures and retryWashChunk', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const longText = [
      '1. 牛顿第二定律的表达式是什么？\nA. F=ma\nB. E=mc^2\nC. PV=nRT\nD. U=IR',
      '2. 关于 HTTP 与 HTTPS，哪些说法正确？\nA. HTTPS 基于 TLS\nB. HTTP 默认端口 80\n答案：AB',
    ].join('\n\n' + '填充段落 '.repeat(60) + '\n\n');

    const chunks = splitTextIntoWashChunks(longText, 400);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const mockFetch = vi
      .fn()
      // Chunk 1 succeeds
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    questions: [
                      {
                        type: 'choice',
                        stem: '牛顿第二定律的表达式是什么？',
                        options: ['A. F=ma', 'B. E=mc^2', 'C. PV=nRT', 'D. U=IR'],
                        answer: 0,
                        answerInferred: true,
                        explain: '牛顿第二定律指出合外力等于质量乘以加速度。',
                        tags: ['物理', '力学'],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      // Chunk 2 fails
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Server busy' } }), { status: 500 }),
      )
      // Retry chunk 2 succeeds
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    questions: [
                      {
                        type: 'multi',
                        stem: '关于 HTTP 与 HTTPS，哪些说法正确？',
                        options: ['HTTPS 基于 TLS', 'HTTP 默认端口 80', 'HTTPS 默认端口 21'],
                        answer: ['A', 'B'],
                        answerInferred: false,
                        explain: 'HTTPS 运行在 TLS 之上，HTTP 默认端口为 80。',
                        tags: ['网络'],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', mockFetch);

    const progressEvents: number[] = [];
    const result = await washQuestionsChunked(
      longText,
      { chunkSizeChars: 400, concurrency: 1, autoFillExplain: true, autoTag: true },
      {
        onProgress: (ev) => progressEvents.push(ev.completedChunks),
      },
    );

    expect(result.cancelled).toBe(false);
    expect(result.totalChunks).toBe(2);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]!.aiInferredAnswer).toBe(true);
    expect(result.drafts[0]!.washedByAi).toBe(true);
    expect(result.drafts[0]!.options[0]).toBe('F=ma');
    expect(result.failedChunks).toHaveLength(1);
    expect(progressEvents).toEqual([0, 1, 2]);

    // Verify maxTokens >= 4096 was sent
    const body = JSON.parse(String(mockFetch.mock.calls[0]![1]?.body)) as { max_tokens: number };
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096);

    // Retry failed chunk
    const retried = await retryWashChunk(result.failedChunks[0]!, {
      autoFillExplain: true,
      autoTag: true,
    });
    expect(retried).toHaveLength(1);
    expect(retried[0]!.type).toBe('multi');
    expect(retried[0]!.answer).toEqual([0, 1]);
    expect(retried[0]!.aiInferredAnswer).toBe(false);
  });

  it('washQuestionsChunked supports cancellation via AbortSignal', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const controller = new AbortController();
    controller.abort();

    const result = await washQuestionsChunked('1. 第一题\n\n2. 第二题', {
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.drafts).toEqual([]);
  });

  it('splitTextIntoWashChunks keeps multi-paragraph and short-Q1 questions intact without mid-question splits', () => {
    const multiParaText = [
      `1. First question stem ${'x'.repeat(160)}\n\nA. opt a1\nB. opt b1\n\n答案：A`,
      `2. Second question stem ${'y'.repeat(140)}\n\nA. option a2 ${'z'.repeat(60)}\nB. option b2\n\n答案：B`,
    ].join('\n\n');

    const multiChunks = splitTextIntoWashChunks(multiParaText, 400);
    expect(multiChunks).toHaveLength(2);
    expect(multiChunks[0]).toMatch(/^1\. First question stem/);
    expect(multiChunks[0]).toContain('答案：A');
    expect(multiChunks[1]).toMatch(/^2\. Second question stem/);
    expect(multiChunks[1]).toContain('A. option a2');

    const shortQ1SingleLine = [
      '1. Short Q1?\nA. Yes\nB. No\n答案：A',
      `Q2: Second question ${'a'.repeat(160)}\nA. ${'b'.repeat(60)}\nB. ${'c'.repeat(60)}\nC. ${'d'.repeat(60)}\nD. end`,
    ].join('\n');

    const singleChunks = splitTextIntoWashChunks(shortQ1SingleLine, 400);
    expect(singleChunks).toHaveLength(2);
    expect(singleChunks[0]).toBe('1. Short Q1?\nA. Yes\nB. No\n答案：A');
    expect(singleChunks[1]).toMatch(/^Q2: Second question/);
    expect(singleChunks[1]).toContain('C. ');
  });

  it('preserves "C programming language" option text and parses string "false" answerInferred strictly', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questions: [
                    {
                      type: 'choice',
                      stem: 'Which language is known for manual memory management?',
                      options: ['Python', 'Java', 'C programming language', 'Go'],
                      answer: 2,
                      answerInferred: 'false',
                      explain: 'C provides manual malloc/free.',
                    },
                    {
                      type: 'choice',
                      stem: 'Unpunctuated labeled options test',
                      options: ['A tree', 'B graph', 'C list', 'D stack'],
                      answer: 1,
                      answerInferred: 'true',
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const res = await washQuestionsChunked('1. Which language...\n2. Unpunctuated...');
    expect(res.drafts).toHaveLength(2);
    expect(res.drafts[0]!.options).toEqual(['Python', 'Java', 'C programming language', 'Go']);
    expect(res.drafts[0]!.aiInferredAnswer).toBe(false);
    expect(res.drafts[1]!.options).toEqual(['tree', 'graph', 'list', 'stack']);
    expect(res.drafts[1]!.aiInferredAnswer).toBe(true);
  });

  it('injects 4 strict rules and allowedTypes into wash System Prompt and threads allowedTypes in retryWashChunk', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { content: JSON.stringify({ questions: [] }) } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    // 1) Default allowedTypes (choice, multi, tf, short — excludes analysis)
    await washQuestionsChunked('1. 示例题');
    const bodyDefault = JSON.parse(String(mockFetch.mock.calls[0]![1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const sysDefault = bodyDefault.messages[0]!.content;
    const userDefault = bodyDefault.messages[1]!.content;
    expect(sysDefault).toContain('"choice"');
    expect(sysDefault).toContain('"multi"');
    expect(sysDefault).toContain('"tf"');
    expect(sysDefault).toContain('"short"');
    expect(sysDefault).not.toContain('"analysis"');
    expect(sysDefault).toContain('纯 JSON');
    expect(sysDefault).toContain('直接跳过');
    expect(sysDefault).toContain('src/types/quiz.ts');
    expect(sysDefault).toContain('\\\\frac');
    expect(sysDefault).toContain('\\\\alpha');
    expect(sysDefault).not.toMatch(/阅卷助教|recommendedMastery/);
    expect(userDefault).toContain('：\n');

    // 2) Objective-only allowedTypes
    await washQuestionsChunked('1. 示例题', {
      allowedTypes: ['choice', 'multi', 'tf'],
    });
    const bodyObj = JSON.parse(String(mockFetch.mock.calls[1]![1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const sysObj = bodyObj.messages[0]!.content;
    expect(sysObj).toContain('"choice"');
    expect(sysObj).toContain('"multi"');
    expect(sysObj).toContain('"tf"');
    expect(sysObj).not.toContain('"short"');
    expect(sysObj).not.toContain('"analysis"');

    // 3) retryWashChunk enforces allowedTypes in prompt & post-filter
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questions: [
                    { type: 'choice', stem: '单选过滤', options: ['A', 'B'], answer: 0 },
                    { type: 'tf', stem: '判断保留', answer: true },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const retried = await retryWashChunk(
      { chunkIndex: 0, totalChunks: 1, rawText: '1. 示例题', errorMessage: 'err' },
      { allowedTypes: ['tf'] },
    );
    const bodyRetry = JSON.parse(String(mockFetch.mock.calls[2]![1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(bodyRetry.messages[0]!.content).toContain('"tf"');
    expect(bodyRetry.messages[0]!.content).not.toContain('"choice"');
    expect(retried).toHaveLength(1);
    expect(retried[0]!.type).toBe('tf');
  });

  it('filters disallowed question types client-side and returns empty drafts cleanly when all filtered out', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const allFiveQuestions = [
      { type: 'choice', stem: '单选题', options: ['A', 'B'], answer: 0 },
      { type: 'multi', stem: '多选题', options: ['A', 'B', 'C'], answer: [0, 1] },
      { type: 'tf', stem: '判断题', answer: true },
      { type: 'short', stem: '简答题', answer: '简答参考答案' },
      { type: 'analysis', stem: '综合分析题', answer: '综合分析答案' },
    ];

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [{ message: { content: JSON.stringify({ questions: allFiveQuestions }) } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    questions: [allFiveQuestions[3], allFiveQuestions[4]],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    questions: [allFiveQuestions[0], allFiveQuestions[4]],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', mockFetch);

    const partial = await washQuestionsChunked('test1', { allowedTypes: ['choice', 'tf'] });
    expect(partial.failedChunks).toEqual([]);
    expect(partial.drafts.map((d) => d.type)).toEqual(['choice', 'tf']);

    const allFiltered = await washQuestionsChunked('test2', {
      allowedTypes: ['choice', 'multi', 'tf'],
    });
    expect(allFiltered.cancelled).toBe(false);
    expect(allFiltered.failedChunks).toEqual([]);
    expect(allFiltered.drafts).toEqual([]);

    const defaultFiltered = await washQuestionsChunked('test3');
    expect(defaultFiltered.failedChunks).toEqual([]);
    expect(defaultFiltered.drafts.map((d) => d.type)).toEqual(['choice']);
  });

  it('falls back from jsonMode: true to jsonMode: false on HTTP 400 in washCompletionJson', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'response_format json_object is unsupported' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    questions: [{ type: 'tf', stem: 'HTTP 400 fallback', answer: true }],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', mockFetch);

    const res = await washQuestionsChunked('1. 判断题');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const req1 = JSON.parse(String(mockFetch.mock.calls[0]![1]?.body)) as {
      response_format?: unknown;
    };
    const req2 = JSON.parse(String(mockFetch.mock.calls[1]![1]?.body)) as {
      response_format?: unknown;
    };
    expect(req1.response_format).toEqual({ type: 'json_object' });
    expect(req2.response_format).toBeUndefined();
    expect(res.drafts).toHaveLength(1);
    expect(res.drafts[0]!.stem).toBe('HTTP 400 fallback');
  });

  it('repairs single-backslash LaTeX commands in wash JSON fallback while preserving genuine JSON escapes', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const rawMalformedJsonContent = [
      '<think>内部推理过程</think>',
      '```json',
      '{',
      '  "questions": [',
      '    {',
      '      "type": "short",',
      '      "stem": "计算 $\\frac{1}{2} + \\alpha + \\theta + \\beta + \\rho \\neq 0$，其中 \\forall x \\in \\underline{z}，\\sqrt{x} 与 \\sum_{i=1}^{n} \\int \\cdot \\leq \\geq \\vec{a} \\hat{y} \\left( \\right) \\langle \\bar{x} \\begin{cases}x=1\\end{cases} \\text{kg} \\times \\tau \\nu \\nabla \\\\gamma \\"quoted\\" \\/path \\u0041\\n下一行\\t选项",',
      '      "answer": "答案包含 $\\frac{a}{b}$ 与 $\\alpha$",',
      '      "explain": "解释 $\\theta \\neq \\beta$"',
      '    }',
      '  ]',
      '}',
      '```',
    ].join('\n');

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { content: rawMalformedJsonContent } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const res = await washQuestionsChunked('1. 公式题');
    expect(res.failedChunks).toEqual([]);
    expect(res.drafts).toHaveLength(1);
    const stem = res.drafts[0]!.stem;
    expect(stem).toContain('\\frac{1}{2}');
    expect(stem).toContain('\\alpha');
    expect(stem).toContain('\\theta');
    expect(stem).toContain('\\beta');
    expect(stem).toContain('\\rho');
    expect(stem).toContain('\\neq');
    expect(stem).toContain('\\forall');
    expect(stem).toContain('\\underline{z}');
    expect(stem).toContain('\\sqrt{x}');
    expect(stem).toContain('\\sum');
    expect(stem).toContain('\\int');
    expect(stem).toContain('\\cdot');
    expect(stem).toContain('\\leq');
    expect(stem).toContain('\\geq');
    expect(stem).toContain('\\vec{a}');
    expect(stem).toContain('\\hat{y}');
    expect(stem).toContain('\\left(');
    expect(stem).toContain('\\right)');
    expect(stem).toContain('\\langle');
    expect(stem).toContain('\\bar{x}');
    expect(stem).toContain('\\begin{cases}');
    expect(stem).toContain('\\text{kg}');
    expect(stem).toContain('\\times');
    expect(stem).toContain('\\tau');
    expect(stem).toContain('\\nu');
    expect(stem).toContain('\\nabla');
    expect(stem).toContain('\\gamma');
    expect(stem).not.toContain('\\\\gamma');
    expect(stem).toContain('"quoted"');
    expect(stem).toContain('/path');
    expect(stem).toContain('A');
    expect(res.drafts[0]!.answer).toContain('\\frac{a}{b}');
    expect(res.drafts[0]!.explain).toContain('\\theta \\neq \\beta');
  });

  it('rejects non-JSON text with PARSE_ERROR without triggering HTTP 400 retry', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { content: '（历史拒答记录，已略）' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const res = await washQuestionsChunked('1. 任意题目');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(res.drafts).toEqual([]);
    expect(res.failedChunks).toHaveLength(1);
    expect(res.failedChunks[0]!.errorCode).toBe('PARSE_ERROR');

    await expect(
      retryWashChunk({
        chunkIndex: 0,
        totalChunks: 1,
        rawText: '1. 任意题目',
        errorMessage: 'parse error',
      }),
    ).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    });
  });

  it('repairs valid-JSON-escape-letter LaTeX commands even when extractJsonFromText succeeds without PARSE_ERROR', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });

    // Every single-backslash LaTeX command here starts with a valid JSON escape letter (b/f/n/r/t),
    // so raw JSON.parse succeeds silently unless extractWashJsonFromText repairs the valid slice.
    const rawValidEscapeJsonContent = [
      '{',
      '  "questions": [',
      '    {',
      '      "type": "short",',
      '      "stem": "计算 $\\frac{1}{2} + \\theta + \\beta + \\rho \\neq 0$，当 $\\begin{cases}x=1\\\\end{cases}$ 时 $2 \\times 3 \\to 6$",',
      '      "answer": "$\\text{ok}$",',
      '      "explain": "$\\frac{1}{2} \\neq \\theta$"',
      '    }',
      '  ]',
      '}',
    ].join('\n');

    expect(() => JSON.parse(rawValidEscapeJsonContent)).not.toThrow();

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { content: rawValidEscapeJsonContent } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const res = await washQuestionsChunked('1. 仅含合法转义字母的 LaTeX 题');
    expect(res.failedChunks).toEqual([]);
    expect(res.drafts).toHaveLength(1);

    const draft = res.drafts[0]!;
    expect(draft.stem).toBe(
      String.raw`计算 $\frac{1}{2} + \theta + \beta + \rho \neq 0$，当 $\begin{cases}x=1\end{cases}$ 时 $2 \times 3 \to 6$`,
    );
    expect(draft.answer).toBe(String.raw`$\text{ok}$`);
    expect(draft.explain).toBe(String.raw`$\frac{1}{2} \neq \theta$`);

    for (const field of [draft.stem, draft.answer, draft.explain]) {
      expect(field).not.toMatch(/[\u0008\u0009\u000a\u000c\u000d]/);
    }
  });

  it('requests canonical aiInferredAnswer field in wash prompt, strips "A. "/"B、" prefixes, and handles empty chunk arrays', async () => {
    saveApiConfig({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-test-canonical',
      temperature: 0.2,
      maxTokens: 2048,
      timeoutMs: 30_000,
      storageScope: 'local',
    });

    let capturedSystemPrompt = '';
    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      capturedSystemPrompt = body.messages.find((m) => m.role === 'system')?.content ?? '';
      return new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questions: [
                    {
                      type: 'choice',
                      stem: '无原文答案的选择题',
                      options: ['A. 选项一', 'B、选项二'],
                      answer: 1,
                      explain: '推导解析',
                      aiInferredAnswer: true,
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await washQuestionsChunked('1. 无原文答案的选择题\nA. 选项一\nB、选项二');
    expect(capturedSystemPrompt).toContain('"aiInferredAnswer"');
    expect(capturedSystemPrompt).toContain('"A. "/"B、"');
    expect(capturedSystemPrompt).toContain('{"questions":[]}');
    expect(res.drafts).toHaveLength(1);
    expect(res.drafts[0]!.options).toEqual(['选项一', '选项二']);
    expect(res.drafts[0]!.answer).toBe(1);
    expect(res.drafts[0]!.aiInferredAnswer).toBe(true);
  });
});
