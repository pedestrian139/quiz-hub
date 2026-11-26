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
import type { CachedAiExplanation, Question, UserStore } from '../types/quiz';
import { computeV1BankCounts } from '../utils/bankCatalog';
import { getBankDb, sanitizeUserStore } from '../utils/bankDb';
import { BUILTIN_AI_BANK_ID, isBuiltinBankId, type BankRecord } from '../utils/quizImportTypes';
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

type PendingProgressOp = { kind: 'save'; store: UserStore; reconciledFrom?: UserStore } | { kind: 'reset' };
type FailedBankOp = { kind: 'save'; bank: BankRecord; create: boolean } | { kind: 'delete'; bankId: string };

const MAX_CONFLICT_RETRIES = 3;
const DEFAULT_DEBOUNCE_MS = 450;
const DEFAULT_BANK_DEBOUNCE_MS = 1000;

let debounceMs = DEFAULT_DEBOUNCE_MS;
let bankDebounceOverrideMs: number | null = null;
let sessionEpoch = 0;
let apiConfigVersion = 0;
let activeAccountId: string | null = null;
let hydratedAccountId: string | null = null;
let hydrationPromise: Promise<void> | null = null;
let lifecycleListenersRegistered = false;

const bankRevisions = new Map<string, number>();
const progressRevisions = new Map<string, number>();
const lastSyncedProgress = new Map<string, UserStore>();
const lastSyncedBanks = new Map<string, BankRecord>();
const pendingProgress = new Map<string, PendingProgressOp>();
const progressTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingBankUpdates = new Map<string, { scope: AccountPracticeScope; bank: BankRecord; create: boolean }>();
const bankUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeProgressFlushes = new Map<string, Promise<void>>();
const activeBankWrites = new Map<string, Promise<void>>();
const failedBankOps = new Map<string, FailedBankOp>();
const pendingCreateBanks = new Set<string>();

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
    pendingCount: pendingProgress.size + pendingBankUpdates.size + failedBankOps.size,
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
  const safe = Math.max(0, ms);
  debounceMs = safe;
  bankDebounceOverrideMs = safe;
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

  const sameCachedExplain = (
    a: CachedAiExplanation | undefined,
    b: CachedAiExplanation | undefined,
  ): boolean => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.content === b.content && a.updatedAt === b.updatedAt && a.model === b.model;
  };

  const aiExplanations: Record<string, CachedAiExplanation> = {};
  const aiIds = new Set([
    ...Object.keys(base.aiExplanations ?? {}),
    ...Object.keys(remote.aiExplanations ?? {}),
    ...Object.keys(local.aiExplanations ?? {}),
  ]);
  for (const id of aiIds) {
    const b = base.aiExplanations?.[id];
    const r = remote.aiExplanations?.[id];
    const rawL = local.aiExplanations?.[id];
    const lPreReset = Boolean(rawL && Number.isFinite(resetMs) && rawL.updatedAt <= resetMs && !r);
    const l = lPreReset ? undefined : rawL;
    let picked: CachedAiExplanation | undefined;
    if (!sameCachedExplain(l, b) && sameCachedExplain(r, b)) {
      picked = l;
    } else if (!sameCachedExplain(r, b) && sameCachedExplain(l, b)) {
      picked = r;
    } else if (l && r) {
      picked = l.updatedAt >= r.updatedAt ? l : r;
    } else if (r) {
      picked = r;
    } else if (l) {
      picked = l;
    }
    if (picked) aiExplanations[id] = picked;
  }

  return {
    records,
    fav,
    mastery,
    ...(Object.keys(aiExplanations).length > 0 ? { aiExplanations } : {}),
  };
}

function sameQuestionCore(a: Question, b: Question): boolean {
  return (
    JSON.stringify({
      type: a.type,
      chapter: a.chapter,
      sectionId: a.sectionId ?? null,
      stem: a.stem,
      options: a.options ?? null,
      answer: a.answer,
      keyPoints: a.keyPoints ?? null,
      tags: a.tags ?? null,
      source: a.source,
      aiInferredAnswer: Boolean(a.aiInferredAnswer),
    }) ===
    JSON.stringify({
      type: b.type,
      chapter: b.chapter,
      sectionId: b.sectionId ?? null,
      stem: b.stem,
      options: b.options ?? null,
      answer: b.answer,
      keyPoints: b.keyPoints ?? null,
      tags: b.tags ?? null,
      source: b.source,
      aiInferredAnswer: Boolean(b.aiInferredAnswer),
    })
  );
}

