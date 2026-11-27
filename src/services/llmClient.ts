import {
  isApiConfigReady,
  isValidHttpUrl,
  loadApiConfig,
  normalizeBaseUrl,
  type ApiConfig,
  type ApiModelMeta,
} from './apiConfig';
import type { PracticeScope } from '../core/practiceScope';

export type ModelInfo = ApiModelMeta;

export const NON_CHAT_MODEL_KEYWORDS = [
  'embedding',
  'rerank',
  'tts',
  'whisper',
  'dall-e',
  'flux',
  'image',
  'audio',
  'ocr',
  'moderation',
  'realtime',
] as const;

export function normalizeFetchedModelId(rawId: string): string {
  const trimmed = rawId.trim();
  if (!trimmed) return '';
  return trimmed.replace(/^models\//i, '').trim();
}

export function isNonChatModel(model: string | ModelInfo): boolean {
  const id = (typeof model === 'string' ? model : model.id).toLowerCase();
  const name = (typeof model === 'string' ? '' : (model.name ?? '')).toLowerCase();
  const combined = `${id} ${name}`;
  return NON_CHAT_MODEL_KEYWORDS.some((kw) => combined.includes(kw));
}

export function formatContextWindow(tokens?: number): string | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }
  if (tokens >= 1_000_000) {
    const binaryM = tokens / 1_048_576;
    if (Math.abs(binaryM - Math.round(binaryM)) < 0.01) {
      return `${Math.round(binaryM)}M`;
    }
    const decimalM = tokens / 1_000_000;
    const rounded = Math.round(decimalM * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    if (tokens % 1024 === 0 && tokens / 1024 >= 2) {
      return `${tokens / 1024}K`;
    }
    const k = Math.round(tokens / 1_000);
    return `${k}K`;
  }
  return String(Math.round(tokens));
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LlmRequestOptions {
  config?: Partial<ApiConfig>;
  practiceScope?: PracticeScope;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  jsonMode?: boolean;
}

export interface LlmTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmCompletionResult {
  content: string;
  model: string;
  latencyMs: number;
  usage?: LlmTokenUsage;
}

export interface ApiConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  message: string;
  statusCode?: number;
}

export type ApiErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_URL'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_OR_CORS'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'PARSE_ERROR'
  | 'UNKNOWN';

export class LlmApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode?: number;
  readonly userMessage: string;

  constructor(code: ApiErrorCode, userMessage: string, statusCode?: number, detail?: string) {
    super(detail || userMessage);
    this.name = 'LlmApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
  }
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return `${normalized}/chat/completions`;
}

export function buildModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return `${normalized}/models`;
}

function resolveEffectiveConfig(override?: Partial<ApiConfig>, practiceScope?: PracticeScope): ApiConfig {
  const stored = loadApiConfig(practiceScope);
  const merged: ApiConfig = {
    ...stored,
    ...(override ?? {}),
  };
  merged.baseUrl = normalizeBaseUrl(merged.baseUrl);
  merged.apiKey = merged.apiKey.trim();
  merged.model = merged.model.trim();
  return merged;
}

function assertReadyConfig(config: ApiConfig): void {
  if (!isValidHttpUrl(config.baseUrl)) {
    throw new LlmApiError('INVALID_URL', 'API Base URL 格式无效，请填写以 http:// 或 https:// 开头的地址。');
  }
  if (!isApiConfigReady(config)) {
    throw new LlmApiError(
      'NOT_CONFIGURED',
      '尚未完成 API 配置，请先点击顶部“API 设置”填写 API Key 和模型名称。',
    );
  }
}

function buildAuthHeaders(config: ApiConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

function extractApiErrorDetail(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: unknown; code?: unknown };
      message?: unknown;
    };
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // Plain text error body
  }
  return trimmed.slice(0, 220);
}

function mapHttpError(status: number, bodyText: string): LlmApiError {
  const detail = extractApiErrorDetail(bodyText);
  const suffix = detail ? `（${detail}）` : '';

  if (status === 401) {
    return new LlmApiError('UNAUTHORIZED', `API Key 无效或已过期${suffix}`, status, detail);
  }
  if (status === 403) {
    return new LlmApiError('FORBIDDEN', `无权访问该模型或接口${suffix}`, status, detail);
  }
  if (status === 404) {
    return new LlmApiError(
      'NOT_FOUND',
      `接口地址或模型名称不存在，请检查 Base URL 与模型 ID${suffix}`,
      status,
      detail,
    );
  }
  if (status === 429) {
    return new LlmApiError(
      'RATE_LIMITED',
      `触发接口频率限制或账户余额不足（HTTP 429）${suffix}`,
      status,
      detail,
    );
  }
  if (status >= 500) {
    return new LlmApiError(
      'SERVER_ERROR',
      `模型服务端暂时异常（HTTP ${status}），请稍后重试${suffix}`,
      status,
      detail,
    );
  }
  return new LlmApiError('UNKNOWN', `请求失败（HTTP ${status}）${suffix}`, status, detail);
}

