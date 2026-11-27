import { isAccountPracticeScope, LEGACY_GUEST_SCOPE, practiceStorageKey } from '../core/practiceScope';
import type { PracticeScope } from '../core/practiceScope';

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

export interface ApiModelMeta {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface ApiProviderPreset {
  id: ApiProviderId;
  name: string;
  shortName: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  modelMetas?: Record<string, Omit<ApiModelMeta, 'id'>>;
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
/** Public model catalog cache keyed by provider + baseUrl (never stores API keys). */
export const API_MODELS_CACHE_KEY = 'ai-intro-quiz-api-models-cache-v1';
export const API_CONFIG_CHANGE_EVENT = 'quiz-hub:api-config-change';
export const OPEN_API_SETTINGS_EVENT = 'quiz-hub:open-api-settings';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_CACHED_MODEL_ENDPOINTS = 20;

export const API_PROVIDER_PRESETS: readonly ApiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    shortName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    modelMetas: {
      'deepseek-flash': { name: 'V4.1-Flash' },
      'deepseek-v4-pro': { name: 'V4-Pro' },
    },
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

export function getPresetModelMetas(preset: ApiProviderPreset): ApiModelMeta[] {
  return preset.models.map((id) => {
    const meta = preset.modelMetas?.[id];
    return {
      id,
      ...(meta?.name ? { name: meta.name } : {}),
      ...(meta?.contextWindow ? { contextWindow: meta.contextWindow } : {}),
      ...(meta?.maxOutputTokens ? { maxOutputTokens: meta.maxOutputTokens } : {}),
    };
  });
}

export function createDefaultApiConfig(): ApiConfig {
  const preset = API_PROVIDER_PRESETS[0];
  return {
    provider: preset.id,
    baseUrl: preset.baseUrl,
    apiKey: '',
    model: preset.defaultModel,
    temperature: 0.3,
    maxTokens: 4096,
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
  const maxTokens = Math.round(clampNumber(raw.maxTokens, 64, 65536, defaults.maxTokens));
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

const memoryCloudApiConfigs = new Map<PracticeScope, ApiConfig>();

function readRawFromScope(scope: ApiStorageScope, owner: PracticeScope): string | null {
  const storage = getStorageByScope(scope);
  if (!storage) return null;
  try {
    return storage.getItem(practiceStorageKey(API_CONFIG_STORAGE_KEY, owner));
  } catch {
    return null;
  }
}

function readSessionApiConfig(owner: PracticeScope): Record<string, unknown> | null {
  const raw = readRawFromScope('session', owner);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function hasSessionApiConfig(owner: PracticeScope): boolean {
  const saved = readSessionApiConfig(owner);
  return saved !== null && (!isAccountPracticeScope(owner) || saved.accountTabOnly === true);
}

export function getCloudMemoryApiConfig(owner: PracticeScope): ApiConfig | null {
  const cached = memoryCloudApiConfigs.get(owner);
  return cached ? { ...cached } : null;
}

export function setCloudMemoryApiConfig(owner: PracticeScope, config: ApiConfig | null): void {
  if (!config) {
    memoryCloudApiConfigs.delete(owner);
  } else {
    memoryCloudApiConfigs.set(owner, sanitizeApiConfig({ ...config, storageScope: 'local' }, 'local'));
  }
  emitApiConfigChange(loadApiConfig(owner), owner);
}

export function clearLocalApiConfigStorage(
  owner: PracticeScope,
  scopes: readonly ApiStorageScope[] = ['local', 'session'],
): void {
  const key = practiceStorageKey(API_CONFIG_STORAGE_KEY, owner);
  for (const scope of scopes) {
    try {
      getStorageByScope(scope)?.removeItem(key);
    } catch {
      // ignore storage cleanup errors
    }
  }
}

export function clearCloudMemoryApiConfigs(owner?: PracticeScope): void {
  if (owner !== undefined) {
    if (memoryCloudApiConfigs.delete(owner)) {
      emitApiConfigChange(loadApiConfig(owner), owner);
    }
    return;
  }
  const owners = Array.from(memoryCloudApiConfigs.keys());
  memoryCloudApiConfigs.clear();
  for (const clearedOwner of owners) {
    emitApiConfigChange(loadApiConfig(clearedOwner), clearedOwner);
  }
}

export function loadApiConfig(owner: PracticeScope = LEGACY_GUEST_SCOPE): ApiConfig {
  const session = readSessionApiConfig(owner);
  if (session && (!isAccountPracticeScope(owner) || session.accountTabOnly === true)) return sanitizeApiConfig(session, 'session');

  const memoryCloud = memoryCloudApiConfigs.get(owner);
  if (memoryCloud) {
    return { ...memoryCloud };
  }

  // Older account builds used the same storage for local-only saves without recording an explicit choice.
  if (session) return sanitizeApiConfig({ ...session, storageScope: 'local' });

  const localRaw = readRawFromScope('local', owner);
  if (localRaw) {
    try {
      return sanitizeApiConfig(JSON.parse(localRaw), 'local');
    } catch {
      return createDefaultApiConfig();
    }
  }

  return createDefaultApiConfig();
}

function emitApiConfigChange(config: ApiConfig, owner: PracticeScope): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(API_CONFIG_CHANGE_EVENT, { detail: { owner, config } }));
  } catch {
    // Ignore event dispatch errors in restricted environments
  }
}

export function saveApiConfig(input: ApiConfig, owner: PracticeScope = LEGACY_GUEST_SCOPE): boolean {
  const clean = sanitizeApiConfig(input, input.storageScope);
  const key = practiceStorageKey(API_CONFIG_STORAGE_KEY, owner);
  const target = getStorageByScope(clean.storageScope);
  const other = getStorageByScope(clean.storageScope === 'session' ? 'local' : 'session');

  if (other) {
    try {
      other.removeItem(key);
    } catch {
      // Ignore cleanup errors
    }
  }

  if (!target) {
    emitApiConfigChange(clean, owner);
    return false;
  }

  try {
    const record = clean.storageScope === 'session' && isAccountPracticeScope(owner) ? { ...clean, accountTabOnly: true } : clean;
    target.setItem(key, JSON.stringify(record));
    emitApiConfigChange(clean, owner);
    return true;
  } catch {
    return false;
  }
}

export function clearApiConfig(owner: PracticeScope = LEGACY_GUEST_SCOPE): ApiConfig {
  memoryCloudApiConfigs.delete(owner);
  const key = practiceStorageKey(API_CONFIG_STORAGE_KEY, owner);
  const local = getStorageByScope('local');
  const session = getStorageByScope('session');
  try {
    local?.removeItem(key);
  } catch {
    // ignore
  }
  try {
    session?.removeItem(key);
  } catch {
    // ignore
  }
  const fresh = createDefaultApiConfig();
  emitApiConfigChange(fresh, owner);
  return fresh;
}

export function subscribeApiConfig(listener: (config: ApiConfig) => void, owner: PracticeScope = LEGACY_GUEST_SCOPE): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }

