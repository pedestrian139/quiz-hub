import type { UserStore } from '../types/quiz';

export const LEGACY_GUEST_SCOPE = 'legacy-guest';
export type GuestPracticeScope = typeof LEGACY_GUEST_SCOPE | `guest:${string}`;
export type AccountPracticeScope = `account:${string}`;
export type PracticeScope = GuestPracticeScope | AccountPracticeScope;
export const PRACTICE_DATA_CHANGED_EVENT = 'quizhub:practice-data-changed';
export const BUILTIN_PROGRESS_SYNCED_EVENT = 'quizhub:builtin-progress-synced';
export const BANK_LIBRARY_SYNCED_EVENT = 'quizhub:bank-library-synced';

export function accountPracticeScope(userId: string): AccountPracticeScope {
  return `account:${userId}`;
}

export function isGuestPracticeScope(value: unknown): value is GuestPracticeScope {
  return value === LEGACY_GUEST_SCOPE || (typeof value === 'string' && /^guest:[a-f\d-]{36}$/.test(value));
}

export function isAccountPracticeScope(value: unknown): value is AccountPracticeScope {
  return typeof value === 'string' && value.startsWith('account:') && value.length > 'account:'.length;
}

export function accountIdFromScope(scope: PracticeScope): string | null {
  return isAccountPracticeScope(scope) ? scope.slice('account:'.length) : null;
}

export function practiceStorageKey(key: string, scope: PracticeScope): string {
  return scope === LEGACY_GUEST_SCOPE ? key : `${key}:${scope}`;
}

export function notifyPracticeDataChanged(scope: PracticeScope): void {
  globalThis.window?.dispatchEvent(new CustomEvent(PRACTICE_DATA_CHANGED_EVENT, { detail: scope }));
}

export function notifyBuiltinProgressSynced(scope: PracticeScope, store: UserStore): void {
  globalThis.window?.dispatchEvent(new CustomEvent(BUILTIN_PROGRESS_SYNCED_EVENT, { detail: { scope, store } }));
}

export function notifyBankLibrarySynced(scope: PracticeScope): void {
  globalThis.window?.dispatchEvent(new CustomEvent(BANK_LIBRARY_SYNCED_EVENT, { detail: { scope } }));
}
