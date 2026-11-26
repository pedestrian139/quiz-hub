/// <reference types="node" />

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountPracticeScope } from '../../src/core/practiceScope';
import { loadStore, saveStore } from '../../src/core/storage';
import {
  API_CONFIG_STORAGE_KEY,
  clearLocalApiConfigStorage,
  createDefaultApiConfig,
  getCloudMemoryApiConfig,
  hasSessionApiConfig,
  loadApiConfig,
  saveApiConfig,
} from '../../src/services/apiConfig';
import { createEmptyStore } from '../../src/core/storage';
import { getBankDb } from '../../src/utils/bankDb';
import type { BankRecord } from '../../src/utils/quizImportTypes';

const mock = vi.hoisted(() => ({
  listCloudBanks: vi.fn(),
  listCloudProgress: vi.fn(),
  restoreCloudApiConfig: vi.fn(),
  saveCloudApiConfig: vi.fn(),
  clearCloudApiConfig: vi.fn(),
  saveCloudBank: vi.fn(),
  deleteCloudBank: vi.fn(),
  loadCloudProgress: vi.fn(),
  saveCloudProgress: vi.fn(),
  resetCloudProgress: vi.fn(),
}));

vi.mock('../../src/services/db/client', () => ({
  isDatabaseConfigured: () => true,
  getDatabaseClient: vi.fn(),
  invokeDatabaseFunction: vi.fn(),
}));

vi.mock('../../src/services/db/cloudData', () => ({
  listCloudBanks: mock.listCloudBanks,
  listCloudProgress: mock.listCloudProgress,
  restoreCloudApiConfig: mock.restoreCloudApiConfig,
  saveCloudApiConfig: mock.saveCloudApiConfig,
  clearCloudApiConfig: mock.clearCloudApiConfig,
  saveCloudBank: mock.saveCloudBank,
  deleteCloudBank: mock.deleteCloudBank,
  loadCloudProgress: mock.loadCloudProgress,
  saveCloudProgress: mock.saveCloudProgress,
  resetCloudProgress: mock.resetCloudProgress,
}));

import {
  clearAccountCloudApiConfig,
  clearCloudSyncSession,
  flushPendingCloudWrites,
  getCloudSyncSnapshot,
  hydrateAccountFromCloud,
  mergeStoresThreeWay,
  queueCloudBankUpdate,
  queueCloudProgressSave,
  retryCloudSync,
  saveAccountCloudApiConfig,
  setCloudSyncDebounceMs,
  syncCloudBankCreate,
  syncCloudBankDelete,
  syncCloudBankUpdate,
  syncCloudProgressReset,
} from '../../src/services/cloudSync';

const USER_ID = 'user-cloud-1';
const SCOPE = accountPracticeScope(USER_ID);

function makeBank(id: string, name: string, updatedAt = 1000): BankRecord {
  return {
    id,
    name,
    builtin: false,
    sourceFormat: 'manual',
    createdAt: 1000,
    updatedAt,
    data: {
      meta: {
        title: name,
        version: '2.0.0',
        generatedAt: '2026-11-25T00:00:00Z',
        counts: {
          total: 0,
          byType: { choice: 0, multi: 0, tf: 0, short: 0, analysis: 0 },
          byOrigin: { comprehensive_bank: 0, video_popup: 0, review_notes_synthesized: 0 },
        },
      },
      chapters: [{ id: 1, short: '第1章', title: '第 1 章' }],
      questions: [],
    },
  };
}

