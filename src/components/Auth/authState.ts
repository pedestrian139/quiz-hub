import { useEffect, useSyncExternalStore } from 'react';
import {
  OPEN_AUTH_MODAL_EVENT,
  getCachedCurrentUser,
  getCurrentUser,
  subscribeAuthChange,
  type AuthUser,
} from '../../services/authService';

export type AuthModalMode = 'login' | 'register' | 'upgrade';

export interface AuthUiSnapshot {
  user: AuthUser | null;
  isOpen: boolean;
  mode: AuthModalMode;
}

const listeners = new Set<() => void>();

let snapshot: AuthUiSnapshot = {
  user: getCachedCurrentUser(),
  isOpen: false,
  mode: 'login',
};

let bridgeInitialized = false;

function emitStore(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setUser(nextUser: AuthUser | null): void {
  snapshot = {
    ...snapshot,
    user: nextUser,
  };
  emitStore();
}

function ensureBridge(): void {
  if (bridgeInitialized || typeof window === 'undefined') {
    return;
  }
  bridgeInitialized = true;

  subscribeAuthChange((nextUser) => {
    setUser(nextUser);
  });

  window.addEventListener(OPEN_AUTH_MODAL_EVENT, (event: Event) => {
    const customEvent = event as CustomEvent<{ mode?: AuthModalMode } | undefined>;
    const requestedMode = customEvent.detail?.mode;
    const validMode: AuthModalMode =
      requestedMode === 'login' || requestedMode === 'register' || requestedMode === 'upgrade'
        ? requestedMode
        : 'login';
    openAuthModal(validMode);
  });
}

function subscribe(listener: () => void): () => void {
  ensureBridge();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AuthUiSnapshot {
  return snapshot;
}

export function openAuthModal(mode: AuthModalMode = 'login'): void {
  snapshot = {
    ...snapshot,
    isOpen: true,
    mode,
  };
  emitStore();
}

export function setAuthModalMode(mode: AuthModalMode): void {
  if (snapshot.mode === mode) {
    return;
  }
  snapshot = {
    ...snapshot,
    mode,
  };
  emitStore();
}

export function closeAuthModal(): void {
  if (!snapshot.isOpen) {
    return;
  }
  snapshot = {
    ...snapshot,
    isOpen: false,
  };
  emitStore();
}

export function useAuthUiState(): AuthUiSnapshot {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    let active = true;
    void getCurrentUser().then((resolved) => {
      if (!active) return;
      const cur = snapshot.user;
      const changed =
        (resolved === null && cur !== null) ||
        (resolved !== null &&
          (cur === null ||
            cur.id !== resolved.id ||
            cur.mode !== resolved.mode ||
            cur.updatedAt !== resolved.updatedAt ||
            cur.nickname !== resolved.nickname));
      if (changed) {
        setUser(resolved);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
