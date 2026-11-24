import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserStore } from '../types/quiz';
import { STORAGE_KEY, loadStore, resetStore, saveStore } from '../core/storage';

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
  const [store, setStore] = useState<UserStore>(() => loadStore());
  const ref = useRef<UserStore>(store);

  const commit = useCallback((next: UserStore) => {
    ref.current = next;
    const ok = saveStore(next);
    setStore(next);
    return ok;
  }, []);

  const update = useCallback(
    (fn: (prev: UserStore) => UserStore) => {
      const next = fn(ref.current);
      commit(next);
      return next;
    },
    [commit],
  );

  const wipe = useCallback(() => {
    const empty = resetStore();
    ref.current = empty;
    setStore(empty);
  }, []);

  const getStore = useCallback(() => ref.current, []);

  // Keep multiple open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      const next = loadStore();
      ref.current = next;
      setStore(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { store, getStore, commit, update, wipe };
}
