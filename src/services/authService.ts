export type AuthAccountType = 'phone' | 'email';
export type AuthUserMode = 'guest' | 'account';

export type AuthErrorCode =
  | 'INVALID_ACCOUNT'
  | 'INVALID_PASSWORD'
  | 'ACCOUNT_EXISTS'
  | 'ACCOUNT_NOT_FOUND'
  | 'WRONG_PASSWORD'
  | 'NOT_A_GUEST'
  | 'STORAGE_ERROR';

export interface AuthUser {
  id: string;
  mode: AuthUserMode;
  isGuest: boolean;
  accountType?: AuthAccountType;
  /** Normalized 11-digit phone number when bound via phone. */
  phone?: string;
  /** Normalized lowercase email when bound via email. */
  email?: string;
  nickname: string;
  createdAt: number;
  updatedAt: number;
  /** Preserved when a guest upgrades to a formal account for cloud progress sync. */
  upgradedFromGuestId?: string;
}

export interface RegisterAccountInput {
  account: string;
  password: string;
  nickname?: string;
}

export interface LoginAccountInput {
  account: string;
  password: string;
}

export interface UpgradeGuestInput {
  account: string;
  password: string;
  nickname?: string;
}

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; code: AuthErrorCode; message: string };

export interface AccountDetectionResult {
  kind: AuthAccountType | 'unknown';
  valid: boolean;
  normalized: string;
  message?: string;
}

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

export const AUTH_SESSION_STORAGE_KEY = 'ai-intro-quiz-auth-session-v1';
export const AUTH_USERS_STORAGE_KEY = 'ai-intro-quiz-auth-users-v1';
export const AUTH_CHANGE_EVENT = 'quiz-hub:auth-change';
export const OPEN_AUTH_MODAL_EVENT = 'quiz-hub:open-auth-modal';

interface StoredAuthRecord {
  user: AuthUser;
  passwordHash: string;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PHONE_DIGITS_RE = /^\d+$/;
const PHONE_11_RE = /^\d{11}$/;
const EMAIL_LOCAL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const EMAIL_DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/i;

/**
 * In-memory fallback used when `localStorage` is inaccessible (SecurityError)
 * or throws on write (QuotaExceededError). Scoped by Storage reference so
 * test suites stubbing fresh `localStorage` instances stay isolated.
 */
let memorySession: AuthUser | null = null;
let memorySessionFallbackActive = false;
let memorySessionStorageRef: Storage | null = null;

let memoryUsers: StoredAuthRecord[] = [];
let memoryUsersFallbackActive = false;
let memoryUsersStorageRef: Storage | null = null;

function getSafeStorage(): Storage | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
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

function hasDangerousOwnKey(obj: Record<string, unknown>): boolean {
  return Object.getOwnPropertyNames(obj).some((key) => DANGEROUS_KEYS.has(key));
}

function sanitizeAuthUser(raw: unknown): AuthUser | null {
  if (!isPlainObject(raw) || hasDangerousOwnKey(raw)) {
    return null;
  }
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    return null;
  }
  if (raw.mode !== 'guest' && raw.mode !== 'account') {
    return null;
  }
  if (typeof raw.isGuest !== 'boolean') {
    return null;
  }
  if (typeof raw.nickname !== 'string' || !raw.nickname.trim()) {
    return null;
  }
  if (
    typeof raw.createdAt !== 'number' ||
    !Number.isFinite(raw.createdAt) ||
    typeof raw.updatedAt !== 'number' ||
    !Number.isFinite(raw.updatedAt)
  ) {
    return null;
  }

  const user: AuthUser = {
    id: raw.id,
    mode: raw.mode,
    isGuest: raw.isGuest,
    nickname: raw.nickname,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };

  if (raw.accountType === 'phone' || raw.accountType === 'email') {
    user.accountType = raw.accountType;
  }
  if (typeof raw.phone === 'string' && PHONE_11_RE.test(raw.phone)) {
    user.phone = raw.phone;
  }
  if (typeof raw.email === 'string' && raw.email.includes('@')) {
    user.email = raw.email;
  }
  if (typeof raw.upgradedFromGuestId === 'string' && raw.upgradedFromGuestId.trim()) {
    user.upgradedFromGuestId = raw.upgradedFromGuestId;
  }

