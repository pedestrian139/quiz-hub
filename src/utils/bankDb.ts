import { createEmptyStore, loadStore } from '../core/storage';
import { LEGACY_GUEST_SCOPE, practiceStorageKey } from '../core/practiceScope';
import type { PracticeScope } from '../core/practiceScope';
import type {
  BankData,
  CachedAiExplanation,
  ChapterMeta,
  MasteryLevel,
  Question,
  UserRecord,
  UserStore,
} from '../types/quiz';
import { computeV1BankCounts } from './bankCatalog';
import {
  BUILTIN_AI_BANK_ID,
  BUILTIN_GUIDE_BANK_ID,
  QUIZHUB_SHARE_SCHEMA,
  isBuiltinBankId,
  type BankRecord,
  type ImportSourceFormat,
  type QuizHubSharePackage,
} from './quizImportTypes';

export const DB_NAME = 'quizhub-v2';
export const DB_VERSION = 1;

const STORE_BANKS = 'banks';
const STORE_PROGRESS = 'progress';
const STORE_META = 'meta';

const META_ACTIVE_BANK_ID = 'activeBankId';
const META_V1_MIGRATED = 'v1Migrated';
const META_V1_MIGRATED_AT = 'v1MigratedAt';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface ProgressEntry {
  bankId: string;
  store: UserStore;
  updatedAt: number;
}

interface MetaEntry {
  key: string;
  value: unknown;
}

export interface InitBankDbResult {
  banks: BankRecord[];
  activeBankId: string;
  progressByBank: Record<string, UserStore>;
  migratedFromV1: boolean;
}