function mergeOptionalTextField(
  baseVal: string | undefined,
  remoteVal: string | undefined,
  localVal: string | undefined,
  preferLocal: boolean,
  hasBase: boolean,
): string | undefined {
  if (hasBase) {
    if (localVal !== baseVal && remoteVal === baseVal) return localVal;
    if (remoteVal !== baseVal && localVal === baseVal) return remoteVal;
    if (localVal !== undefined && remoteVal !== undefined) {
      return preferLocal ? localVal : remoteVal;
    }
    return localVal ?? remoteVal;
  }
  const localTrim = localVal?.trim() ?? '';
  const remoteTrim = remoteVal?.trim() ?? '';
  if (localTrim && !remoteTrim) return localVal;
  if (remoteTrim && !localTrim) return remoteVal;
  if (localTrim && remoteTrim) return preferLocal ? localVal : remoteVal;
  return localVal ?? remoteVal;
}

function mergeSingleQuestion(
  base: Question | undefined,
  remote: Question,
  local: Question,
  preferLocal: boolean,
): Question {
  const hasBase = base !== undefined;
  let coreSource: Question;
  if (base && sameQuestionCore(local, base) && !sameQuestionCore(remote, base)) {
    coreSource = remote;
  } else if (base && !sameQuestionCore(local, base) && sameQuestionCore(remote, base)) {
    coreSource = local;
  } else {
    coreSource = preferLocal ? local : remote;
  }

  const explain =
    mergeOptionalTextField(base?.explain, remote.explain, local.explain, preferLocal, hasBase) ?? '';
  const explanation = mergeOptionalTextField(
    base?.explanation,
    remote.explanation,
    local.explanation,
    preferLocal,
    hasBase,
  );
  const aiAnalysis = mergeOptionalTextField(
    base?.aiAnalysis,
    remote.aiAnalysis,
    local.aiAnalysis,
    preferLocal,
    hasBase,
  );

  const merged: Question = {
    ...structuredClone(coreSource),
    explain,
  };
  if (explanation !== undefined) {
    merged.explanation = explanation;
  } else {
    delete merged.explanation;
  }
  if (aiAnalysis !== undefined) {
    merged.aiAnalysis = aiAnalysis;
  } else {
    delete merged.aiAnalysis;
  }
  return merged;
}

function mergeQuestionsThreeWay(
  baseList: Question[] | undefined,
  remoteList: Question[],
  localList: Question[],
  preferLocal: boolean,
): Question[] {
  const baseMap = new Map((baseList ?? []).map((q) => [q.id, q]));
  const remoteMap = new Map(remoteList.map((q) => [q.id, q]));
  const localMap = new Map(localList.map((q) => [q.id, q]));
  const merged: Question[] = [];
  const seen = new Set<string>();

  for (const localQ of localList) {
    seen.add(localQ.id);
    const baseQ = baseMap.get(localQ.id);
    const remoteQ = remoteMap.get(localQ.id);
    if (remoteQ) {
      merged.push(mergeSingleQuestion(baseQ, remoteQ, localQ, preferLocal));
    } else if (
      baseQ &&
      sameQuestionCore(localQ, baseQ) &&
      localQ.explain === baseQ.explain &&
      localQ.explanation === baseQ.explanation &&
      localQ.aiAnalysis === baseQ.aiAnalysis
    ) {
      continue;
    } else {
      merged.push(structuredClone(localQ));
    }
  }

  for (const remoteQ of remoteList) {
    if (seen.has(remoteQ.id)) continue;
    const baseQ = baseMap.get(remoteQ.id);
    if (baseQ && !localMap.has(remoteQ.id)) {
      continue;
    }
    merged.push(structuredClone(remoteQ));
  }

  return merged;
}

