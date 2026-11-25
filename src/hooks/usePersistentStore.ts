import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserStore } from '../types/quiz';
import { STORAGE_KEY, loadStore, resetStore, saveStore } from '../core/storage';
import { practiceStorageKey } from '../core/practiceScope';
import { usePracticeScope } from './practiceScope';

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
  }, [scope]);

  const getStore = useCallback(() => ref.current, []);

  // Keep multiple open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== practiceStorageKey(STORAGE_KEY, scope)) return;
      const next = loadStore(scope);
      ref.current = next;
      setStore(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [scope]);

  return { store, getStore, commit, update, wipe };
}
