import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_PROGRESS_SYNCED_EVENT,
  isAccountPracticeScope,
  notifyBankLibrarySynced,
  practiceStorageKey,
  type PracticeScope,
} from '../../core/practiceScope';
import { STORAGE_KEY, createEmptyStore, loadStore } from '../../core/storage';
import { usePracticeScope } from '../../hooks/practiceScope';
import type { MasteryLevel, Question, UserStore } from '../../types/quiz';
import { BUILTIN_AI_BANK_ID } from '../../utils/quizImportTypes';
import { getBankDb } from '../../utils/bankDb';
import { useBankLibraryContext } from '../../utils/BankLibraryContext';
import type { WrongBookItem, WrongBookMetaStore } from './types';
import {
  collectWrongBookItems,
  markQuestionMasteredInStore,
  recordRetryWrongInStore,
} from './wrongBookEngine';
import {
  WRONG_BOOK_META_KEY,
  loadWrongBookMeta,
  recordRetryWrongInMeta,
  saveWrongBookMeta,
  syncWrongBookMetaWithBanks,
} from './wrongBookMeta';

const WRONG_BOOK_META_SYNCED_EVENT = 'quizhub:wrong-book-meta-synced';

interface ScopedBuiltinReadResult {
  available: boolean;
  exists: boolean;
  raw: string | null;
  store: UserStore | null;
}

function getSafeLocalStorage(): Storage | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage && typeof storage.getItem === 'function') {
      return storage;
    }
    return null;
  } catch {
    return null;
  }
}

function readScopedBuiltinRaw(scope: PracticeScope): { available: boolean; raw: string | null } {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return { available: false, raw: null };
  }
  try {
    const key = practiceStorageKey(STORAGE_KEY, scope);
    return { available: true, raw: storage.getItem(key) };
  } catch {
    return { available: false, raw: null };
  }
}

function readScopedBuiltinLocalStorage(scope: PracticeScope): ScopedBuiltinReadResult {
  const { available, raw } = readScopedBuiltinRaw(scope);
  if (!available || raw === null) {
    return { available, exists: false, raw: null, store: null };
  }
  return { available: true, exists: true, raw, store: loadStore(scope) };
}

function notifyMetaSynced(scope: PracticeScope, meta: WrongBookMetaStore): void {
  globalThis.window?.dispatchEvent(
    new CustomEvent(WRONG_BOOK_META_SYNCED_EVENT, { detail: { scope, meta } }),
  );
}

