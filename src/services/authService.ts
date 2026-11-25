import { getDatabaseClient, invokeDatabaseFunction, isDatabaseConfigured } from './db/client';
import { normalizeAccount, validatePassword } from './db/account';
import type { AccountIdentifier } from './db/account';
import { loadProfile } from './db/cloudData';
import type { AccountProfile, GuestImportConflicts } from './db/cloudData';
import { endGuest, GUEST_KEY, getGuestId, startGuest } from './db/guestData';
import { hasPendingGuestUpgrade, readPendingUpgrade, runGuestUpgrade, savePendingUpgrade } from './db/guestUpgrade';
import { getActiveGuestPracticeScope } from './db/guestOwnership';
import { accountPracticeScope } from '../core/practiceScope';
import type { GuestPracticeScope } from '../core/practiceScope';

interface Credentials { account: string; password: string }
interface LoginCredentials extends Credentials { importGuestData?: boolean }
interface AccountSelection extends Credentials { secondaryAccount?: string }
interface Registration extends AccountSelection { nickname: string }
interface GuestLoginImport { account: AccountIdentifier; scope: GuestPracticeScope }

export interface GuestProfile {
  id: string;
  email: null;
  phone: null;
  nickname: string;
  isGuest: true;
}

export type CurrentUser = AccountProfile | GuestProfile;
export interface AuthenticatedResult {
  status: 'authenticated' | 'migration_pending';
  user: AccountProfile;
  guestDataSynced?: true;
  pendingEmail?: string;
  failedSecondaryAccount?: string;
  migrationConflicts?: GuestImportConflicts;
}
export type AuthResult = { status: 'email_confirmation_required'; user: null } | AuthenticatedResult;
export type LinkResult = { status: 'authenticated' | 'email_confirmation_required'; user: AccountProfile };

export { detectAccountInput, validatePassword } from './db/account';
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
  return { id, email: null, phone: null, nickname: '游客', isGuest: true };
}

function confirmationRedirect(): string {
  return import.meta.env.VITE_SUPABASE_AUTH_REDIRECT_URL?.trim() || `${location.origin}${location.pathname}`;
}

function matchesAccount(user: AccountProfile, account: AccountIdentifier): boolean {
  return (account.kind === 'email' ? user.email : user.phone) === account.value;
}

function registrationIdentifiers(account: string, secondaryAccount?: string): {
  registrationAccount: AccountIdentifier; accountToLink?: AccountIdentifier;
} {
  const primary = normalizeAccount(account);
  if (secondaryAccount === undefined) return { registrationAccount: primary };
  const secondary = normalizeAccount(secondaryAccount);
  if (primary.kind === secondary.kind) throw new Error('同时注册时，请提供一个邮箱和一个手机号。');
  return primary.kind === 'phone' ? { registrationAccount: primary, accountToLink: secondary }
    : { registrationAccount: secondary, accountToLink: primary };
}