  return user;
}

function cloneUser(user: AuthUser): AuthUser {
  return { ...user };
}

function sanitizeStoredRecord(raw: unknown): StoredAuthRecord | null {
  if (!isPlainObject(raw) || hasDangerousOwnKey(raw)) {
    return null;
  }
  if (typeof raw.passwordHash !== 'string' || !raw.passwordHash) {
    return null;
  }
  const user = sanitizeAuthUser(raw.user);
  if (!user) {
    return null;
  }
  return {
    user,
    passwordHash: raw.passwordHash,
  };
}

function readSession(): AuthUser | null {
  const storage = getSafeStorage();
  if (!storage) {
    return memorySession ? cloneUser(memorySession) : null;
  }
  if (memorySessionFallbackActive && memorySessionStorageRef === storage) {
    return memorySession ? cloneUser(memorySession) : null;
  }
  try {
    const raw = storage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return sanitizeAuthUser(parsed);
  } catch {
    return null;
  }
}

function writeSession(user: AuthUser | null): void {
  const snapshot = user ? cloneUser(user) : null;
  memorySession = snapshot;
  const storage = getSafeStorage();
  if (!storage) {
    memorySessionFallbackActive = true;
    memorySessionStorageRef = null;
    return;
  }
  try {
    if (snapshot) {
      storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    } else {
      storage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
    memorySessionFallbackActive = false;
    memorySessionStorageRef = storage;
  } catch {
    memorySessionFallbackActive = true;
    memorySessionStorageRef = storage;
  }
}

function readUsers(): StoredAuthRecord[] {
  const storage = getSafeStorage();
  if (!storage) {
    return memoryUsers.map((r) => ({ user: cloneUser(r.user), passwordHash: r.passwordHash }));
  }
  if (memoryUsersFallbackActive && memoryUsersStorageRef === storage) {
    return memoryUsers.map((r) => ({ user: cloneUser(r.user), passwordHash: r.passwordHash }));
  }
  try {
    const raw = storage.getItem(AUTH_USERS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const records: StoredAuthRecord[] = [];
    for (const item of parsed) {
      const record = sanitizeStoredRecord(item);
      if (record) {
        records.push(record);
      }
    }
    return records;
  } catch {
    return [];
  }
}

function writeUsers(records: StoredAuthRecord[]): void {
  const cloned = records.map((r) => ({
    user: cloneUser(r.user),
    passwordHash: r.passwordHash,
  }));
  memoryUsers = cloned;
  const storage = getSafeStorage();
  if (!storage) {
    memoryUsersFallbackActive = true;
    memoryUsersStorageRef = null;
    return;
  }
  try {
    storage.setItem(AUTH_USERS_STORAGE_KEY, JSON.stringify(cloned));
    memoryUsersFallbackActive = false;
    memoryUsersStorageRef = storage;
  } catch {
    memoryUsersFallbackActive = true;
    memoryUsersStorageRef = storage;
  }
}

function emitAuthChange(user: AuthUser | null): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<AuthUser | null>(AUTH_CHANGE_EVENT, {
      detail: user ? cloneUser(user) : null,
    }),
  );
}

function generateId(prefix: 'usr' | 'guest'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  const timePart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${timePart}${randPart}`;
}

/**
 * Deterministic salted mock digest so plaintext passwords are never persisted.
 * Intended to be replaced by real backend hashing/JWT in `feat/database`.
 */
function hashPasswordMock(password: string, salt: string): string {
  const input = `quizhub-v2:${salt}:${password}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `mock_${p1}${p2}`;
}

function buildDefaultNickname(
  detection: AccountDetectionResult,
  explicitNickname?: string,
): string {
  const custom = explicitNickname?.trim();
  if (custom) {
    return custom.slice(0, 24);
  }
  if (detection.kind === 'phone') {
    return `手机用户_${detection.normalized.slice(-4)}`;
  }
  if (detection.kind === 'email') {
    const atIndex = detection.normalized.indexOf('@');
    const localPart = atIndex > 0 ? detection.normalized.slice(0, atIndex) : '用户';
    return localPart.slice(0, 20) || '邮箱用户';
  }
  return 'QuizHub用户';
}

