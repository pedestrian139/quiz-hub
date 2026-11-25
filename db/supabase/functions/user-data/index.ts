import { backendClient, HttpError, object, requiredEnv, requireOwner, serve } from '../_shared/edge.ts';

interface SecretEnvelope { ciphertext: string; nonce: string; keyVersion: number }
interface ConfigAndSecret { config: Record<string, unknown>; secret: SecretEnvelope | null }

const KEY_VERSION = 1;
const providers = new Set(['deepseek', 'openai', 'siliconflow', 'zhipu', 'dashscope', 'moonshot', 'gemini', 'custom']);
const encoder = new TextEncoder();

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function getEncryptionKey(version: number): Promise<CryptoKey> {
  if (!Number.isInteger(version) || version < 1) throw new Error('Invalid encryption key version');
  const raw = decodeBase64(requiredEnv(`QUIZHUB_API_KEY_ENCRYPTION_KEY_V${version}`));
  if (raw.byteLength !== 32) throw new Error('API encryption key must be 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function additionalData(userId: string, version: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`quizhub:api-key:${version}:${userId}`);
}

async function encryptApiKey(value: string, userId: string): Promise<SecretEnvelope | null> {
  if (!value) return null;
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey(KEY_VERSION);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: additionalData(userId, KEY_VERSION) },
    key, encoder.encode(value));
  return { ciphertext: encodeBase64(new Uint8Array(ciphertext)), nonce: encodeBase64(nonce), keyVersion: KEY_VERSION };
}

async function decryptApiKey(secret: SecretEnvelope | null, userId: string): Promise<string> {
  if (!secret) return '';
  const key = await getEncryptionKey(secret.keyVersion);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(secret.nonce),
    additionalData: additionalData(userId, secret.keyVersion) }, key, decodeBase64(secret.ciphertext));
  return new TextDecoder().decode(plaintext);
}

function numberInRange(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new HttpError(400, 'API 配置数值超出范围。');
  }
  return value;
}

async function prepareApiConfig(value: unknown, userId: string) {
  const input = object(value);
  if (typeof input.provider !== 'string' || !providers.has(input.provider) || input.storageScope !== 'local'
    || typeof input.baseUrl !== 'string' || typeof input.model !== 'string' || typeof input.apiKey !== 'string'
    || input.apiKey.length > 8192) throw new HttpError(400, 'API 配置字段无效。');

  const baseUrl = input.baseUrl.trim().replace(/^https?:/i, (protocol) => protocol.toLowerCase());
  if (baseUrl) {
    const url = URL.parse(baseUrl);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new HttpError(400, 'API 地址须为有效的 HTTP(S) 地址。请将密钥填写在 API Key 字段。');
    }
  }
  const config = {
    provider: input.provider, baseUrl, model: input.model.trim(),
    temperature: numberInRange(input.temperature, 0, 2),
    maxTokens: numberInRange(input.maxTokens, 64, 16384, true),
    timeoutMs: numberInRange(input.timeoutMs, 5000, 180000, true),
  };
  return { config, secret: await encryptApiKey(input.apiKey.trim(), userId) };
}

serve(async (req, body) => {
  const admin = backendClient();
  const user = await requireOwner(req, body, admin);

  switch (body.action) {
    case 'save_api_config': {
      const { config, secret } = await prepareApiConfig(body.config, user.id);
      const { data, error } = await admin.rpc('quizhub_set_api_config', { p_user_id: user.id, p_config: config, p_secret: secret });
      if (error) throw error;
      return data;
    }
    case 'restore_api_config': {
      const { data, error } = await admin.rpc('quizhub_restore_api_config', { p_user_id: user.id });
      if (error) throw error;
      const stored = data as ConfigAndSecret | null;
      return { config: stored?.config ?? null, apiKey: await decryptApiKey(stored?.secret ?? null, user.id) };
    }
    case 'clear_api_config': {
      const { error } = await admin.rpc('quizhub_clear_api_config', { p_user_id: user.id });
      if (error) throw error;
      return { ok: true };
    }
    case 'import_guest': {
      const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
      if (typeof body.importId !== 'string' || !uuid.test(body.importId)
        || typeof body.sourceId !== 'string' || !uuid.test(body.sourceId)
        || typeof body.sourceVersion !== 'number' || !Number.isSafeInteger(body.sourceVersion) || body.sourceVersion < 1
        || !Array.isArray(body.banks) || !Array.isArray(body.progress)) throw new HttpError(400, '游客迁移数据无效。');
      const api = body.apiConfig === null ? null : await prepareApiConfig(body.apiConfig, user.id);
      const { data, error } = await admin.rpc('quizhub_import_guest', {
        p_user_id: user.id, p_import_id: body.importId, p_source_id: body.sourceId, p_source_version: body.sourceVersion,
        p_banks: body.banks, p_progress: body.progress,
        p_api_config: api?.config ?? null, p_secret: api?.secret ?? null,
      });
      if (error) throw error;
      return data;
    }
    default:
      throw new HttpError(400, '未知数据操作。');
  }
});
