import { useSyncExternalStore } from 'react';
import {
  accountIdFromScope,
  accountPracticeScope,
  isAccountPracticeScope,
  notifyBankLibrarySynced,
  notifyBuiltinProgressSynced,
  type AccountPracticeScope,
  type PracticeScope,
} from '../core/practiceScope';
import { createEmptyStore, saveStore } from '../core/storage';
import type { UserStore } from '../types/quiz';
import { getBankDb, sanitizeUserStore } from '../utils/bankDb';
import { BUILTIN_AI_BANK_ID, type BankRecord } from '../utils/quizImportTypes';
import {
  clearCloudMemoryApiConfigs,
  clearLocalApiConfigStorage,
  setCloudMemoryApiConfig,
  type ApiConfig,
} from './apiConfig';
import { isDatabaseConfigured } from './db/client';
import {
  clearCloudApiConfig,
  deleteCloudBank,
  listCloudBanks,
  listCloudProgress,
  loadCloudProgress,
  resetCloudProgress,
  restoreCloudApiConfig,
  saveCloudApiConfig,
  saveCloudBank,
  saveCloudProgress,
} from './db/cloudData';

export type CloudSyncStatus = 'idle' | 'hydrating' | 'syncing' | 'synced' | 'error' | 'conflict';

export interface CloudSyncSnapshot {
  accountId: string | null;
  status: CloudSyncStatus;
  message: string | null;
  pendingCount: number;
  lastSyncedAt: number | null;
}

type PendingProgressOp = { kind: 'save'; store: UserStore } | { kind: 'reset' };
type FailedBankOp = { kind: 'save'; bank: BankRecord; create: boolean } | { kind: 'delete'; bankId: string };

const MAX_CONFLICT_RETRIES = 3;
const DEFAULT_DEBOUNCE_MS = 450;

let debounceMs = DEFAULT_DEBOUNCE_MS;
let sessionEpoch = 0;
let apiConfigVersion = 0;
let activeAccountId: string | null = null;
let hydratedAccountId: string | null = null;
let hydrationPromise: Promise<void> | null = null;
let lifecycleListenersRegistered = false;

const bankRevisions = new Map<string, number>();
const progressRevisions = new Map<string, number>();
const lastSyncedProgress = new Map<string, UserStore>();
const pendingProgress = new Map<string, PendingProgressOp>();
const progressTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeProgressFlushes = new Map<string, Promise<void>>();
const activeBankWrites = new Map<string, Promise<void>>();
const failedBankOps = new Map<string, FailedBankOp>();

const listeners = new Set<() => void>();
let snapshot: CloudSyncSnapshot = {
  accountId: null,
  status: 'idle',
  message: null,
  pendingCount: 0,
  lastSyncedAt: null,
};

function emitSnapshot(partial?: Partial<CloudSyncSnapshot>): void {
  snapshot = {
    ...snapshot,
    ...partial,
    accountId: activeAccountId,
    pendingCount: pendingProgress.size + failedBankOps.size,
  };
  for (const listener of listeners) listener();
}

export function getCloudSyncSnapshot(): CloudSyncSnapshot {
  return snapshot;
}

export function subscribeCloudSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCloudSyncState(): CloudSyncSnapshot {
  return useSyncExternalStore(subscribeCloudSync, getCloudSyncSnapshot, getCloudSyncSnapshot);
}

export function setCloudSyncDebounceMs(ms: number): void {
  debounceMs = Math.max(0, ms);
}

export function isRevisionConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === '40001') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /\b40001\b/.test(message);
}

export function isBankNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return code === '42501' && typeof message === 'string' && /Bank not found/i.test(message);
}

