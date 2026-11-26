import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2.119.2';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function requiredEnv(key: string): string {
  const value = Deno.env.get(key)?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function gatewayKey(keyring: string, legacyKey: string): string {
  const configured = Deno.env.get(keyring);
  if (configured) {
    const keys = JSON.parse(configured) as { default?: string };
    if (keys.default) return keys.default;
  }
  return requiredEnv(legacyKey);
}

export function backendClient(): SupabaseClient {
  return createClient(requiredEnv('SUPABASE_URL'), gatewayKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '请求数据格式无效。');
  return value as Record<string, unknown>;
}

export async function requireOwner(req: Request, body: Record<string, unknown>, admin: SupabaseClient): Promise<User> {
  const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) throw new HttpError(401, '请先登录。');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) throw new HttpError(401, '会话已失效，请重新登录。');
  if (body.ownerId !== data.user.id) throw new HttpError(403, '登录账号已变更。');
  return data.user;
}

export function serve(handler: (req: Request, body: Record<string, unknown>) => Promise<unknown>): void {
  Deno.serve(async (req) => {
    const origin = req.headers.get('origin');
    const allowedOrigins = (Deno.env.get('QUIZHUB_ALLOWED_ORIGINS') ?? '').split(',').map((item) => item.trim());
    const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' });
    if (origin) {
      if (!allowedOrigins.includes(origin)) return new Response(null, { status: 403, headers });
      headers.set('access-control-allow-origin', origin);
      headers.set('access-control-allow-methods', 'POST, OPTIONS');
      headers.set('access-control-allow-headers', 'authorization, apikey, x-client-info, content-type, x-supabase-api-version, x-region');
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return new Response(null, { status: 405, headers });
    try {
      const body = object(await req.json().catch(() => null));
      return new Response(JSON.stringify(await handler(req, body)), { headers });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : '服务暂不可用，请稍后重试。';
      return new Response(JSON.stringify({ error: message }), { status, headers });
    }
  });
}
