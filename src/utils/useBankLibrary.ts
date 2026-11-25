import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEmptyStore } from '../core/storage';
import type { StoreApi } from '../hooks/usePersistentStore';
import type { UserStore } from '../types/quiz';
import { BUILTIN_AI_BANK, buildBankViewModel, type BankViewModel } from './bankCatalog';
import {
  createCustomBank,
  deleteCustomBank,
  initBankDb,
  renameCustomBank,
  resetBankProgress,
  saveBankProgress,
  setActiveBankId as persistActiveBankId,
  type CreateCustomBankInput,
} from './bankDb';
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
    void initBankDb(BUILTIN_AI_BANK).then((res) => {
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
          void saveBankProgress(dirtyId, nextProgress[dirtyId]!);
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
    return () => {
      cancelled = true;
    };
  }, []);

  const getProgressFor = useCallback((bankId: string): UserStore => {
    return progressRef.current[bankId] ?? createEmptyStore();
  }, []);

  const commitFor = useCallback((bankId: string, next: UserStore): boolean => {
    dirtyProgressRef.current.add(bankId);
    const nextMap = { ...progressRef.current, [bankId]: next };
    progressRef.current = nextMap;
    setProgressByBank(nextMap);
    void saveBankProgress(bankId, next);
    return true;
  }, []);

  const updateFor = useCallback(
    (bankId: string, fn: (prev: UserStore) => UserStore): UserStore => {
      const current = progressRef.current[bankId] ?? createEmptyStore();
      const next = fn(current);
      commitFor(bankId, next);
      return next;
    },
    [commitFor],
  );

  const wipeFor = useCallback((bankId: string): void => {
    dirtyProgressRef.current.add(bankId);
    const empty = createEmptyStore();
    const nextMap = { ...progressRef.current, [bankId]: empty };
    progressRef.current = nextMap;
    setProgressByBank(nextMap);
    void resetBankProgress(bankId);
  }, []);

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
    await persistActiveBankId(targetId);
  }, []);

  const importNewBank = useCallback(
    async (input: CreateCustomBankInput, activate = true): Promise<BankRecord> => {
      const created = await createCustomBank(input);
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
        await persistActiveBankId(created.id);
      }

      return created;
    },
    [],
  );

  const renameBank = useCallback(
    async (bankId: string, name: string, description?: string): Promise<boolean> => {
      const updated = await renameCustomBank(bankId, name, description);
      if (!updated) return false;
      const nextBanks = sortLibraryBanks(
        banksRef.current.map((b) => (b.id === bankId ? updated : b)),
      );
      banksRef.current = nextBanks;
      setBanks(nextBanks);
      return true;
    },
    [],
  );

  const deleteBank = useCallback(async (bankId: string): Promise<boolean> => {
    const ok = await deleteCustomBank(bankId);
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
      await persistActiveBankId(BUILTIN_AI_BANK_ID);
    }
    return true;
  }, []);

  const clearBankProgress = useCallback(
    async (bankId: string): Promise<void> => {
      wipeFor(bankId);
    },
    [wipeFor],
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
