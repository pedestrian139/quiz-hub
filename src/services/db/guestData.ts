import { loadStore, STORAGE_KEY } from '../../core/storage';
import { API_CONFIG_STORAGE_KEY, sanitizeApiConfig } from '../apiConfig';
import type { ApiConfig } from '../apiConfig';
import type { UserStore } from '../../types/quiz';
import { closeQuizHubDb, getBankProgress, isStoreNonEmpty, listCustomBanks, openQuizHubDb, sanitizeUserStore } from '../../utils/bankDb';
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
  return readLocal(GUEST_KEY) ?? memoryGuestId;
}

export function startGuest(): string {
  const id = getGuestId() ?? crypto.randomUUID();
  memoryGuestId = id;
  try { globalThis.localStorage.setItem(GUEST_KEY, id); } catch { /* Same-page guest remains available. */ }
  return id;
}

export function endGuest(): void {
  memoryGuestId = null;
  try { globalThis.localStorage.removeItem(GUEST_KEY); } catch { /* Local storage can be disabled. */ }
}

interface StoredProgress { bankId: string; store: unknown; updatedAt: number }
interface BankSnapshot { banks: BankRecord[]; progress: StoredProgress[]; migratedAt?: number }

async function readBankSnapshot(): Promise<BankSnapshot> {
  const database = await openQuizHubDb();
  if (!database) {
    if (globalThis.indexedDB) {
      // The normal app can fall back to memory. Migration must distinguish that from an empty disk snapshot.
      closeQuizHubDb();
      throw new Error('浏览器暂时无法读取题库存储。');
    }
    const banks = await listCustomBanks();
    const progress = await Promise.all([BUILTIN_AI_BANK_ID, ...banks.map(({ id }) => id)].map(async (bankId) => ({
      bankId, store: await getBankProgress(bankId), updatedAt: 0,
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

export async function readGuestData(): Promise<GuestData> {
  const snapshot = await readBankSnapshot();
  const hasLegacyData = globalThis.localStorage.getItem(STORAGE_KEY) !== null;
  const apiConfigText = globalThis.localStorage.getItem(API_CONFIG_STORAGE_KEY);
  const banks = snapshot.banks.filter((bank) => !bank.builtin && bank.id !== BUILTIN_AI_BANK_ID);
  const progressByBank = new Map(snapshot.progress.map((entry) => [entry.bankId, entry]));
  const builtin = mergeBuiltinProgress(loadStore(), hasLegacyData, progressByBank.get(BUILTIN_AI_BANK_ID), snapshot.migratedAt);
  const bankProgress = banks.map(({ id }) => ({ bankId: id, store: sanitizeUserStore(progressByBank.get(id)?.store) }));
  const progress = [{ bankId: BUILTIN_AI_BANK_ID, store: builtin }, ...bankProgress]
    .filter(({ store }) => isStoreNonEmpty(store));
  let raw: unknown = null;
  try { raw = apiConfigText ? JSON.parse(apiConfigText) : null; } catch { /* Corrupt configuration is left in local storage. */ }
  const apiConfig = raw && typeof raw === 'object' && 'provider' in raw && 'baseUrl' in raw && 'model' in raw
    ? sanitizeApiConfig(raw) : null;
  return { banks, progress, apiConfig: apiConfig?.storageScope === 'local' ? apiConfig : null };
}