describe('live cloud sync coordinator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
    sessionStorage.clear();
    setCloudSyncDebounceMs(0);
    clearCloudSyncSession(USER_ID);

    mock.listCloudBanks.mockResolvedValue([]);
    mock.listCloudProgress.mockResolvedValue({});
    mock.restoreCloudApiConfig.mockResolvedValue(null);
    mock.saveCloudApiConfig.mockResolvedValue({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 1200,
      timeoutMs: 45000,
      storageScope: 'local',
      hasKey: true,
    });
    mock.clearCloudApiConfig.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearCloudSyncSession(USER_ID);
    getBankDb(SCOPE).closeQuizHubDb();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('hydrates cloud banks, progress, and decrypted API config strictly in RAM', async () => {
    const cloudBank = makeBank('cloud-bank-1', '操作系统云库');
    const cloudStore = { records: { q1: { ok: 1 as const, ts: 500 } }, fav: { q1: true }, mastery: {} };
    const cloudApi = { ...createDefaultApiConfig(), apiKey: 'sk-cloud-memory-only', model: 'deepseek-reasoner' };

    localStorage.setItem(`${API_CONFIG_STORAGE_KEY}:${SCOPE}`, JSON.stringify({ ...cloudApi, apiKey: 'sk-stale-local' }));
    mock.listCloudBanks.mockResolvedValue([{ bank: cloudBank, revision: 2 }]);
    mock.listCloudProgress.mockResolvedValue({
      'builtin-ai-intro': { store: cloudStore, revision: 3, resetAt: null },
      'cloud-bank-1': { store: cloudStore, revision: 1, resetAt: null },
    });
    mock.restoreCloudApiConfig.mockResolvedValue(cloudApi);

    await hydrateAccountFromCloud(USER_ID, { force: true });

    expect(loadStore(SCOPE)).toEqual(cloudStore);
    expect((await getBankDb(SCOPE).listCustomBanks()).map((b) => b.name)).toEqual(['操作系统云库']);
    expect(await getBankDb(SCOPE).getBankProgress('cloud-bank-1')).toEqual(cloudStore);

    expect(loadApiConfig(SCOPE)).toMatchObject({ apiKey: 'sk-cloud-memory-only', model: 'deepseek-reasoner' });
    expect(getCloudMemoryApiConfig(SCOPE)?.apiKey).toBe('sk-cloud-memory-only');
    expect(localStorage.getItem(`${API_CONFIG_STORAGE_KEY}:${SCOPE}`)).toBeNull();
    expect(sessionStorage.getItem(`${API_CONFIG_STORAGE_KEY}:${SCOPE}`)).toBeNull();
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', accountId: USER_ID });
  });

  it('saves and clears cloud API config cleanly while preserving tab-only session isolation', async () => {
    const cloudApi = { ...createDefaultApiConfig(), apiKey: 'sk-encrypted-remote' };
    await saveAccountCloudApiConfig(SCOPE, cloudApi);

    expect(mock.saveCloudApiConfig).toHaveBeenCalledWith(cloudApi, USER_ID);
    expect(loadApiConfig(SCOPE).apiKey).toBe('sk-encrypted-remote');
    expect(localStorage.getItem(`${API_CONFIG_STORAGE_KEY}:${SCOPE}`)).toBeNull();

    // User switches explicitly to session-only mode locally: sessionStorage takes precedence, cloud not called
    const sessionCfg = { ...createDefaultApiConfig(), apiKey: 'sk-tab-only', storageScope: 'session' as const };
    saveApiConfig(sessionCfg, SCOPE);
    expect(hasSessionApiConfig(SCOPE)).toBe(true);
    expect(loadApiConfig(SCOPE).apiKey).toBe('sk-tab-only');
    expect(mock.saveCloudApiConfig).toHaveBeenCalledTimes(1);

    await clearAccountCloudApiConfig(SCOPE);
    expect(mock.clearCloudApiConfig).toHaveBeenCalledTimes(1);
    expect(hasSessionApiConfig(SCOPE)).toBe(false);
    expect(getCloudMemoryApiConfig(SCOPE)).toBeNull();
    expect(loadApiConfig(SCOPE).apiKey).toBe('');
  });

  it('purges memory API config on logout and ignores stale in-flight hydration', async () => {
    let resolveRestore!: (val: ReturnType<typeof createDefaultApiConfig> | null) => void;
    mock.restoreCloudApiConfig.mockReturnValue(new Promise((resolve) => { resolveRestore = resolve; }));

    const pendingHydration = hydrateAccountFromCloud(USER_ID, { force: true });
    clearCloudSyncSession(USER_ID);
    resolveRestore({ ...createDefaultApiConfig(), apiKey: 'sk-late-response' });
    await pendingHydration;

    expect(getCloudMemoryApiConfig(SCOPE)).toBeNull();
    expect(loadApiConfig(SCOPE).apiKey).toBe('');
    clearLocalApiConfigStorage(SCOPE);
  });

  it('keeps an old browser config available when the account has no cloud config', async () => {
    const legacy = { ...createDefaultApiConfig(), apiKey: 'test-legacy-key' };
    localStorage.setItem(`${API_CONFIG_STORAGE_KEY}:${SCOPE}`, JSON.stringify(legacy));
    await hydrateAccountFromCloud(USER_ID);
    expect(loadApiConfig(SCOPE)).toEqual(legacy);
    expect(mock.saveCloudApiConfig).not.toHaveBeenCalled();
  });

  it('ignores an older API restore after clearing and a late save after logout', async () => {
    const older = { ...createDefaultApiConfig(), apiKey: 'test-old-key' };
    let resolveRestore!: (value: typeof older) => void;
    mock.restoreCloudApiConfig.mockReturnValueOnce(new Promise((resolve) => { resolveRestore = resolve; }));
    const loading = hydrateAccountFromCloud(USER_ID);
    await clearAccountCloudApiConfig(SCOPE);
    resolveRestore(older);
    await loading;
    expect(getCloudMemoryApiConfig(SCOPE)).toBeNull();

    let resolveSave!: () => void;
    mock.saveCloudApiConfig.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSave = resolve; }));
    const saving = saveAccountCloudApiConfig(SCOPE, older);
    clearCloudSyncSession(USER_ID);
    resolveSave();
    await saving;
    expect(getCloudMemoryApiConfig(SCOPE)).toBeNull();
    expect(getCloudSyncSnapshot().accountId).toBeNull();
  });

  it('coalesces debounced progress writes, increments tracked revision, and flushes resets immediately', async () => {
    setCloudSyncDebounceMs(25);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    const s1 = { records: { q1: { ok: 1 as const, ts: 100 } }, fav: {}, mastery: {} };
    const s2 = { records: { q1: { ok: 1 as const, ts: 100 }, q2: { ok: 0 as const, ts: 200 } }, fav: { q2: true }, mastery: {} };

    mock.saveCloudProgress.mockResolvedValueOnce({ store: s2, revision: 1, resetAt: null });
    queueCloudProgressSave(SCOPE, 'builtin-ai-intro', s1);
    queueCloudProgressSave(SCOPE, 'builtin-ai-intro', s2);

    await vi.waitFor(() => expect(mock.saveCloudProgress).toHaveBeenCalledTimes(1));
    expect(mock.saveCloudProgress).toHaveBeenCalledWith('builtin-ai-intro', s2, 0);

    mock.resetCloudProgress.mockResolvedValueOnce({ store: createEmptyStore(), revision: 2, resetAt: '2026-11-25T10:00:00Z' });
    await syncCloudProgressReset(SCOPE, 'builtin-ai-intro');
    expect(mock.resetCloudProgress).toHaveBeenCalledWith('builtin-ai-intro', 1);
  });

  it('resolves 40001 progress conflicts with 3-way merge preserving remote changes and intentional un-stars', async () => {
    const base = { records: { q0: { ok: 1 as const, ts: 100 } }, fav: { q0: true, qUnstar: true }, mastery: { q0: 1 as const } };
    const remote = { records: { q0: { ok: 1 as const, ts: 100 }, qRemote: { ok: 1 as const, ts: 300 } }, fav: { q0: true, qUnstar: true, qRemote: true }, mastery: { q0: 1 as const, qRemote: 2 as const } };
    const local = { records: { q0: { ok: 1 as const, ts: 100 }, qLocal: { ok: 0 as const, ts: 250 } }, fav: { q0: true, qLocal: true }, mastery: { q0: 2 as const, qLocal: 0 as const } };

    const mergedDirect = mergeStoresThreeWay(base, remote, local, null);
    expect(mergedDirect.records).toHaveProperty('qRemote');
    expect(mergedDirect.records).toHaveProperty('qLocal');
    expect(mergedDirect.fav).toEqual({ q0: true, qRemote: true, qLocal: true });
    expect(mergedDirect.mastery).toEqual({ q0: 2, qRemote: 2, qLocal: 0 });

    mock.listCloudProgress.mockResolvedValue({
      'builtin-ai-intro': { store: base, revision: 1, resetAt: null },
    });
    await hydrateAccountFromCloud(USER_ID, { force: true });

    mock.saveCloudProgress
      .mockRejectedValueOnce(Object.assign(new Error('Progress changed'), { code: '40001' }))
      .mockResolvedValueOnce({ store: mergedDirect, revision: 3, resetAt: null });
    mock.loadCloudProgress.mockResolvedValueOnce({ store: remote, revision: 2, resetAt: null });

    saveStore(local, SCOPE);
    queueCloudProgressSave(SCOPE, 'builtin-ai-intro', local);
    await flushPendingCloudWrites();

    expect(mock.saveCloudProgress).toHaveBeenNthCalledWith(1, 'builtin-ai-intro', local, 1);
    expect(mock.saveCloudProgress).toHaveBeenNthCalledWith(2, 'builtin-ai-intro', mergedDirect, 2);
    expect(loadStore(SCOPE)).toEqual(mergedDirect);
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });
  });

  it('handles 40001 conflicts on custom bank rename and delete including remotely deleted banks', async () => {
    const initialBank = makeBank('b1', '旧名字', 100);
    const remoteUpdatedBank = makeBank('b1', '他端改名', 200);
    mock.listCloudBanks.mockResolvedValue([{ bank: initialBank, revision: 1 }]);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    const localRenamed = {
      ...initialBank,
      name: '本端新名',
      updatedAt: 300,
      data: { ...initialBank.data, meta: { ...initialBank.data.meta, title: '本端新名' } },
    };
    const mergedExpectation = {
      ...remoteUpdatedBank,
      name: '本端新名',
      updatedAt: 300,
      data: { ...remoteUpdatedBank.data, meta: { ...remoteUpdatedBank.data.meta, title: '本端新名' } },
    };

    mock.saveCloudBank
      .mockRejectedValueOnce(Object.assign(new Error('Bank changed or was deleted'), { code: '40001' }))
      .mockResolvedValueOnce({ bank: mergedExpectation, revision: 3 });
    mock.listCloudBanks.mockResolvedValueOnce([{ bank: remoteUpdatedBank, revision: 2 }]);

    await syncCloudBankUpdate(SCOPE, localRenamed);
    expect(mock.saveCloudBank).toHaveBeenNthCalledWith(2, mergedExpectation, 2);

    // Deleting when another device already deleted the bank reconciles silently without uncaught rejection
    mock.deleteCloudBank.mockRejectedValueOnce(Object.assign(new Error('Bank changed or was deleted'), { code: '40001' }));
    mock.listCloudBanks.mockResolvedValueOnce([]);
    await expect(syncCloudBankDelete(SCOPE, 'b1')).resolves.toBeUndefined();
    expect(getCloudSyncSnapshot().status).toBe('synced');
  });

  it('surfaces error status on failed writes and recovers via retryCloudSync', async () => {
    await hydrateAccountFromCloud(USER_ID, { force: true });
    const newBank = makeBank('b-fail', '离线新建库', 150);

    mock.saveCloudBank.mockRejectedValueOnce(new Error('network error'));
    await syncCloudBankCreate(SCOPE, newBank);
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'error', pendingCount: 1 });

    mock.saveCloudBank.mockResolvedValueOnce({ bank: newBank, revision: 1 });
    mock.listCloudBanks.mockResolvedValue([{ bank: newBank, revision: 1 }]);
    await retryCloudSync(USER_ID);
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });
  });

  it('merges aiExplanations in mergeStoresThreeWay while respecting remoteResetAt', () => {
    const base = {
      records: {},
      fav: {},
      mastery: {},
      aiExplanations: {
        qShared: { content: '初始解析', updatedAt: 100 },
      },
    };
    const remote = {
      records: {},
      fav: {},
      mastery: {},
      aiExplanations: {
        qShared: { content: '初始解析', updatedAt: 100 },
        qRemote: { content: '远端新解析', updatedAt: 300 },
      },
    };
    const local = {
      records: {},
      fav: {},
      mastery: {},
      aiExplanations: {
        qShared: { content: '本地更新解析', updatedAt: 250, model: 'deepseek-chat' },
        qPreReset: { content: '重置前解析', updatedAt: 150 },
      },
    };

    const merged = mergeStoresThreeWay(base, remote, local, '1970-01-01T00:00:00.200Z');
    expect(merged.aiExplanations?.qShared?.content).toBe('本地更新解析');
    expect(merged.aiExplanations?.qRemote?.content).toBe('远端新解析');
    expect(merged.aiExplanations?.qPreReset).toBeUndefined();
  });

  it('preserves data.questions aiAnalysis across expectedRevision=null, 40001 conflict retries, and debounced queueCloudBankUpdate', async () => {
    const q1 = {
      id: 'q1',
      type: 'choice' as const,
      chapter: 1,
      stem: '题目 1',
      options: ['A', 'B'],
      answer: 0,
      explain: '原始解析',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#1' },
    };
    const q2 = {
      id: 'q2',
      type: 'tf' as const,
      chapter: 1,
      stem: '题目 2',
      answer: true,
      explain: '',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#2' },
    };

    const baseBank: BankRecord = {
      ...makeBank('b-ai', 'AI 解析题库', 100),
      data: {
        ...makeBank('b-ai', 'AI 解析题库', 100).data,
        questions: [q1, q2],
      },
    };

    // Case 1: expectedRevision === null (before hydration) still preserves local aiAnalysis on q1
    const localBeforeHydrate: BankRecord = {
      ...baseBank,
      updatedAt: 200,
      data: {
        ...baseBank.data,
        questions: [{ ...q1, aiAnalysis: '### 【核心考点】\n本地 Q1 解析' }, q2],
      },
    };
    const remoteWithQ2: BankRecord = {
      ...baseBank,
      updatedAt: 150,
      data: {
        ...baseBank.data,
        questions: [q1, { ...q2, aiAnalysis: '远端 Q2 解析' }],
      },
    };
    mock.listCloudBanks.mockResolvedValueOnce([{ bank: remoteWithQ2, revision: 2 }]);
    mock.saveCloudBank.mockImplementationOnce(async (bankArg: BankRecord) => ({
      bank: bankArg,
      revision: 3,
    }));

    await syncCloudBankUpdate(SCOPE, localBeforeHydrate);
    const savedArg1 = mock.saveCloudBank.mock.calls[0]![0] as BankRecord;
    expect(savedArg1.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe(
      '### 【核心考点】\n本地 Q1 解析',
    );
    expect(savedArg1.data.questions.find((q) => q.id === 'q2')?.aiAnalysis).toBe('远端 Q2 解析');

    // Case 2: debounced queueCloudBankUpdate coalesces rapid edits and survives 40001 conflict retry
    setCloudSyncDebounceMs(25);
    mock.listCloudBanks.mockResolvedValue([{ bank: savedArg1, revision: 3 }]);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    const edit1: BankRecord = {
      ...savedArg1,
      updatedAt: 400,
      data: {
        ...savedArg1.data,
        questions: [
          { ...q1, aiAnalysis: '中间态解析' },
          { ...q2, aiAnalysis: '远端 Q2 解析' },
        ],
      },
    };
    const edit2: BankRecord = {
      ...savedArg1,
      updatedAt: 500,
      data: {
        ...savedArg1.data,
        questions: [
          { ...q1, aiAnalysis: '最终版 Q1 解析' },
          { ...q2, aiAnalysis: '远端 Q2 解析' },
        ],
      },
    };
    const remoteConflict: BankRecord = {
      ...savedArg1,
      name: '他端同步改名',
      updatedAt: 450,
      data: {
        ...savedArg1.data,
        meta: { ...savedArg1.data.meta, title: '他端同步改名' },
      },
    };

    mock.listCloudBanks.mockResolvedValueOnce([{ bank: remoteConflict, revision: 4 }]);
    mock.saveCloudBank
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: '40001' }))
      .mockImplementationOnce(async (bankArg: BankRecord) => ({ bank: bankArg, revision: 5 }));

    queueCloudBankUpdate(SCOPE, edit1);
    queueCloudBankUpdate(SCOPE, edit2);
    expect(getCloudSyncSnapshot().pendingCount).toBe(1);

    await flushPendingCloudWrites();
    expect(mock.saveCloudBank).toHaveBeenCalledTimes(3);
    const conflictRetryArg = mock.saveCloudBank.mock.calls[2]![0] as BankRecord;
    expect(conflictRetryArg.name).toBe('他端同步改名');
    expect(conflictRetryArg.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe(
      '最终版 Q1 解析',
    );
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });
  });

  it('does not overwrite newer queued bank update or delete with stale failedBankOps during flushPendingCloudWrites', async () => {
    const q1 = {
      id: 'q1',
      type: 'choice' as const,
      chapter: 1,
      stem: '并发题',
      options: ['A', 'B'],
      answer: 0,
      explain: '',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#1' },
    };
    const base = makeBank('b-race', '竞争题库', 100);
    const hydrated: BankRecord = {
      ...base,
      data: { ...base.data, questions: [q1] },
    };

    mock.listCloudBanks.mockResolvedValueOnce([{ bank: hydrated, revision: 1 }]);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    const bankV1: BankRecord = {
      ...hydrated,
      updatedAt: 200,
      data: { ...hydrated.data, questions: [{ ...q1, aiAnalysis: 'STALE_V1' }] },
    };
    const bankV2: BankRecord = {
      ...hydrated,
      updatedAt: 300,
      data: { ...hydrated.data, questions: [{ ...q1, aiAnalysis: 'NEWER_V2' }] },
    };

    const savedVersions: string[] = [];
    mock.saveCloudBank
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(async (bankArg: BankRecord) => {
        savedVersions.push(bankArg.data.questions[0]?.aiAnalysis ?? '');
        return { bank: bankArg, revision: 2 };
      });

    await syncCloudBankUpdate(SCOPE, bankV1);
    expect(getCloudSyncSnapshot().status).toBe('error');

    queueCloudBankUpdate(SCOPE, bankV2, 50);
    await flushPendingCloudWrites();

    expect(savedVersions).toEqual(['NEWER_V2']);
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });

    // Also ensure syncCloudBankDelete supersedes any prior failed save
    mock.saveCloudBank.mockRejectedValueOnce(new Error('network down again'));
    await syncCloudBankUpdate(SCOPE, bankV2);
    expect(getCloudSyncSnapshot().status).toBe('error');

    mock.deleteCloudBank.mockResolvedValueOnce(undefined);
    await syncCloudBankDelete(SCOPE, 'b-race');
    await flushPendingCloudWrites();
    expect(mock.deleteCloudBank).toHaveBeenCalledWith('b-race', 2);
    expect(savedVersions).toEqual(['NEWER_V2']);
  });

  it('preserves offline-created bank and creates with expectedRevision=0 after queueCloudBankUpdate and flushPendingCloudWrites', async () => {
    const q1 = {
      id: 'q1',
      type: 'choice' as const,
      chapter: 1,
      stem: '离线建库题',
      options: ['A', 'B'],
      answer: 0,
      explain: '',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#1' },
    };
    const createdBase = makeBank('b-offline-create', '离线新建库', 100);
    const created: BankRecord = {
      ...createdBase,
      data: { ...createdBase.data, questions: [q1] },
    };
    const updated: BankRecord = {
      ...created,
      updatedAt: 200,
      data: { ...created.data, questions: [{ ...q1, aiAnalysis: 'AI_EXPLAIN' }] },
    };

    await hydrateAccountFromCloud(USER_ID, { force: true });
    await getBankDb(SCOPE).saveCustomBank(created);

    const savedCalls: Array<{ expectedRevision: number; aiAnalysis: string | undefined }> = [];
    mock.saveCloudBank
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async (bankArg: BankRecord, expectedRevision: number) => {
        savedCalls.push({
          expectedRevision,
          aiAnalysis: bankArg.data.questions[0]?.aiAnalysis,
        });
        return { bank: bankArg, revision: 1 };
      });

    await syncCloudBankCreate(SCOPE, created);
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'error', pendingCount: 1 });

    await getBankDb(SCOPE).saveCustomBank(updated);
    queueCloudBankUpdate(SCOPE, updated, 50);
    await flushPendingCloudWrites();

    const localBanks = await getBankDb(SCOPE).listCustomBanks();
    expect(localBanks.some((b) => b.id === 'b-offline-create')).toBe(true);
    expect(localBanks.find((b) => b.id === 'b-offline-create')?.data.questions[0]?.aiAnalysis).toBe('AI_EXPLAIN');
    expect(savedCalls).toEqual([{ expectedRevision: 0, aiAnalysis: 'AI_EXPLAIN' }]);
    expect(mock.listCloudBanks).toHaveBeenCalledTimes(1); // Only during initial hydrate; never fell back to remote-delete check
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });
  });

  it('preserves bank when in-flight syncCloudBankCreate fails after queueCloudBankUpdate and resolves 40001 if create succeeded remotely', async () => {
    const q1 = {
      id: 'q1',
      type: 'choice' as const,
      chapter: 1,
      stem: '飞行建库题',
      options: ['A', 'B'],
      answer: 0,
      explain: '',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#1' },
    };
    const createdBase = makeBank('b-inflight-create', '飞行新建库', 100);
    const created: BankRecord = {
      ...createdBase,
      data: { ...createdBase.data, questions: [q1] },
    };
    const updated: BankRecord = {
      ...created,
      updatedAt: 200,
      data: { ...created.data, questions: [{ ...q1, aiAnalysis: 'AI_EXPLAIN' }] },
    };

    await hydrateAccountFromCloud(USER_ID, { force: true });
    await getBankDb(SCOPE).saveCustomBank(created);

    // Case A: in-flight create rejects after queueCloudBankUpdate -> flushPendingCloudWrites saves with expectedRevision=0
    let rejectInflight!: (err: Error) => void;
    const savedCallsA: Array<{ expectedRevision: number; aiAnalysis: string | undefined }> = [];
    mock.saveCloudBank
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectInflight = reject;
          }),
      )
      .mockImplementationOnce(async (bankArg: BankRecord, expectedRevision: number) => {
        savedCallsA.push({
          expectedRevision,
          aiAnalysis: bankArg.data.questions[0]?.aiAnalysis,
        });
        return { bank: bankArg, revision: 1 };
      });

    const createPromise = syncCloudBankCreate(SCOPE, created);
    await getBankDb(SCOPE).saveCustomBank(updated);
    queueCloudBankUpdate(SCOPE, updated, 50);
    rejectInflight(new Error('network drop'));
    await createPromise;

    await flushPendingCloudWrites();
    const localBanksA = await getBankDb(SCOPE).listCustomBanks();
    expect(localBanksA.some((b) => b.id === 'b-inflight-create')).toBe(true);
    expect(savedCallsA).toEqual([{ expectedRevision: 0, aiAnalysis: 'AI_EXPLAIN' }]);
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });

    // Case B: create actually succeeded on server before response returned -> 40001 on expectedRevision=0 merges and saves cleanly
    clearCloudSyncSession(USER_ID);
    const created2Base = makeBank('b-create-40001', '隐式成功库', 100);
    const created2: BankRecord = {
      ...created2Base,
      data: { ...created2Base.data, questions: [q1] },
    };
    const updated2: BankRecord = {
      ...created2,
      updatedAt: 200,
      data: { ...created2.data, questions: [{ ...q1, aiAnalysis: 'AI_EXPLAIN_40001' }] },
    };
    mock.listCloudBanks.mockResolvedValueOnce([]);
    await hydrateAccountFromCloud(USER_ID, { force: true });
    await getBankDb(SCOPE).saveCustomBank(created2);

    const savedCallsB: Array<{ expectedRevision: number; aiAnalysis: string | undefined }> = [];
    mock.saveCloudBank
      .mockRejectedValueOnce(new Error('timeout after server commit'))
      .mockRejectedValueOnce(Object.assign(new Error('already exists'), { code: '40001' }))
      .mockImplementationOnce(async (bankArg: BankRecord, expectedRevision: number) => {
        savedCallsB.push({
          expectedRevision,
          aiAnalysis: bankArg.data.questions[0]?.aiAnalysis,
        });
        return { bank: bankArg, revision: 2 };
      });
    mock.listCloudBanks.mockResolvedValueOnce([{ bank: created2, revision: 1 }]);

    await syncCloudBankCreate(SCOPE, created2);
    await getBankDb(SCOPE).saveCustomBank(updated2);
    queueCloudBankUpdate(SCOPE, updated2, 50);
    await flushPendingCloudWrites();

    const localBanksB = await getBankDb(SCOPE).listCustomBanks();
    expect(localBanksB.some((b) => b.id === 'b-create-40001')).toBe(true);
    expect(savedCallsB).toEqual([{ expectedRevision: 1, aiAnalysis: 'AI_EXPLAIN_40001' }]);
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });
  });

  it('does not overwrite unsynced local bank edits in IndexedDB when force-hydrating with pending failedBankOps save', async () => {
    const q1 = {
      id: 'q1',
      type: 'choice' as const,
      chapter: 1,
      stem: '同步失败回放题',
      options: ['A', 'B'],
      answer: 0,
      explain: '',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#1' },
    };
    const base = makeBank('b-failed-save-hydrate', '失败回放题库', 100);
    const remoteRev1: BankRecord = {
      ...base,
      data: { ...base.data, questions: [q1] },
    };
    const localUpdated: BankRecord = {
      ...remoteRev1,
      updatedAt: 200,
      data: { ...remoteRev1.data, questions: [{ ...q1, aiAnalysis: 'LOCAL_AI_1' }] },
    };

    mock.listCloudBanks.mockResolvedValueOnce([{ bank: remoteRev1, revision: 1 }]);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    await getBankDb(SCOPE).saveCustomBank(localUpdated);
    mock.saveCloudBank.mockRejectedValueOnce(new Error('offline'));
    await syncCloudBankUpdate(SCOPE, localUpdated);
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'error', pendingCount: 1 });

    // Force-hydrate returns stale remote rev 1 while failedBankOps holds kind: 'save'
    mock.listCloudBanks.mockResolvedValueOnce([{ bank: remoteRev1, revision: 1 }]);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    const midBanks = await getBankDb(SCOPE).listCustomBanks();
    expect(midBanks.find((b) => b.id === 'b-failed-save-hydrate')?.data.questions[0]?.aiAnalysis).toBe('LOCAL_AI_1');

    const savedCalls: Array<{ expectedRevision: number; aiAnalysis: string | undefined }> = [];
    mock.saveCloudBank.mockImplementationOnce(async (bankArg: BankRecord, expectedRevision: number) => {
      savedCalls.push({
        expectedRevision,
        aiAnalysis: bankArg.data.questions[0]?.aiAnalysis,
      });
      return { bank: bankArg, revision: 2 };
    });

    await flushPendingCloudWrites();

    expect(savedCalls).toEqual([{ expectedRevision: 1, aiAnalysis: 'LOCAL_AI_1' }]);
    const finalBanks = await getBankDb(SCOPE).listCustomBanks();
    expect(finalBanks.find((b) => b.id === 'b-failed-save-hydrate')?.data.questions[0]?.aiAnalysis).toBe('LOCAL_AI_1');
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });
  });

  it('merges failedBankOps save with remote rev 2 on flush after force-hydrate instead of clobbering remote changes (Target 1b)', async () => {
    const q1 = {
      id: 'q1',
      type: 'choice' as const,
      chapter: 1,
      stem: '冲突合并题1',
      options: ['A', 'B'],
      answer: 0,
      explain: '',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#1' },
    };
    const q2 = {
      id: 'q2',
      type: 'choice' as const,
      chapter: 1,
      stem: '冲突合并题2',
      options: ['A', 'B'],
      answer: 1,
      explain: '',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#2' },
    };
    const base = makeBank('b-target-1b', 'Original Name', 100);
    const rev1: BankRecord = {
      ...base,
      data: { ...base.data, questions: [q1, q2] },
    };
    const localUpdated: BankRecord = {
      ...rev1,
      updatedAt: 200,
      data: {
        ...rev1.data,
        questions: [{ ...q1, aiAnalysis: 'LOCAL_AI_1' }, q2],
      },
    };
    const remoteRev2: BankRecord = {
      ...rev1,
      name: 'Remote Renamed',
      updatedAt: 300,
      data: {
        ...rev1.data,
        meta: { ...rev1.data.meta, title: 'Remote Renamed' },
        questions: [q1, { ...q2, aiAnalysis: 'REMOTE_AI_2' }],
      },
    };

    mock.listCloudBanks.mockResolvedValueOnce([{ bank: rev1, revision: 1 }]);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    await getBankDb(SCOPE).saveCustomBank(localUpdated);
    mock.saveCloudBank.mockRejectedValueOnce(new Error('offline'));
    await syncCloudBankUpdate(SCOPE, localUpdated);
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'error', pendingCount: 1 });

    // Remote moves to rev 2 before force-hydrate runs
    let serverBank = structuredClone(remoteRev2);
    let serverRev = 2;
    mock.listCloudBanks.mockImplementation(async () => [{ bank: structuredClone(serverBank), revision: serverRev }]);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    const midBanks = await getBankDb(SCOPE).listCustomBanks();
    expect(midBanks.find((b) => b.id === 'b-target-1b')?.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe('LOCAL_AI_1');

    const saveAttempts: number[] = [];
    mock.saveCloudBank.mockImplementation(async (bankArg: BankRecord, expectedRevision: number) => {
      saveAttempts.push(expectedRevision);
      if (expectedRevision !== serverRev) {
        throw Object.assign(new Error('revision conflict'), { code: '40001' });
      }
      serverRev += 1;
      serverBank = structuredClone(bankArg);
      return { bank: structuredClone(serverBank), revision: serverRev };
    });

    await flushPendingCloudWrites();

    expect(saveAttempts).toEqual([1, 2]);
    expect(serverBank.name).toBe('Remote Renamed');
    expect(serverBank.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe('LOCAL_AI_1');
    expect(serverBank.data.questions.find((q) => q.id === 'q2')?.aiAnalysis).toBe('REMOTE_AI_2');

    const finalBanks = await getBankDb(SCOPE).listCustomBanks();
    const idbBank = finalBanks.find((b) => b.id === 'b-target-1b');
    expect(idbBank?.name).toBe('Remote Renamed');
    expect(idbBank?.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe('LOCAL_AI_1');
    expect(idbBank?.data.questions.find((q) => q.id === 'q2')?.aiAnalysis).toBe('REMOTE_AI_2');
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });
  });

  it('merges pendingBankUpdates with remote rev 2 on flush after force-hydrate instead of clobbering remote changes (Target 1c)', async () => {
    const q1 = {
      id: 'q1',
      type: 'choice' as const,
      chapter: 1,
      stem: '防抖冲突合并题1',
      options: ['A', 'B'],
      answer: 0,
      explain: '',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#1' },
    };
    const q2 = {
      id: 'q2',
      type: 'choice' as const,
      chapter: 1,
      stem: '防抖冲突合并题2',
      options: ['A', 'B'],
      answer: 1,
      explain: '',
      source: { origin: 'comprehensive_bank' as const, file: 'test', ref: '#2' },
    };
    const base = makeBank('b-target-1c', 'Original Name', 100);
    const rev1: BankRecord = {
      ...base,
      data: { ...base.data, questions: [q1, q2] },
    };
    const localUpdated: BankRecord = {
      ...rev1,
      updatedAt: 200,
      data: {
        ...rev1.data,
        questions: [{ ...q1, aiAnalysis: 'LOCAL_AI_1' }, q2],
      },
    };
    const remoteRev2: BankRecord = {
      ...rev1,
      name: 'Remote Renamed',
      updatedAt: 300,
      data: {
        ...rev1.data,
        meta: { ...rev1.data.meta, title: 'Remote Renamed' },
        questions: [q1, { ...q2, aiAnalysis: 'REMOTE_AI_2' }],
      },
    };

    mock.listCloudBanks.mockResolvedValueOnce([{ bank: rev1, revision: 1 }]);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    await getBankDb(SCOPE).saveCustomBank(localUpdated);
    queueCloudBankUpdate(SCOPE, localUpdated, 5000);

    let serverBank = structuredClone(remoteRev2);
    let serverRev = 2;
    mock.listCloudBanks.mockImplementation(async () => [{ bank: structuredClone(serverBank), revision: serverRev }]);
    await hydrateAccountFromCloud(USER_ID, { force: true });

    const saveAttempts: number[] = [];
    mock.saveCloudBank.mockImplementation(async (bankArg: BankRecord, expectedRevision: number) => {
      saveAttempts.push(expectedRevision);
      if (expectedRevision !== serverRev) {
        throw Object.assign(new Error('revision conflict'), { code: '40001' });
      }
      serverRev += 1;
      serverBank = structuredClone(bankArg);
      return { bank: structuredClone(serverBank), revision: serverRev };
    });

    await flushPendingCloudWrites();

    expect(saveAttempts).toEqual([1, 2]);
    expect(serverBank.name).toBe('Remote Renamed');
    expect(serverBank.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe('LOCAL_AI_1');
    expect(serverBank.data.questions.find((q) => q.id === 'q2')?.aiAnalysis).toBe('REMOTE_AI_2');

    const finalBanks = await getBankDb(SCOPE).listCustomBanks();
    const idbBank = finalBanks.find((b) => b.id === 'b-target-1c');
    expect(idbBank?.name).toBe('Remote Renamed');
    expect(idbBank?.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe('LOCAL_AI_1');
    expect(idbBank?.data.questions.find((q) => q.id === 'q2')?.aiAnalysis).toBe('REMOTE_AI_2');
    expect(getCloudSyncSnapshot()).toMatchObject({ status: 'synced', pendingCount: 0 });
  });
});