export function mergeStoresThreeWay(
  baseInput: UserStore,
  remoteInput: UserStore,
  localInput: UserStore,
  remoteResetAt: string | null,
): UserStore {
  const base = sanitizeUserStore(baseInput);
  const remote = sanitizeUserStore(remoteInput);
  const local = sanitizeUserStore(localInput);
  const resetMs = remoteResetAt ? Date.parse(remoteResetAt) : NaN;

  const records: UserStore['records'] = { ...remote.records };
  for (const [id, localRec] of Object.entries(local.records)) {
    if (Number.isFinite(resetMs) && localRec.ts <= resetMs && !remote.records[id]) {
      continue;
    }
    const remoteRec = remote.records[id];
    if (!remoteRec || localRec.ts >= remoteRec.ts) {
      records[id] = localRec;
    }
  }

  const fav: UserStore['fav'] = {};
  const favIds = new Set([...Object.keys(base.fav), ...Object.keys(remote.fav), ...Object.keys(local.fav)]);
  for (const id of favIds) {
    const inBase = base.fav[id] === true;
    const inRemote = remote.fav[id] === true;
    const inLocal = local.fav[id] === true;
    if (inLocal !== inBase && inRemote === inBase) {
      if (inLocal) fav[id] = true;
    } else if (inRemote !== inBase && inLocal === inBase) {
      if (inRemote) fav[id] = true;
    } else {
      const stalePreReset = Number.isFinite(resetMs) && Boolean(local.records[id]) && local.records[id]!.ts <= resetMs;
      if (inRemote || (inLocal && !stalePreReset)) {
        fav[id] = true;
      }
    }
  }

  const mastery: UserStore['mastery'] = {};
  const masteryIds = new Set([...Object.keys(base.mastery), ...Object.keys(remote.mastery), ...Object.keys(local.mastery)]);
  for (const id of masteryIds) {
    const b = base.mastery[id];
    const r = remote.mastery[id];
    const l = local.mastery[id];
    let picked: 0 | 1 | 2 | undefined;
    if (l !== b && r === b) {
      picked = l;
    } else if (r !== b && l === b) {
      picked = r;
    } else if (l !== undefined && r !== undefined) {
      picked = (local.records[id]?.ts ?? 0) >= (remote.records[id]?.ts ?? 0) ? l : r;
    } else if (r !== undefined) {
      picked = r;
    } else if (l !== undefined) {
      const stalePreReset = Number.isFinite(resetMs) && Boolean(local.records[id]) && local.records[id]!.ts <= resetMs;
      if (!stalePreReset) picked = l;
    }
    if (picked !== undefined) mastery[id] = picked;
  }

  return { records, fav, mastery };
}

function ensureLifecycleListeners(): void {
  if (lifecycleListenersRegistered || typeof window === 'undefined') return;
  lifecycleListenersRegistered = true;
  window.addEventListener('pagehide', () => {
    void flushPendingCloudWrites();
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushPendingCloudWrites();
      }
    });
  }
}

function clearProgressTimer(bankId: string): void {
  const timer = progressTimers.get(bankId);
  if (timer !== undefined) {
    clearTimeout(timer);
    progressTimers.delete(bankId);
  }
}

function writeBuiltinLocalCache(scope: PracticeScope, store: UserStore): void {
  const clean = sanitizeUserStore(store);
  saveStore(clean, scope);
  notifyBuiltinProgressSynced(scope, clean);
}

function settledStatusUpdate(fallbackStatus: CloudSyncStatus = 'synced', message: string | null = null): void {
  if (failedBankOps.size > 0 || pendingProgress.size > 0) {
    return;
  }
  emitSnapshot({
    status: fallbackStatus,
    message,
    lastSyncedAt: Date.now(),
  });
}

function ensureAccountSession(userId: string): void {
  if (activeAccountId !== null && activeAccountId !== userId) {
    clearCloudSyncSession(activeAccountId);
  }
  if (activeAccountId !== userId) {
    activeAccountId = userId;
  }
  ensureLifecycleListeners();
}

export function clearCloudSyncSession(previousAccountId?: string | null): void {
  const targetAccount = previousAccountId ?? activeAccountId;
  sessionEpoch += 1;
  activeAccountId = null;
  hydratedAccountId = null;
  hydrationPromise = null;

  for (const timer of progressTimers.values()) clearTimeout(timer);
  progressTimers.clear();
  pendingProgress.clear();
  failedBankOps.clear();
  bankRevisions.clear();
  progressRevisions.clear();
  lastSyncedProgress.clear();
  activeProgressFlushes.clear();
  activeBankWrites.clear();

  clearCloudMemoryApiConfigs();
  if (targetAccount) {
    clearLocalApiConfigStorage(accountPracticeScope(targetAccount), ['local', 'session']);
  }

  snapshot = {
    accountId: null,
    status: 'idle',
    message: null,
    pendingCount: 0,
    lastSyncedAt: null,
  };
  for (const listener of listeners) listener();
}

