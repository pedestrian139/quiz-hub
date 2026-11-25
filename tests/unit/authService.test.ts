import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_SESSION_STORAGE_KEY,
  AUTH_USERS_STORAGE_KEY,
  detectAccountInput,
  getCachedCurrentUser,
  getCurrentUser,
  loginAsGuest,
  loginWithAccount,
  logout,
  registerWithAccount,
  subscribeAuthChange,
  upgradeGuestToAccount,
  validatePassword,
  type AuthUser,
} from '../../src/services/authService';

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

describe('authService', () => {
  const originalOwnLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalOwnLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalOwnLocalStorage);
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('AU-01: detects 11-digit phone numbers and emails accurately', () => {
    expect(detectAccountInput('')).toMatchObject({ kind: 'unknown', valid: false });
    expect(detectAccountInput('   ')).toMatchObject({ kind: 'unknown', valid: false });

    expect(detectAccountInput(' 13800138000 ')).toEqual({
      kind: 'phone',
      valid: true,
      normalized: '13800138000',
    });
    expect(detectAccountInput('1380013800')).toMatchObject({
      kind: 'phone',
      valid: false,
      message: '手机号需为 11 位数字',
    });
    expect(detectAccountInput('138001380001')).toMatchObject({
      kind: 'phone',
      valid: false,
      message: '手机号需为 11 位数字',
    });

    expect(detectAccountInput(' User+1@Sub.EDU ')).toEqual({
      kind: 'email',
      valid: true,
      normalized: 'user+1@sub.edu',
    });
    for (const badEmail of ['alice@', '@qq.com', 'a@b', 'a@b.c', 'a b@c.com', 'a..b@c.com']) {
      expect(detectAccountInput(badEmail)).toMatchObject({
        kind: 'email',
        valid: false,
      });
    }

    expect(detectAccountInput('138abc12345')).toMatchObject({
      kind: 'unknown',
      valid: false,
    });
  });

  it('AU-02: validates password emptiness and >= 6 char length for register/upgrade', () => {
    expect(validatePassword('', true)).toEqual({ valid: false, message: '请输入密码' });
    expect(validatePassword('12345', true)).toEqual({
      valid: false,
      message: '密码长度不能少于 6 位',
    });
    expect(validatePassword('123456', true)).toEqual({ valid: true });
    expect(validatePassword('123', false)).toEqual({ valid: true });
  });

  it('AU-03: registerWithAccount persists session without raw password and rejects duplicates', async () => {
    const res = await registerWithAccount({
      account: '13800138000',
      password: 'secret123',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.user.mode).toBe('account');
    expect(res.user.isGuest).toBe(false);
    expect(res.user.accountType).toBe('phone');
    expect(res.user.phone).toBe('13800138000');
    expect(res.user.nickname).toBe('手机用户_8000');
    expect((res.user as unknown as Record<string, unknown>).password).toBeUndefined();

    const sessionRaw = globalThis.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    const usersRaw = globalThis.localStorage.getItem(AUTH_USERS_STORAGE_KEY);
    expect(sessionRaw).not.toBeNull();
    expect(usersRaw).not.toBeNull();
    expect(sessionRaw).not.toContain('secret123');
    expect(usersRaw).not.toContain('secret123');
    expect(globalThis.localStorage.getItem('ai-intro-quiz-v1')).toBeNull();

    const dup = await registerWithAccount({
      account: '13800138000',
      password: 'anotherpassword',
    });
    expect(dup).toEqual({
      ok: false,
      code: 'ACCOUNT_EXISTS',
      message: '该账号已注册，请直接登录',
    });
  });

  it('AU-04: logout clears active session while preserving account for loginWithAccount', async () => {
    const reg = await registerWithAccount({
      account: 'Alice@Example.COM',
      password: 'password88',
    });
    expect(reg.ok).toBe(true);
    expect(await getCurrentUser()).not.toBeNull();

    await logout();
    expect(await getCurrentUser()).toBeNull();
    expect(getCachedCurrentUser()).toBeNull();

    const missing = await loginWithAccount({
      account: 'nobody@example.com',
      password: 'password88',
    });
    expect(missing).toEqual({
      ok: false,
      code: 'ACCOUNT_NOT_FOUND',
      message: '该账号尚未注册，请先注册',
    });

    const wrongPwd = await loginWithAccount({
      account: 'alice@example.com',
      password: 'wrong',
    });
    expect(wrongPwd).toEqual({
      ok: false,
      code: 'WRONG_PASSWORD',
      message: '密码错误，请重新输入',
    });

    const okLogin = await loginWithAccount({
      account: 'alice@example.com',
      password: 'password88',
    });
    expect(okLogin.ok).toBe(true);
    if (!okLogin.ok) return;
    expect(okLogin.user.email).toBe('alice@example.com');
    expect(okLogin.user.nickname).toBe('alice');
  });

  it('AU-05: loginAsGuest and upgradeGuestToAccount preserve guest id and emit auth events', async () => {
    const events: Array<AuthUser | null> = [];
    const unsubscribe = subscribeAuthChange((user) => {
      events.push(user);
    });

    const guestRes = await loginAsGuest();
    expect(guestRes.ok).toBe(true);
    if (!guestRes.ok) return;

    const guestId = guestRes.user.id;
    expect(guestRes.user.isGuest).toBe(true);
    expect(guestRes.user.mode).toBe('guest');
    expect(guestRes.user.nickname.startsWith('游客_')).toBe(true);

    // Calling loginAsGuest again while already guest reuses existing guest
    const guestRes2 = await loginAsGuest();
    expect(guestRes2.ok).toBe(true);
    if (guestRes2.ok) {
      expect(guestRes2.user.id).toBe(guestId);
    }

    const upgradeRes = await upgradeGuestToAccount({
      account: '13912345678',
      password: 'bindpass99',
    });
    expect(upgradeRes.ok).toBe(true);
    if (!upgradeRes.ok) return;

    expect(upgradeRes.user.id).toBe(guestId);
    expect(upgradeRes.user.upgradedFromGuestId).toBe(guestId);
    expect(upgradeRes.user.isGuest).toBe(false);
    expect(upgradeRes.user.mode).toBe('account');
    expect(upgradeRes.user.phone).toBe('13912345678');

    // Non-guest cannot call upgradeGuestToAccount
    const repeatUpgrade = await upgradeGuestToAccount({
      account: 'new@example.com',
      password: 'bindpass99',
    });
    expect(repeatUpgrade).toEqual({
      ok: false,
      code: 'NOT_A_GUEST',
      message: '当前非游客模式，无法绑定升级',
    });

    unsubscribe();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]?.upgradedFromGuestId).toBe(guestId);
  });

  it('AU-06: rejects prototype pollution / corrupted JSON and degrades gracefully on storage errors', async () => {
    globalThis.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, '{not-json');
    expect(await getCurrentUser()).toBeNull();

    globalThis.localStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      '{"__proto__":{"polluted":true},"id":"u1","mode":"account","isGuest":false,"nickname":"x","createdAt":1,"updatedAt":1}',
    );
    expect(await getCurrentUser()).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // SecurityError when localStorage getter throws
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    const memGuest = await loginAsGuest();
    expect(memGuest.ok).toBe(true);
    expect((await getCurrentUser())?.isGuest).toBe(true);
    await logout();
    expect(await getCurrentUser()).toBeNull();

    // QuotaExceededError on setItem
    const baseStorage = createMemoryStorage();
    const quotaStorage: Storage = {
      ...baseStorage,
      get length() {
        return baseStorage.length;
      },
      clear: () => baseStorage.clear(),
      getItem: (k: string) => baseStorage.getItem(k),
      key: (i: number) => baseStorage.key(i),
      removeItem: (k: string) => baseStorage.removeItem(k),
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
    };
    vi.stubGlobal('localStorage', quotaStorage);

    const quotaReg = await registerWithAccount({
      account: 'quota@example.com',
      password: 'password123',
    });
    expect(quotaReg.ok).toBe(true);
    expect((await getCurrentUser())?.email).toBe('quota@example.com');
  });
});
