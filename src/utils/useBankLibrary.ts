import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BANK_LIBRARY_SYNCED_EVENT,
  BUILTIN_PROGRESS_SYNCED_EVENT,
  isAccountPracticeScope,
  notifyBuiltinProgressSynced,
  type PracticeScope,
} from '../core/practiceScope';
import { createEmptyStore, resetStore, saveStore } from '../core/storage';
import type { StoreApi } from '../hooks/usePersistentStore';
import { usePracticeScope } from '../hooks/practiceScope';
import {
  queueCloudProgressSave,
  syncCloudBankCreate,
  syncCloudBankDelete,
  syncCloudBankUpdate,
  syncCloudProgressReset,
} from '../services/cloudSync';
import type { UserStore } from '../types/quiz';
import { BUILTIN_AI_BANK, buildBankViewModel, type BankViewModel } from './bankCatalog';
import { getBankDb, type CreateCustomBankInput } from './bankDb';
import { BUILTIN_AI_BANK_ID, type BankRecord } from './quizImportTypes';

export interface BankLibraryApi {
  ready: boolean;
  migratedFromV1: boolean;
  banks: BankRecord[];
  activeBank: BankRecord;
  activeBankId: string;
  activeViewModel: BankViewModel;
  progressByBank: Record<string, UserStore>;
  getProgressFor: (bankId: string) => UserStore;
  storeApiFor: (bankId: string) => StoreApi;
  switchBank: (bankId: string) => Promise<void>;
  importNewBank: (input: CreateCustomBankInput, activate?: boolean) => Promise<BankRecord>;
  renameBank: (bankId: string, name: string, description?: string) => Promise<boolean>;
  deleteBank: (bankId: string) => Promise<boolean>;
  clearBankProgress: (bankId: string) => Promise<void>;
}

function sortLibraryBanks(customBanks: BankRecord[]): BankRecord[] {
  const customSorted = [...customBanks]
    .filter((b) => b.id !== BUILTIN_AI_BANK_ID && !b.builtin)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  return [BUILTIN_AI_BANK, ...customSorted];
}

