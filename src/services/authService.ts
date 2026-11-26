import { getDatabaseClient, isDatabaseConfigured } from './db/client';
import { normalizeAccount, validateEmailOtp, validatePassword } from './db/account';
import type { AccountIdentifier } from './db/account';
import { loadProfile } from './db/cloudData';
import type { AccountProfile, GuestImportConflicts } from './db/cloudData';
import { endGuest, GUEST_KEY, getGuestId, startGuest } from './db/guestData';
import { hasPendingGuestUpgrade, readPendingUpgrade, runGuestUpgrade, savePendingUpgrade } from './db/guestUpgrade';
import { getActiveGuestPracticeScope } from './db/guestOwnership';
import { accountPracticeScope } from '../core/practiceScope';
import type { GuestPracticeScope } from '../core/practiceScope';
import { clearCloudSyncSession, flushPendingCloudWrites } from './cloudSync';

interface Credentials { account: string; password: string }
interface LoginCredentials extends Credentials { importGuestData?: boolean }
interface Registration extends Credentials { nickname: string }
interface UpgradeCredentials extends Credentials { nickname?: string }
export interface EmailOtpRequest { account: string }
export interface EmailOtpVerification { account: string; code: string; importGuestData?: boolean }
interface GuestLoginImport { account: AccountIdentifier; scope: GuestPracticeScope }

export interface GuestProfile {
  id: string;
  email: null;
  nickname: string;
  isGuest: true;
}

export type CurrentUser = AccountProfile | GuestProfile;
export interface AuthenticatedResult {
  status: 'authenticated' | 'migration_pending';
  user: AccountProfile;
  guestDataSynced?: true;
  migrationConflicts?: GuestImportConflicts;
}
export type AuthResult = { status: 'email_confirmation_required'; user: null } | AuthenticatedResult;

export { detectAccountInput, validateEmailOtp, validatePassword } from './db/account';
export { isDatabaseConfigured as isAuthConfigured } from './db/client';

type AuthChange = { type: 'session_changed'; accountId?: string | null } | { type: 'guest_migration'; result: AuthenticatedResult };
const authListeners = new Set<(change: AuthChange) => void>();

function publishAuthChange(change: AuthChange): void {
  for (const listener of authListeners) listener(change);
}

export function subscribeAuthChange(listener: (change: AuthChange) => void): () => void {
  authListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === GUEST_KEY) listener({ type: 'session_changed' });
  };
  globalThis.window?.addEventListener('storage', onStorage);
  return () => {
    authListeners.delete(listener);
    globalThis.window?.removeEventListener('storage', onStorage);
  };
}

const observedAuthClients = new WeakSet<object>();

function authClient() {
  const { auth } = getDatabaseClient();
  if (!observedAuthClients.has(auth)) {
    observedAuthClients.add(auth);
    let resumedUserId: string | null = null;
    auth.onAuthStateChange((event, session) => {
      if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) return;
      if (!session) resumedUserId = null;
      const shouldResume = (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session
        && session.user.id !== resumedUserId && readPendingUpgrade();
      if (shouldResume && session) resumedUserId = session.user.id;
      // Auth callbacks hold the SDK session lock. Defer refresh and database calls.
      setTimeout(() => {
        publishAuthChange({ type: 'session_changed', accountId: session?.user.id ?? null });
        if (shouldResume && session) {
          void auth.getSession().then(({ data }) => {
            if (data.session?.user.id === session.user.id) return completeSignIn(session.user.id);
          }).catch(() => { /* The pending snapshot remains available. */ });
        }
      }, 0);
    });
  }
  return auth;
}

function guestProfile(id: string): GuestProfile {
  return { id, email: null, nickname: '游客', isGuest: true };
}

function confirmationRedirect(): string {
  return import.meta.env.VITE_SUPABASE_AUTH_REDIRECT_URL?.trim() || `${location.origin}${location.pathname}`;
}

function matchesAccount(user: AccountProfile, account: AccountIdentifier): boolean {
  return user.email === account.value;
}

async function loadAuthenticatedProfile(): Promise<AccountProfile | null> {
  if (!isDatabaseConfigured()) return null;
  const { data, error } = await authClient().getUser();
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  if (!data.user) return null;
  return loadProfile(data.user.id);
}

async function finishGuestUpgrade(user: AccountProfile, options?: Parameters<typeof runGuestUpgrade>[1]): Promise<AuthenticatedResult> {
  const migration = await runGuestUpgrade(user, options);
  const result: AuthenticatedResult = { status: migration.pending ? 'migration_pending' : 'authenticated', user,
    ...(migration.synced && { guestDataSynced: true }),
    ...(migration.conflicts && { migrationConflicts: migration.conflicts }) };
  if (migration.pending || migration.synced) publishAuthChange({ type: 'guest_migration', result });
  return result;
}

async function completeSignIn(userId: string, guestImport?: GuestLoginImport): Promise<AuthenticatedResult> {
  const user = await loadProfile(userId);
  if (guestImport && matchesAccount(user, guestImport.account)) savePendingUpgrade(guestImport.account, guestImport.scope, user.id);
  endGuest();
  return finishGuestUpgrade(user);
}

