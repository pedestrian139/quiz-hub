import { createEmptyStore, loadStore, saveStore, STORAGE_KEY } from '../../core/storage';
import { LEGACY_GUEST_SCOPE, notifyPracticeDataChanged, practiceStorageKey } from '../../core/practiceScope';
import type { AccountPracticeScope, GuestPracticeScope, PracticeScope } from '../../core/practiceScope';
import { API_CONFIG_STORAGE_KEY, sanitizeApiConfig, saveApiConfig } from '../apiConfig';
import type { ApiConfig } from '../apiConfig';
import type { UserStore } from '../../types/quiz';
import { getBankDb, isStoreNonEmpty, mergeUserStores, sanitizeUserStore } from '../../utils/bankDb';
import { BUILTIN_AI_BANK_ID } from '../../utils/quizImportTypes';
import type { BankRecord } from '../../utils/quizImportTypes';

export const GUEST_KEY = 'quizhub-v2:guest';
let memoryGuestId: string | null = null;

export interface GuestData {
  banks: BankRecord[];
  progress: { bankId: string; store: UserStore }[];
  apiConfig: ApiConfig | null;
}

function readLocal(key: string): string | null {
  try { return globalThis.localStorage.getItem(key); } catch { return null; }
}

export function getGuestId(): string | null {
  const persisted = readLocal(GUEST_KEY);
  if (persisted !== null) memoryGuestId = null;
  return persisted ?? memoryGuestId;
}

export function startGuest(): string {
  const id = getGuestId() ?? crypto.randomUUID();
  try {
    globalThis.localStorage.setItem(GUEST_KEY, id);
    memoryGuestId = null;
  } catch {
    if (readLocal(GUEST_KEY) === null) memoryGuestId = id;
  }
  return id;
}

export function endGuest(): void {
  memoryGuestId = null;
  try { globalThis.localStorage.removeItem(GUEST_KEY); } catch { /* Local storage can be disabled. */ }
}

interface StoredProgress { bankId: string; store: unknown; updatedAt: number }
interface BankSnapshot { banks: BankRecord[]; progress: StoredProgress[]; migratedAt?: number }

async function readBankSnapshot(scope: PracticeScope): Promise<BankSnapshot> {
  const bankDb = getBankDb(scope);
  const database = await bankDb.openQuizHubDb();
  if (!database) {
    if (globalThis.indexedDB) {
      // The normal app can fall back to memory. Migration must distinguish that from an empty disk snapshot.
      bankDb.closeQuizHubDb();
      throw new Error('浏览器暂时无法读取题库存储。');
    }
    const banks = await bankDb.listCustomBanks();
    const progress = await Promise.all([BUILTIN_AI_BANK_ID, ...banks.map(({ id }) => id)].map(async (bankId) => ({
      bankId, store: await bankDb.getBankProgress(bankId), updatedAt: 0,
    })));
    return { banks, progress };
  }
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['banks', 'progress', 'meta'], 'readonly');
    const banks = tx.objectStore('banks').getAll();
    const progress = tx.objectStore('progress').getAll();
    const migration = tx.objectStore('meta').get('v1MigratedAt');
    tx.oncomplete = () => resolve({ banks: banks.result, progress: progress.result, migratedAt: migration.result?.value });
    tx.onabort = () => reject(tx.error ?? new Error('读取题库迁移快照失败。'));
  });
}

function mergeBuiltinProgress(
  legacy: UserStore, hasLegacyData: boolean, snapshot: StoredProgress | undefined, migratedAt: number | undefined,
): UserStore {
  if (!snapshot) return legacy;
  const indexed = sanitizeUserStore(snapshot.store);
  if (!hasLegacyData) {
    // A removed V1 key must stay cleared when the only IndexedDB copy was created by the initial import.
    return migratedAt !== undefined && snapshot.updatedAt <= migratedAt ? legacy : indexed;
  }
  if (!isStoreNonEmpty(indexed)) {
    // An IndexedDB reset supersedes legacy answers from before that reset.
    const records = Object.fromEntries(Object.entries(legacy.records).filter(([, item]) => item.ts > snapshot.updatedAt));
    return {
      records,
      fav: Object.fromEntries(Object.entries(legacy.fav).filter(([id]) => Object.hasOwn(records, id))),
      mastery: Object.fromEntries(Object.entries(legacy.mastery).filter(([id]) => Object.hasOwn(records, id))),
    };
  }
  const records = { ...indexed.records, ...legacy.records };
  for (const [id, item] of Object.entries(indexed.records)) {
    if (item.ts > records[id]!.ts) records[id] = item;
  }
  return { records, fav: legacy.fav, mastery: { ...indexed.mastery, ...legacy.mastery } };
}