export function useBankLibrary(): BankLibraryApi {
  const scope = usePracticeScope();
  const bankDb = getBankDb(scope);
  const [ready, setReady] = useState(false);
  const [migratedFromV1, setMigratedFromV1] = useState(false);
  const [banks, setBanks] = useState<BankRecord[]>(() => [BUILTIN_AI_BANK]);
  const [activeBankId, setActiveBankIdState] = useState<string>(BUILTIN_AI_BANK_ID);
  const [progressByBank, setProgressByBank] = useState<Record<string, UserStore>>(() => ({
    [BUILTIN_AI_BANK_ID]: createEmptyStore(),
  }));

  const activeBankIdRef = useRef<string>(activeBankId);
  const progressRef = useRef<Record<string, UserStore>>(progressByBank);
  const banksRef = useRef<BankRecord[]>(banks);
  const dirtyProgressRef = useRef<Set<string>>(new Set());
  const activeTouchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void bankDb.initBankDb(BUILTIN_AI_BANK).then((res) => {
      if (cancelled) return;

      const mergedBanksMap = new Map<string, BankRecord>();
      for (const b of res.banks) {
        mergedBanksMap.set(b.id, b);
      }
      for (const b of banksRef.current) {
        if (!mergedBanksMap.has(b.id)) {
          mergedBanksMap.set(b.id, b);
        }
      }
      const nextBanks = sortLibraryBanks(Array.from(mergedBanksMap.values()));
      banksRef.current = nextBanks;
      setBanks(nextBanks);

      const nextProgress: Record<string, UserStore> = { ...res.progressByBank };
      for (const dirtyId of dirtyProgressRef.current) {
        if (progressRef.current[dirtyId]) {
          nextProgress[dirtyId] = progressRef.current[dirtyId]!;
          void bankDb.saveBankProgress(dirtyId, nextProgress[dirtyId]!);
        }
      }
      for (const b of nextBanks) {
        if (!nextProgress[b.id]) {
          nextProgress[b.id] = createEmptyStore();
        }
      }
      progressRef.current = nextProgress;
      setProgressByBank(nextProgress);

      if (!activeTouchedRef.current) {
        const validIds = new Set(nextBanks.map((b) => b.id));
        const nextActive = validIds.has(res.activeBankId)
          ? res.activeBankId
          : BUILTIN_AI_BANK_ID;
        activeBankIdRef.current = nextActive;
        setActiveBankIdState(nextActive);
      }

      if (res.migratedFromV1) {
        setMigratedFromV1(true);
      }
      setReady(true);
    });

    const onBankLibrarySynced = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: PracticeScope }>).detail;
      if (detail?.scope !== scope) return;
      void bankDb.initBankDb(BUILTIN_AI_BANK).then((res) => {
        if (cancelled) return;
        const syncedBanks = sortLibraryBanks(res.banks);
        banksRef.current = syncedBanks;
        setBanks(syncedBanks);

        const nextProgress: Record<string, UserStore> = { ...res.progressByBank };
        for (const b of syncedBanks) {
          if (!nextProgress[b.id]) {
            nextProgress[b.id] = createEmptyStore();
          }
        }
        progressRef.current = nextProgress;
        setProgressByBank(nextProgress);

        const validIds = new Set(syncedBanks.map((b) => b.id));
        if (!validIds.has(activeBankIdRef.current)) {
          activeBankIdRef.current = BUILTIN_AI_BANK_ID;
          setActiveBankIdState(BUILTIN_AI_BANK_ID);
        }
      });
    };

    const onBuiltinSynced = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: PracticeScope; store: UserStore }>).detail;
      if (detail?.scope !== scope) return;
      const nextMap = { ...progressRef.current, [BUILTIN_AI_BANK_ID]: detail.store };
      progressRef.current = nextMap;
      setProgressByBank(nextMap);
    };

    window.addEventListener(BANK_LIBRARY_SYNCED_EVENT, onBankLibrarySynced);
    window.addEventListener(BUILTIN_PROGRESS_SYNCED_EVENT, onBuiltinSynced);
    return () => {
      cancelled = true;
      window.removeEventListener(BANK_LIBRARY_SYNCED_EVENT, onBankLibrarySynced);
      window.removeEventListener(BUILTIN_PROGRESS_SYNCED_EVENT, onBuiltinSynced);
    };
  }, [bankDb, scope]);

  const getProgressFor = useCallback((bankId: string): UserStore => {
    return progressRef.current[bankId] ?? createEmptyStore();
  }, []);

  const commitFor = useCallback((bankId: string, next: UserStore): boolean => {
    dirtyProgressRef.current.add(bankId);
    const nextMap = { ...progressRef.current, [bankId]: next };
    progressRef.current = nextMap;
    setProgressByBank(nextMap);
    void bankDb.saveBankProgress(bankId, next);
    if (bankId === BUILTIN_AI_BANK_ID) {
      saveStore(next, scope);
      notifyBuiltinProgressSynced(scope, next);
    }
    if (isAccountPracticeScope(scope)) {
      queueCloudProgressSave(scope, bankId, next);
    }
    return true;
  }, [bankDb, scope]);

  const updateFor = useCallback(
    (bankId: string, fn: (prev: UserStore) => UserStore): UserStore => {
      const current = progressRef.current[bankId] ?? createEmptyStore();
      const next = fn(current);
      commitFor(bankId, next);
      return next;
    },
    [commitFor],
  );

  const wipeLocalFor = useCallback((bankId: string): void => {
    dirtyProgressRef.current.add(bankId);
    const empty = createEmptyStore();
    const nextMap = { ...progressRef.current, [bankId]: empty };
    progressRef.current = nextMap;
    setProgressByBank(nextMap);
    void bankDb.resetBankProgress(bankId);
    if (bankId === BUILTIN_AI_BANK_ID) {
      resetStore(scope);
      notifyBuiltinProgressSynced(scope, empty);
    }
  }, [bankDb, scope]);

  const wipeFor = useCallback((bankId: string): void => {
    wipeLocalFor(bankId);
    if (isAccountPracticeScope(scope)) {
      void syncCloudProgressReset(scope, bankId);
    }
  }, [scope, wipeLocalFor]);

  const storeApiFor = useCallback(
    (bankId: string): StoreApi => ({
      store: progressByBank[bankId] ?? createEmptyStore(),
      getStore: () => getProgressFor(bankId),
      commit: (next) => commitFor(bankId, next),
      update: (fn) => updateFor(bankId, fn),
      wipe: () => wipeFor(bankId),
    }),
    [commitFor, getProgressFor, progressByBank, updateFor, wipeFor],
  );

  const switchBank = useCallback(async (bankId: string): Promise<void> => {
    const exists = banksRef.current.some((b) => b.id === bankId);
    const targetId = exists ? bankId : BUILTIN_AI_BANK_ID;
    activeTouchedRef.current = true;
    activeBankIdRef.current = targetId;
    setActiveBankIdState(targetId);
    if (!progressRef.current[targetId]) {
      const nextMap = { ...progressRef.current, [targetId]: createEmptyStore() };
      progressRef.current = nextMap;
      setProgressByBank(nextMap);
    }
    await bankDb.setActiveBankId(targetId);
  }, [bankDb]);

  const importNewBank = useCallback(
    async (input: CreateCustomBankInput, activate = true): Promise<BankRecord> => {
      const created = await bankDb.createCustomBank(input);
      const nextBanks = sortLibraryBanks([...banksRef.current, created]);
      banksRef.current = nextBanks;
      setBanks(nextBanks);

      const nextProgress = {
        ...progressRef.current,
        [created.id]: createEmptyStore(),
      };
      progressRef.current = nextProgress;
      setProgressByBank(nextProgress);

      if (activate) {
        activeTouchedRef.current = true;
        activeBankIdRef.current = created.id;
        setActiveBankIdState(created.id);
        await bankDb.setActiveBankId(created.id);
      }

      if (isAccountPracticeScope(scope)) {
        await syncCloudBankCreate(scope, created);
      }

      return created;
    },
    [bankDb, scope],
  );

  const renameBank = useCallback(
    async (bankId: string, name: string, description?: string): Promise<boolean> => {
      const updated = await bankDb.renameCustomBank(bankId, name, description);
      if (!updated) return false;
      const nextBanks = sortLibraryBanks(
        banksRef.current.map((b) => (b.id === bankId ? updated : b)),
      );
      banksRef.current = nextBanks;
      setBanks(nextBanks);
      if (isAccountPracticeScope(scope)) {
        await syncCloudBankUpdate(scope, updated);
      }
      return true;
    },
    [bankDb, scope],
  );

  const deleteBank = useCallback(async (bankId: string): Promise<boolean> => {
    const ok = await bankDb.deleteCustomBank(bankId);
    if (!ok) return false;

    const nextBanks = banksRef.current.filter((b) => b.id !== bankId);
    banksRef.current = nextBanks;
    setBanks(nextBanks);

    const nextProgress = { ...progressRef.current };
    delete nextProgress[bankId];
    progressRef.current = nextProgress;
    setProgressByBank(nextProgress);

    if (activeBankIdRef.current === bankId) {
      activeTouchedRef.current = true;
      activeBankIdRef.current = BUILTIN_AI_BANK_ID;
      setActiveBankIdState(BUILTIN_AI_BANK_ID);
      await bankDb.setActiveBankId(BUILTIN_AI_BANK_ID);
    }
    if (isAccountPracticeScope(scope)) {
      await syncCloudBankDelete(scope, bankId);
    }
    return true;
  }, [bankDb, scope]);

  const clearBankProgress = useCallback(
    async (bankId: string): Promise<void> => {
      wipeLocalFor(bankId);
      if (isAccountPracticeScope(scope)) {
        await syncCloudProgressReset(scope, bankId);
      }
    },
    [scope, wipeLocalFor],
  );

  const activeBank = useMemo(
    () => banks.find((b) => b.id === activeBankId) ?? BUILTIN_AI_BANK,
    [activeBankId, banks],
  );

  const activeViewModel = useMemo(() => buildBankViewModel(activeBank), [activeBank]);

  return {
    ready,
    migratedFromV1,
    banks,
    activeBank,
    activeBankId: activeBank.id,
    activeViewModel,
    progressByBank,
    getProgressFor,
    storeApiFor,
    switchBank,
    importNewBank,
    renameBank,
    deleteBank,
    clearBankProgress,
  };
}
