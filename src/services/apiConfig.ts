export type ApiProviderId =
  | 'deepseek'
  | 'openai'
  | 'siliconflow'
  | 'zhipu'
  | 'dashscope'
  | 'moonshot'
  | 'gemini'
  | 'custom';

export type ApiStorageScope = 'local' | 'session';

export interface ApiProviderPreset {
  id: ApiProviderId;
  name: string;
  shortName: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  keyPlaceholder: string;
  hint: string;
}

export interface ApiConfig {
  provider: ApiProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  storageScope: ApiStorageScope;
}

/** Independent storage key — never collides with `ai-intro-quiz-v1` or `ai-intro-quiz-theme`. */
export const API_CONFIG_STORAGE_KEY = 'ai-intro-quiz-api-config-v1';
export const API_CONFIG_CHANGE_EVENT = 'quiz-hub:api-config-change';
export const OPEN_API_SETTINGS_EVENT = 'quiz-hub:open-api-settings';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const API_PROVIDER_PRESETS: readonly ApiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    shortName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyPlaceholder: 'sk-...',
    hint: '性价比高、中文课程解析准确，支持 OpenAI 兼容协议。',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    shortName: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    models: [
      'Qwen/Qwen2.5-7B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'THUDM/GLM-4-9B-0414',
    ],
    keyPlaceholder: 'sk-...',
    hint: '国内直连、支持多种开源免费/低价模型，浏览器 CORS 友好。',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    shortName: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    keyPlaceholder: '输入智谱 API Key',
    hint: 'glm-4-flash 响应快、额度友好，适合刷题解析与批改。',
  },
  {
    id: 'dashscope',
    name: '阿里通义千问',
    shortName: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    keyPlaceholder: 'sk-...',
    hint: '阿里云百炼 OpenAI 兼容模式。',
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    shortName: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0711-preview'],
    keyPlaceholder: 'sk-...',
    hint: '长文本理解能力强，适合长题干与大段复习资料解析。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    keyPlaceholder: 'sk-...',
    hint: 'OpenAI 官方接口（直连需网络支持，或切换至“自定义”填写中转地址）。',
  },
  {
    id: 'gemini',
    name: 'Google Gemini (兼容)',
    shortName: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    keyPlaceholder: 'AIza...',
    hint: '使用 Google AI Studio 提供的 OpenAI 兼容端点。',
  },
  {
    id: 'custom',
    name: '自定义 / 中转 / Ollama',
    shortName: '自定义',
    baseUrl: '',
    defaultModel: '',
    models: [],
    keyPlaceholder: 'sk-...（本地 Ollama 可留空）',
    hint: '支持任意 OpenAI 兼容接口（如 OneAPI / NewAPI / OpenRouter / 本地 Ollama http://localhost:11434/v1）。',
  },
] as const;

const VALID_PROVIDER_IDS = new Set<string>(API_PROVIDER_PRESETS.map((p) => p.id));

export function getProviderPreset(id: ApiProviderId): ApiProviderPreset {
  return API_PROVIDER_PRESETS.find((p) => p.id === id) ?? API_PROVIDER_PRESETS[0];
}

export function createDefaultApiConfig(): ApiConfig {
  const preset = API_PROVIDER_PRESETS[0];
  return {
    provider: preset.id,
    baseUrl: preset.baseUrl,
    apiKey: '',
    model: preset.defaultModel,
    temperature: 0.3,
    maxTokens: 1200,
    timeoutMs: 45000,
    storageScope: 'local',
  };
}

export function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  let normalized = trimmed.replace(/\/+$/, '');
  normalized = normalized.replace(/\/chat\/completions$/i, '');
  normalized = normalized.replace(/\/models$/i, '');
  return normalized.replace(/\/+$/, '');
}

