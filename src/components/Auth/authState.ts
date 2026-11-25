import { useSyncExternalStore } from 'react';
import { getCurrentUser, subscribeAuthChange } from '../../services/authService';
import type { AuthenticatedResult, CurrentUser } from '../../services/authService';

export const OPEN_AUTH_MODAL_EVENT = 'quiz-hub:open-auth-modal';
export type AuthModalMode = 'login' | 'register' | 'upgrade' | 'guest-login';
type MigrationStatus = 'pending' | 'conflict' | 'synced';

interface AuthUiSnapshot {
  user: CurrentUser | null;
  identityStatus: 'loading' | 'ready' | 'error';
  isOpen: boolean;
  mode: AuthModalMode;
  migrationStatus: MigrationStatus | null;
}

const listeners = new Set<() => void>();
let snapshot: AuthUiSnapshot = { user: null, identityStatus: 'loading', isOpen: false, mode: 'login', migrationStatus: null };
let lastMigration: { userId: string; status: MigrationStatus } | null = null;
let bridgeInitialized = false;
let refreshVersion = 0;

function updateSnapshot(change: Partial<AuthUiSnapshot>): void {
  snapshot = { ...snapshot, ...change };
  for (const listener of listeners) listener();
}

function setAuthUser(user: CurrentUser | null): void {
  refreshVersion += 1;
  updateSnapshot({ user, identityStatus: 'ready', migrationStatus: user?.id === lastMigration?.userId ? lastMigration?.status ?? null : null });
}

function recordMigration(result: AuthenticatedResult): void {
  const status = result.migrationConflicts ? 'conflict' : result.status === 'migration_pending' ? 'pending'
    : result.guestDataSynced ? 'synced' : null;
  if (!status) return;
  lastMigration = { userId: result.user.id, status };
  if (snapshot.user?.id === result.user.id) updateSnapshot({ migrationStatus: status });
}

export async function applyAuthResult(result: AuthenticatedResult): Promise<void> {
  recordMigration(result);
  await refreshAuthIdentity();
}

export async function refreshAuthIdentity(): Promise<void> {
  const version = ++refreshVersion;
  try {
    const user = await getCurrentUser();
    if (version === refreshVersion) setAuthUser(user);
  } catch {
    if (version === refreshVersion) updateSnapshot({ user: null, identityStatus: 'error', migrationStatus: null });
  }
}

function ensureBridge(): void {
  if (bridgeInitialized || typeof window === 'undefined') return;
  bridgeInitialized = true;
  subscribeAuthChange((event) => {
    if (event.type === 'guest_migration') recordMigration(event.result);
    else {
      const currentAccount = snapshot.user && !snapshot.user.isGuest ? snapshot.user.id : null;
      if (event.accountId !== undefined && event.accountId !== currentAccount) {
        updateSnapshot({ user: null, identityStatus: 'loading', migrationStatus: null });
      }
      void refreshAuthIdentity();
    }
  });
  window.addEventListener(OPEN_AUTH_MODAL_EVENT, (event) => {
    const mode = (event as CustomEvent<{ mode?: AuthModalMode }>).detail?.mode;
    openAuthModal(mode === 'register' || mode === 'upgrade' || mode === 'guest-login' ? mode : 'login');
  });
  void refreshAuthIdentity();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureBridge();
  return () => { listeners.delete(listener); };
}

function getSnapshot(): AuthUiSnapshot { return snapshot; }

export function openAuthModal(mode: AuthModalMode = 'login'): void {
  updateSnapshot({ isOpen: true, mode });
}

export function setAuthModalMode(mode: AuthModalMode): void {
  if (snapshot.mode !== mode) updateSnapshot({ mode });
}

export function closeAuthModal(): void {
  if (snapshot.isOpen) updateSnapshot({ isOpen: false });
}

export function useAuthUiState(): AuthUiSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
