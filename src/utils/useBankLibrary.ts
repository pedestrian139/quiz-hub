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
  queueCloudBankUpdate,
  queueCloudProgressSave,
  syncCloudBankCreate,
  syncCloudBankDelete,
  syncCloudBankUpdate,
  syncCloudProgressReset,
} from '../services/cloudSync';
import type { UserStore } from '../types/quiz';
import { BUILTIN_AI_BANK, BUILTIN_GUIDE_BANK, buildBankViewModel, type BankViewModel } from './bankCatalog';
import { getBankDb, type CreateCustomBankInput } from './bankDb';
import { BUILTIN_AI_BANK_ID, BUILTIN_GUIDE_BANK_ID, isBuiltinBankId, type BankRecord } from './quizImportTypes';

export interface BankLibraryApi {
  ready: boolean;
  loading: boolean;
  error: string | null;
  migratedFromV1: boolean;
  banks: BankRecord[];
  switchableBanks: BankRecord[];
  activeBank: BankRecord;
  activeBankId: string;
  activeViewModel: BankViewModel;
  progressByBank: Record<string, UserStore>;
  getProgressFor: (bankId: string) => UserStore;
  storeApiFor: (bankId: string) => StoreApi;
  switchBank: (bankId: string) => Promise<void>;
  selectBank: (bankId: string) => Promise<void>;
  importNewBank: (input: CreateCustomBankInput, activate?: boolean) => Promise<BankRecord>;
  saveBank: (bank: BankRecord) => Promise<BankRecord>;
  renameBank: (bankId: string, name: string, description?: string) => Promise<boolean>;
  deleteBank: (bankId: string) => Promise<boolean>;
  clearBankProgress: (bankId: string) => Promise<void>;
  updateActiveProgress: (fn: (prev: UserStore) => UserStore) => UserStore;
  saveQuestionAiAnalysis: (
    bankId: string,
    questionId: string,
    content: string,
    model?: string,
  ) => Promise<void>;
}

function sortLibraryBanks(customBanks: BankRecord[]): BankRecord[] {
  const customSorted = [...customBanks]
    .filter((b) => !isBuiltinBankId(b.id) && !b.builtin)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  return [BUILTIN_GUIDE_BANK, ...customSorted];
}

const HISTORICAL_BANK_IDS = [BUILTIN_AI_BANK_ID];

function canRestoreLegacyBank(scope: PracticeScope, store: UserStore | undefined): boolean {
  return isAccountPracticeScope(scope) && Boolean(store && BUILTIN_AI_BANK.data.questions.some(({ id }) =>
    Object.hasOwn(store.records, id) || store.fav[id] === true || Object.hasOwn(store.mastery, id),
  ));
}