export async function hydrateAccountFromCloud(
  userId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  ensureAccountSession(userId);
  if (!options.force) {
    if (hydrationPromise) return hydrationPromise;
    if (hydratedAccountId === userId) return;
  }

  const epoch = sessionEpoch;
  const apiRequest = ++apiConfigVersion;
  const scope = accountPracticeScope(userId);
  const bankDb = getBankDb(scope);

  const run = (async () => {
    emitSnapshot({ status: 'hydrating', message: null });
    const [banksRes, progressRes, apiRes] = await Promise.allSettled([
      listCloudBanks(),
      listCloudProgress(),
      restoreCloudApiConfig(userId),
    ]);
    if (epoch !== sessionEpoch) return;

    let anyRejected = false;
    let banksChanged = false;
    let progressChanged = false;

    if (apiRequest === apiConfigVersion) {
      if (apiRes.status === 'fulfilled') {
        if (apiRes.value) clearLocalApiConfigStorage(scope, ['local']);
        setCloudMemoryApiConfig(scope, apiRes.value);
      } else {
        anyRejected = true;
      }
    }

    if (banksRes.status === 'fulfilled') {
      const cloudIds = new Set<string>();
      const localBanks = await bankDb.listCustomBanks();
      if (epoch !== sessionEpoch) return;

      for (const entry of banksRes.value) {
        cloudIds.add(entry.bank.id);
        bankRevisions.set(entry.bank.id, entry.revision);
        if (failedBankOps.get(entry.bank.id)?.kind === 'delete') continue;
        await bankDb.saveCustomBank(entry.bank);
        if (epoch !== sessionEpoch) return;
        banksChanged = true;
      }

      for (const localBank of localBanks) {
        if (!cloudIds.has(localBank.id) && !failedBankOps.has(localBank.id) && !activeBankWrites.has(localBank.id)) {
          await bankDb.deleteCustomBank(localBank.id);
          if (epoch !== sessionEpoch) return;
          bankRevisions.delete(localBank.id);
          progressRevisions.delete(localBank.id);
          lastSyncedProgress.delete(localBank.id);
          banksChanged = true;
        }
      }
    } else {
      anyRejected = true;
    }

    if (progressRes.status === 'fulfilled') {
      for (const [bankId, entry] of Object.entries(progressRes.value)) {
        if (epoch !== sessionEpoch) return;
        if (failedBankOps.get(bankId)?.kind === 'delete') continue;
        progressRevisions.set(bankId, entry.revision);
        lastSyncedProgress.set(bankId, sanitizeUserStore(entry.store));
        if (entry.revision <= 0) continue;

        const pending = pendingProgress.get(bankId);
        if (pending && pending.kind === 'save') {
          const merged = mergeStoresThreeWay(createEmptyStore(), entry.store, pending.store, entry.resetAt);
          pendingProgress.set(bankId, { kind: 'save', store: merged });
          await bankDb.saveBankProgress(bankId, merged);
          if (epoch !== sessionEpoch) return;
          if (bankId === BUILTIN_AI_BANK_ID) {
            writeBuiltinLocalCache(scope, merged);
          }
          progressChanged = true;
        } else if (!pending) {
          await bankDb.saveBankProgress(bankId, entry.store);
          if (epoch !== sessionEpoch) return;
          if (bankId === BUILTIN_AI_BANK_ID) {
            writeBuiltinLocalCache(scope, entry.store);
          }
          progressChanged = true;
        }
      }
    } else {
      anyRejected = true;
    }

    if (epoch !== sessionEpoch) return;
    if (banksChanged || progressChanged) {
      notifyBankLibrarySynced(scope);
    }

    hydratedAccountId = userId;
    if (anyRejected) {
      emitSnapshot({
        status: 'error',
        message: '部分云端数据读取失败，请点击重试。',
      });
    } else if (failedBankOps.size > 0 || pendingProgress.size > 0) {
      emitSnapshot({ status: snapshot.status === 'conflict' ? 'conflict' : 'syncing' });
    } else {
      emitSnapshot({
        status: 'synced',
        message: null,
        lastSyncedAt: Date.now(),
      });
    }
  })();

  hydrationPromise = run;
  try {
    await run;
  } finally {
    if (hydrationPromise === run) hydrationPromise = null;
  }
}