function createLinkedAbortController(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): {
  controller: AbortController;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('timeout'));
  }, Math.max(1000, timeoutMs));

  return {
    controller,
    didTimeout: () => timedOut,
    cleanup: () => {
      globalThis.clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

function mapFetchException(err: unknown, didTimeout: boolean, externalAborted: boolean): LlmApiError {
  if (err instanceof LlmApiError) return err;
  if (didTimeout) {
    return new LlmApiError('TIMEOUT', '请求超时，请检查网络连接或在“API 设置”中适当调大超时时间。');
  }
  if (externalAborted || (err instanceof Error && err.name === 'AbortError')) {
    return new LlmApiError('ABORTED', '已取消本次 AI 请求。');
  }
  const rawMsg = err instanceof Error ? err.message : String(err);
  return new LlmApiError(
    'NETWORK_OR_CORS',
    '无法连接到 API 接口（可能是网络不可达、代理未开启或目标接口不支持浏览器 CORS 跨域）。',
    undefined,
    rawMsg,
  );
}

function parseCompletionPayload(payload: unknown): {
  content: string;
  model: string;
  usage?: LlmTokenUsage;
} {
  if (!payload || typeof payload !== 'object') {
    throw new LlmApiError('PARSE_ERROR', '接口返回格式异常，无法解析模型回复。');
  }
  const obj = payload as {
    model?: unknown;
    choices?: Array<{
      message?: { content?: unknown };
      text?: unknown;
    }>;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
    };
  };

  const first = Array.isArray(obj.choices) ? obj.choices[0] : undefined;
  let content = '';
  const rawContent = first?.message?.content ?? first?.text;

  if (typeof rawContent === 'string') {
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    content = rawContent
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }

  if (!content.trim()) {
    throw new LlmApiError('PARSE_ERROR', '模型返回了空内容，请检查模型名称或稍后重试。');
  }

  const usage: LlmTokenUsage | undefined = obj.usage
    ? {
        promptTokens:
          typeof obj.usage.prompt_tokens === 'number' ? obj.usage.prompt_tokens : undefined,
        completionTokens:
          typeof obj.usage.completion_tokens === 'number'
            ? obj.usage.completion_tokens
            : undefined,
        totalTokens:
          typeof obj.usage.total_tokens === 'number' ? obj.usage.total_tokens : undefined,
      }
    : undefined;

  return {
    content,
    model: typeof obj.model === 'string' && obj.model ? obj.model : '',
    usage,
  };
}

/**
 * Extracts and parses the first valid JSON object or array from an LLM response,
 * stripping optional reasoning tags (`<think>...</think>`) and markdown code fences.
 */
export function extractJsonFromText<T = unknown>(raw: string): T {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : withoutThink).trim();

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Attempt to locate outermost JSON object or array
    const objStart = candidate.indexOf('{');
    const objEnd = candidate.lastIndexOf('}');
    const arrStart = candidate.indexOf('[');
    const arrEnd = candidate.lastIndexOf(']');

    const slices: string[] = [];
    if (objStart >= 0 && objEnd > objStart) {
      slices.push(candidate.slice(objStart, objEnd + 1));
    }
    if (arrStart >= 0 && arrEnd > arrStart) {
      slices.push(candidate.slice(arrStart, arrEnd + 1));
    }

    // Try whichever starts earlier first
    slices.sort((a, b) => candidate.indexOf(a) - candidate.indexOf(b));
    for (const slice of slices) {
      try {
        return JSON.parse(slice) as T;
      } catch {
        // continue
      }
    }

    throw new LlmApiError('PARSE_ERROR', '模型返回的内容不是合法 JSON，请重试或更换更稳定的模型。');
  }
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: LlmRequestOptions = {},
): Promise<LlmCompletionResult> {
  const config = resolveEffectiveConfig(options.config, options.practiceScope);
  assertReadyConfig(config);

  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const linked = createLinkedAbortController(timeoutMs, options.signal);
  const startedAt = Date.now();

  try {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: options.temperature ?? config.temperature,
      max_tokens: options.maxTokens ?? config.maxTokens,
      stream: false,
    };
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(buildChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: buildAuthHeaders(config),
      body: JSON.stringify(body),
      signal: linked.controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw mapHttpError(res.status, errText);
    }

    const data: unknown = await res.json().catch(() => {
      throw new LlmApiError('PARSE_ERROR', '无法解析服务端 JSON 响应。');
    });
    const parsed = parseCompletionPayload(data);

    return {
      content: parsed.content,
      model: parsed.model || config.model,
      latencyMs: Math.max(0, Date.now() - startedAt),
      usage: parsed.usage,
    };
  } catch (err) {
    throw mapFetchException(err, linked.didTimeout(), Boolean(options.signal?.aborted));
  } finally {
    linked.cleanup();
  }
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  options: LlmRequestOptions = {},
  onChunk?: (chunk: string, accumulated: string) => void,
): Promise<LlmCompletionResult> {
  const config = resolveEffectiveConfig(options.config, options.practiceScope);
  assertReadyConfig(config);

  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const linked = createLinkedAbortController(timeoutMs, options.signal);
  const startedAt = Date.now();

  try {
    const res = await fetch(buildChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: buildAuthHeaders(config),
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? config.temperature,
        max_tokens: options.maxTokens ?? config.maxTokens,
        stream: true,
      }),
      signal: linked.controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw mapHttpError(res.status, errText);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.body || contentType.includes('application/json')) {
      const data: unknown = await res.json().catch(() => {
        throw new LlmApiError('PARSE_ERROR', '无法解析模型响应内容。');
      });
      const parsed = parseCompletionPayload(data);
      onChunk?.(parsed.content, parsed.content);
      return {
        content: parsed.content,
        model: parsed.model || config.model,
        latencyMs: Math.max(0, Date.now() - startedAt),
        usage: parsed.usage,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulated = '';
    let resolvedModel = config.model;

    const processLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload) as {
          model?: unknown;
          choices?: Array<{
            delta?: { content?: unknown };
            message?: { content?: unknown };
          }>;
        };
        if (typeof parsed.model === 'string' && parsed.model) {
          resolvedModel = parsed.model;
        }
        const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          accumulated += delta;
          onChunk?.(delta, accumulated);
        }
      } catch {
        // Ignore malformed SSE keepalive frames
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    }

    if (buffer.trim()) {
      processLine(buffer);
    }

    if (!accumulated.trim()) {
      throw new LlmApiError('PARSE_ERROR', '流式响应未返回有效文本，请重试或检查模型兼容性。');
    }

    return {
      content: accumulated,
      model: resolvedModel,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch (err) {
    throw mapFetchException(err, linked.didTimeout(), Boolean(options.signal?.aborted));
  } finally {
    linked.cleanup();
  }
}