async function tryLinkSecondaryAccount(result: AuthResult, password: string, accountToLink?: AccountIdentifier): Promise<AuthResult> {
  if (!result.user || !accountToLink || matchesAccount(result.user, accountToLink)) return result;
  try {
    const link = await linkAccount({ account: accountToLink.value, password });
    return { ...result, user: link.user,
      ...(link.status === 'email_confirmation_required' && { pendingEmail: accountToLink.value }) };
  } catch {
    return { ...result, failedSecondaryAccount: accountToLink.value };
  }
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

async function signInPhone(phone: string, password: string, guestImport?: GuestLoginImport): Promise<AuthResult> {
  const tokens = await invokeDatabaseFunction<{ access_token: string; refresh_token: string }>(
    'phone-auth', { action: 'login', phone, password },
  );
  const { data, error } = await authClient().setSession(tokens);
  if (error) throw error;
  if (!data.user) throw new Error('手机号登录未完成，请重试。');
  return completeSignIn(data.user.id, guestImport);
}

async function register(account: AccountIdentifier, password: string, nickname: string): Promise<AuthResult> {
  const name = nickname.trim();
  if (!name || Array.from(name).length > 80) throw new Error('昵称须为 1–80 个字符。');
  const validation = validatePassword(password, true);
  if (!validation.valid) throw new Error(validation.message);
  if (account.kind === 'phone') {
    await invokeDatabaseFunction('phone-auth', { action: 'register', phone: account.value, password, nickname: name });
    return signInPhone(account.value, password);
  }
  const { data, error } = await authClient().signUp({
    email: account.value, password, options: { data: { nickname: name }, emailRedirectTo: confirmationRedirect() },
  });
  if (error) throw error;
  return data.session ? completeSignIn(data.session.user.id) : { status: 'email_confirmation_required', user: null };
}

export async function registerWithAccount({ account, password, nickname, secondaryAccount }: Registration): Promise<AuthResult> {
  const { registrationAccount, accountToLink } = registrationIdentifiers(account, secondaryAccount);
  return tryLinkSecondaryAccount(await register(registrationAccount, password, nickname), password, accountToLink);
}

export async function loginWithAccount({ account, password, importGuestData }: LoginCredentials): Promise<AuthResult> {
  const identifier = normalizeAccount(account);
  const guestImport = importGuestData && getGuestId()
    ? { account: identifier, scope: await getActiveGuestPracticeScope() } : undefined;
  if (identifier.kind === 'phone') return signInPhone(identifier.value, password, guestImport);
  const { data, error } = await authClient().signInWithPassword({ email: identifier.value, password });
  if (error) throw error;
  if (!data.user) throw new Error('邮箱登录未完成，请重试。');
  return completeSignIn(data.user.id, guestImport);
}

export async function loginAsGuest(): Promise<GuestProfile> {
  if (isDatabaseConfigured()) {
    const auth = authClient();
    const { data, error } = await auth.getSession();
    if (error) throw error;
    if (data.session) {
      const { error: signOutError } = await auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
    }
  }
  const user = guestProfile(startGuest());
  publishAuthChange({ type: 'session_changed' });
  return user;
}

export async function upgradeGuestToAccount({ account, password, secondaryAccount }: AccountSelection): Promise<AuthResult> {
  const { registrationAccount, accountToLink } = registrationIdentifiers(account, secondaryAccount);
  const user = await loadAuthenticatedProfile();
  if (!user) {
    savePendingUpgrade(registrationAccount, await getActiveGuestPracticeScope());
    return tryLinkSecondaryAccount(await register(registrationAccount, password, '刷题用户'), password, accountToLink);
  }
  const matchedAccount = [registrationAccount, accountToLink].find((candidate) => candidate && matchesAccount(user, candidate));
  if (!matchedAccount) throw new Error('请退出当前账号后再升级游客资料。');
  savePendingUpgrade(matchedAccount, await getActiveGuestPracticeScope(), user.id);
  const secondAccount = matchedAccount === registrationAccount ? accountToLink : registrationAccount;
  return tryLinkSecondaryAccount(await completeSignIn(user.id), password, secondAccount);
}

/** Sync the current account namespace, or explicitly import the current unclaimed guest data. */
export async function syncLocalData({ includeGuest = false }: { includeGuest?: boolean } = {}): Promise<AuthResult> {
  const user = await loadAuthenticatedProfile();
  if (!user) throw new Error('请先登录正式账号。');
  const account = user.email || user.phone;
  if (!account) throw new Error('请先完成账号验证。');
  if (!hasPendingGuestUpgrade(user)) {
    const scope = includeGuest ? await getActiveGuestPracticeScope() : accountPracticeScope(user.id);
    savePendingUpgrade(normalizeAccount(account), scope, user.id);
  }
  return finishGuestUpgrade(user, { retryConflicts: true });
}

export async function resumeGuestUpgrade(): Promise<AuthResult | null> {
  const user = await loadAuthenticatedProfile();
  return user && hasPendingGuestUpgrade(user) ? finishGuestUpgrade(user, { retryConflicts: true }) : null;
}

/** Add a second sign-in identifier to the current account. The password and user ID stay the same. */
export async function linkAccount({ account, password }: Credentials): Promise<LinkResult> {
  const identifier = normalizeAccount(account);
  const user = await loadAuthenticatedProfile();
  if (!user) throw new Error('请先登录正式账号。');
  if (matchesAccount(user, identifier)) return { status: 'authenticated', user };
  if (user[identifier.kind]) throw new Error('此账号已绑定同类型的登录方式。');
  const auth = authClient();
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== user.id) throw new Error('登录账号已变更，请重试。');
  const linkRequest = identifier.kind === 'phone' ? { action: 'link', phone: identifier.value }
    : { action: 'authorize_email_link', email: identifier.value };
  await invokeDatabaseFunction('phone-auth', { ...linkRequest, ownerId: user.id, password }, data.session.access_token);
  if (identifier.kind === 'phone') return { status: 'authenticated', user: await loadProfile(user.id) };
  const current = await auth.getSession();
  if (current.error) throw current.error;
  if (current.data.session?.user.id !== user.id) throw new Error('登录账号已变更，请重试。');
  const { error: updateError } = await auth.updateUser({ email: identifier.value }, { emailRedirectTo: confirmationRedirect() });
  if (updateError) throw updateError;
  return { status: 'email_confirmation_required', user };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await loadAuthenticatedProfile();
  if (user) return user;
  const id = getGuestId();
  return id ? guestProfile(id) : null;
}

export async function logout(): Promise<void> {
  if (isDatabaseConfigured()) {
    const { error } = await authClient().signOut({ scope: 'local' });
    if (error) throw error;
  }
  endGuest();
  publishAuthChange({ type: 'session_changed' });
}