function matchesAccount(record: StoredAuthRecord, detection: AccountDetectionResult): boolean {
  if (detection.kind === 'phone') {
    return record.user.phone === detection.normalized;
  }
  if (detection.kind === 'email') {
    return record.user.email === detection.normalized;
  }
  return false;
}

export function detectAccountInput(raw: string): AccountDetectionResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      kind: 'unknown',
      valid: false,
      normalized: '',
      message: '请输入手机号或邮箱',
    };
  }

  if (trimmed.includes('@')) {
    const normalized = trimmed.toLowerCase();
    const parts = normalized.split('@');
    if (parts.length !== 2) {
      return {
        kind: 'email',
        valid: false,
        normalized,
        message: '邮箱格式不正确，请输入有效邮箱（如 name@example.com）',
      };
    }
    const [localPart, domainPart] = parts;
    const valid =
      Boolean(localPart) &&
      Boolean(domainPart) &&
      !localPart.startsWith('.') &&
      !localPart.endsWith('.') &&
      !normalized.includes('..') &&
      EMAIL_LOCAL_RE.test(localPart) &&
      EMAIL_DOMAIN_RE.test(domainPart);

    return valid
      ? { kind: 'email', valid: true, normalized }
      : {
          kind: 'email',
          valid: false,
          normalized,
          message: '邮箱格式不正确，请输入有效邮箱（如 name@example.com）',
        };
  }

  if (PHONE_DIGITS_RE.test(trimmed)) {
    if (PHONE_11_RE.test(trimmed)) {
      return {
        kind: 'phone',
        valid: true,
        normalized: trimmed,
      };
    }
    return {
      kind: 'phone',
      valid: false,
      normalized: trimmed,
      message: '手机号需为 11 位数字',
    };
  }

  return {
    kind: 'unknown',
    valid: false,
    normalized: trimmed,
    message: '请输入有效的 11 位手机号或邮箱地址',
  };
}

export function validatePassword(
  password: string,
  requireMinLength: boolean,
): PasswordValidationResult {
  if (!password) {
    return { valid: false, message: '请输入密码' };
  }
  if (requireMinLength && password.length < 6) {
    return { valid: false, message: '密码长度不能少于 6 位' };
  }
  return { valid: true };
}

export function getCachedCurrentUser(): AuthUser | null {
  return readSession();
}

export function subscribeAuthChange(listener: (user: AuthUser | null) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const onAuthChange = (event: Event) => {
    const customEvent = event as CustomEvent<AuthUser | null>;
    if (customEvent.detail !== undefined) {
      listener(customEvent.detail ? cloneUser(customEvent.detail) : null);
      return;
    }
    listener(readSession());
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === AUTH_SESSION_STORAGE_KEY) {
      listener(readSession());
    }
  };

  window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    window.removeEventListener('storage', onStorage);
  };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  return readSession();
}

export async function registerWithAccount(input: RegisterAccountInput): Promise<AuthResult> {
  const detection = detectAccountInput(input.account);
  if (!detection.valid || detection.kind === 'unknown') {
    return {
      ok: false,
      code: 'INVALID_ACCOUNT',
      message: detection.message ?? '请输入有效的 11 位手机号或邮箱地址',
    };
  }

  const pwdCheck = validatePassword(input.password, true);
  if (!pwdCheck.valid) {
    return {
      ok: false,
      code: 'INVALID_PASSWORD',
      message: pwdCheck.message ?? '密码长度不能少于 6 位',
    };
  }

  const users = readUsers();
  if (users.some((r) => matchesAccount(r, detection))) {
    return {
      ok: false,
      code: 'ACCOUNT_EXISTS',
      message: '该账号已注册，请直接登录',
    };
  }

  const now = Date.now();
  const user: AuthUser = {
    id: generateId('usr'),
    mode: 'account',
    isGuest: false,
    accountType: detection.kind,
    ...(detection.kind === 'phone'
      ? { phone: detection.normalized }
      : { email: detection.normalized }),
    nickname: buildDefaultNickname(detection, input.nickname),
    createdAt: now,
    updatedAt: now,
  };

  const record: StoredAuthRecord = {
    user,
    passwordHash: hashPasswordMock(input.password, user.id),
  };

  writeUsers([...users, record]);
  writeSession(user);
  emitAuthChange(user);

  return { ok: true, user: cloneUser(user) };
}

