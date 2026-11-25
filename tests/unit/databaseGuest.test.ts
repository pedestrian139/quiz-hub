import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore, saveStore } from '../../src/core/storage';
import { API_CONFIG_STORAGE_KEY, createDefaultApiConfig } from '../../src/services/apiConfig';
import { normalizeAccount } from '../../src/services/db/account';
import { readGuestData } from '../../src/services/db/guestData';
import { savePendingUpgrade, readPendingUpgrade } from '../../src/services/db/guestUpgrade';
import { closeQuizHubDb, createCustomBank, initBankDb, resetBankProgress, saveBankProgress } from '../../src/utils/bankDb';
import { BUILTIN_AI_BANK } from '../../src/utils/bankCatalog';

describe('database accounts and guest migration', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('normalizes alternate sign-in identifiers and rejects reserved aliases', () => {
    expect(normalizeAccount(' USER@example.COM ')).toEqual({ kind: 'email', value: 'user@example.com' });
    expect(normalizeAccount('00123456789')).toEqual({ kind: 'phone', value: '00123456789' });
    expect(() => normalizeAccount('00123456789@phone.quizhub.local')).toThrow();
    expect(() => normalizeAccount('123abc')).toThrow();
  });

  it('binds a pending migration to the selected identity without saving its password', () => {
    const pending = savePendingUpgrade(normalizeAccount('user@example.com'));
    expect(readPendingUpgrade()).toEqual(pending);
    expect(savePendingUpgrade(normalizeAccount('USER@example.com'))).toEqual(pending);
    expect(savePendingUpgrade(normalizeAccount('00123456789')).importId).not.toBe(pending.importId);
  });

  it('reads legacy progress, imported banks and only the locally persistent API configuration', async () => {
    const bank = await createCustomBank({ id: 'guest-test-bank', name: '游客题库', chapters: [], questions: [] });
    const progress = { records: { q1: { ok: 1 as const, ts: 123 } }, fav: { q1: true }, mastery: {} };
    saveStore(progress);
    await saveBankProgress(bank.id, progress);
    const config = { ...createDefaultApiConfig(), apiKey: 'local-key' };
    localStorage.setItem(API_CONFIG_STORAGE_KEY, JSON.stringify(config));
    sessionStorage.setItem(API_CONFIG_STORAGE_KEY, JSON.stringify({ ...config, storageScope: 'session', apiKey: 'session-key' }));

    const data = await readGuestData();
    expect(data.banks.find((entry) => entry.id === bank.id)).toEqual(bank);
    expect(data.progress).toEqual(expect.arrayContaining([
      { bankId: 'builtin-ai-intro', store: progress }, { bankId: bank.id, store: progress },
    ]));
    expect(data.apiConfig?.apiKey).toBe('local-key');
    localStorage.removeItem(API_CONFIG_STORAGE_KEY);
    expect((await readGuestData()).apiConfig).toBeNull();
  });

  it('does not re-upload the old IndexedDB copy after the main built-in progress is cleared', async () => {
    saveStore({ records: { q1: { ok: 1, ts: 123 } }, fav: { q1: true }, mastery: {} });
    expect((await initBankDb(BUILTIN_AI_BANK)).migratedFromV1).toBe(true);
    resetStore();
    expect((await readGuestData()).progress.some(({ bankId }) => bankId === BUILTIN_AI_BANK.id)).toBe(false);
  });

  it('does not restore pre-reset favorites and mastery when newer answers survive', async () => {
    await resetBankProgress(BUILTIN_AI_BANK.id);
    saveStore({ records: { old: { ok: 1, ts: 10 }, recent: { ok: 1, ts: Date.now() + 1000 } },
      fav: { old: true, recent: true }, mastery: { old: 2, recent: 1 } });
    const result = await readGuestData();
    expect(result.progress.find(({ bankId }) => bankId === BUILTIN_AI_BANK.id)?.store).toEqual({
      records: { recent: expect.any(Object) }, fav: { recent: true }, mastery: { recent: 1 },
    });
  });

  it('reports an unreadable persistent snapshot and can retry from the original storage', async () => {
    const bank = await createCustomBank({ name: 'Persistent bank', chapters: [], questions: [] });
    closeQuizHubDb();
    const failedOpen = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('Storage unavailable'); });
    try { await expect(readGuestData()).rejects.toThrow(); } finally { failedOpen.mockRestore(); }
    expect((await readGuestData()).banks.some(({ id }) => id === bank.id)).toBe(true);
  });
});