async function writeAccountApiConfig(scope: AccountPracticeScope, config: ApiConfig | null): Promise<void> {
  const userId = accountIdFromScope(scope);
  if (!userId || (activeAccountId && activeAccountId !== userId)) throw new Error('登录账号已变更，请重新打开 API 设置。');
  ensureAccountSession(userId);
  const epoch = sessionEpoch;
  emitSnapshot({ status: 'syncing', message: null });
  try {
    if (config) await saveCloudApiConfig(config, userId);
    else await clearCloudApiConfig(userId);
    if (epoch !== sessionEpoch) return;
    apiConfigVersion += 1;
    clearLocalApiConfigStorage(scope, ['local', 'session']);
    setCloudMemoryApiConfig(scope, config);
    settledStatusUpdate('synced', null);
  } catch (err) {
    if (epoch === sessionEpoch) {
      emitSnapshot({ status: 'error', message: config ? '云端保存 API 配置失败，请稍后重试。' : '清除云端 API 配置失败，请稍后重试。' });
    }
    throw err;
  }
}

export async function saveAccountCloudApiConfig(scope: AccountPracticeScope, config: ApiConfig): Promise<void> {
  await writeAccountApiConfig(scope, config);
}

export async function clearAccountCloudApiConfig(scope: AccountPracticeScope): Promise<void> {
  await writeAccountApiConfig(scope, null);
}

async function waitForBankAndHydration(bankId: string): Promise<void> {
  if (hydrationPromise) await hydrationPromise.catch(() => undefined);
  const bankWrite = activeBankWrites.get(bankId);
  if (bankWrite) await bankWrite.catch(() => undefined);
}

function flushProgressForBank(userId: string, bankId: string): Promise<void> {
  const existing = activeProgressFlushes.get(bankId);
  if (existing) return existing;

  const epoch = sessionEpoch;
  const scope = accountPracticeScope(userId);
  const bankDb = getBankDb(scope);

  const task = (async () => {
    await waitForBankAndHydration(bankId);

    while (pendingProgress.has(bankId) && epoch === sessionEpoch) {
      let op = pendingProgress.get(bankId)!;
      pendingProgress.delete(bankId);
      let baseStore = lastSyncedProgress.get(bankId) ?? createEmptyStore();
      let mergedWithRemote = false;
      let resolvedConflict = false;
      let terminalStatus: 'error' | 'conflict' | null = null;
      let terminalMessage: string | null = null;
      let savedVersioned: { store: UserStore; revision: number } | null = null;

      emitSnapshot({ status: 'syncing', message: null });

      for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
        if (epoch !== sessionEpoch) return;
        const revision = progressRevisions.get(bankId) ?? 0;

        try {
          const result = op.kind === 'reset'
            ? await resetCloudProgress(bankId, revision)
            : await saveCloudProgress(bankId, op.store, revision);
          savedVersioned = { store: result.store, revision: result.revision };
          break;
        } catch (err) {
          if (epoch !== sessionEpoch) return;

          if (isRevisionConflictError(err)) {
            if (attempt >= MAX_CONFLICT_RETRIES) {
              terminalStatus = 'conflict';
              terminalMessage = '云端进度存在并发冲突，请点击重试。';
              break;
            }
            try {
              const latest = await loadCloudProgress(bankId);
              if (epoch !== sessionEpoch) return;
              progressRevisions.set(bankId, latest.revision);
              lastSyncedProgress.set(bankId, sanitizeUserStore(latest.store));
              if (op.kind === 'save') {
                const merged = mergeStoresThreeWay(baseStore, latest.store, op.store, latest.resetAt);
                baseStore = latest.store;
                op = { kind: 'save', store: merged };
                mergedWithRemote = true;
              }
              resolvedConflict = true;
              continue;
            } catch {
              terminalStatus = 'error';
              terminalMessage = '拉取云端最新进度失败，请点击重试。';
              break;
            }
          }

          if (isBankNotFoundError(err)) {
            if (failedBankOps.has(bankId)) {
              terminalStatus = 'error';
              terminalMessage = '题库尚未上传至云端，请点击重试。';
              break;
            }
            void hydrateAccountFromCloud(userId, { force: true });
            emitSnapshot({ status: 'conflict', message: '该题库已在其他设备删除，已同步最新题库列表。' });
            return;
          }

          terminalStatus = 'error';
          terminalMessage = '进度同步失败，请稍后重试。';
          break;
        }
      }

      if (epoch !== sessionEpoch) return;

      if (savedVersioned) {
        progressRevisions.set(bankId, savedVersioned.revision);
        lastSyncedProgress.set(bankId, sanitizeUserStore(savedVersioned.store));
        if (mergedWithRemote && !pendingProgress.has(bankId)) {
          await bankDb.saveBankProgress(bankId, savedVersioned.store);
          if (epoch !== sessionEpoch) return;
          if (bankId === BUILTIN_AI_BANK_ID) {
            writeBuiltinLocalCache(scope, savedVersioned.store);
          }
          notifyBankLibrarySynced(scope);
        }
        if (!pendingProgress.has(bankId)) {
          settledStatusUpdate('synced', resolvedConflict ? '已合并云端最新进度' : null);
        }
      } else if (terminalStatus) {
        if (!pendingProgress.has(bankId)) {
          pendingProgress.set(bankId, op);
        }
        emitSnapshot({ status: terminalStatus, message: terminalMessage });
        break;
      }
    }
  })();

  activeProgressFlushes.set(bankId, task);
  void task.finally(() => {
    if (activeProgressFlushes.get(bankId) === task) {
      activeProgressFlushes.delete(bankId);
    }
  });
  return task;
}