export async function loginWithAccount(input: LoginAccountInput): Promise<AuthResult> {
  const detection = detectAccountInput(input.account);
  if (!detection.valid || detection.kind === 'unknown') {
    return {
      ok: false,
      code: 'INVALID_ACCOUNT',
      message: detection.message ?? '请输入有效的 11 位手机号或邮箱地址',
    };
  }

  const pwdCheck = validatePassword(input.password, false);
  if (!pwdCheck.valid) {
    return {
      ok: false,
      code: 'INVALID_PASSWORD',
      message: pwdCheck.message ?? '请输入密码',
    };
  }

  const users = readUsers();
  const matched = users.find((r) => matchesAccount(r, detection));
  if (!matched) {
    return {
      ok: false,
      code: 'ACCOUNT_NOT_FOUND',
      message: '该账号尚未注册，请先注册',
    };
  }

  const expectedHash = hashPasswordMock(input.password, matched.user.id);
  if (matched.passwordHash !== expectedHash) {
    return {
      ok: false,
      code: 'WRONG_PASSWORD',
      message: '密码错误，请重新输入',
    };
  }

  const updatedUser: AuthUser = {
    ...matched.user,
    updatedAt: Date.now(),
  };

  writeSession(updatedUser);
  emitAuthChange(updatedUser);

  return { ok: true, user: cloneUser(updatedUser) };
}

export async function loginAsGuest(): Promise<AuthResult> {
  const current = readSession();
  if (current && current.isGuest) {
    return { ok: true, user: cloneUser(current) };
  }

  const now = Date.now();
  const id = generateId('guest');
  const shortCode = id.slice(-4).toUpperCase();
  const guestUser: AuthUser = {
    id,
    mode: 'guest',
    isGuest: true,
    nickname: `游客_${shortCode}`,
    createdAt: now,
    updatedAt: now,
  };

  writeSession(guestUser);
  emitAuthChange(guestUser);

  return { ok: true, user: cloneUser(guestUser) };
}

export async function upgradeGuestToAccount(input: UpgradeGuestInput): Promise<AuthResult> {
  const current = readSession();
  if (!current || !current.isGuest) {
    return {
      ok: false,
      code: 'NOT_A_GUEST',
      message: '当前非游客模式，无法绑定升级',
    };
  }

  const detection = detectAccountInput(input.account);
  if (!detection.valid || detection.kind === 'unknown') {
    return {
      ok: false,
      code: 'INVALID_ACCOUNT',
      message: detection.message ?? '请输入有效的 11 位手机号或邮箱地址',
    };
  }

  const pwdCheck = validatePassword(input.password, true);
  if (!pwdCheck.valid) {
    return {
      ok: false,
      code: 'INVALID_PASSWORD',
      message: pwdCheck.message ?? '密码长度不能少于 6 位',
    };
  }

  const users = readUsers();
  if (users.some((r) => matchesAccount(r, detection))) {
    return {
      ok: false,
      code: 'ACCOUNT_EXISTS',
      message: '该手机号或邮箱已被注册，请直接切换账号登录',
    };
  }

  const now = Date.now();
  const upgradedUser: AuthUser = {
    id: current.id,
    mode: 'account',
    isGuest: false,
    accountType: detection.kind,
    ...(detection.kind === 'phone'
      ? { phone: detection.normalized }
      : { email: detection.normalized }),
    nickname: buildDefaultNickname(detection, input.nickname),
    createdAt: current.createdAt,
    updatedAt: now,
    upgradedFromGuestId: current.id,
  };

  const record: StoredAuthRecord = {
    user: upgradedUser,
    passwordHash: hashPasswordMock(input.password, upgradedUser.id),
  };

  writeUsers([...users, record]);
  writeSession(upgradedUser);
  emitAuthChange(upgradedUser);

  return { ok: true, user: cloneUser(upgradedUser) };
}

export async function logout(): Promise<void> {
  writeSession(null);
  emitAuthChange(null);
}
