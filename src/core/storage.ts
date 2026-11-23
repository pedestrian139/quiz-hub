import type {
  ImportStoreResult,
  MasteryLevel,
  UserRecord,
  UserStore,
} from '../types/quiz';

export const STORAGE_KEY = 'ai-intro-quiz-v1';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function createEmptyStore(): UserStore {
  return {
    records: {},
    fav: {},
    mastery: {},
  };
}

function getSafeStorage(): Storage | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function' &&
      typeof storage.removeItem === 'function'
    ) {
      return storage;
    }
    return null;
  } catch {
    return null;
  }
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
  if (typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0;
  }
  if (Array.isArray(value)) {
    return value.every(
      (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0,
    );
  }
  return false;
}

function normalizeChoice(
  choice: number | number[] | boolean,
): number | number[] | boolean {
  return Array.isArray(choice) ? [...choice] : choice;
}

function parseUserRecord(value: unknown): UserRecord | null {
  if (!isPlainObject(value) || hasDangerousOwnKey(value)) {
    return null;
  }
  if (value.ok !== 0 && value.ok !== 1) {
    return null;
  }
  if (typeof value.ts !== 'number' || !Number.isFinite(value.ts) || value.ts < 0) {
    return null;
  }
  if (value.choice !== undefined && !isValidChoice(value.choice)) {
    return null;
  }
  const record: UserRecord = {
    ok: value.ok,
    ts: value.ts,
  };
  if (value.choice !== undefined) {
    record.choice = normalizeChoice(value.choice);
  }
  return record;
}

function isValidMastery(value: unknown): value is MasteryLevel {
  return value === 0 || value === 1 || value === 2;
}

export function loadStore(): UserStore {
  const storage = getSafeStorage();
  if (!storage) {
    return createEmptyStore();
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return createEmptyStore();
  }

  if (!raw) {
    return createEmptyStore();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyStore();
  }

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

  return store;
}

export function saveStore(store: UserStore): boolean {
  const storage = getSafeStorage();
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function resetStore(): UserStore {
  const storage = getSafeStorage();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage removal errors
    }
  }
  return createEmptyStore();
}

export function exportStoreJson(store: UserStore): string {
  return JSON.stringify(
    {
      records: store.records,
      fav: store.fav,
      mastery: store.mastery,
    },
    null,
    2,
  );
}

export function importStoreJson(raw: string): ImportStoreResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: '导入内容不能为空' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: '无效的 JSON 格式' };
  }

  if (!isPlainObject(parsed) || hasDangerousOwnKey(parsed)) {
    return { ok: false, error: '无效的存档结构：根节点必须为安全对象' };
  }

  if (
    !Object.prototype.hasOwnProperty.call(parsed, 'records') ||
    !Object.prototype.hasOwnProperty.call(parsed, 'fav') ||
    !Object.prototype.hasOwnProperty.call(parsed, 'mastery')
  ) {
    return { ok: false, error: '存档缺少必要字段（records / fav / mastery）' };
  }

  if (!isPlainObject(parsed.records) || hasDangerousOwnKey(parsed.records)) {
    return { ok: false, error: '无效的 records 字段' };
  }
  if (!isPlainObject(parsed.fav) || hasDangerousOwnKey(parsed.fav)) {
    return { ok: false, error: '无效的 fav 字段' };
  }
  if (!isPlainObject(parsed.mastery) || hasDangerousOwnKey(parsed.mastery)) {
    return { ok: false, error: '无效的 mastery 字段' };
  }

  const cleanStore = createEmptyStore();

  for (const key of Object.getOwnPropertyNames(parsed.records)) {
    const validRecord = parseUserRecord(parsed.records[key]);
    if (!validRecord) {
      return { ok: false, error: `records["${key}"] 格式无效` };
    }
    cleanStore.records[key] = validRecord;
  }

  for (const key of Object.getOwnPropertyNames(parsed.fav)) {
    const val = parsed.fav[key];
    if (typeof val !== 'boolean') {
      return { ok: false, error: `fav["${key}"] 必须为布尔值` };
    }
    cleanStore.fav[key] = val;
  }

  for (const key of Object.getOwnPropertyNames(parsed.mastery)) {
    const val = parsed.mastery[key];
    if (!isValidMastery(val)) {
      return { ok: false, error: `mastery["${key}"] 必须为 0、1 或 2` };
    }
    cleanStore.mastery[key] = val;
  }

  return { ok: true, store: cleanStore };
}
