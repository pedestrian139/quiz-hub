import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_CONFIG_STORAGE_KEY,
  clearApiConfig,
  createDefaultApiConfig,
  isApiConfigReady,
  isLocalEndpoint,
  isValidHttpUrl,
  loadApiConfig,
  maskApiKey,
  normalizeBaseUrl,
  sanitizeApiConfig,
  saveApiConfig,
} from '../../src/services/apiConfig';
import {
  LlmApiError,
  buildChatCompletionsUrl,
  buildModelsUrl,
  chatCompletion,
  extractJsonFromText,
  fetchAvailableModels,
  streamChatCompletion,
  testApiConnection,
} from '../../src/services/llmClient';
import {
  generateQuestionsFromText,
  gradeSubjectiveDraft,
} from '../../src/services/quizAiService';
import { STORAGE_KEY } from '../../src/core/storage';
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

describe('API services (V2 feat/api-integration)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('sessionStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('API-01: normalizes base URLs, masks keys, and validates remote vs localhost readiness', () => {
    expect(normalizeBaseUrl(' https://api.deepseek.com/v1/chat/completions/ ')).toBe(
      'https://api.deepseek.com/v1',
    );
    expect(normalizeBaseUrl('https://api.openai.com/v1/models')).toBe('https://api.openai.com/v1');
    expect(buildChatCompletionsUrl('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    );
    expect(buildModelsUrl('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com/v1/models',
    );

    expect(isValidHttpUrl('https://api.deepseek.com/v1')).toBe(true);
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isLocalEndpoint('http://localhost:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://127.0.0.1:8080/v1')).toBe(true);
    expect(isLocalEndpoint('https://api.deepseek.com/v1')).toBe(false);

    expect(maskApiKey('')).toBe('未设置');
    expect(maskApiKey('sk-1234567890abcd')).toBe('sk-1••••abcd');

    const remoteMissingKey = createDefaultApiConfig();
    expect(isApiConfigReady(remoteMissingKey)).toBe(false);

    const remoteReady = { ...remoteMissingKey, apiKey: 'sk-test-key' };
    expect(isApiConfigReady(remoteReady)).toBe(true);

    const localOllamaReady = {
      ...remoteMissingKey,
      provider: 'custom' as const,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5:7b',
    };
    expect(isApiConfigReady(localOllamaReady)).toBe(true);
  });

  it('API-02: saves/loads across localStorage and sessionStorage without touching quiz store key', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, '{"records":{},"fav":{},"mastery":{}}');

    const localCfg = {
      ...createDefaultApiConfig(),
      apiKey: 'sk-local-secret',
      model: 'deepseek-chat',
      storageScope: 'local' as const,
    };
    expect(saveApiConfig(localCfg)).toBe(true);
    expect(globalThis.localStorage.getItem(API_CONFIG_STORAGE_KEY)).not.toBeNull();
    expect(globalThis.sessionStorage.getItem(API_CONFIG_STORAGE_KEY)).toBeNull();
    expect(loadApiConfig().apiKey).toBe('sk-local-secret');

    // Switching to session scope removes from localStorage
    const sessionCfg = { ...localCfg, apiKey: 'sk-session-only', storageScope: 'session' as const };
    expect(saveApiConfig(sessionCfg)).toBe(true);
    expect(globalThis.localStorage.getItem(API_CONFIG_STORAGE_KEY)).toBeNull();
    expect(globalThis.sessionStorage.getItem(API_CONFIG_STORAGE_KEY)).not.toBeNull();
    expect(loadApiConfig()).toMatchObject({ apiKey: 'sk-session-only', storageScope: 'session' });

    const cleared = clearApiConfig();
    expect(cleared.apiKey).toBe('');
    expect(globalThis.sessionStorage.getItem(API_CONFIG_STORAGE_KEY)).toBeNull();
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(
      '{"records":{},"fav":{},"mastery":{}}',
    );
  });

  it('API-03: recovers safely from corrupted JSON and rejects prototype-pollution payloads', () => {
    globalThis.localStorage.setItem(API_CONFIG_STORAGE_KEY, '{broken-json');
    expect(loadApiConfig()).toEqual(createDefaultApiConfig());

    const polluted = JSON.parse('{"__proto__":{"polluted":true},"apiKey":"bad"}');
    expect(sanitizeApiConfig(polluted).apiKey).toBe('');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('API-04: extractJsonFromText strips <think> blocks and markdown fences safely', () => {
    const wrapped = `<think>先分析要点...</think>
以下是结果：
\`\`\`json
{"score": 88, "summary": "核心概念准确"}
\`\`\``;
    expect(extractJsonFromText<{ score: number; summary: string }>(wrapped)).toEqual({
      score: 88,
      summary: '核心概念准确',
    });

    expect(() => extractJsonFromText('not json at all')).toThrow(LlmApiError);
  });

  it('API-05: chatCompletion and streamChatCompletion parse responses and classify HTTP errors', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-valid',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { content: '测试回复内容' } }],
          usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const res = await chatCompletion([{ role: 'user', content: 'hi' }]);
    expect(res.content).toBe('测试回复内容');
    expect(res.usage?.totalTokens).toBe(16);

    // SSE streaming test
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"model":"deepseek-chat","choices":[{"delta":{"content":"你好"}}]}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"model":"deepseek-chat","choices":[{"delta":{"content":"世界"}}]}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });
    mockFetch.mockResolvedValueOnce(
      new Response(sseStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const chunks: string[] = [];
    const streamed = await streamChatCompletion([{ role: 'user', content: 'stream' }], {}, (c) =>
      chunks.push(c),
    );
    expect(chunks).toEqual(['你好', '世界']);
    expect(streamed.content).toBe('你好世界');

    // 401 unauthorized mapping
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }),
    );
    await expect(chatCompletion([{ role: 'user', content: 'fail' }])).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
  });

  it('API-06: testApiConnection and fetchAvailableModels handle success and errors cleanly', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'glm-4-flash',
            choices: [{ message: { content: 'OK' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'gpt-4o-mini' }, { id: 'deepseek-chat' }, { id: 'deepseek-chat' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', mockFetch);

    const probe = await testApiConnection({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-test',
      model: 'glm-4-flash',
    });
    expect(probe.ok).toBe(true);
    expect(probe.model).toBe('glm-4-flash');

    const models = await fetchAvailableModels({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
    });
    expect(models).toEqual(['deepseek-chat', 'gpt-4o-mini']);
  });

  it('API-07: gradeSubjectiveDraft and generateQuestionsFromText output strict V1 schema structures', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-valid',
      model: 'deepseek-chat',
    });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 86,
                    recommendedMastery: 2,
                    summary: '回答完整覆盖了 CNN 三大核心特性',
                    matchedPoints: ['局部感受野', '权值共享'],
                    missingPoints: ['池化降维'],
                    improvedAnswer: 'CNN 具备局部感受野、权值共享与池化降维三大特性。',
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
                    questions: [
                      {
                        type: 'choice',
                        stem: '下列哪项属于 CNN 的结构特性？',
                        options: ['权值共享', '循环隐藏态', '注意力掩码', '反向传播消除'],
                        answer: 0,
                        explain: '卷积核在空间位置共享参数。',
                      },
                      {
                        type: 'choice',
                        stem: '坏数据：越界答案应被自动过滤',
                        options: ['A', 'B'],
                        answer: 9,
                        explain: 'invalid',
                      },
                      {
                        type: 'tf',
                        stem: '池化层可以降低特征图空间维度。',
                        answer: true,
                        explain: '最大池化/平均池化实现下采样。',
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

    const shortQ = MOCK_QUESTIONS[6];
    const { feedback } = await gradeSubjectiveDraft(shortQ, '局部感受野和权值共享');
    expect(feedback.score).toBe(86);
    expect(feedback.recommendedMastery).toBe(2);
    expect(feedback.matchedPoints).toEqual(['局部感受野', '权值共享']);

    const { questions } = await generateQuestionsFromText('CNN 具有局部感受野与池化降维特性。', {
      chapter: 5,
      count: 2,
    });
    expect(questions).toHaveLength(2);
    expect(questions[0].type).toBe('choice');
    expect(questions[0].chapter).toBe(5);
    expect(questions[1].type).toBe('tf');
    expect(questions[1].answer).toBe(true);
  });
});
