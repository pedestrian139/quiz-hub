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

    expect(mock.saveCloudApiConfig).toHaveBeenCalledWith({ ...cloudApi, storageScope: 'local' });
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
});
