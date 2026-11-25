export type AccountIdentifier = { kind: 'email' | 'phone'; value: string };

export const PHONE_ACCOUNT_DOMAIN = 'phone.quizhub.local';

export function detectAccountInput(input: string): { kind: AccountIdentifier['kind'] | 'unknown'; valid: boolean; normalized: string; message?: string } {
  const value = input.trim().toLowerCase();
  if (/^[0-9]+$/.test(value)) {
    const valid = /^[0-9]{7,15}$/.test(value);
    return { kind: 'phone', normalized: value, valid, message: valid ? undefined : '手机号需为 7–15 位数字。' };
  }
  if (value.includes('@')) {
    const valid = value.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value)
      && !value.endsWith(`@${PHONE_ACCOUNT_DOMAIN}`);
    return { kind: 'email', normalized: value, valid, message: valid ? undefined : '邮箱格式不正确。' };
  }
  return { kind: 'unknown', valid: false, normalized: value, message: '请输入有效邮箱或 7–15 位数字手机号。' };
}

export function normalizeAccount(input: string): AccountIdentifier {
  const account = detectAccountInput(input);
  if (!account.valid || account.kind === 'unknown') throw new Error(account.message);
  return { kind: account.kind, value: account.normalized };
}

export function validatePassword(password: string, creatingAccount: boolean): { valid: boolean; message?: string } {
  if (!password) return { valid: false, message: '请输入密码。' };
  if (creatingAccount && (Array.from(password).length < 8 || new TextEncoder().encode(password).length > 72)) {
    return { valid: false, message: '密码至少需要 8 个字符，UTF-8 长度最多 72 字节。' };
  }
  return { valid: true };
}
