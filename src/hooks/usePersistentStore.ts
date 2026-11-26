import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserStore } from '../types/quiz';
import { STORAGE_KEY, loadStore, resetStore, saveStore } from '../core/storage';
import {
  BUILTIN_PROGRESS_SYNCED_EVENT,
  isAccountPracticeScope,
  practiceStorageKey,
  type PracticeScope,
} from '../core/practiceScope';
import { usePracticeScope } from './practiceScope';
import { getBankDb } from '../utils/bankDb';
import { BUILTIN_AI_BANK_ID } from '../utils/quizImportTypes';
import { queueCloudProgressSave, syncCloudProgressReset } from '../services/cloudSync';

export interface StoreApi {
  store: UserStore;
  /** Always-current snapshot (safe inside rapid successive event handlers). */
  getStore: () => UserStore;
  /** Replace the store, persisting it to localStorage (failures are swallowed by saveStore). */
  commit: (next: UserStore) => boolean;
  update: (fn: (prev: UserStore) => UserStore) => UserStore;
  /** Wipe persisted progress entirely. */
  wipe: () => void;
}

export function usePersistentStore(): StoreApi {
  const scope = usePracticeScope();
  const [store, setStore] = useState<UserStore>(() => loadStore(scope));
  const ref = useRef<UserStore>(store);

  const commit = useCallback((next: UserStore) => {
    ref.current = next;
    const ok = saveStore(next, scope);
    setStore(next);
    if (isAccountPracticeScope(scope)) {
      void getBankDb(scope).saveBankProgress(BUILTIN_AI_BANK_ID, next);
      queueCloudProgressSave(scope, BUILTIN_AI_BANK_ID, next);
    }
    return ok;
  }, [scope]);

  const update = useCallback(
    (fn: (prev: UserStore) => UserStore) => {
      const next = fn(ref.current);
      commit(next);
      return next;
    },
    [commit],
  );

  const wipe = useCallback(() => {
    const empty = resetStore(scope);
    ref.current = empty;
    setStore(empty);
    if (isAccountPracticeScope(scope)) {
      void getBankDb(scope).resetBankProgress(BUILTIN_AI_BANK_ID);
      void syncCloudProgressReset(scope, BUILTIN_AI_BANK_ID);
    }
  }, [scope]);

  const getStore = useCallback(() => ref.current, []);

  // Keep multiple open tabs and cloud sync updates in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== practiceStorageKey(STORAGE_KEY, scope)) return;
      const next = loadStore(scope);
      ref.current = next;
      setStore(next);
    };
    const onSynced = (e: Event) => {
      const detail = (e as CustomEvent<{ scope: PracticeScope; store: UserStore }>).detail;
      if (detail?.scope !== scope) return;
      ref.current = detail.store;
      setStore(detail.store);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(BUILTIN_PROGRESS_SYNCED_EVENT, onSynced);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(BUILTIN_PROGRESS_SYNCED_EVENT, onSynced);
    };
  }, [scope]);

  return { store, getStore, commit, update, wipe };
}