export async function readGuestData(scope: PracticeScope = LEGACY_GUEST_SCOPE): Promise<GuestData> {
  const snapshot = await readBankSnapshot(scope);
  const hasLegacyData = globalThis.localStorage.getItem(practiceStorageKey(STORAGE_KEY, scope)) !== null;
  const apiConfigText = globalThis.localStorage.getItem(practiceStorageKey(API_CONFIG_STORAGE_KEY, scope));
  const banks = snapshot.banks.filter((bank) => !bank.builtin && bank.id !== BUILTIN_AI_BANK_ID);
  const progressByBank = new Map(snapshot.progress.map((entry) => [entry.bankId, entry]));
  const builtin = mergeBuiltinProgress(loadStore(scope), hasLegacyData, progressByBank.get(BUILTIN_AI_BANK_ID), snapshot.migratedAt);
  const bankProgress = banks.map(({ id }) => ({ bankId: id, store: sanitizeUserStore(progressByBank.get(id)?.store) }));
  const progress = [{ bankId: BUILTIN_AI_BANK_ID, store: builtin }, ...bankProgress]
    .filter(({ store }) => isStoreNonEmpty(store));
  let raw: unknown = null;
  try { raw = apiConfigText ? JSON.parse(apiConfigText) : null; } catch { /* Corrupt configuration is left in local storage. */ }
  const apiConfig = raw && typeof raw === 'object' && 'provider' in raw && 'baseUrl' in raw && 'model' in raw
    ? sanitizeApiConfig(raw) : null;
  return { banks, progress, apiConfig: apiConfig?.storageScope === 'local' ? apiConfig : null };
}

/** Copy a claimed guest snapshot to the account once. Keep the original available for cloud retry. */
export async function adoptGuestData(snapshot: GuestData, source: GuestPracticeScope, target: AccountPracticeScope): Promise<void> {
  const bankDb = getBankDb(target);
  const database = await bankDb.openQuizHubDb();
  if (!database) {
    bankDb.closeQuizHubDb();
    throw new Error('本机账号存储暂不可用。');
  }
  const copied = await new Promise<boolean>((resolve, reject) => {
    const tx = database.transaction(['banks', 'progress', 'meta'], 'readwrite');
    const banks = tx.objectStore('banks');
    const progress = tx.objectStore('progress');
    const meta = tx.objectStore('meta');
    const marker = `adopted:${source}`;
    const adopted = meta.get(marker);
    const existingBanks = banks.getAll();
    const existingProgress = progress.getAll();
    let copied = false;
    let remaining = 3;
    let error: unknown;
    const apply = () => {
      if (--remaining !== 0 || adopted.result) return;
      try {
        const localBanks = new Map<string, BankRecord>((existingBanks.result as BankRecord[]).map((bank) => [bank.id, bank]));
        const localProgress = new Map<string, StoredProgress>((existingProgress.result as StoredProgress[]).map((entry) => [entry.bankId, entry]));
        const importedIds = new Set([BUILTIN_AI_BANK_ID]);
        for (const bank of snapshot.banks) {
          const existing = localBanks.get(bank.id);
          if (!existing) banks.put(bank);
          if (!existing || JSON.stringify(existing.data) === JSON.stringify(bank.data)) importedIds.add(bank.id);
        }
        for (const { bankId, store } of snapshot.progress) {
          if (!importedIds.has(bankId)) continue;
          const previous = localProgress.get(bankId);
          if (previous && !isStoreNonEmpty(sanitizeUserStore(previous.store))) continue;
          const merged = mergeUserStores(store, previous ? sanitizeUserStore(previous.store) : createEmptyStore());
          if (bankId === BUILTIN_AI_BANK_ID && !saveStore(mergeUserStores(merged, loadStore(target)), target)) {
            throw new Error('无法保存账号的本机进度。');
          }
          progress.put({ bankId, store: merged, updatedAt: Date.now() });
        }
        const apiConfigKey = practiceStorageKey(API_CONFIG_STORAGE_KEY, target);
        if (snapshot.apiConfig && !localStorage.getItem(apiConfigKey) && !sessionStorage.getItem(apiConfigKey)
          && !saveApiConfig(snapshot.apiConfig, target)) throw new Error('无法保存账号的本机 API 配置。');
        meta.put({ key: marker, value: true });
        copied = Boolean(snapshot.banks.length || snapshot.progress.length || snapshot.apiConfig);
      } catch (failure) {
        error = failure;
        tx.abort();
      }
    };
    for (const request of [adopted, existingBanks, existingProgress]) request.onsuccess = apply;
    tx.oncomplete = () => resolve(copied);
    tx.onabort = () => reject(error ?? tx.error ?? new Error('无法复制游客数据至本机账号。'));
  });
  if (copied) notifyPracticeDataChanged(target);
}
