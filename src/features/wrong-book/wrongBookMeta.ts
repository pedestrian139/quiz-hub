import { LEGACY_GUEST_SCOPE, practiceStorageKey, type PracticeScope } from '../../core/practiceScope';
import { getOptionLabel, isObjectiveQuestion } from '../../core/questionUtils';
import { gradeObjectiveQuestion } from '../../core/quizEngine';
import type { Question, UserRecord, UserStore } from '../../types/quiz';
import type { BankRecord } from '../../utils/quizImportTypes';
import type {
  WrongBookMetaEntry,
  WrongBookMetaStore,
  WrongChoiceSnapshot,
} from './types';

export const WRONG_BOOK_META_KEY = 'quizhub-v2:wrong-book-meta';

export const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const MAX_VALID_TS = 8.64e15;
const MAX_CHOICE_HISTORY = 20;

export function isValidTimestamp(ts: unknown): ts is number {
  return typeof ts === 'number' && Number.isFinite(ts) && ts >= 0 && ts <= MAX_VALID_TS;
}

export function sanitizeTimestamp(ts: unknown, fallback = 0): number {
  return isValidTimestamp(ts) ? ts : fallback;
}

export function createEmptyMetaStore(): WrongBookMetaStore {
  return {
    version: 1,
    byBank: {},
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

export function isValidChoice(value: unknown): value is number | number[] | boolean {
  if (typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return false;
    }
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        return false;
      }
      const item = value[i];
      if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function isValidChoiceForQuestion(
  q: Question,
  value: unknown,
): value is number | number[] | boolean {
  switch (q.type) {
    case 'choice':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0;
    case 'multi':
      return Array.isArray(value) && isValidChoice(value);
    case 'tf':
      return typeof value === 'boolean';
    case 'short':
    case 'analysis':
      return false;
  }
}

export function normalizeChoiceValue(
  choice: number | number[] | boolean,
): number | number[] | boolean {
  if (Array.isArray(choice)) {
    return Array.from(new Set(choice)).sort((a, b) => a - b);
  }
  return choice;
}

function choiceKey(choice: number | number[] | boolean | null | undefined): string {
  if (choice == null) return 'undefined';
  if (Array.isArray(choice)) {
    return `arr:${normalizeChoiceValue(choice).toString()}`;
  }
  return `${typeof choice}:${String(choice)}`;
}

export function formatChoiceSnapshotLabel(
  q: Question,
  choice: number | number[] | boolean | null | undefined,
): string {
  if (choice == null) {
    return '未作答';
  }
  if (q.type === 'choice' && typeof choice === 'number' && Number.isInteger(choice) && choice >= 0) {
    const label = getOptionLabel(choice);
    const optText = q.options?.[choice];
    return optText !== undefined ? `${label}. ${optText}` : label;
  }
  if (q.type === 'multi' && Array.isArray(choice)) {
    const sorted = Array.from(
      new Set(choice.filter((i) => typeof i === 'number' && Number.isInteger(i) && i >= 0)),
    ).sort((a, b) => a - b);
    if (sorted.length === 0) return '未作答';
    return sorted
      .map((idx) => {
        const label = getOptionLabel(idx);
        const optText = q.options?.[idx];
        return optText !== undefined ? `${label}. ${optText}` : label;
      })
      .join('；');
  }
  if (q.type === 'tf' && typeof choice === 'boolean') {
    return choice ? '正确' : '错误';
  }
  return String(choice);
}

function parseWrongChoiceSnapshot(value: unknown): WrongChoiceSnapshot | null {
  if (!isPlainObject(value) || hasDangerousOwnKey(value)) {
    return null;
  }
  if (typeof value.label !== 'string' || !value.label.trim()) {
    return null;
  }
  if (!isValidTimestamp(value.ts)) {
    return null;
  }
  if (value.choice !== undefined && !isValidChoice(value.choice)) {
    return null;
  }
  return {
    ...(value.choice !== undefined ? { choice: normalizeChoiceValue(value.choice) } : {}),
    label: value.label,
    ts: value.ts,
  };
}

function parseMetaEntry(value: unknown): WrongBookMetaEntry | null {
  if (!isPlainObject(value) || hasDangerousOwnKey(value)) {
    return null;
  }
  if (
    typeof value.wrongCount !== 'number' ||
    !Number.isInteger(value.wrongCount) ||
    value.wrongCount < 1
  ) {
    return null;
  }
  if (!isValidTimestamp(value.lastWrongTs)) {
    return null;
  }
  if (!isValidTimestamp(value.lastObservedTs)) {
    return null;
  }
  const wrongChoices: WrongChoiceSnapshot[] = [];
  if (Array.isArray(value.wrongChoices)) {
    for (const item of value.wrongChoices) {
      const parsed = parseWrongChoiceSnapshot(item);
      if (parsed) {
        wrongChoices.push(parsed);
      }
    }
  }
  return {
    wrongCount: value.wrongCount,
    lastWrongTs: value.lastWrongTs,
    lastObservedTs: value.lastObservedTs,
    wrongChoices: wrongChoices.slice(-MAX_CHOICE_HISTORY),
  };
}

export function loadWrongBookMeta(
  scope: PracticeScope = LEGACY_GUEST_SCOPE,
): WrongBookMetaStore {
  const storage = getSafeStorage();
  if (!storage) {
    return createEmptyMetaStore();
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(practiceStorageKey(WRONG_BOOK_META_KEY, scope));
  } catch {
    return createEmptyMetaStore();
  }

  if (!raw) {
    return createEmptyMetaStore();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyMetaStore();
  }

  if (!isPlainObject(parsed) || !isPlainObject(parsed.byBank)) {
    return createEmptyMetaStore();
  }

  const store = createEmptyMetaStore();
  for (const bankId of Object.getOwnPropertyNames(parsed.byBank)) {
    if (DANGEROUS_KEYS.has(bankId)) continue;
    const bankVal = parsed.byBank[bankId];
    if (!isPlainObject(bankVal)) continue;

    const cleanBankMap: Record<string, WrongBookMetaEntry> = {};
    for (const qId of Object.getOwnPropertyNames(bankVal)) {
      if (DANGEROUS_KEYS.has(qId)) continue;
      const entry = parseMetaEntry(bankVal[qId]);
      if (entry) {
        cleanBankMap[qId] = entry;
      }
    }
    if (Object.keys(cleanBankMap).length > 0) {
      store.byBank[bankId] = cleanBankMap;
    }
  }

  return store;
}

export function saveWrongBookMeta(
  meta: WrongBookMetaStore,
  scope: PracticeScope = LEGACY_GUEST_SCOPE,
): boolean {
  const storage = getSafeStorage();
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(practiceStorageKey(WRONG_BOOK_META_KEY, scope), JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

export function isWrongRecord(q: Question, rec: UserRecord | undefined): boolean {
  if (!rec) return false;
  if (rec.ok === 0) return true;
  if (isObjectiveQuestion(q.type) && rec.choice != null) {
    return !gradeObjectiveQuestion(q, rec.choice).isCorrect;
  }
  return false;
}

function mergeWrongChoice(
  existing: readonly WrongChoiceSnapshot[],
  q: Question,
  choice: number | number[] | boolean | null | undefined,
  ts: number,
): WrongChoiceSnapshot[] {
  if (!isValidChoiceForQuestion(q, choice)) {
    return [...existing];
  }
  const normalized = normalizeChoiceValue(choice);
  const label = formatChoiceSnapshotLabel(q, normalized);
  const key = choiceKey(normalized);
  const next = existing.filter((item) => choiceKey(item.choice) !== key);
  next.push({ choice: normalized, label, ts });
  return next.slice(-MAX_CHOICE_HISTORY);
}

function sameChoices(
  a: readonly WrongChoiceSnapshot[],
  b: readonly WrongChoiceSnapshot[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const itemA = a[i]!;
    const itemB = b[i]!;
    if (
      itemA.label !== itemB.label ||
      itemA.ts !== itemB.ts ||
      choiceKey(itemA.choice) !== choiceKey(itemB.choice)
    ) {
      return false;
    }
  }
  return true;
}

export function syncWrongBookMetaWithBanks(
  meta: WrongBookMetaStore,
  banks: readonly BankRecord[],
  progressByBank: Record<string, UserStore>,
): { meta: WrongBookMetaStore; changed: boolean } {
  let changed = false;
  const nextByBank: Record<string, Record<string, WrongBookMetaEntry>> = {};

  for (const existingBankId of Object.keys(meta.byBank)) {
    if (DANGEROUS_KEYS.has(existingBankId)) continue;
    nextByBank[existingBankId] = { ...meta.byBank[existingBankId] };
  }

  for (const bank of banks) {
    if (DANGEROUS_KEYS.has(bank.id)) continue;
    const store = Object.prototype.hasOwnProperty.call(progressByBank, bank.id)
      ? progressByBank[bank.id]
      : undefined;
    if (!store) continue;

    const bankMeta = nextByBank[bank.id] ? { ...nextByBank[bank.id] } : {};
    let bankChanged = false;

    for (const q of bank.data.questions) {
      if (DANGEROUS_KEYS.has(q.id)) continue;
      const rec = Object.prototype.hasOwnProperty.call(store.records, q.id)
        ? store.records[q.id]
        : undefined;
      if (!isWrongRecord(q, rec) || !rec) {
        continue;
      }

      const safeTs = sanitizeTimestamp(rec.ts, 0);
      const existing = Object.prototype.hasOwnProperty.call(bankMeta, q.id)
        ? bankMeta[q.id]
        : undefined;

      if (!existing) {
        bankMeta[q.id] = {
          wrongCount: 1,
          lastWrongTs: safeTs,
          lastObservedTs: safeTs,
          wrongChoices: mergeWrongChoice([], q, rec.choice, safeTs),
        };
        bankChanged = true;
      } else {
        const existingLastObservedTs = sanitizeTimestamp(existing.lastObservedTs, 0);
        const existingLastWrongTs = sanitizeTimestamp(existing.lastWrongTs, 0);
        if (safeTs > existingLastObservedTs) {
          bankMeta[q.id] = {
            wrongCount: existing.wrongCount + 1,
            lastWrongTs: Math.max(existingLastWrongTs, safeTs),
            lastObservedTs: safeTs,
            wrongChoices: mergeWrongChoice(existing.wrongChoices, q, rec.choice, safeTs),
          };
          bankChanged = true;
        } else if (isValidChoiceForQuestion(q, rec.choice) && existing.wrongChoices.length === 0) {
          const merged = mergeWrongChoice(existing.wrongChoices, q, rec.choice, safeTs);
          if (!sameChoices(existing.wrongChoices, merged)) {
            bankMeta[q.id] = {
              ...existing,
              lastWrongTs: existingLastWrongTs,
              lastObservedTs: existingLastObservedTs,
              wrongChoices: merged,
            };
            bankChanged = true;
          }
        }
      }
    }

    if (bankChanged) {
      nextByBank[bank.id] = bankMeta;
      changed = true;
    }
  }

  if (!changed) {
    return { meta, changed: false };
  }

  return {
    meta: {
      version: 1,
      byBank: nextByBank,
    },
    changed: true,
  };
}

export function recordRetryWrongInMeta(
  meta: WrongBookMetaStore,
  bankId: string,
  q: Question,
  choice: number | number[] | boolean | undefined,
  ts: number = Date.now(),
): WrongBookMetaStore {
  if (DANGEROUS_KEYS.has(bankId) || DANGEROUS_KEYS.has(q.id)) {
    return meta;
  }
  const existingBank = Object.prototype.hasOwnProperty.call(meta.byBank, bankId)
    ? meta.byBank[bankId]
    : undefined;
  const existingEntry =
    existingBank && Object.prototype.hasOwnProperty.call(existingBank, q.id)
      ? existingBank[q.id]
      : undefined;

  const safeTs = isValidTimestamp(ts) ? ts : sanitizeTimestamp(Date.now(), 0);
  const existingLastWrongTs = sanitizeTimestamp(existingEntry?.lastWrongTs, 0);
  const existingLastObservedTs = sanitizeTimestamp(existingEntry?.lastObservedTs, 0);
  const nextEntry: WrongBookMetaEntry = {
    wrongCount: existingEntry ? existingEntry.wrongCount + 1 : 2,
    lastWrongTs: Math.max(existingLastWrongTs, safeTs),
    lastObservedTs: Math.max(existingLastObservedTs, safeTs),
    wrongChoices: mergeWrongChoice(existingEntry?.wrongChoices ?? [], q, choice, safeTs),
  };

  return {
    version: 1,
    byBank: {
      ...meta.byBank,
      [bankId]: {
        ...(existingBank ?? {}),
        [q.id]: nextEntry,
      },
    },
  };
}