export function isValidHttpUrl(rawUrl: string): boolean {
  const normalized = normalizeBaseUrl(rawUrl);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isLocalEndpoint(rawUrl: string): boolean {
  const normalized = normalizeBaseUrl(rawUrl);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function isApiConfigReady(config: ApiConfig): boolean {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const model = config.model.trim();
  const apiKey = config.apiKey.trim();
  if (!isValidHttpUrl(baseUrl) || model.length === 0) {
    return false;
  }
  if (apiKey.length === 0 && !isLocalEndpoint(baseUrl)) {
    return false;
  }
  return true;
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return '未设置';
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****`;
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function getStorageByScope(scope: ApiStorageScope): Storage | null {
  try {
    const g = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
    const storage = scope === 'session' ? g.sessionStorage : g.localStorage;
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function' &&
      typeof storage.removeItem === 'function'
    ) {
      return storage;
    }
    return null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeApiConfig(raw: unknown, fallbackScope: ApiStorageScope = 'local'): ApiConfig {
  const defaults = createDefaultApiConfig();
  if (!isPlainObject(raw)) {
    return { ...defaults, storageScope: fallbackScope };
  }

  for (const key of Object.getOwnPropertyNames(raw)) {
    if (DANGEROUS_KEYS.has(key)) {
      return { ...defaults, storageScope: fallbackScope };
    }
  }

  const provider: ApiProviderId =
    typeof raw.provider === 'string' && VALID_PROVIDER_IDS.has(raw.provider)
      ? (raw.provider as ApiProviderId)
      : defaults.provider;
  const preset = getProviderPreset(provider);

  const baseUrl =
    typeof raw.baseUrl === 'string' ? normalizeBaseUrl(raw.baseUrl) : preset.baseUrl;
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  const model = typeof raw.model === 'string' ? raw.model.trim() : preset.defaultModel;
  const temperature = Math.round(clampNumber(raw.temperature, 0, 2, defaults.temperature) * 100) / 100;
  const maxTokens = Math.round(clampNumber(raw.maxTokens, 64, 16384, defaults.maxTokens));
  const timeoutMs = Math.round(clampNumber(raw.timeoutMs, 5000, 180000, defaults.timeoutMs));
  const storageScope: ApiStorageScope =
    raw.storageScope === 'session' || raw.storageScope === 'local'
      ? raw.storageScope
      : fallbackScope;

  return {
    provider,
    baseUrl,
    apiKey,
    model,
    temperature,
    maxTokens,
    timeoutMs,
    storageScope,
  };
}

function readRawFromScope(scope: ApiStorageScope): string | null {
  const storage = getStorageByScope(scope);
  if (!storage) return null;
  try {
    return storage.getItem(API_CONFIG_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function loadApiConfig(): ApiConfig {
  const sessionRaw = readRawFromScope('session');
  if (sessionRaw) {
    try {
      return sanitizeApiConfig(JSON.parse(sessionRaw), 'session');
    } catch {
      // Fall through to localStorage
    }
  }

  const localRaw = readRawFromScope('local');
  if (localRaw) {
    try {
      return sanitizeApiConfig(JSON.parse(localRaw), 'local');
    } catch {
      return createDefaultApiConfig();
    }
  }

  return createDefaultApiConfig();
}

function emitApiConfigChange(config: ApiConfig): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent<ApiConfig>(API_CONFIG_CHANGE_EVENT, { detail: config }));
  } catch {
    // Ignore event dispatch errors in restricted environments
  }
}

export function saveApiConfig(input: ApiConfig): boolean {
  const clean = sanitizeApiConfig(input, input.storageScope);
  const target = getStorageByScope(clean.storageScope);
  const other = getStorageByScope(clean.storageScope === 'session' ? 'local' : 'session');

  if (other) {
    try {
      other.removeItem(API_CONFIG_STORAGE_KEY);
    } catch {
      // Ignore cleanup errors
    }
  }

  if (!target) {
    emitApiConfigChange(clean);
    return false;
  }

  try {
    target.setItem(API_CONFIG_STORAGE_KEY, JSON.stringify(clean));
    emitApiConfigChange(clean);
    return true;
  } catch {
    return false;
  }
}

export function clearApiConfig(): ApiConfig {
  const local = getStorageByScope('local');
  const session = getStorageByScope('session');
  try {
    local?.removeItem(API_CONFIG_STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    session?.removeItem(API_CONFIG_STORAGE_KEY);
  } catch {
    // ignore
  }
  const fresh = createDefaultApiConfig();
  emitApiConfigChange(fresh);
  return fresh;
}

export function subscribeApiConfig(listener: (config: ApiConfig) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }

  const onCustom = (event: Event) => {
    const custom = event as CustomEvent<ApiConfig>;
    listener(custom.detail ? sanitizeApiConfig(custom.detail) : loadApiConfig());
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === API_CONFIG_STORAGE_KEY) {
      listener(loadApiConfig());
    }
  };

  window.addEventListener(API_CONFIG_CHANGE_EVENT, onCustom);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(API_CONFIG_CHANGE_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

export function requestOpenApiSettings(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(OPEN_API_SETTINGS_EVENT));
  } catch {
    // Ignore
  }
}
