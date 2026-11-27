import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, createEmptyStore, saveStore } from '../../src/core/storage';
import { BUILTIN_AI_BANK, BUILTIN_GUIDE_BANK } from '../../src/utils/bankCatalog';
import {
  closeQuizHubDb,
  createCustomBank,
  deleteCustomBank,
  exportBankSharePackage,
  getActiveBankId,
  getBankProgress,
  initBankDb,
  isStoreNonEmpty,
  mergeUserStores,
  renameCustomBank,
  resetBankProgress,
  resetFallbackMemoryDb,
  sanitizeUserStore,
  saveBankProgress,
  saveCustomBank,
  setActiveBankId,
} from '../../src/utils/bankDb';
import { BUILTIN_AI_BANK_ID, QUIZHUB_SHARE_SCHEMA } from '../../src/utils/quizImportTypes';

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

describe('bankDb (IndexedDB multi-bank storage & V1 migration)', () => {
  beforeEach(() => {
    closeQuizHubDb();
    resetFallbackMemoryDb();
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    closeQuizHubDb();
    resetFallbackMemoryDb();
    vi.unstubAllGlobals();
  });

  it('BD-01: fresh init returns built-in AI bank as active with empty progress and no V1 migration', async () => {
    const res = await initBankDb(BUILTIN_AI_BANK);
    expect(res.migratedFromV1).toBe(false);
    expect(res.activeBankId).toBe(BUILTIN_AI_BANK_ID);
    expect(res.banks).toHaveLength(1);
    expect(res.banks[0]!.id).toBe(BUILTIN_AI_BANK_ID);
    expect(res.banks[0]!.data.questions).toHaveLength(335);
    expect(res.progressByBank[BUILTIN_AI_BANK_ID]).toEqual(createEmptyStore());
  });

  it('BD-02: losslessly migrates V1 localStorage progress into IndexedDB without deleting V1 key, and reset does not resurrect V1', async () => {
    saveStore({
      records: { 'qb-c1-choice-01': { ok: 1, choice: 1, ts: 123456 } },
      fav: { 'qb-c1-choice-01': true },
      mastery: { 'syn-c5-short-01': 2 },
    });

    const firstInit = await initBankDb(BUILTIN_AI_BANK);
    expect(firstInit.migratedFromV1).toBe(true);
    expect(firstInit.progressByBank[BUILTIN_AI_BANK_ID]!.records['qb-c1-choice-01']?.ok).toBe(1);
    expect(firstInit.progressByBank[BUILTIN_AI_BANK_ID]!.fav['qb-c1-choice-01']).toBe(true);
    expect(firstInit.progressByBank[BUILTIN_AI_BANK_ID]!.mastery['syn-c5-short-01']).toBe(2);
    // V1 localStorage key remains intact
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // Second init does not re-migrate
    closeQuizHubDb();
    const secondInit = await initBankDb(BUILTIN_AI_BANK);
    expect(secondInit.migratedFromV1).toBe(false);
    expect(secondInit.progressByBank[BUILTIN_AI_BANK_ID]!.records['qb-c1-choice-01']?.ok).toBe(1);

    // Resetting built-in progress in V2 stays empty across re-init (never resurrects V1)
    await resetBankProgress(BUILTIN_AI_BANK_ID);
    closeQuizHubDb();
    const afterReset = await initBankDb(BUILTIN_AI_BANK);
    expect(afterReset.migratedFromV1).toBe(false);
    expect(afterReset.progressByBank[BUILTIN_AI_BANK_ID]).toEqual(createEmptyStore());
  });

  it('BD-03: supports custom bank create, rename, delete and blocks mutating built-in bank', async () => {
    await initBankDb(BUILTIN_AI_BANK);

    const bankA = await createCustomBank({
      name: '高等数学',
      description: '上册极限与导数',
      chapters: [{ id: 1, short: '极限', title: '第 1 章 极限' }],
      questions: [
        {
          id: 'm1',
          type: 'tf',
          chapter: 1,
          stem: '连续函数一定可导。',
          answer: false,
          explain: '例如 |x| 在 x=0 连续但不可导。',
          source: { origin: 'comprehensive_bank', file: '高等数学', ref: '#1' },
        },
      ],
    });

    expect(bankA.id).not.toBe(BUILTIN_AI_BANK_ID);
    expect(bankA.builtin).toBe(false);

    await setActiveBankId(bankA.id);
    expect(await getActiveBankId()).toBe(bankA.id);

    const renamed = await renameCustomBank(bankA.id, '高等数学（精简版）');
    expect(renamed?.name).toBe('高等数学（精简版）');

    // Built-in protections
    expect(await renameCustomBank(BUILTIN_AI_BANK_ID, 'hacked')).toBeNull();
    expect(await deleteCustomBank(BUILTIN_AI_BANK_ID)).toBe(false);
    await expect(saveCustomBank(BUILTIN_AI_BANK)).rejects.toThrow();

    // Deleting active custom bank falls back to built-in
    expect(await deleteCustomBank(bankA.id)).toBe(true);
    expect(await getActiveBankId()).toBe(BUILTIN_AI_BANK_ID);

    const finalInit = await initBankDb(BUILTIN_AI_BANK);
    expect(finalInit.banks).toHaveLength(1);
  });

  it('BD-04: isolates progress, wrong answers, and favorites strictly per bank', async () => {
    await initBankDb(BUILTIN_AI_BANK);

    const bankA = await createCustomBank({
      name: '题库 A',
      chapters: [{ id: 1, short: '第一章', title: '第一章' }],
      questions: [
        {
          id: 'a1',
          type: 'tf',
          chapter: 1,
          stem: 'A1',
          answer: true,
          explain: '',
          source: { origin: 'comprehensive_bank', file: 'A', ref: '#1' },
        },
      ],
    });
    const bankB = await createCustomBank({
      name: '题库 B',
      chapters: [{ id: 1, short: '第一章', title: '第一章' }],
      questions: [
        {
          id: 'b1',
          type: 'tf',
          chapter: 1,
          stem: 'B1',
          answer: false,
          explain: '',
          source: { origin: 'comprehensive_bank', file: 'B', ref: '#1' },
        },
      ],
    });

    await saveBankProgress(bankA.id, {
      records: { a1: { ok: 0, choice: false, ts: 100 } },
      fav: { a1: true },
      mastery: {},
    });
    await saveBankProgress(bankB.id, {
      records: { b1: { ok: 1, choice: false, ts: 200 } },
      fav: {},
      mastery: {},
    });

    // Clear Bank A only
    await resetBankProgress(bankA.id);
    expect(await getBankProgress(bankA.id)).toEqual(createEmptyStore());
    expect((await getBankProgress(bankB.id)).records.b1?.ok).toBe(1);
    expect(await getBankProgress(BUILTIN_AI_BANK_ID)).toEqual(createEmptyStore());
  });

  it('BD-05: exports valid .quizhub.json share package and degrades gracefully when indexedDB is blocked', async () => {
    const shareJson = exportBankSharePackage(BUILTIN_GUIDE_BANK);
    const parsed = JSON.parse(shareJson) as {
      schema: string;
      bank: { name: string; data: { questions: unknown[] } };
    };
    expect(parsed.schema).toBe(QUIZHUB_SHARE_SCHEMA);
    expect(parsed.bank.name).toBe('QuizHub 使用引导示例题库');
    expect(parsed.bank.data.questions).toHaveLength(3);

    // Simulate SecurityError / blocked indexedDB
    closeQuizHubDb();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });

    const fallbackInit = await initBankDb(BUILTIN_AI_BANK);
    expect(fallbackInit.banks).toHaveLength(1);
    const memCreated = await createCustomBank({
      name: '内存降级题库',
      chapters: [{ id: 1, short: '默认', title: '第 1 章 默认' }],
      questions: [],
    });
    expect(memCreated.name).toBe('内存降级题库');
    const saved = await saveBankProgress(memCreated.id, createEmptyStore());
    expect(saved).toBe(true);
  });

  it('BD-06: normalizes Phase 1 legacy questions missing explain and preserves aiExplanations across sanitize/merge', async () => {
    const legacyQuestion = {
      id: 'legacy-q1',
      type: 'choice' as const,
      chapter: 1,
      stem: '旧题库题目无 explain 字段',
      options: ['A', 'B'],
      answer: 0,
      source: { origin: 'comprehensive_bank' as const, file: 'v1.json', ref: '#1' },
    } as unknown as Parameters<typeof createCustomBank>[0]['questions'][number];

    const created = await createCustomBank({
      name: 'Phase 1 兼容题库',
      chapters: [{ id: 1, short: '第一章', title: '第 1 章' }],
      questions: [legacyQuestion],
    });
    expect(created.data.questions[0]!.explain).toBe('');

    const sanitizedEmpty = sanitizeUserStore({ records: {}, fav: {}, mastery: {}, aiExplanations: {} });
    expect(sanitizedEmpty).toEqual(createEmptyStore());
    expect('aiExplanations' in sanitizedEmpty).toBe(false);

    const storeWithAi = sanitizeUserStore({
      records: {},
      fav: {},
      mastery: {},
      aiExplanations: {
        q1: { content: '### 【核心考点】\n测试', updatedAt: 200, model: 'deepseek-chat' },
      },
    });
    expect(isStoreNonEmpty(storeWithAi)).toBe(true);

    const older = sanitizeUserStore({
      records: {},
      fav: {},
      mastery: {},
      aiExplanations: {
        q1: { content: '旧解析', updatedAt: 100 },
        q2: { content: '仅旧端', updatedAt: 150 },
      },
    });
    const merged = mergeUserStores(older, storeWithAi);
    expect(merged.aiExplanations?.q1?.content).toBe('### 【核心考点】\n测试');
    expect(merged.aiExplanations?.q2?.content).toBe('仅旧端');
  });
});