export function mergeBankRecords(
  base: BankRecord | undefined,
  remote: BankRecord,
  local: BankRecord,
): BankRecord {
  const preferLocal = local.updatedAt >= remote.updatedAt;
  const mergedName =
    base && local.name === base.name && remote.name !== base.name ? remote.name : local.name;
  const mergedDesc =
    base && local.description === base.description && remote.description !== base.description
      ? remote.description
      : local.description;

  const mergedQuestions = mergeQuestionsThreeWay(
    base?.data.questions,
    remote.data.questions,
    local.data.questions,
    preferLocal,
  );
  const mergedChapters =
    base &&
    JSON.stringify(local.data.chapters) === JSON.stringify(base.data.chapters) &&
    JSON.stringify(remote.data.chapters) !== JSON.stringify(base.data.chapters)
      ? remote.data.chapters
      : local.data.chapters;

  return {
    ...remote,
    name: mergedName,
    description: mergedDesc,
    updatedAt: Math.max(remote.updatedAt, local.updatedAt),
    data: {
      ...remote.data,
      chapters: structuredClone(mergedChapters),
      questions: mergedQuestions,
      meta: {
        ...remote.data.meta,
        title: mergedName,
        counts: computeV1BankCounts(mergedQuestions),
      },
    },
  };
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

function clearBankUpdateTimer(bankId: string): void {
  const timer = bankUpdateTimers.get(bankId);
  if (timer !== undefined) {
    clearTimeout(timer);
    bankUpdateTimers.delete(bankId);
  }
}

function writeBuiltinLocalCache(scope: PracticeScope, store: UserStore): void {
  const clean = sanitizeUserStore(store);
  saveStore(clean, scope);
  notifyBuiltinProgressSynced(scope, clean);
}

function settledStatusUpdate(fallbackStatus: CloudSyncStatus = 'synced', message: string | null = null): void {
  if (failedBankOps.size > 0 || pendingProgress.size > 0 || pendingBankUpdates.size > 0) {
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
  for (const timer of bankUpdateTimers.values()) clearTimeout(timer);
  bankUpdateTimers.clear();
  pendingProgress.clear();
  pendingBankUpdates.clear();
  failedBankOps.clear();
  pendingCreateBanks.clear();
  bankRevisions.clear();
  progressRevisions.clear();
  lastSyncedProgress.clear();
  lastSyncedBanks.clear();
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
        if (
          failedBankOps.has(entry.bank.id) ||
          pendingBankUpdates.has(entry.bank.id) ||
          activeBankWrites.has(entry.bank.id)
        ) {
          continue;
        }
        bankRevisions.set(entry.bank.id, entry.revision);
        lastSyncedBanks.set(entry.bank.id, structuredClone(entry.bank));
        pendingCreateBanks.delete(entry.bank.id);
        await bankDb.saveCustomBank(entry.bank);
        if (epoch !== sessionEpoch) return;
        banksChanged = true;
      }

      for (const localBank of localBanks) {
        if (
          !cloudIds.has(localBank.id) &&
          !failedBankOps.has(localBank.id) &&
          !activeBankWrites.has(localBank.id) &&
          !pendingBankUpdates.has(localBank.id) &&
          !pendingCreateBanks.has(localBank.id)
        ) {
          await bankDb.deleteCustomBank(localBank.id);
          if (epoch !== sessionEpoch) return;
          bankRevisions.delete(localBank.id);
          lastSyncedBanks.delete(localBank.id);
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
    } else if (failedBankOps.size > 0 || pendingProgress.size > 0 || pendingBankUpdates.size > 0) {
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
      const localStoreBeforeMerge = op.kind === 'save' ? op.reconciledFrom ?? op.store : createEmptyStore();
      pendingProgress.delete(bankId);
      let baseStore = lastSyncedProgress.get(bankId) ?? createEmptyStore();
      let mergedWithRemote = op.kind === 'save' && op.reconciledFrom !== undefined;
      let resolvedConflict = false;
      let terminalStatus: 'error' | 'conflict' | null = null;
      let terminalMessage: string | null = null;
      let savedVersioned: { store: UserStore; revision: number; resetAt: string | null } | null = null;

      emitSnapshot({ status: 'syncing', message: null });

      for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
        if (epoch !== sessionEpoch) return;
        const revision = progressRevisions.get(bankId) ?? 0;

        try {
          const result = op.kind === 'reset'
            ? await resetCloudProgress(bankId, revision)
            : await saveCloudProgress(bankId, op.store, revision);
          savedVersioned = result;
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
                op = { kind: 'save', store: merged, reconciledFrom: localStoreBeforeMerge };
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
        const queued = pendingProgress.get(bankId);
        if (mergedWithRemote && queued?.kind === 'save') {
          pendingProgress.set(bankId, {
            kind: 'save',
            reconciledFrom: queued.store,
            store: mergeStoresThreeWay(localStoreBeforeMerge, savedVersioned.store, queued.store, savedVersioned.resetAt),
          });
        } else if (mergedWithRemote && !queued) {
          await bankDb.saveBankProgress(bankId, savedVersioned.store);
          if (epoch !== sessionEpoch) return;
          if (!pendingProgress.has(bankId)) {
            if (bankId === BUILTIN_AI_BANK_ID) writeBuiltinLocalCache(scope, savedVersioned.store);
            notifyBankLibrarySynced(scope);
          }
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
  const epoch = sessionEpoch;
  const prev = activeBankWrites.get(bankId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => {
    if (epoch === sessionEpoch) return fn();
  });
  activeBankWrites.set(bankId, next);
  return next.finally(() => {
    if (activeBankWrites.get(bankId) === next) {
      activeBankWrites.delete(bankId);
    }
  });
}

function shouldCreateBankOnCloud(bankId: string): boolean {
  if (bankRevisions.has(bankId)) return false;
  if (pendingCreateBanks.has(bankId)) return true;
  const priorFailed = failedBankOps.get(bankId);
  if (priorFailed?.kind === 'save' && priorFailed.create) return true;
  const priorPending = pendingBankUpdates.get(bankId);
  return Boolean(priorPending?.create);
}

async function performBankSave(scope: AccountPracticeScope, bank: BankRecord, create: boolean): Promise<void> {
  const epoch = sessionEpoch;
  if (hydrationPromise) await hydrationPromise.catch(() => undefined);
  if (epoch !== sessionEpoch) return;

  const bankDb = getBankDb(scope);
  emitSnapshot({ status: 'syncing', message: null });
  failedBankOps.delete(bank.id);

  let currentPayload = bank;
  const knownRevision = bankRevisions.get(bank.id);
  let expectedRevision =
    knownRevision !== undefined && knownRevision > 0 ? knownRevision : (create ? 0 : null);

  if (expectedRevision === null) {
    try {
      const remoteList = await listCloudBanks();
      if (epoch !== sessionEpoch) return;
      for (const entry of remoteList) bankRevisions.set(entry.bank.id, entry.revision);
      const match = remoteList.find((entry) => entry.bank.id === bank.id);
      if (match) {
        expectedRevision = match.revision;
        currentPayload = mergeBankRecords(lastSyncedBanks.get(bank.id), match.bank, bank);
      } else {
        await bankDb.deleteCustomBank(bank.id);
        pendingCreateBanks.delete(bank.id);
        bankRevisions.delete(bank.id);
        lastSyncedBanks.delete(bank.id);
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
      lastSyncedBanks.set(saved.bank.id, structuredClone(saved.bank));
      pendingCreateBanks.delete(saved.bank.id);
      const queued = pendingBankUpdates.get(saved.bank.id);
      if (queued) {
        queued.bank = mergeBankRecords(bank, saved.bank, queued.bank);
      } else {
        await bankDb.saveCustomBank(saved.bank);
        if (epoch !== sessionEpoch) return;
        notifyBankLibrarySynced(scope);
      }
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
            pendingCreateBanks.delete(bank.id);
            bankRevisions.delete(bank.id);
            lastSyncedBanks.delete(bank.id);
            progressRevisions.delete(bank.id);
            lastSyncedProgress.delete(bank.id);
            notifyBankLibrarySynced(scope);
            emitSnapshot({ status: 'conflict', message: '该题库已在其他设备删除，已同步最新题库列表。' });
            return;
          }
          expectedRevision = remote.revision;
          currentPayload = mergeBankRecords(lastSyncedBanks.get(bank.id), remote.bank, bank);
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
        pendingCreateBanks.delete(bankId);
        bankRevisions.delete(bankId);
        lastSyncedBanks.delete(bankId);
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
      pendingCreateBanks.delete(bankId);
      bankRevisions.delete(bankId);
      lastSyncedBanks.delete(bankId);
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
            pendingCreateBanks.delete(bankId);
            bankRevisions.delete(bankId);
            lastSyncedBanks.delete(bankId);
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

async function flushQueuedBankUpdate(bankId: string): Promise<void> {
  const pending = pendingBankUpdates.get(bankId);
  if (!pending) return;
  await enqueueBankWrite(bankId, async () => {
    if (pendingBankUpdates.get(bankId) !== pending) return;
    pendingBankUpdates.delete(bankId);
    const shouldCreate =
      !bankRevisions.has(bankId) && (pending.create || pendingCreateBanks.has(bankId));
    await performBankSave(pending.scope, pending.bank, shouldCreate);
  });
}

export function queueCloudBankUpdate(
  scope: PracticeScope,
  bank: BankRecord,
  customDebounceMs?: number,
): void {
  if (!isAccountPracticeScope(scope) || !isDatabaseConfigured() || bank.builtin || isBuiltinBankId(bank.id)) {
    return;
  }
  const userId = accountIdFromScope(scope);
  if (!userId) return;
  ensureAccountSession(userId);

  const shouldCreate = shouldCreateBankOnCloud(bank.id);
  failedBankOps.delete(bank.id);
  clearBankUpdateTimer(bank.id);
  pendingBankUpdates.set(bank.id, { scope, bank: structuredClone(bank), create: shouldCreate });
  emitSnapshot();

  const delay =
    customDebounceMs !== undefined
      ? Math.max(0, customDebounceMs)
      : (bankDebounceOverrideMs ?? DEFAULT_BANK_DEBOUNCE_MS);
  if (delay === 0) {
    void flushQueuedBankUpdate(bank.id);
    return;
  }

  const timer = setTimeout(() => {
    bankUpdateTimers.delete(bank.id);
    void flushQueuedBankUpdate(bank.id);
  }, delay);
  bankUpdateTimers.set(bank.id, timer);
}

export async function syncCloudBankCreate(scope: PracticeScope, bank: BankRecord): Promise<void> {
  if (!isAccountPracticeScope(scope) || !isDatabaseConfigured() || bank.builtin) return;
  const userId = accountIdFromScope(scope);
  if (!userId) return;
  ensureAccountSession(userId);
  pendingCreateBanks.add(bank.id);
  failedBankOps.delete(bank.id);
  clearBankUpdateTimer(bank.id);
  pendingBankUpdates.delete(bank.id);
  await enqueueBankWrite(bank.id, () => performBankSave(scope, bank, true));
}

export async function syncCloudBankUpdate(scope: PracticeScope, bank: BankRecord): Promise<void> {
  if (!isAccountPracticeScope(scope) || !isDatabaseConfigured() || bank.builtin) return;
  const userId = accountIdFromScope(scope);
  if (!userId) return;
  ensureAccountSession(userId);
  const shouldCreate = shouldCreateBankOnCloud(bank.id);
  failedBankOps.delete(bank.id);
  clearBankUpdateTimer(bank.id);
  pendingBankUpdates.delete(bank.id);
  await enqueueBankWrite(bank.id, () => performBankSave(scope, bank, shouldCreate));
}

export async function syncCloudBankDelete(scope: PracticeScope, bankId: string): Promise<void> {
  if (!isAccountPracticeScope(scope) || !isDatabaseConfigured() || isBuiltinBankId(bankId)) return;
  const userId = accountIdFromScope(scope);
  if (!userId) return;
  ensureAccountSession(userId);

  pendingCreateBanks.delete(bankId);
  failedBankOps.delete(bankId);
  clearBankUpdateTimer(bankId);
  pendingBankUpdates.delete(bankId);
  clearProgressTimer(bankId);
  pendingProgress.delete(bankId);
  await enqueueBankWrite(bankId, () => performBankDelete(bankId));
}

export async function flushPendingCloudWrites(): Promise<void> {
  if (!isDatabaseConfigured() || !activeAccountId) return;
  const userId = activeAccountId;
  const scope = accountPracticeScope(userId);

  const bankTimerIds = Array.from(bankUpdateTimers.keys());
  for (const bankId of bankTimerIds) {
    clearBankUpdateTimer(bankId);
  }
  const queuedBankIds = Array.from(pendingBankUpdates.keys());
  const flushedBankIds = new Set(queuedBankIds);
  for (const bankId of queuedBankIds) {
    void flushQueuedBankUpdate(bankId);
  }

  const bankOps = Array.from(failedBankOps.values());
  for (const op of bankOps) {
    const opBankId = op.kind === 'save' ? op.bank.id : op.bankId;
    if (flushedBankIds.has(opBankId)) {
      continue;
    }
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
  if (failedBankOps.size === 0 && pendingProgress.size === 0 && pendingBankUpdates.size === 0) {
    await hydrateAccountFromCloud(userId, { force: true });
  }
}