export function useBankLibrary(): BankLibraryApi {
  const scope = usePracticeScope();
  const bankDb = getBankDb(scope);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migratedFromV1, setMigratedFromV1] = useState(false);
  const [banks, setBanks] = useState<BankRecord[]>(() => [BUILTIN_GUIDE_BANK]);
  const [activeBankId, setActiveBankIdState] = useState<string>(BUILTIN_GUIDE_BANK_ID);
  const [progressByBank, setProgressByBank] = useState<Record<string, UserStore>>(() => ({
    [BUILTIN_GUIDE_BANK_ID]: createEmptyStore(),
  }));

  const activeBankIdRef = useRef<string>(activeBankId);
  const progressRef = useRef<Record<string, UserStore>>(progressByBank);
  const banksRef = useRef<BankRecord[]>(banks);
  const dirtyProgressRef = useRef<Set<string>>(new Set());
  const bankWriteQueuesRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const activeTouchedRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    void bankDb
      .initBankDb(BUILTIN_GUIDE_BANK, HISTORICAL_BANK_IDS)
      .then((res) => {
        if (cancelled) return;
        setError(null);

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
        const nextActive = validIds.has(res.activeBankId) ||
          (res.activeBankId === BUILTIN_AI_BANK_ID && canRestoreLegacyBank(scope, nextProgress[BUILTIN_AI_BANK_ID]))
          ? res.activeBankId
          : BUILTIN_GUIDE_BANK_ID;
        activeBankIdRef.current = nextActive;
        setActiveBankIdState(nextActive);
      }

      if (res.migratedFromV1) {
        setMigratedFromV1(true);
      }
      setReady(true);
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : '加载本地题库失败');
      setReady(true);
    });

    const onBankLibrarySynced = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: PracticeScope }>).detail;
      if (detail?.scope !== scope) return;
      void bankDb.initBankDb(BUILTIN_GUIDE_BANK, HISTORICAL_BANK_IDS).then((res) => {
        if (cancelled) return;
        const syncedById = new Map(res.banks.map((b) => [b.id, b]));
        for (const [queuedId] of bankWriteQueuesRef.current) {
          const inFlight = banksRef.current.find((b) => b.id === queuedId);
          if (inFlight) {
            syncedById.set(queuedId, inFlight);
          } else {
            syncedById.delete(queuedId);
          }
        }
        const syncedBanks = sortLibraryBanks(Array.from(syncedById.values()));
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
        if (!validIds.has(activeBankIdRef.current) &&
          !(activeBankIdRef.current === BUILTIN_AI_BANK_ID && canRestoreLegacyBank(scope, nextProgress[BUILTIN_AI_BANK_ID]))) {
          activeBankIdRef.current = BUILTIN_GUIDE_BANK_ID;
          setActiveBankIdState(BUILTIN_GUIDE_BANK_ID);
        }
      }).catch(() => {
        if (!cancelled) setError('无法更新本机题库，请刷新后重试。');
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
      mountedRef.current = false;
      window.removeEventListener(BANK_LIBRARY_SYNCED_EVENT, onBankLibrarySynced);
      window.removeEventListener(BUILTIN_PROGRESS_SYNCED_EVENT, onBuiltinSynced);
    };
  }, [bankDb, scope]);

  const getProgressFor = useCallback((bankId: string): UserStore => {
    return progressRef.current[bankId] ?? createEmptyStore();
  }, []);

  const persistProgressFor = useCallback((bankId: string, next: UserStore, requireStorage = false): Promise<boolean> => {
    dirtyProgressRef.current.add(bankId);
    const nextMap = { ...progressRef.current, [bankId]: next };
    progressRef.current = nextMap;
    setProgressByBank(nextMap);
    const saved = bankDb.saveBankProgress(bankId, next, requireStorage);
    if (bankId === BUILTIN_AI_BANK_ID) {
      saveStore(next, scope);
      notifyBuiltinProgressSynced(scope, next);
    }
    if (isAccountPracticeScope(scope)) {
      queueCloudProgressSave(scope, bankId, next);
    }
    return saved;
  }, [bankDb, scope]);

  const commitFor = useCallback((bankId: string, next: UserStore): boolean => {
    void persistProgressFor(bankId, next);
    return true;
  }, [persistProgressFor]);

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
      if (activeBankIdRef.current === bankId) {
        activeBankIdRef.current = BUILTIN_GUIDE_BANK_ID;
        setActiveBankIdState(BUILTIN_GUIDE_BANK_ID);
        void bankDb.setActiveBankId(BUILTIN_GUIDE_BANK_ID);
      }
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
    const exists = banksRef.current.some((b) => b.id === bankId) ||
      (bankId === BUILTIN_AI_BANK_ID && canRestoreLegacyBank(scope, progressRef.current[bankId]));
    const targetId = exists ? bankId : BUILTIN_GUIDE_BANK_ID;
    activeTouchedRef.current = true;
    activeBankIdRef.current = targetId;
    setActiveBankIdState(targetId);
    if (!progressRef.current[targetId]) {
      const nextMap = { ...progressRef.current, [targetId]: createEmptyStore() };
      progressRef.current = nextMap;
      setProgressByBank(nextMap);
    }
    await bankDb.setActiveBankId(targetId);
  }, [bankDb, scope]);

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

  const enqueueBankJob = useCallback(<T>(bankId: string, task: () => Promise<T>): Promise<T> => {
    const prev = bankWriteQueuesRef.current.get(bankId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    bankWriteQueuesRef.current.set(bankId, next);
    return next.finally(() => {
      if (bankWriteQueuesRef.current.get(bankId) === next) {
        bankWriteQueuesRef.current.delete(bankId);
      }
    });
  }, []);

  const saveBank = useCallback(
    async (bank: BankRecord): Promise<BankRecord> => {
      if (isBuiltinBankId(bank.id) || bank.builtin) {
        throw new Error('Cannot overwrite built-in example bank');
      }

      return enqueueBankJob(bank.id, async () => {
        const latest = banksRef.current.find((b) => b.id === bank.id);
        const optimistic: BankRecord = {
          ...bank,
          builtin: false,
          updatedAt: Math.max(Date.now(), bank.updatedAt || 0, (latest?.updatedAt ?? 0) + 1),
        };
        const nextBanks = sortLibraryBanks(
          latest
            ? banksRef.current.map((b) => (b.id === optimistic.id ? optimistic : b))
            : [...banksRef.current, optimistic],
        );
        banksRef.current = nextBanks;
        setBanks(nextBanks);

        const saved = await bankDb.saveCustomBank(optimistic);
        const syncedList = sortLibraryBanks(
          banksRef.current.some((b) => b.id === saved.id)
            ? banksRef.current.map((b) => (b.id === saved.id ? saved : b))
            : [...banksRef.current, saved],
        );
        banksRef.current = syncedList;
        setBanks(syncedList);
        if (isAccountPracticeScope(scope)) {
          queueCloudBankUpdate(scope, saved);
        }
        return saved;
      });
    },
    [bankDb, enqueueBankJob, scope],
  );

  const renameBank = useCallback(
    async (bankId: string, name: string, description?: string): Promise<boolean> => {
      if (isBuiltinBankId(bankId)) {
        return false;
      }
      const trimmed = name.trim();
      if (!trimmed) {
        return false;
      }

      return enqueueBankJob(bankId, async () => {
        let target = banksRef.current.find((b) => b.id === bankId);
        if (!target) {
          const fromDb = await bankDb.listCustomBanks();
          target = fromDb.find((b) => b.id === bankId);
        }
        if (!target || target.builtin) {
          return false;
        }

        const patched: BankRecord = {
          ...target,
          name: trimmed,
          description:
            description !== undefined ? description.trim() || undefined : target.description,
          updatedAt: Math.max(Date.now(), target.updatedAt + 1),
          data: {
            ...target.data,
            meta: {
              ...target.data.meta,
              title: trimmed,
            },
          },
        };
        const nextBanks = sortLibraryBanks(
          banksRef.current.some((b) => b.id === bankId)
            ? banksRef.current.map((b) => (b.id === bankId ? patched : b))
            : [...banksRef.current, patched],
        );
        banksRef.current = nextBanks;
        setBanks(nextBanks);

        const saved = await bankDb.saveCustomBank(patched);
        const syncedList = sortLibraryBanks(
          banksRef.current.some((b) => b.id === saved.id)
            ? banksRef.current.map((b) => (b.id === saved.id ? saved : b))
            : [...banksRef.current, saved],
        );
        banksRef.current = syncedList;
        setBanks(syncedList);
        if (isAccountPracticeScope(scope)) {
          await syncCloudBankUpdate(scope, saved);
        }
        return true;
      });
    },
    [bankDb, enqueueBankJob, scope],
  );

  const deleteBank = useCallback(async (bankId: string): Promise<boolean> => {
    if (isBuiltinBankId(bankId)) {
      return false;
    }
    return enqueueBankJob(bankId, async () => {
      const ok = await bankDb.deleteCustomBank(bankId);

      const nextBanks = banksRef.current.filter((b) => b.id !== bankId);
      banksRef.current = nextBanks;
      setBanks(nextBanks);

      if (!ok) return false;

      const nextProgress = { ...progressRef.current };
      delete nextProgress[bankId];
      progressRef.current = nextProgress;
      setProgressByBank(nextProgress);

      if (activeBankIdRef.current === bankId) {
        activeTouchedRef.current = true;
        activeBankIdRef.current = BUILTIN_GUIDE_BANK_ID;
        setActiveBankIdState(BUILTIN_GUIDE_BANK_ID);
        await bankDb.setActiveBankId(BUILTIN_GUIDE_BANK_ID);
      }
      if (isAccountPracticeScope(scope)) {
        await syncCloudBankDelete(scope, bankId);
      }
      return true;
    });
  }, [bankDb, enqueueBankJob, scope]);

  const clearBankProgress = useCallback(
    async (bankId: string): Promise<void> => {
      wipeLocalFor(bankId);
      if (isAccountPracticeScope(scope)) {
        await syncCloudProgressReset(scope, bankId);
      }
    },
    [scope, wipeLocalFor],
  );

  const updateActiveProgress = useCallback(
    (fn: (prev: UserStore) => UserStore): UserStore => {
      return updateFor(activeBankIdRef.current, fn);
    },
    [updateFor],
  );

  const saveQuestionAiAnalysis = useCallback(
    async (
      bankId: string,
      questionId: string,
      content: string,
      model?: string,
    ): Promise<void> => {
      const trimmed = content.trim();
      if (!trimmed || !mountedRef.current) return;

      if (isBuiltinBankId(bankId)) {
        const cleanModel = model?.trim() || undefined;
        const prev = progressRef.current[bankId] ?? createEmptyStore();
        const saved = await persistProgressFor(bankId, {
          ...prev,
          aiExplanations: {
            ...(prev.aiExplanations ?? {}),
            [questionId]: {
              content,
              updatedAt: Date.now(),
              ...(cleanModel ? { model: cleanModel } : {}),
            },
          },
        }, true);
        if (!saved) throw new Error('无法保存本机解析。');
        return;
      }

      await enqueueBankJob(bankId, async () => {
        const latestInRef = banksRef.current.find((b) => b.id === bankId);
        if (!mountedRef.current) return;
        if (!latestInRef || latestInRef.builtin) throw new Error('题库已不存在。');

        let changed = false;
        const nextQuestions = latestInRef.data.questions.map((q) => {
          if (q.id !== questionId) return q;
          changed = true;
          return {
            ...q,
            aiAnalysis: content,
            explanation: q.explanation && q.explanation.trim().length > 0 ? q.explanation : content,
          };
        });
        if (!changed) throw new Error('题目已不存在。');

        const nextBank: BankRecord = {
          ...latestInRef,
          updatedAt: Math.max(Date.now(), latestInRef.updatedAt + 1),
          data: {
            ...latestInRef.data,
            questions: nextQuestions,
          },
        };

        const saved = await bankDb.saveCustomBank(nextBank, { requireStorage: true });
        if (!mountedRef.current) return;
        const syncedList = sortLibraryBanks(
          banksRef.current.map((b) => (b.id === saved.id ? saved : b)),
        );
        banksRef.current = syncedList;
        setBanks(syncedList);
        if (isAccountPracticeScope(scope)) {
          queueCloudBankUpdate(scope, saved);
        }
      });
    },
    [bankDb, enqueueBankJob, persistProgressFor, scope],
  );

  const legacyAvailable = canRestoreLegacyBank(scope, progressByBank[BUILTIN_AI_BANK_ID]);
  const switchableBanks = useMemo(
    () => legacyAvailable ? [...banks, BUILTIN_AI_BANK] : banks,
    [banks, legacyAvailable],
  );
  const activeBank = useMemo(
    () => switchableBanks.find((b) => b.id === activeBankId) ?? BUILTIN_GUIDE_BANK,
    [activeBankId, switchableBanks],
  );

  const activeViewModel = useMemo(() => buildBankViewModel(activeBank), [activeBank]);

  return {
    ready,
    loading: !ready,
    error,
    migratedFromV1,
    banks,
    switchableBanks,
    activeBank,
    activeBankId: activeBank.id,
    activeViewModel,
    progressByBank,
    getProgressFor,
    storeApiFor,
    switchBank,
    selectBank: switchBank,
    importNewBank,
    saveBank,
    renameBank,
    deleteBank,
    clearBankProgress,
    updateActiveProgress,
    saveQuestionAiAnalysis,
  };
}
