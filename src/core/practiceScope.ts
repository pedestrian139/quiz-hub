export const LEGACY_GUEST_SCOPE = 'legacy-guest';
export type GuestPracticeScope = typeof LEGACY_GUEST_SCOPE | `guest:${string}`;
export type AccountPracticeScope = `account:${string}`;
export type PracticeScope = GuestPracticeScope | AccountPracticeScope;
export const PRACTICE_DATA_CHANGED_EVENT = 'quizhub:practice-data-changed';

export function accountPracticeScope(userId: string): AccountPracticeScope {
  return `account:${userId}`;
}

export function isGuestPracticeScope(value: unknown): value is GuestPracticeScope {
  return value === LEGACY_GUEST_SCOPE || (typeof value === 'string' && /^guest:[a-f\d-]{36}$/.test(value));
}

export function practiceStorageKey(key: string, scope: PracticeScope): string {
  return scope === LEGACY_GUEST_SCOPE ? key : `${key}:${scope}`;
}

export function notifyPracticeDataChanged(scope: PracticeScope): void {
  globalThis.window?.dispatchEvent(new CustomEvent(PRACTICE_DATA_CHANGED_EVENT, { detail: scope }));
}