export function queueCloudProgressSave(scope: PracticeScope, bankId: string, store: UserStore): void {
  if (!isAccountPracticeScope(scope) || !isDatabaseConfigured()) return;
  const userId = accountIdFromScope(scope);
  if (!userId) return;
  ensureAccountSession(userId);

  pendingProgress.set(bankId, { kind: 'save', store: sanitizeUserStore(store) });
  clearProgressTimer(bankId);
  emitSnapshot();

  if (debounceMs === 0) {
    void flushProgressForBank(userId, bankId);
    return;
  }

  const timer = setTimeout(() => {
    progressTimers.delete(bankId);
    void flushProgressForBank(userId, bankId);
  }, debounceMs);
  progressTimers.set(bankId, timer);
}

export async function syncCloudProgressReset(scope: PracticeScope, bankId: string): Promise<void> {
  if (!isAccountPracticeScope(scope) || !isDatabaseConfigured()) return;
  const userId = accountIdFromScope(scope);
  if (!userId) return;
  ensureAccountSession(userId);

  clearProgressTimer(bankId);
  pendingProgress.set(bankId, { kind: 'reset' });
  emitSnapshot({ status: 'syncing', message: null });
  await flushProgressForBank(userId, bankId);
}

function enqueueBankWrite(bankId: string, fn: () => Promise<void>): Promise<void> {
  const prev = activeBankWrites.get(bankId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  activeBankWrites.set(bankId, next);
  return next.finally(() => {
    if (activeBankWrites.get(bankId) === next) {
      activeBankWrites.delete(bankId);
    }
  });
}

async function performBankSave(scope: AccountPracticeScope, bank: BankRecord, create: boolean): Promise<void> {
  const epoch = sessionEpoch;
  if (hydrationPromise) await hydrationPromise.catch(() => undefined);
  if (epoch !== sessionEpoch) return;

  const bankDb = getBankDb(scope);
  emitSnapshot({ status: 'syncing', message: null });
  failedBankOps.delete(bank.id);

  let currentPayload = bank;
  let expectedRevision = create ? 0 : (bankRevisions.get(bank.id) ?? null);

  if (expectedRevision === null) {
    try {
      const remoteList = await listCloudBanks();
      if (epoch !== sessionEpoch) return;
      for (const entry of remoteList) bankRevisions.set(entry.bank.id, entry.revision);
      const match = remoteList.find((entry) => entry.bank.id === bank.id);
      if (match) {
        expectedRevision = match.revision;
        currentPayload = {
          ...match.bank,
          name: bank.name,
          description: bank.description,
          updatedAt: bank.updatedAt,
          data: {
            ...match.bank.data,
            meta: {
              ...match.bank.data.meta,
              title: bank.name,
            },
          },
        };
      } else {
        await bankDb.deleteCustomBank(bank.id);
        bankRevisions.delete(bank.id);
        progressRevisions.delete(bank.id);
        lastSyncedProgress.delete(bank.id);
        notifyBankLibrarySynced(scope);
        emitSnapshot({ status: 'conflict', message: '该题库已在其他设备删除，已同步最新题库列表。' });
        return;
      }
    } catch {
      failedBankOps.set(bank.id, { kind: 'save', bank, create });
      emitSnapshot({ status: 'error', message: '题库同步失败，请稍后重试。' });
      return;
    }
  }

  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
    if (epoch !== sessionEpoch) return;
    try {
      const saved = await saveCloudBank(currentPayload, expectedRevision);
      if (epoch !== sessionEpoch) return;
      bankRevisions.set(saved.bank.id, saved.revision);
      await bankDb.saveCustomBank(saved.bank);
      notifyBankLibrarySynced(scope);
      settledStatusUpdate('synced', attempt > 0 ? '已合并云端题库变更' : null);
      return;
    } catch (err) {
      if (epoch !== sessionEpoch) return;
      if (isRevisionConflictError(err)) {
        if (attempt >= MAX_CONFLICT_RETRIES) {
          failedBankOps.set(bank.id, { kind: 'save', bank, create });
          emitSnapshot({ status: 'conflict', message: '题库保存存在版本冲突，请点击重试。' });
          return;
        }
        try {
          const remoteList = await listCloudBanks();
          if (epoch !== sessionEpoch) return;
          for (const entry of remoteList) bankRevisions.set(entry.bank.id, entry.revision);
          const remote = remoteList.find((entry) => entry.bank.id === bank.id);
          if (!remote) {
            if (create) {
              expectedRevision = 0;
              continue;
            }
            await bankDb.deleteCustomBank(bank.id);
            bankRevisions.delete(bank.id);
            progressRevisions.delete(bank.id);
            lastSyncedProgress.delete(bank.id);
            notifyBankLibrarySynced(scope);
            emitSnapshot({ status: 'conflict', message: '该题库已在其他设备删除，已同步最新题库列表。' });
            return;
          }
          expectedRevision = remote.revision;
          currentPayload = create
            ? bank
            : {
                ...remote.bank,
                name: bank.name,
                description: bank.description,
                updatedAt: bank.updatedAt,
                data: {
                  ...remote.bank.data,
                  meta: {
                    ...remote.bank.data.meta,
                    title: bank.name,
                  },
                },
              };
          continue;
        } catch {
          failedBankOps.set(bank.id, { kind: 'save', bank, create });
          emitSnapshot({ status: 'error', message: '拉取云端最新题库失败，请点击重试。' });
          return;
        }
      }

      failedBankOps.set(bank.id, { kind: 'save', bank, create });
      emitSnapshot({ status: 'error', message: '题库同步失败，请稍后重试。' });
      return;
    }
  }
}