async function register(
  account: AccountIdentifier,
  password: string,
  nickname: string,
  guestImport?: GuestLoginImport,
): Promise<AuthResult> {
  const name = nickname.trim();
  if (!name || Array.from(name).length > 80) throw new Error('昵称须为 1–80 个字符。');
  const validation = validatePassword(password, true);
  if (!validation.valid) throw new Error(validation.message);
  const { data, error } = await authClient().signUp({
    email: account.value,
    password,
    options: { data: { nickname: name }, emailRedirectTo: confirmationRedirect() },
  });
  if (error) throw error;
  if (!data.session && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('该邮箱已注册，请直接登录或使用邮箱验证码登录。');
  }
  if (data.session) return completeSignIn(data.session.user.id, guestImport);
  if (guestImport) savePendingUpgrade(guestImport.account, guestImport.scope);
  return { status: 'email_confirmation_required', user: null };
}

export async function registerWithAccount({ account, password, nickname }: Registration): Promise<AuthResult> {
  return register(normalizeAccount(account), password, nickname);
}

export async function resendSignupOtp({ account }: EmailOtpRequest): Promise<void> {
  const identifier = normalizeAccount(account);
  const { error } = await authClient().resend({
    type: 'signup',
    email: identifier.value,
    options: { emailRedirectTo: confirmationRedirect() },
  });
  if (error) throw error;
}

export async function sendLoginOtp({ account }: EmailOtpRequest): Promise<void> {
  const identifier = normalizeAccount(account);
  const { error } = await authClient().signInWithOtp({
    email: identifier.value,
    options: { shouldCreateUser: false, emailRedirectTo: confirmationRedirect() },
  });
  if (error) throw error;
}

export async function verifyEmailOtp({ account, code, importGuestData }: EmailOtpVerification): Promise<AuthenticatedResult> {
  const identifier = normalizeAccount(account);
  const otp = validateEmailOtp(code);
  if (!otp.valid) throw new Error(otp.message);
  const guestImport = importGuestData && getGuestId()
    ? { account: identifier, scope: await getActiveGuestPracticeScope() } : undefined;
  const { data, error } = await authClient().verifyOtp({
    email: identifier.value,
    token: otp.normalized,
    type: 'email',
  });
  if (error) throw error;
  const userId = data.user?.id ?? data.session?.user.id;
  if (!userId) throw new Error('邮箱验证码验证未完成，请重试。');
  return completeSignIn(userId, guestImport);
}

export async function loginWithAccount({ account, password, importGuestData }: LoginCredentials): Promise<AuthenticatedResult> {
  const identifier = normalizeAccount(account);
  const guestImport = importGuestData && getGuestId()
    ? { account: identifier, scope: await getActiveGuestPracticeScope() } : undefined;
  const { data, error } = await authClient().signInWithPassword({ email: identifier.value, password });
  if (error) throw error;
  if (!data.user) throw new Error('邮箱登录未完成，请重试。');
  return completeSignIn(data.user.id, guestImport);
}

export async function loginAsGuest(): Promise<GuestProfile> {
  let signedOutUserId: string | null = null;
  if (isDatabaseConfigured()) {
    const auth = authClient();
    const { data, error } = await auth.getSession();
    if (error) throw error;
    if (data.session) {
      signedOutUserId = data.session.user.id;
      await flushPendingCloudWrites().catch(() => undefined);
      const { error: signOutError } = await auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
    }
  }
  clearCloudSyncSession(signedOutUserId);
  const user = guestProfile(startGuest());
  publishAuthChange({ type: 'session_changed', accountId: null });
  return user;
}

export async function upgradeGuestToAccount({ account, password, nickname }: UpgradeCredentials): Promise<AuthResult> {
  const identifier = normalizeAccount(account);
  const displayName = nickname?.trim() || '刷题用户';
  const validation = validatePassword(password, true);
  if (!validation.valid) throw new Error(validation.message);
  const user = await loadAuthenticatedProfile();
  if (!user) {
    const scope = await getActiveGuestPracticeScope();
    return register(identifier, password, displayName, { account: identifier, scope });
  }
  if (!matchesAccount(user, identifier)) throw new Error('请退出当前账号后再升级游客资料。');
  savePendingUpgrade(identifier, await getActiveGuestPracticeScope(), user.id);
  return completeSignIn(user.id);
}

/** Sync the current account namespace, or explicitly import the current unclaimed guest data. */
export async function syncLocalData({ includeGuest = false }: { includeGuest?: boolean } = {}): Promise<AuthenticatedResult> {
  const user = await loadAuthenticatedProfile();
  if (!user) throw new Error('请先登录正式账号。');
  if (!user.email) throw new Error('请先完成邮箱验证。');
  if (!hasPendingGuestUpgrade(user)) {
    const scope = includeGuest ? await getActiveGuestPracticeScope() : accountPracticeScope(user.id);
    savePendingUpgrade(normalizeAccount(user.email), scope, user.id);
  }
  return finishGuestUpgrade(user, { retryConflicts: true });
}

export async function resumeGuestUpgrade(): Promise<AuthenticatedResult | null> {
  const user = await loadAuthenticatedProfile();
  return user && hasPendingGuestUpgrade(user) ? finishGuestUpgrade(user, { retryConflicts: true }) : null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await loadAuthenticatedProfile();
  if (user) return user;
  const id = getGuestId();
  return id ? guestProfile(id) : null;
}

export async function logout(): Promise<void> {
  let signedOutUserId: string | null = null;
  if (isDatabaseConfigured()) {
    const auth = authClient();
    const { data } = await auth.getSession().catch(() => ({ data: { session: null } }));
    signedOutUserId = data.session?.user.id ?? null;
    if (signedOutUserId) {
      await flushPendingCloudWrites().catch(() => undefined);
    }
    const { error } = await auth.signOut({ scope: 'local' });
    if (error) throw error;
  }
  clearCloudSyncSession(signedOutUserId);
  endGuest();
  publishAuthChange({ type: 'session_changed', accountId: null });
}