/**
 * Structured JSON completion helper — usable both by subjective grading and by
 * future Question Bank Import features to parse raw study text into `Question[]`.
 */
export async function chatCompletionJson<T>(
  messages: ChatMessage[],
  options: LlmRequestOptions = {},
): Promise<{ data: T; raw: LlmCompletionResult }> {
  try {
    const raw = await chatCompletion(messages, { ...options, jsonMode: true });
    return { data: extractJsonFromText<T>(raw.content), raw };
  } catch (err) {
    // Some OpenAI-compatible relays reject `response_format: { type: 'json_object' }` with HTTP 400.
    if (err instanceof LlmApiError && err.statusCode === 400) {
      const raw = await chatCompletion(messages, { ...options, jsonMode: false });
      return { data: extractJsonFromText<T>(raw.content), raw };
    }
    throw err;
  }
}

export async function testApiConnection(
  configOverride?: Partial<ApiConfig>,
  signal?: AbortSignal,
  practiceScope?: PracticeScope,
): Promise<ApiConnectionTestResult> {
  const config = resolveEffectiveConfig(configOverride, practiceScope);
  const startedAt = Date.now();
  try {
    assertReadyConfig(config);
    const res = await chatCompletion(
      [
        { role: 'system', content: 'You are a connectivity test assistant.' },
        { role: 'user', content: 'Reply with OK only.' },
      ],
      {
        config,
        practiceScope,
        temperature: 0,
        maxTokens: 12,
        timeoutMs: Math.min(config.timeoutMs, 20000),
        signal,
      },
    );
    return {
      ok: true,
      latencyMs: res.latencyMs,
      model: res.model || config.model,
      message: `连接成功！模型 ${res.model || config.model} 响应正常（${res.latencyMs} ms）。`,
    };
  } catch (err) {
    const apiErr =
      err instanceof LlmApiError
        ? err
        : new LlmApiError('UNKNOWN', err instanceof Error ? err.message : '连接测试失败');
    return {
      ok: false,
      latencyMs: Math.max(0, Date.now() - startedAt),
      model: config.model,
      message: apiErr.userMessage,
      statusCode: apiErr.statusCode,
    };
  }
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const num = Number(value.trim());
    if (Number.isFinite(num) && num > 0) {
      return Math.round(num);
    }
  }
  return undefined;
}