async function performBankDelete(bankId: string): Promise<void> {
  const epoch = sessionEpoch;
  if (hydrationPromise) await hydrationPromise.catch(() => undefined);
  if (epoch !== sessionEpoch) return;

  emitSnapshot({ status: 'syncing', message: null });
  failedBankOps.delete(bankId);

  let expectedRevision = bankRevisions.get(bankId) ?? null;
  if (expectedRevision === null) {
    try {
      const remoteList = await listCloudBanks();
      if (epoch !== sessionEpoch) return;
      for (const entry of remoteList) bankRevisions.set(entry.bank.id, entry.revision);
      const remote = remoteList.find((entry) => entry.bank.id === bankId);
      if (!remote) {
        bankRevisions.delete(bankId);
        progressRevisions.delete(bankId);
        lastSyncedProgress.delete(bankId);
        settledStatusUpdate('synced', null);
        return;
      }
      expectedRevision = remote.revision;
    } catch {
      failedBankOps.set(bankId, { kind: 'delete', bankId });
      emitSnapshot({ status: 'error', message: '删除云端题库失败，请稍后重试。' });
      return;
    }
  }

  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
    if (epoch !== sessionEpoch) return;
    try {
      await deleteCloudBank(bankId, expectedRevision);
      if (epoch !== sessionEpoch) return;
      bankRevisions.delete(bankId);
      progressRevisions.delete(bankId);
      lastSyncedProgress.delete(bankId);
      settledStatusUpdate('synced', null);
      return;
    } catch (err) {
      if (epoch !== sessionEpoch) return;
      if (isRevisionConflictError(err)) {
        if (attempt >= MAX_CONFLICT_RETRIES) {
          failedBankOps.set(bankId, { kind: 'delete', bankId });
          emitSnapshot({ status: 'conflict', message: '删除题库存在版本冲突，请点击重试。' });
          return;
        }
        try {
          const remoteList = await listCloudBanks();
          if (epoch !== sessionEpoch) return;
          for (const entry of remoteList) bankRevisions.set(entry.bank.id, entry.revision);
          const remote = remoteList.find((entry) => entry.bank.id === bankId);
          if (!remote) {
            bankRevisions.delete(bankId);
            progressRevisions.delete(bankId);
            lastSyncedProgress.delete(bankId);
            settledStatusUpdate('synced', null);
            return;
          }
          expectedRevision = remote.revision;
          continue;
        } catch {
          failedBankOps.set(bankId, { kind: 'delete', bankId });
          emitSnapshot({ status: 'error', message: '删除云端题库失败，请稍后重试。' });
          return;
        }
      }

      failedBankOps.set(bankId, { kind: 'delete', bankId });
      emitSnapshot({ status: 'error', message: '删除云端题库失败，请稍后重试。' });
      return;
    }
  }
}

