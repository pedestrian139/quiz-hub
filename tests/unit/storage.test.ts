import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY,
  createEmptyStore,
  exportStoreJson,
  importStoreJson,
  loadStore,
  resetStore,
  saveStore,
} from '../../src/core/storage';
import type { UserStore } from '../../src/types/quiz';
import { EMPTY_STORE, MOCK_STORE } from './fixtures/mockBank';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('storage', () => {
  const originalOwnLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalOwnLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalOwnLocalStorage);
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('ST-01: uses expected STORAGE_KEY constant', () => {
    expect(STORAGE_KEY).toBe('ai-intro-quiz-v1');
  });

  it('ST-02: fresh loadStore() returns empty store with fresh object references', () => {
    const s1 = loadStore();
    const s2 = loadStore();

    expect(s1).toEqual(EMPTY_STORE);
    expect(s1).toEqual({ records: {}, fav: {}, mastery: {} });
    expect(s1).not.toBe(s2);
    expect(s1.records).not.toBe(s2.records);
    expect(s1.fav).not.toBe(s2.fav);
    expect(s1.mastery).not.toBe(s2.mastery);

    s1.records['qb-c1-choice-01'] = { ok: 1, choice: 1, ts: 100 };
    expect(s2.records).toEqual({});

    const empty = createEmptyStore();
    expect(empty).toEqual(EMPTY_STORE);
    expect(empty).not.toBe(s2);
  });

  it('ST-03: saveStore(MOCK_STORE) and loadStore() roundtrip preserves all fields', () => {
    const saved = saveStore(MOCK_STORE);
    expect(saved).toBe(true);
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    const loaded = loadStore();
    expect(loaded).toEqual(MOCK_STORE);
    expect(loaded).not.toBe(MOCK_STORE);
  });

  it('ST-04: resetStore() removes STORAGE_KEY and subsequent loadStore() returns empty store', () => {
    expect(saveStore(MOCK_STORE)).toBe(true);
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    const cleared = resetStore();
    expect(cleared).toEqual(EMPTY_STORE);
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadStore()).toEqual(EMPTY_STORE);
  });

  it('ST-05: corrupted JSON in localStorage falls back safely to empty store', () => {
    const badPayloads = ['{bad', 'null', '[]', '123', '"hello"', ''];
    for (const raw of badPayloads) {
      globalThis.localStorage.setItem(STORAGE_KEY, raw);
      expect(() => loadStore()).not.toThrow();
      expect(loadStore()).toEqual(EMPTY_STORE);
    }
  });

  it('ST-06: partial/malformed entries in localStorage are sanitized while valid siblings survive', () => {
    const rawWithMixedValidity = `{
      "records": {
        "valid-num": { "ok": 1, "choice": 2, "ts": 1000 },
        "valid-arr": { "ok": 0, "choice": [0, 2], "ts": 2000 },
        "valid-bool": { "ok": 1, "choice": true, "ts": 3000 },
        "valid-no-choice": { "ok": 0, "ts": 0 },
        "bad-ok": { "ok": 2, "ts": 1000 },
        "bad-ts-neg": { "ok": 1, "ts": -1 },
        "bad-ts-null": { "ok": 1, "ts": null },
        "bad-ts-inf": { "ok": 1, "ts": 1e999 },
        "bad-choice-null": { "ok": 1, "choice": null, "ts": 1000 },
        "bad-choice-neg": { "ok": 1, "choice": -1, "ts": 1000 },
        "bad-choice-arr-neg": { "ok": 1, "choice": [1, -2], "ts": 1000 },
        "bad-choice-float": { "ok": 1, "choice": 1.5, "ts": 1000 },
        "bad-choice-str": { "ok": 1, "choice": "A", "ts": 1000 },
        "__proto__": { "ok": 1, "ts": 999, "polluted": true },
        "constructor": { "ok": 1, "ts": 999 }
      },
      "fav": {
        "valid-fav-true": true,
        "valid-fav-false": false,
        "bad-fav-str": "yes",
        "bad-fav-num": 1,
        "prototype": true
      },
      "mastery": {
        "valid-m0": 0,
        "valid-m1": 1,
        "valid-m2": 2,
        "bad-m3": 3,
        "bad-m-neg": -1,
        "bad-m-str": "2",
        "__proto__": 2
      }
    }`;

    globalThis.localStorage.setItem(STORAGE_KEY, rawWithMixedValidity);
    const loaded = loadStore();

    expect(loaded).toEqual({
      records: {
        'valid-num': { ok: 1, choice: 2, ts: 1000 },
        'valid-arr': { ok: 0, choice: [0, 2], ts: 2000 },
        'valid-bool': { ok: 1, choice: true, ts: 3000 },
        'valid-no-choice': { ok: 0, ts: 0 },
      },
      fav: {
        'valid-fav-true': true,
        'valid-fav-false': false,
      },
      mastery: {
        'valid-m0': 0,
        'valid-m1': 1,
        'valid-m2': 2,
      },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(loaded.records, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(loaded.records, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(loaded.fav, 'prototype')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(loaded.mastery, '__proto__')).toBe(false);
  });

  it('ST-07: unavailable or throwing localStorage never throws across loadStore/saveStore/resetStore', () => {
    // 1. undefined localStorage (e.g., SSR)
    vi.stubGlobal('localStorage', undefined);
    expect(() => loadStore()).not.toThrow();
    expect(loadStore()).toEqual(EMPTY_STORE);
    expect(() => saveStore(MOCK_STORE)).not.toThrow();
    expect(saveStore(MOCK_STORE)).toBe(false);
    expect(() => resetStore()).not.toThrow();
    expect(resetStore()).toEqual(EMPTY_STORE);

    // 2. getter throwing SecurityError
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access denied', 'SecurityError');
      },
    });
    expect(() => loadStore()).not.toThrow();
    expect(loadStore()).toEqual(EMPTY_STORE);
    expect(() => saveStore(MOCK_STORE)).not.toThrow();
    expect(saveStore(MOCK_STORE)).toBe(false);
    expect(() => resetStore()).not.toThrow();
    expect(resetStore()).toEqual(EMPTY_STORE);

    // Restore safe own descriptor before stubbing method failures
    delete (globalThis as Record<string, unknown>).localStorage;

    // 3. setItem throwing QuotaExceededError, getItem/removeItem throwing
    const throwingStorage: Storage = {
      length: 0,
      clear() {},
      key() {
        return null;
      },
      getItem() {
        throw new Error('getItem failed');
      },
      setItem() {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      removeItem() {
        throw new Error('removeItem failed');
      },
    };
    vi.stubGlobal('localStorage', throwingStorage);
    expect(() => loadStore()).not.toThrow();
    expect(loadStore()).toEqual(EMPTY_STORE);
    expect(() => saveStore(MOCK_STORE)).not.toThrow();
    expect(saveStore(MOCK_STORE)).toBe(false);
    expect(() => resetStore()).not.toThrow();
    expect(resetStore()).toEqual(EMPTY_STORE);
  });

  it('ST-08: exportStoreJson() + importStoreJson() valid roundtrip with number, number[], and boolean choices', () => {
    const store: UserStore = {
      records: {
        'qb-c1-choice-01': { ok: 1, choice: 1, ts: 1732340000000 },
        'qb-c3-multi-01': { ok: 1, choice: [0, 2], ts: 1732340020000 },
        'qb-c1-tf-01': { ok: 0, choice: false, ts: 1732340010000 },
        'syn-c5-short-01': { ok: 0, ts: 1732340030000 },
      },
      fav: {
        'qb-c1-tf-01': true,
        'vid-c7-choice-01': false,
      },
      mastery: {
        'syn-c5-short-01': 1,
        'syn-c7-analysis-01': 2,
        'syn-c8-short-01': 0,
      },
    };

    const json = exportStoreJson(store);
    const result = importStoreJson(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.store).toEqual(store);
      expect(result.store).not.toBe(store);
      expect(result.store.records['qb-c3-multi-01'].choice).not.toBe(
        store.records['qb-c3-multi-01'].choice,
      );
    }
  });

  it('ST-09: importStoreJson() returns { ok: false, error } for malformed JSON and invalid schemas/values', () => {
    const invalidCases: Array<[string, string]> = [
      ['empty string', ''],
      ['whitespace string', '   \n  '],
      ['malformed JSON', '{bad'],
      ['root null', 'null'],
      ['root array', '[]'],
      ['root primitive', '123'],
      ['missing mastery', '{"records":{},"fav":{}}'],
      ['missing fav', '{"records":{},"mastery":{}}'],
      ['missing records', '{"fav":{},"mastery":{}}'],
      ['records is array', '{"records":[],"fav":{},"mastery":{}}'],
      ['fav is null', '{"records":{},"fav":null,"mastery":{}}'],
      ['mastery is string', '{"records":{},"fav":{},"mastery":"bad"}'],
      ['ok is 2', '{"records":{"q1":{"ok":2,"ts":100}},"fav":{},"mastery":{}}'],
      ['mastery is 3', '{"records":{},"fav":{},"mastery":{"q1":3}}'],
      ['mastery is -1', '{"records":{},"fav":{},"mastery":{"q1":-1}}'],
      ['ts is -1', '{"records":{"q1":{"ok":1,"ts":-1}},"fav":{},"mastery":{}}'],
      ['ts is 1e999 (Infinity)', '{"records":{"q1":{"ok":1,"ts":1e999}},"fav":{},"mastery":{}}'],
      ['ts is null', '{"records":{"q1":{"ok":1,"ts":null}},"fav":{},"mastery":{}}'],
      ['fav is "yes"', '{"records":{},"fav":{"q1":"yes"},"mastery":{}}'],
      ['choice is null', '{"records":{"q1":{"ok":1,"choice":null,"ts":100}},"fav":{},"mastery":{}}'],
      ['choice is [-1]', '{"records":{"q1":{"ok":1,"choice":[-1],"ts":100}},"fav":{},"mastery":{}}'],
      ['choice is -1', '{"records":{"q1":{"ok":1,"choice":-1,"ts":100}},"fav":{},"mastery":{}}'],
      ['choice is 1.5', '{"records":{"q1":{"ok":1,"choice":1.5,"ts":100}},"fav":{},"mastery":{}}'],
      ['choice is "A"', '{"records":{"q1":{"ok":1,"choice":"A","ts":100}},"fav":{},"mastery":{}}'],
    ];

    for (const [label, payload] of invalidCases) {
      const res = importStoreJson(payload);
      expect(res.ok, `expected failure for ${label}`).toBe(false);
      if (!res.ok) {
        expect(typeof res.error).toBe('string');
        expect(res.error.length).toBeGreaterThan(0);
      }
    }
  });

  it('ST-10: importStoreJson() rejects __proto__, constructor, prototype at root and nested levels without polluting Object.prototype', () => {
    const pollutionPayloads = [
      '{"__proto__":{"polluted":"yes"},"records":{},"fav":{},"mastery":{}}',
      '{"constructor":{"prototype":{"polluted":"yes"}},"records":{},"fav":{},"mastery":{}}',
      '{"prototype":{"polluted":"yes"},"records":{},"fav":{},"mastery":{}}',
      '{"records":{"__proto__":{"ok":1,"ts":1}},"fav":{},"mastery":{}}',
      '{"records":{"constructor":{"ok":1,"ts":1}},"fav":{},"mastery":{}}',
      '{"records":{},"fav":{"__proto__":true},"mastery":{}}',
      '{"records":{},"fav":{"prototype":true},"mastery":{}}',
      '{"records":{},"fav":{},"mastery":{"__proto__":2}}',
      '{"records":{},"fav":{},"mastery":{"constructor":1}}',
      '{"records":{"q1":{"ok":1,"ts":1,"__proto__":{"polluted":"yes"}}},"fav":{},"mastery":{}}',
    ];

    for (const payload of pollutionPayloads) {
      const res = importStoreJson(payload);
      expect(res.ok).toBe(false);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it('ST-11: failed importStoreJson() leaves persisted localStorage store and caller objects unmutated', () => {
    saveStore(MOCK_STORE);
    const persistedBefore = globalThis.localStorage.getItem(STORAGE_KEY);
    const callerStoreSnapshot = structuredClone(MOCK_STORE);

    const invalidInputs = [
      '{bad',
      '{"records":{"q1":{"ok":2,"ts":100}},"fav":{},"mastery":{}}',
      '{"records":{"__proto__":{"ok":1,"ts":1}},"fav":{},"mastery":{}}',
    ];

    for (const raw of invalidInputs) {
      const res = importStoreJson(raw);
      expect(res.ok).toBe(false);
      expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(persistedBefore);
      expect(loadStore()).toEqual(MOCK_STORE);
      expect(MOCK_STORE).toEqual(callerStoreSnapshot);
    }
  });
});