function parseRawModelEntry(raw: unknown): ModelInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const rawId =
    typeof item.id === 'string' && item.id.trim()
      ? item.id
      : typeof item.name === 'string' && item.name.trim()
        ? item.name
        : '';
  const id = normalizeFetchedModelId(rawId);
  if (!id) return null;

  const rawDisplayName =
    typeof item.display_name === 'string' && item.display_name.trim()
      ? item.display_name.trim()
      : typeof item.displayName === 'string' && item.displayName.trim()
        ? item.displayName.trim()
        : typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim()
          ? normalizeFetchedModelId(item.name)
          : undefined;
  const name = rawDisplayName && rawDisplayName !== id ? rawDisplayName : undefined;

  const contextWindow = parsePositiveInt(
    item.context_window ??
      item.context_length ??
      item.contextWindow ??
      item.inputTokenLimit ??
      item.input_token_limit ??
      item.max_context_length,
  );
  const maxOutputTokens = parsePositiveInt(
    item.max_output_tokens ??
      item.maxOutputTokens ??
      item.outputTokenLimit ??
      item.output_token_limit ??
      item.max_completion_tokens,
  );

  return {
    id,
    ...(name ? { name } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };
}

function mapModelsEndpointError(status: number, bodyText: string): LlmApiError {
  if (status === 401) {
    return new LlmApiError(
      'UNAUTHORIZED',
      'API Key 无效或已过期（HTTP 401），无法拉取模型列表，请检查 Key 或改用下方兜底预设 / 手动输入。',
      401,
      bodyText,
    );
  }
  if (status === 403) {
    return new LlmApiError(
      'FORBIDDEN',
      '当前 API Key 无权限访问模型列表接口（HTTP 403），可改用下方兜底预设或手动输入模型 ID。',
      403,
      bodyText,
    );
  }
  if (status === 404) {
    return new LlmApiError(
      'NOT_FOUND',
      '该服务商不支持 /models 模型列表接口（HTTP 404），已自动降级为兜底预设，也可直接手动输入模型 ID。',
      404,
      bodyText,
    );
  }
  return mapHttpError(status, bodyText);
}

export async function fetchAvailableModelInfos(
  configOverride?: Partial<ApiConfig>,
  signal?: AbortSignal,
  practiceScope?: PracticeScope,
): Promise<ModelInfo[]> {
  const config = resolveEffectiveConfig(configOverride, practiceScope);
  if (!isValidHttpUrl(config.baseUrl)) {
    throw new LlmApiError('INVALID_URL', '请先填写有效的 API Base URL。');
  }

  const linked = createLinkedAbortController(Math.min(config.timeoutMs, 15000), signal);
  try {
    const res = await fetch(buildModelsUrl(config.baseUrl), {
      method: 'GET',
      headers: buildAuthHeaders(config),
      signal: linked.controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw mapModelsEndpointError(res.status, errText);
    }

    const payload = (await res.json().catch(() => null)) as
      | { data?: unknown[]; models?: unknown[] }
      | unknown[]
      | null;

    const rawList: unknown[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : [];

    const byId = new Map<string, ModelInfo>();
    for (const rawItem of rawList) {
      const parsed = parseRawModelEntry(rawItem);
      if (!parsed) continue;
      const existing = byId.get(parsed.id);
      if (!existing) {
        byId.set(parsed.id, parsed);
      } else {
        byId.set(parsed.id, {
          id: parsed.id,
          ...(existing.name || parsed.name ? { name: existing.name || parsed.name } : {}),
          ...(existing.contextWindow || parsed.contextWindow
            ? { contextWindow: existing.contextWindow || parsed.contextWindow }
            : {}),
          ...(existing.maxOutputTokens || parsed.maxOutputTokens
            ? { maxOutputTokens: existing.maxOutputTokens || parsed.maxOutputTokens }
            : {}),
        });
      }
    }

    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  } catch (err) {
    const mapped = mapFetchException(err, linked.didTimeout(), Boolean(signal?.aborted));
    if (mapped.code === 'NETWORK_OR_CORS') {
      throw new LlmApiError(
        'NETWORK_OR_CORS',
        '拉取模型列表受网络或浏览器 CORS 跨域限制，已自动降级为兜底预设，也可直接手动输入模型 ID。',
        undefined,
        mapped.message,
      );
    }
    throw mapped;
  } finally {
    linked.cleanup();
  }
}

export async function fetchAvailableModels(
  configOverride?: Partial<ApiConfig>,
  signal?: AbortSignal,
  practiceScope?: PracticeScope,
): Promise<string[]> {
  const infos = await fetchAvailableModelInfos(configOverride, signal, practiceScope);
  return infos.map((m) => m.id);
}