export async function syncCloudBankCreate(scope: PracticeScope, bank: BankRecord): Promise<void> {
  if (!isAccountPracticeScope(scope) || !isDatabaseConfigured() || bank.builtin) return;
  const userId = accountIdFromScope(scope);
  if (!userId) return;
  ensureAccountSession(userId);
  await enqueueBankWrite(bank.id, () => performBankSave(scope, bank, true));
}

export async function syncCloudBankUpdate(scope: PracticeScope, bank: BankRecord): Promise<void> {
  if (!isAccountPracticeScope(scope) || !isDatabaseConfigured() || bank.builtin) return;
  const userId = accountIdFromScope(scope);
  if (!userId) return;
  ensureAccountSession(userId);
  await enqueueBankWrite(bank.id, () => performBankSave(scope, bank, false));
}

export async function syncCloudBankDelete(scope: PracticeScope, bankId: string): Promise<void> {
  if (!isAccountPracticeScope(scope) || !isDatabaseConfigured() || bankId === BUILTIN_AI_BANK_ID) return;
  const userId = accountIdFromScope(scope);
  if (!userId) return;
  ensureAccountSession(userId);

  clearProgressTimer(bankId);
  pendingProgress.delete(bankId);
  await enqueueBankWrite(bankId, () => performBankDelete(bankId));
}

export async function flushPendingCloudWrites(): Promise<void> {
  if (!isDatabaseConfigured() || !activeAccountId) return;
  const userId = activeAccountId;
  const scope = accountPracticeScope(userId);

  const bankOps = Array.from(failedBankOps.values());
  for (const op of bankOps) {
    if (op.kind === 'save') {
      await enqueueBankWrite(op.bank.id, () => performBankSave(scope, op.bank, op.create));
    } else {
      await enqueueBankWrite(op.bankId, () => performBankDelete(op.bankId));
    }
  }

  const timerIds = Array.from(progressTimers.keys());
  for (const bankId of timerIds) {
    clearProgressTimer(bankId);
  }

  const progressBankIds = new Set([...pendingProgress.keys(), ...activeProgressFlushes.keys()]);
  await Promise.all(Array.from(progressBankIds, (bankId) => flushProgressForBank(userId, bankId)));
  await Promise.all(Array.from(activeBankWrites.values()));
}

export async function retryCloudSync(userId: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  ensureAccountSession(userId);
  await flushPendingCloudWrites();
  if (failedBankOps.size === 0 && pendingProgress.size === 0) {
    await hydrateAccountFromCloud(userId, { force: true });
  }
}