export interface CreateCustomBankInput {
  id?: string;
  name: string;
  description?: string;
  sourceFormat?: ImportSourceFormat | 'manual';
  chapters: ChapterMeta[];
  questions: Question[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasDangerousOwnKey(obj: Record<string, unknown>): boolean {
  return Object.getOwnPropertyNames(obj).some((key) => DANGEROUS_KEYS.has(key));
}

function isValidChoice(value: unknown): value is number | number[] | boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0;
  if (Array.isArray(value)) {
    return value.every(
      (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0,
    );
  }
  return false;
}

function parseUserRecord(value: unknown): UserRecord | null {
  if (!isPlainObject(value) || hasDangerousOwnKey(value)) return null;
  if (value.ok !== 0 && value.ok !== 1) return null;
  if (typeof value.ts !== 'number' || !Number.isFinite(value.ts) || value.ts < 0) {
    return null;
  }
  if (value.choice !== undefined && !isValidChoice(value.choice)) return null;
  const record: UserRecord = { ok: value.ok, ts: value.ts };
  if (value.choice !== undefined) {
    record.choice = Array.isArray(value.choice) ? [...value.choice] : value.choice;
  }
  return record;
}

function isValidMastery(value: unknown): value is MasteryLevel {
  return value === 0 || value === 1 || value === 2;
}

function parseCachedAiExplanation(value: unknown): CachedAiExplanation | null {
  if (!isPlainObject(value) || hasDangerousOwnKey(value)) return null;
  if (typeof value.content !== 'string' || value.content.trim().length === 0) return null;
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) {
    return null;
  }
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  return {
    content: value.content,
    updatedAt: value.updatedAt,
    ...(model.length > 0 ? { model } : {}),
  };
}

function normalizeLegacyQuestion(q: Question): Question {
  return {
    ...q,
    explain: typeof q.explain === 'string' ? q.explain : '',
  };
}

export function sanitizeUserStore(parsed: unknown): UserStore {
  if (!isPlainObject(parsed)) {
    return createEmptyStore();
  }
  const store = createEmptyStore();

  if (isPlainObject(parsed.records)) {
    for (const key of Object.getOwnPropertyNames(parsed.records)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const validRecord = parseUserRecord(parsed.records[key]);
      if (validRecord) {
        store.records[key] = validRecord;
      }
    }
  }

  if (isPlainObject(parsed.fav)) {
    for (const key of Object.getOwnPropertyNames(parsed.fav)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const val = parsed.fav[key];
      if (typeof val === 'boolean') {
        store.fav[key] = val;
      }
    }
  }

  if (isPlainObject(parsed.mastery)) {
    for (const key of Object.getOwnPropertyNames(parsed.mastery)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const val = parsed.mastery[key];
      if (isValidMastery(val)) {
        store.mastery[key] = val;
      }
    }
  }

  if (isPlainObject(parsed.aiExplanations)) {
    const aiExplanations: Record<string, CachedAiExplanation> = {};
    for (const key of Object.getOwnPropertyNames(parsed.aiExplanations)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const valid = parseCachedAiExplanation(parsed.aiExplanations[key]);
      if (valid) {
        aiExplanations[key] = valid;
      }
    }
    if (Object.keys(aiExplanations).length > 0) {
      store.aiExplanations = aiExplanations;
    }
  }

  return store;
}

function cloneStore(store: UserStore): UserStore {
  return sanitizeUserStore(store);
}

function cloneBankRecord(bank: BankRecord): BankRecord {
  return structuredClone(bank);
}

export function isStoreNonEmpty(store: UserStore): boolean {
  return (
    Object.keys(store.records).length > 0 ||
    Object.keys(store.fav).length > 0 ||
    Object.keys(store.mastery).length > 0 ||
    (store.aiExplanations !== undefined && Object.keys(store.aiExplanations).length > 0)
  );
}

export function mergeUserStores(older: UserStore, newer: UserStore): UserStore {
  const mergedRecords: Record<string, UserRecord> = { ...older.records };
  for (const [id, rec] of Object.entries(newer.records)) {
    const prev = mergedRecords[id];
    if (!prev || rec.ts >= prev.ts) {
      mergedRecords[id] = rec;
    }
  }
  const mergedAi: Record<string, CachedAiExplanation> = {};
  for (const source of [older.aiExplanations, newer.aiExplanations]) {
    if (!isPlainObject(source)) continue;
    for (const key of Object.getOwnPropertyNames(source)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const valid = parseCachedAiExplanation(source[key]);
      if (!valid) continue;
      const prev = mergedAi[key];
      if (!prev || valid.updatedAt >= prev.updatedAt) {
        mergedAi[key] = valid;
      }
    }
  }
  return {
    records: mergedRecords,
    fav: { ...older.fav, ...newer.fav },
    mastery: { ...older.mastery, ...newer.mastery },
    ...(Object.keys(mergedAi).length > 0 ? { aiExplanations: mergedAi } : {}),
  };
}

function createBankDb(scope: PracticeScope) {
  const memBanks = new Map<string, BankRecord>();
  const memProgress = new Map<string, UserStore>();
  const memMeta = new Map<string, unknown>();

  let openPromise: Promise<IDBDatabase | null> | null = null;
  let cachedDb: IDBDatabase | null = null;
  const progressWriteQueues = new Map<string, Promise<boolean>>();
  let defaultBankId = BUILTIN_GUIDE_BANK_ID;

  function resetFallbackMemoryDb(): void {
    memBanks.clear();
    memProgress.clear();
    memMeta.clear();
  }

  function closeQuizHubDb(): void {
    openPromise = null;
    if (cachedDb) {
      try {
        cachedDb.close();
      } catch {
        // Ignore close errors
      }
      cachedDb = null;
    }
  }

  function openQuizHubDb(): Promise<IDBDatabase | null> {
    if (cachedDb) {
      return Promise.resolve(cachedDb);
    }
    if (openPromise) {
      return openPromise;
    }

    openPromise = new Promise<IDBDatabase | null>((resolve) => {
      let factory: IDBFactory | undefined;
      try {
        factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      } catch {
        openPromise = null;
        resolve(null);
        return;
      }

      if (!factory || typeof factory.open !== 'function') {
        openPromise = null;
        resolve(null);
        return;
      }

      let req: IDBOpenDBRequest;
      try {
        req = factory.open(practiceStorageKey(DB_NAME, scope), DB_VERSION);
      } catch {
        openPromise = null;
        resolve(null);
        return;
      }

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_BANKS)) {
          db.createObjectStore(STORE_BANKS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
          db.createObjectStore(STORE_PROGRESS, { keyPath: 'bankId' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        cachedDb = db;
        db.onversionchange = () => {
          closeQuizHubDb();
        };
        db.onclose = () => {
          if (cachedDb === db) {
            cachedDb = null;
          }
          openPromise = null;
        };
        resolve(db);
      };

      req.onerror = () => {
        openPromise = null;
        resolve(null);
      };

      req.onblocked = () => {
        openPromise = null;
        resolve(null);
      };
    });

    return openPromise;
  }

  function idbReq<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  }

  function txDone(tx: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  async function getMeta(key: string): Promise<unknown> {
    const db = await openQuizHubDb();
    if (!db) {
      return memMeta.get(key);
    }
    try {
      const tx = db.transaction(STORE_META, 'readonly');
      const res = (await idbReq(tx.objectStore(STORE_META).get(key))) as MetaEntry | undefined;
      await txDone(tx);
      return res?.value;
    } catch {
      return memMeta.get(key);
    }
  }

  async function setMeta(key: string, value: unknown): Promise<void> {
    memMeta.set(key, value);
    const db = await openQuizHubDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ key, value } satisfies MetaEntry);
      await txDone(tx);
    } catch {
      // Fallback memory map already updated
    }
  }

  async function listCustomBanks(): Promise<BankRecord[]> {
    const db = await openQuizHubDb();
    let list: BankRecord[];
    if (!db) {
      list = Array.from(memBanks.values()).map(cloneBankRecord);
    } else {
      try {
        const tx = db.transaction(STORE_BANKS, 'readonly');
        const all = (await idbReq(tx.objectStore(STORE_BANKS).getAll())) as BankRecord[];
        await txDone(tx);
        list = Array.isArray(all) ? all.map(cloneBankRecord) : [];
      } catch {
        list = Array.from(memBanks.values()).map(cloneBankRecord);
      }
    }

    return list
      .filter((b) => b && !isBuiltinBankId(b.id) && !b.builtin)
      .map((b) => {
        const safeQuestions = Array.isArray(b.data?.questions)
          ? b.data.questions.map(normalizeLegacyQuestion)
          : [];
        return {
          ...b,
          builtin: false,
          data: {
            ...b.data,
            questions: safeQuestions,
            meta: {
              ...b.data.meta,
              counts: computeV1BankCounts(safeQuestions),
            },
          },
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  }

  async function saveCustomBank(bank: BankRecord, options?: { requireStorage?: boolean }): Promise<BankRecord> {
    if (isBuiltinBankId(bank.id) || bank.builtin) {
      throw new Error('Cannot overwrite built-in example bank');
    }
    const safeQuestions = Array.isArray(bank.data?.questions)
      ? bank.data.questions.map(normalizeLegacyQuestion)
      : [];
    const counts = computeV1BankCounts(safeQuestions);
    const cleanName = bank.name.trim() || '未命名题库';
    const cloned = cloneBankRecord(bank);
    const normalized: BankRecord = {
      ...cloned,
      name: cleanName,
      description: bank.description?.trim() || undefined,
      builtin: false,
      updatedAt: bank.updatedAt || Date.now(),
      data: {
        ...cloned.data,
        questions: safeQuestions,
        meta: {
          ...cloned.data.meta,
          title: cleanName,
          counts,
        },
      },
    };

    const db = await openQuizHubDb();
    if (!db && options?.requireStorage) throw new Error('浏览器题库存储暂不可用。');
    if (db) {
      try {
        const tx = db.transaction(STORE_BANKS, 'readwrite');
        tx.objectStore(STORE_BANKS).put(normalized);
        await txDone(tx);
      } catch (error) {
        if (options?.requireStorage) throw error;
      }
    }
    memBanks.set(normalized.id, cloneBankRecord(normalized));
    return normalized;
  }

  async function createCustomBank(input: CreateCustomBankInput): Promise<BankRecord> {
    const now = Date.now();
    const safeName = input.name.trim() || '未命名题库';
    const id =
      input.id && !isBuiltinBankId(input.id)
        ? input.id
        : `bank-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    const chapters = [...input.chapters].sort((a, b) => a.id - b.id);
    const questions = input.questions.map((q) => normalizeLegacyQuestion(q));
    const data: BankData = {
      meta: {
        title: safeName,
        version: '2.0.0',
        generatedAt: new Date(now).toISOString(),
        counts: computeV1BankCounts(questions),
      },
      chapters,
      questions,
    };

    const record: BankRecord = {
      id,
      name: safeName,
      description: input.description?.trim() || undefined,
      builtin: false,
      createdAt: now,
      updatedAt: now,
      ...(input.sourceFormat ? { sourceFormat: input.sourceFormat } : {}),
      data,
    };

    const saved = await saveCustomBank(record);
    await saveBankProgress(saved.id, createEmptyStore());
    return saved;
  }

  async function renameCustomBank(
    bankId: string,
    newName: string,
    newDescription?: string,
  ): Promise<BankRecord | null> {
    if (isBuiltinBankId(bankId)) {
      return null;
    }
    const trimmed = newName.trim();
    if (!trimmed) {
      return null;
    }

    const banks = await listCustomBanks();
    const target = banks.find((b) => b.id === bankId);
    if (!target || target.builtin) {
      return null;
    }

    const updated: BankRecord = {
      ...target,
      name: trimmed,
      description:
        newDescription !== undefined ? newDescription.trim() || undefined : target.description,
      updatedAt: Date.now(),
      data: {
        ...target.data,
        meta: {
          ...target.data.meta,
          title: trimmed,
        },
      },
    };

    return saveCustomBank(updated);
  }

  async function deleteCustomBank(bankId: string): Promise<boolean> {
    if (isBuiltinBankId(bankId)) {
      return false;
    }

    memBanks.delete(bankId);
    memProgress.delete(bankId);

    const db = await openQuizHubDb();
    if (db) {
      try {
        const tx = db.transaction([STORE_BANKS, STORE_PROGRESS], 'readwrite');
        tx.objectStore(STORE_BANKS).delete(bankId);
        tx.objectStore(STORE_PROGRESS).delete(bankId);
        await txDone(tx);
      } catch {
        // Ignore IDB failure after memory deletion
      }
    }

    const active = await getActiveBankId();
    if (active === bankId) {
      await setActiveBankId(defaultBankId);
    }
    return true;
  }

  async function readAllProgressMap(): Promise<Record<string, UserStore>> {
    const map: Record<string, UserStore> = {};
    const db = await openQuizHubDb();
    if (!db) {
      for (const [id, st] of memProgress.entries()) {
        map[id] = cloneStore(st);
      }
      return map;
    }

    try {
      const tx = db.transaction(STORE_PROGRESS, 'readonly');
      const entries = (await idbReq(tx.objectStore(STORE_PROGRESS).getAll())) as ProgressEntry[];
      await txDone(tx);
      for (const entry of entries) {
        if (entry && typeof entry.bankId === 'string') {
          map[entry.bankId] = sanitizeUserStore(entry.store);
        }
      }
    } catch {
      for (const [id, st] of memProgress.entries()) {
        map[id] = cloneStore(st);
      }
    }
    return map;
  }

  async function getBankProgress(bankId: string): Promise<UserStore> {
    const db = await openQuizHubDb();
    if (!db) {
      return cloneStore(memProgress.get(bankId) ?? createEmptyStore());
    }

    try {
      const tx = db.transaction(STORE_PROGRESS, 'readonly');
      const entry = (await idbReq(tx.objectStore(STORE_PROGRESS).get(bankId))) as
        | ProgressEntry
        | undefined;
      await txDone(tx);
      return entry ? sanitizeUserStore(entry.store) : createEmptyStore();
    } catch {
      return cloneStore(memProgress.get(bankId) ?? createEmptyStore());
    }
  }

  async function writeBankProgressRaw(bankId: string, store: UserStore, requireStorage = false): Promise<boolean> {
    const clean = cloneStore(store);
    memProgress.set(bankId, clean);
    if (bankId === BUILTIN_AI_BANK_ID) {
      memMeta.set(META_V1_MIGRATED, true);
    }

    const db = await openQuizHubDb();
    if (!db) {
      return !requireStorage;
    }

    try {
      const storesToOpen =
        bankId === BUILTIN_AI_BANK_ID ? [STORE_PROGRESS, STORE_META] : [STORE_PROGRESS];
      const tx = db.transaction(storesToOpen, 'readwrite');
      tx.objectStore(STORE_PROGRESS).put({
        bankId,
        store: clean,
        updatedAt: Date.now(),
      } satisfies ProgressEntry);
      if (bankId === BUILTIN_AI_BANK_ID) {
        tx.objectStore(STORE_META).put({
          key: META_V1_MIGRATED,
          value: true,
        } satisfies MetaEntry);
      }
      await txDone(tx);
      return true;
    } catch {
      return false;
    }
  }

  function saveBankProgress(bankId: string, store: UserStore, requireStorage = false): Promise<boolean> {
    const prev = progressWriteQueues.get(bankId) ?? Promise.resolve(true);
    const next = prev.catch(() => true).then(() => writeBankProgressRaw(bankId, store, requireStorage));
    progressWriteQueues.set(bankId, next);
    return next;
  }

  async function resetBankProgress(bankId: string): Promise<UserStore> {
    const empty = createEmptyStore();
    await saveBankProgress(bankId, empty);
    return empty;
  }

  async function getActiveBankId(): Promise<string> {
    const raw = await getMeta(META_ACTIVE_BANK_ID);
    return typeof raw === 'string' && raw.trim().length > 0 ? raw : defaultBankId;
  }

  async function setActiveBankId(bankId: string): Promise<void> {
    await setMeta(META_ACTIVE_BANK_ID, bankId);
  }

  async function initBankDb(
    builtinBank: BankRecord,
    extraProgressIds: readonly string[] = [],
  ): Promise<InitBankDbResult> {
    defaultBankId = builtinBank.id;
    await openQuizHubDb();

    let migratedFromV1 = false;
    const v1MigratedFlag = await getMeta(META_V1_MIGRATED);
    if (v1MigratedFlag !== true) {
      const v1Store = loadStore(scope);
      if (isStoreNonEmpty(v1Store)) {
        const existingBuiltin = await getBankProgress(BUILTIN_AI_BANK_ID);
        const merged = isStoreNonEmpty(existingBuiltin)
          ? mergeUserStores(v1Store, existingBuiltin)
          : v1Store;
        await writeBankProgressRaw(BUILTIN_AI_BANK_ID, merged);
        await setMeta(META_V1_MIGRATED, true);
        await setMeta(META_V1_MIGRATED_AT, Date.now());
        migratedFromV1 = true;
      }
    }

    const customBanks = await listCustomBanks();
    const banks: BankRecord[] = [builtinBank, ...customBanks];
    const validBankIds = new Set([...banks.map((b) => b.id), ...extraProgressIds]);

    const storedProgress = await readAllProgressMap();
    const progressByBank: Record<string, UserStore> = {};
    for (const bankId of validBankIds) {
      progressByBank[bankId] = storedProgress[bankId]
        ? cloneStore(storedProgress[bankId]!)
        : createEmptyStore();
    }

    const rawActiveId = await getMeta(META_ACTIVE_BANK_ID);
    const activeBankId = typeof rawActiveId === 'string' && validBankIds.has(rawActiveId)
      ? rawActiveId
      : builtinBank.id;
    if (activeBankId !== rawActiveId) {
      await setActiveBankId(activeBankId);
    }

    return {
      banks,
      activeBankId,
      progressByBank,
      migratedFromV1,
    };
  }

  return {
    resetFallbackMemoryDb,
    closeQuizHubDb,
    openQuizHubDb,
    listCustomBanks,
    saveCustomBank,
    createCustomBank,
    renameCustomBank,
    deleteCustomBank,
    getBankProgress,
    saveBankProgress,
    resetBankProgress,
    getActiveBankId,
    setActiveBankId,
    initBankDb,
  };
}

const databases = new Map<PracticeScope, ReturnType<typeof createBankDb>>();

export function getBankDb(scope: PracticeScope) {
  let database = databases.get(scope);
  if (!database) {
    database = createBankDb(scope);
    databases.set(scope, database);
  }
  return database;
}

export const {
  resetFallbackMemoryDb,
  closeQuizHubDb,
  openQuizHubDb,
  listCustomBanks,
  saveCustomBank,
  createCustomBank,
  renameCustomBank,
  deleteCustomBank,
  getBankProgress,
  saveBankProgress,
  resetBankProgress,
  getActiveBankId,
  setActiveBankId,
  initBankDb,
} = getBankDb(LEGACY_GUEST_SCOPE);

export function exportBankSharePackage(bank: BankRecord): string {
  const pkg: QuizHubSharePackage = {
    schema: QUIZHUB_SHARE_SCHEMA,
    exportedAt: new Date().toISOString(),
    bank: {
      name: bank.name,
      ...(bank.description ? { description: bank.description } : {}),
      data: {
        ...bank.data,
        meta: {
          ...bank.data.meta,
          title: bank.name,
          counts: computeV1BankCounts(bank.data.questions),
        },
      },
    },
  };
  return JSON.stringify(pkg, null, 2);
}