  const onCustom = (event: Event) => {
    const custom = event as CustomEvent<{ owner: PracticeScope; config: ApiConfig }>;
    if (custom.detail?.owner === owner) listener(sanitizeApiConfig(custom.detail.config));
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === practiceStorageKey(API_CONFIG_STORAGE_KEY, owner)) {
      listener(loadApiConfig(owner));
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

interface CachedModelsEntry {
  models: ApiModelMeta[];
  updatedAt: number;
}

function modelCacheKey(provider: ApiProviderId, baseUrl: string): string | null {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return null;
  return `${provider}::${normalized}`;
}

function sanitizeCachedModelMeta(raw: unknown): ApiModelMeta | null {
  if (!isPlainObject(raw)) return null;
  if (Object.getOwnPropertyNames(raw).some((k) => DANGEROUS_KEYS.has(k))) return null;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const id = raw.id.trim();
  const name = typeof raw.name === 'string' && raw.name.trim() && raw.name.trim() !== id
    ? raw.name.trim()
    : undefined;
  const contextWindow =
    typeof raw.contextWindow === 'number' && Number.isFinite(raw.contextWindow) && raw.contextWindow > 0
      ? Math.round(raw.contextWindow)
      : undefined;
  const maxOutputTokens =
    typeof raw.maxOutputTokens === 'number' && Number.isFinite(raw.maxOutputTokens) && raw.maxOutputTokens > 0
      ? Math.round(raw.maxOutputTokens)
      : undefined;
  return {
    id,
    ...(name ? { name } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };
}

function readModelCacheMap(): Record<string, CachedModelsEntry> {
  const storage = getStorageByScope('local');
  if (!storage) return {};
  try {
    const raw = storage.getItem(API_MODELS_CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return {};
    const result: Record<string, CachedModelsEntry> = {};
    for (const key of Object.getOwnPropertyNames(parsed)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const entry = parsed[key];
      if (!isPlainObject(entry) || !Array.isArray(entry.models)) continue;
      const cleanModels: ApiModelMeta[] = [];
      for (const item of entry.models) {
        const clean = sanitizeCachedModelMeta(item);
        if (clean) cleanModels.push(clean);
      }
      if (cleanModels.length > 0) {
        result[key] = {
          models: cleanModels,
          updatedAt:
            typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
              ? entry.updatedAt
              : 0,
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function loadCachedProviderModels(provider: ApiProviderId, baseUrl: string): ApiModelMeta[] {
  const key = modelCacheKey(provider, baseUrl);
  if (!key) return [];
  const map = readModelCacheMap();
  return map[key]?.models ?? [];
}

export function saveCachedProviderModels(
  provider: ApiProviderId,
  baseUrl: string,
  models: readonly ApiModelMeta[],
): void {
  const key = modelCacheKey(provider, baseUrl);
  const storage = getStorageByScope('local');
  if (!key || !storage) return;

  const cleanModels: ApiModelMeta[] = [];
  const seen = new Set<string>();
  for (const item of models) {
    const clean = sanitizeCachedModelMeta(item);
    if (clean && !seen.has(clean.id)) {
      seen.add(clean.id);
      cleanModels.push(clean);
    }
  }
  if (cleanModels.length === 0) return;

  const map = readModelCacheMap();
  map[key] = { models: cleanModels, updatedAt: Date.now() };

  const entries = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const pruned: Record<string, CachedModelsEntry> = {};
  for (const [k, v] of entries.slice(0, MAX_CACHED_MODEL_ENDPOINTS)) {
    pruned[k] = v;
  }
  try {
    storage.setItem(API_MODELS_CACHE_KEY, JSON.stringify(pruned));
  } catch {
    // Ignore storage quota errors for non-critical public model cache
  }
}

export function clearCachedProviderModels(provider?: ApiProviderId, baseUrl?: string): void {
  const storage = getStorageByScope('local');
  if (!storage) return;
  try {
    if (!provider || !baseUrl) {
      storage.removeItem(API_MODELS_CACHE_KEY);
      return;
    }
    const key = modelCacheKey(provider, baseUrl);
    if (!key) return;
    const map = readModelCacheMap();
    if (key in map) {
      delete map[key];
      storage.setItem(API_MODELS_CACHE_KEY, JSON.stringify(map));
    }
  } catch {
    // Ignore storage errors
  }
}
