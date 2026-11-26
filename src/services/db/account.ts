export type AccountIdentifier = { kind: 'email'; value: string };

export function detectAccountInput(input: string): { kind: 'email'; valid: boolean; normalized: string; message?: string } {
  const value = input.trim().toLowerCase();
  if (!value) {
    return { kind: 'email', normalized: '', valid: false, message: '请输入邮箱地址。' };
  }
  const valid = value.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
  return { kind: 'email', normalized: value, valid, message: valid ? undefined : '请输入有效的邮箱地址。' };
}

export function normalizeAccount(input: string): AccountIdentifier {
  const account = detectAccountInput(input);
  if (!account.valid) throw new Error(account.message);
  return { kind: account.kind, value: account.normalized };
}

export function validatePassword(password: string, creatingAccount: boolean): { valid: boolean; message?: string } {
  if (!password) return { valid: false, message: '请输入密码。' };
  if (creatingAccount && (Array.from(password).length < 8 || new TextEncoder().encode(password).length > 72)) {
    return { valid: false, message: '密码至少需要 8 个字符，UTF-8 长度最多 72 字节。' };
  }
  return { valid: true };
}

export function validateEmailOtp(code: string): { valid: boolean; normalized: string; message?: string } {
  const normalized = code.trim();
  if (!normalized) {
    return { valid: false, normalized: '', message: '请输入邮箱验证码。' };
  }
  const valid = /^[0-9]{6,8}$/.test(normalized);
  return { valid, normalized, message: valid ? undefined : '请输入 6–8 位数字验证码。' };
}
