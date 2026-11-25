import { createClient, FunctionsHttpError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export function getDatabaseClient(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publicKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
  if (!url || !publicKey) throw new Error('尚未配置 Supabase 项目地址和公开密钥。');
  return client ??= createClient(url, publicKey, { auth: { flowType: 'pkce' } });
}

export function isDatabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL?.trim()
    && (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim());
}

export async function invokeDatabaseFunction<T>(
  name: 'phone-auth' | 'user-data',
  body: Record<string, unknown>,
  accessToken?: string,
): Promise<T> {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const { data, error } = await getDatabaseClient().functions.invoke<T>(name, { body, headers });
  if (error instanceof FunctionsHttpError) {
    const payload = await (error.context as Response).json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || '云端操作失败，请稍后重试。', { cause: error });
  }
  if (error) throw new Error('无法连接云端服务，请稍后重试。', { cause: error });
  if (data === null) throw new Error('云端返回的数据为空。');
  return data;
}