export function useWrongBook() {
  const scope = usePracticeScope();
  const library = useBankLibraryContext();

  const [meta, setMeta] = useState<WrongBookMetaStore>(() => loadWrongBookMeta(scope));
  const [builtinSnapshot, setBuiltinSnapshot] = useState<ScopedBuiltinReadResult>(() =>
    readScopedBuiltinLocalStorage(scope),
  );
  const lastBuiltinRawRef = useRef<string | null>(builtinSnapshot.raw);
  const lastBuiltinAvailableRef = useRef<boolean>(builtinSnapshot.available);
  const hadBuiltinKeyRef = useRef<boolean>(builtinSnapshot.exists);
  const inFlightCustomSyncRef = useRef<number>(0);
  const metaRef = useRef<WrongBookMetaStore>(meta);
  metaRef.current = meta;

  const syncBuiltinFromLocalStorage = useCallback(() => {
    const { available, raw } = readScopedBuiltinRaw(scope);
    if (!available) {
      if (lastBuiltinAvailableRef.current) {
        lastBuiltinAvailableRef.current = false;
        lastBuiltinRawRef.current = null;
        setBuiltinSnapshot({ available: false, exists: false, raw: null, store: null });
      }
      return;
    }
    if (lastBuiltinAvailableRef.current && raw === lastBuiltinRawRef.current) {
      return;
    }
    lastBuiltinAvailableRef.current = true;
    lastBuiltinRawRef.current = raw;
    if (raw === null) {
      setBuiltinSnapshot({ available: true, exists: false, raw: null, store: null });
      return;
    }
    hadBuiltinKeyRef.current = true;
    setBuiltinSnapshot({
      available: true,
      exists: true,
      raw,
      store: loadStore(scope),
    });
  }, [scope]);

  // Reset per-scope state when PracticeScope changes
  useEffect(() => {
    const initialBuiltin = readScopedBuiltinLocalStorage(scope);
    lastBuiltinAvailableRef.current = initialBuiltin.available;
    lastBuiltinRawRef.current = initialBuiltin.raw;
    hadBuiltinKeyRef.current = initialBuiltin.exists;
    setBuiltinSnapshot(initialBuiltin);
    setMeta(loadWrongBookMeta(scope));
  }, [scope]);

  // Keep reconciled state fresh across same-tab App.tsx updates, storage events, focus, and hash changes
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === practiceStorageKey(STORAGE_KEY, scope)) {
        if (e.key !== null && e.newValue === null) {
          hadBuiltinKeyRef.current = true;
        }
        syncBuiltinFromLocalStorage();
      }
      if (e.key === null || e.key === practiceStorageKey(WRONG_BOOK_META_KEY, scope)) {
        setMeta(loadWrongBookMeta(scope));
      }
    };

    const onBuiltinSynced = (e: Event) => {
      const detail = (e as CustomEvent<{ scope: PracticeScope; store: UserStore }>).detail;
      if (detail?.scope !== scope) return;
      const latest = readScopedBuiltinLocalStorage(scope);
      lastBuiltinAvailableRef.current = latest.available;
      lastBuiltinRawRef.current = latest.raw;
      if (latest.exists) {
        hadBuiltinKeyRef.current = true;
      }
      setBuiltinSnapshot({
        available: latest.available,
        exists: latest.exists,
        raw: latest.raw,
        store: latest.exists ? latest.store : null,
      });
    };

    const onMetaSynced = (e: Event) => {
      const detail = (e as CustomEvent<{ scope: PracticeScope; meta: WrongBookMetaStore }>).detail;
      if (detail?.scope !== scope) return;
      setMeta(detail.meta);
    };

    const onFocusOrRoute = () => {
      syncBuiltinFromLocalStorage();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncBuiltinFromLocalStorage();
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(BUILTIN_PROGRESS_SYNCED_EVENT, onBuiltinSynced);
    window.addEventListener(WRONG_BOOK_META_SYNCED_EVENT, onMetaSynced);
    window.addEventListener('focus', onFocusOrRoute);
    window.addEventListener('hashchange', onFocusOrRoute);
    window.addEventListener('pointerdown', onFocusOrRoute, true);
    window.addEventListener('keyup', onFocusOrRoute, true);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(BUILTIN_PROGRESS_SYNCED_EVENT, onBuiltinSynced);
      window.removeEventListener(WRONG_BOOK_META_SYNCED_EVENT, onMetaSynced);
      window.removeEventListener('focus', onFocusOrRoute);
      window.removeEventListener('hashchange', onFocusOrRoute);
      window.removeEventListener('pointerdown', onFocusOrRoute, true);
      window.removeEventListener('keyup', onFocusOrRoute, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [scope, syncBuiltinFromLocalStorage]);

  const refresh = useCallback(() => {
    syncBuiltinFromLocalStorage();
    setMeta(loadWrongBookMeta(scope));
    notifyBankLibrarySynced(scope);
  }, [scope, syncBuiltinFromLocalStorage]);

  const isBuiltinWipedAuthoritative = useCallback(
    (available: boolean, exists: boolean): boolean => {
      if (!available || exists) return false;
      return !isAccountPracticeScope(scope) || hadBuiltinKeyRef.current;
    },
    [scope],
  );

  const reconciledProgress = useMemo<Record<string, UserStore>>(() => {
    const next: Record<string, UserStore> = { ...library.progressByBank };
    if (builtinSnapshot.exists && builtinSnapshot.store) {
      next[BUILTIN_AI_BANK_ID] = builtinSnapshot.store;
    } else if (isBuiltinWipedAuthoritative(builtinSnapshot.available, builtinSnapshot.exists)) {
      next[BUILTIN_AI_BANK_ID] = createEmptyStore();
    }
    return next;
  }, [builtinSnapshot, isBuiltinWipedAuthoritative, library.progressByBank]);

  // Synchronize meta with newly observed wrong timestamps (without double-counting)
  useEffect(() => {
    if (!library.ready) return;
    const { meta: synced, changed } = syncWrongBookMetaWithBanks(
      metaRef.current,
      library.switchableBanks,
      reconciledProgress,
    );
    if (changed) {
      metaRef.current = synced;
      setMeta(synced);
      saveWrongBookMeta(synced, scope);
      notifyMetaSynced(scope, synced);
    }
  }, [library.switchableBanks, library.ready, reconciledProgress, scope]);

  const allItems = useMemo<WrongBookItem[]>(() => {
    return collectWrongBookItems(library.switchableBanks, reconciledProgress, meta);
  }, [library.switchableBanks, meta, reconciledProgress]);

  const recordRetryWrong = useCallback(
    async (
      bankId: string,
      question: Question,
      choiceOrLevel: number | number[] | boolean | MasteryLevel,
    ): Promise<void> => {
      const now = Date.now();
      const nextMeta = recordRetryWrongInMeta(
        metaRef.current,
        bankId,
        question,
        typeof choiceOrLevel === 'number' &&
          (question.type === 'short' || question.type === 'analysis')
          ? undefined
          : (choiceOrLevel as number | number[] | boolean),
        now,
      );
      metaRef.current = nextMeta;
      setMeta(nextMeta);
      saveWrongBookMeta(nextMeta, scope);
      notifyMetaSynced(scope, nextMeta);

      const updatedStore = library.storeApiFor(bankId).update((prev) => {
        if (bankId === BUILTIN_AI_BANK_ID) {
          const latestLocal = readScopedBuiltinLocalStorage(scope);
          const base =
            latestLocal.exists && latestLocal.store
              ? latestLocal.store
              : isBuiltinWipedAuthoritative(latestLocal.available, latestLocal.exists)
                ? createEmptyStore()
                : prev;
          return recordRetryWrongInStore(base, question, choiceOrLevel, now);
        }
        return recordRetryWrongInStore(prev, question, choiceOrLevel, now);
      });

      if (bankId === BUILTIN_AI_BANK_ID) {
        const latest = readScopedBuiltinLocalStorage(scope);
        lastBuiltinAvailableRef.current = latest.available;
        lastBuiltinRawRef.current = latest.raw;
        if (latest.exists) {
          hadBuiltinKeyRef.current = true;
        }
        setBuiltinSnapshot({
          available: latest.available,
          exists: latest.exists,
          raw: latest.raw,
          store: latest.exists ? latest.store : null,
        });
      } else {
        inFlightCustomSyncRef.current += 1;
        try {
          await getBankDb(scope).saveBankProgress(bankId, updatedStore);
        } finally {
          inFlightCustomSyncRef.current = Math.max(0, inFlightCustomSyncRef.current - 1);
          if (inFlightCustomSyncRef.current === 0) {
            notifyBankLibrarySynced(scope);
          }
        }
      }
    },
    [isBuiltinWipedAuthoritative, library, scope],
  );

  const markMastered = useCallback(
    async (bankId: string, question: Question): Promise<void> => {
      const now = Date.now();
      const updatedStore = library.storeApiFor(bankId).update((prev) => {
        if (bankId === BUILTIN_AI_BANK_ID) {
          const latestLocal = readScopedBuiltinLocalStorage(scope);
          const base =
            latestLocal.exists && latestLocal.store
              ? latestLocal.store
              : isBuiltinWipedAuthoritative(latestLocal.available, latestLocal.exists)
                ? createEmptyStore()
                : prev;
          return markQuestionMasteredInStore(base, question, now);
        }
        return markQuestionMasteredInStore(prev, question, now);
      });

      if (bankId === BUILTIN_AI_BANK_ID) {
        const latest = readScopedBuiltinLocalStorage(scope);
        lastBuiltinAvailableRef.current = latest.available;
        lastBuiltinRawRef.current = latest.raw;
        if (latest.exists) {
          hadBuiltinKeyRef.current = true;
        }
        setBuiltinSnapshot({
          available: latest.available,
          exists: latest.exists,
          raw: latest.raw,
          store: latest.exists ? latest.store : null,
        });
      } else {
        inFlightCustomSyncRef.current += 1;
        try {
          await getBankDb(scope).saveBankProgress(bankId, updatedStore);
        } finally {
          inFlightCustomSyncRef.current = Math.max(0, inFlightCustomSyncRef.current - 1);
          if (inFlightCustomSyncRef.current === 0) {
            notifyBankLibrarySynced(scope);
          }
        }
      }
    },
    [isBuiltinWipedAuthoritative, library, scope],
  );

  return {
    scope,
    ready: library.ready,
    banks: library.switchableBanks,
    items: allItems,
    refresh,
    recordRetryWrong,
    markMastered,
  };
}
