import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_VALID_TS,
  WRONG_BOOK_META_KEY,
  buildWrongBookMarkdown,
  collectWrongBookItems,
  createEmptyMetaStore,
  filterAndSortWrongItems,
  formatWrongTimestamp,
  isValidChoice,
  isValidChoiceForQuestion,
  isWrongRecord,
  loadWrongBookMeta,
  markQuestionMasteredInStore,
  recordRetryWrongInMeta,
  recordRetryWrongInStore,
  saveWrongBookMeta,
  syncWrongBookMetaWithBanks,
} from '../../src/features/wrong-book';
import { accountPracticeScope, LEGACY_GUEST_SCOPE, practiceStorageKey } from '../../src/core/practiceScope';
import type { BankData, Question, UserStore } from '../../src/types/quiz';
import { BUILTIN_AI_BANK_ID, type BankRecord } from '../../src/utils/quizImportTypes';
import { MOCK_CHAPTERS, MOCK_QUESTIONS } from './fixtures/mockBank';

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

function makeBank(id: string, name: string, builtin: boolean, questions: Question[]): BankRecord {
  const data: BankData = {
    meta: {
      title: name,
      version: '1.0',
      generatedAt: '2026-11-26T00:00:00Z',
      counts: {
        total: questions.length,
        byType: {
          choice: questions.filter((q) => q.type === 'choice').length,
          multi: questions.filter((q) => q.type === 'multi').length,
          tf: questions.filter((q) => q.type === 'tf').length,
          short: questions.filter((q) => q.type === 'short').length,
          analysis: questions.filter((q) => q.type === 'analysis').length,
        },
        byOrigin: {
          comprehensive_bank: questions.length,
          video_popup: 0,
          review_notes_synthesized: 0,
        },
      },
    },
    chapters: MOCK_CHAPTERS,
    questions,
  };
  return {
    id,
    name,
    builtin,
    createdAt: 1000,
    updatedAt: 2000,
    data,
  };
}

const CUSTOM_QUESTIONS: Question[] = [
  {
    id: 'custom-q-choice',
    type: 'choice',
    chapter: 1,
    stem: '自定义题库单选题：以下哪个协议用于网页超文本传输？',
    options: ['FTP', 'HTTP', 'SMTP', 'SSH'],
    answer: 1,
    explain: 'HTTP 是超文本传输协议。',
    source: { origin: 'comprehensive_bank', file: 'custom.json', ref: '#1' },
  },
  {
    id: 'custom-q-short',
    type: 'short',
    chapter: 2,
    stem: '自定义题库简答题：简述过拟合的常见缓解方法。',
    answer: '增加训练样本、正则化、Dropout、早停等。',
    explain: '',
    keyPoints: ['正则化（L1/L2）', 'Dropout / 数据增强'],
    source: { origin: 'comprehensive_bank', file: 'custom.json', ref: '#2' },
  },
];

describe('SmartWrongBook core engine, meta & markdown', () => {
  const originalOwnLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

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

  it('detects wrong records via ok === 0 or mismatched objective choice', () => {
    const choiceQ = MOCK_QUESTIONS.find((q) => q.type === 'choice')!;
    const multiQ = MOCK_QUESTIONS.find((q) => q.type === 'multi')!;
    const tfQ = MOCK_QUESTIONS.find((q) => q.type === 'tf')!;
    const shortQ = MOCK_QUESTIONS.find((q) => q.type === 'short')!;

    expect(isWrongRecord(choiceQ, undefined)).toBe(false);
    expect(isWrongRecord(choiceQ, { ok: 0, choice: 0, ts: 100 })).toBe(true);
    // Even if ok === 1 was corrupted, an objective choice failing gradeObjectiveQuestion is flagged wrong
    expect(isWrongRecord(choiceQ, { ok: 1, choice: 0, ts: 100 })).toBe(true);
    expect(isWrongRecord(choiceQ, { ok: 1, choice: choiceQ.answer as number, ts: 100 })).toBe(false);

    // Multi order-insensitive right vs wrong
    const multiAns = multiQ.answer as number[];
    expect(isWrongRecord(multiQ, { ok: 1, choice: [...multiAns].reverse(), ts: 100 })).toBe(false);
    expect(isWrongRecord(multiQ, { ok: 1, choice: [0], ts: 100 })).toBe(true);

    // TF
    expect(isWrongRecord(tfQ, { ok: 1, choice: tfQ.answer as boolean, ts: 100 })).toBe(false);
    expect(isWrongRecord(tfQ, { ok: 1, choice: !(tfQ.answer as boolean), ts: 100 })).toBe(true);

    // Subjective
    expect(isWrongRecord(shortQ, { ok: 0, ts: 100 })).toBe(true);
    expect(isWrongRecord(shortQ, { ok: 1, ts: 100 })).toBe(false);
  });

  it('isolates meta by PracticeScope and defends against corruption, prototype pollution & throwing storage', () => {
    const guestScope = LEGACY_GUEST_SCOPE;
    const accScope = accountPracticeScope('user-42');

    const guestMeta = createEmptyMetaStore();
    guestMeta.byBank[BUILTIN_AI_BANK_ID] = {
      'q-1': {
        wrongCount: 2,
        lastWrongTs: 500,
        lastObservedTs: 500,
        wrongChoices: [{ choice: 0, label: 'A. 1950年', ts: 500 }],
      },
    };
    expect(saveWrongBookMeta(guestMeta, guestScope)).toBe(true);
    expect(loadWrongBookMeta(guestScope).byBank[BUILTIN_AI_BANK_ID]?.['q-1']?.wrongCount).toBe(2);
    expect(loadWrongBookMeta(accScope).byBank).toEqual({});

    // Prototype pollution & malformed JSON defense
    localStorage.setItem(
      practiceStorageKey(WRONG_BOOK_META_KEY, accScope),
      '{"version":1,"byBank":{"__proto__":{"polluted":true},"custom":{"constructor":{"wrongCount":9,"lastWrongTs":1,"lastObservedTs":1,"wrongChoices":[]},"valid":{"wrongCount":3,"lastWrongTs":200,"lastObservedTs":200,"wrongChoices":[{"choice":1,"label":"B","ts":200}]},"bad":{"wrongCount":-1}}}}',
    );
    const loadedAcc = loadWrongBookMeta(accScope);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(loadedAcc.byBank.custom?.valid?.wrongCount).toBe(3);
    expect(loadedAcc.byBank.custom?.bad).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(loadedAcc.byBank.custom ?? {}, 'constructor')).toBe(false);

    localStorage.setItem(practiceStorageKey(WRONG_BOOK_META_KEY, guestScope), '{broken-json');
    expect(loadWrongBookMeta(guestScope)).toEqual(createEmptyMetaStore());

    // Throwing storage
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
    });
    expect(loadWrongBookMeta(guestScope)).toEqual(createEmptyMetaStore());
    expect(saveWrongBookMeta(guestMeta, guestScope)).toBe(false);
  });

  it('tracks baseline wrongCount=1, increments only on newer ts or retry wrong, and avoids double counting', () => {
    const choiceQ = MOCK_QUESTIONS[0]!; // answer = 1
    const builtinBank = makeBank(BUILTIN_AI_BANK_ID, '人工智能导论', true, MOCK_QUESTIONS);

    const store1: UserStore = {
      records: { [choiceQ.id]: { ok: 0, choice: 0, ts: 1000 } },
      fav: {},
      mastery: {},
    };

    // Initial sync sets baseline = 1
    const first = syncWrongBookMetaWithBanks(
      createEmptyMetaStore(),
      [builtinBank],
      { [BUILTIN_AI_BANK_ID]: store1 },
    );
    expect(first.changed).toBe(true);
    expect(first.meta.byBank[BUILTIN_AI_BANK_ID]?.[choiceQ.id]?.wrongCount).toBe(1);
    expect(first.meta.byBank[BUILTIN_AI_BANK_ID]?.[choiceQ.id]?.wrongChoices).toHaveLength(1);

    // Re-syncing with unchanged ts does not increment
    const repeat = syncWrongBookMetaWithBanks(
      first.meta,
      [builtinBank],
      { [BUILTIN_AI_BANK_ID]: store1 },
    );
    expect(repeat.changed).toBe(false);
    expect(repeat.meta.byBank[BUILTIN_AI_BANK_ID]?.[choiceQ.id]?.wrongCount).toBe(1);

    // External newer wrong ts increments count and appends distinct choice
    const store2: UserStore = {
      records: { [choiceQ.id]: { ok: 0, choice: 2, ts: 2000 } },
      fav: {},
      mastery: {},
    };
    const second = syncWrongBookMetaWithBanks(
      repeat.meta,
      [builtinBank],
      { [BUILTIN_AI_BANK_ID]: store2 },
    );
    expect(second.changed).toBe(true);
    const entry2 = second.meta.byBank[BUILTIN_AI_BANK_ID]?.[choiceQ.id]!;
    expect(entry2.wrongCount).toBe(2);
    expect(entry2.wrongChoices.map((c) => c.choice)).toEqual([0, 2]);

    // Retry wrong inside SmartWrongBook + updating store at same ts=3000 must NOT double-count
    const retryMeta = recordRetryWrongInMeta(second.meta, BUILTIN_AI_BANK_ID, choiceQ, 3, 3000);
    const retryStore = recordRetryWrongInStore(store2, choiceQ, 3, 3000);
    const afterRetrySync = syncWrongBookMetaWithBanks(
      retryMeta,
      [builtinBank],
      { [BUILTIN_AI_BANK_ID]: retryStore },
    );
    expect(afterRetrySync.changed).toBe(false);
    const entry3 = afterRetrySync.meta.byBank[BUILTIN_AI_BANK_ID]?.[choiceQ.id]!;
    expect(entry3.wrongCount).toBe(3);
    expect(entry3.lastWrongTs).toBe(3000);
    expect(entry3.wrongChoices.map((c) => c.choice)).toEqual([0, 2, 3]);
  });

  it('aggregates across builtin + custom banks, filters by bank, and sorts by wrongCount / recent', () => {
    const builtinBank = makeBank(BUILTIN_AI_BANK_ID, '人工智能导论', true, MOCK_QUESTIONS);
    const customBank = makeBank('custom-1', '计算机网络精选', false, CUSTOM_QUESTIONS);

    const qBuiltin1 = MOCK_QUESTIONS[0]!; // choice
    const qBuiltin2 = MOCK_QUESTIONS[2]!; // tf
    const qCustom1 = CUSTOM_QUESTIONS[0]!; // choice

    const progressByBank: Record<string, UserStore> = {
      [BUILTIN_AI_BANK_ID]: {
        records: {
          [qBuiltin1.id]: { ok: 0, choice: 0, ts: 1000 },
          [qBuiltin2.id]: { ok: 0, choice: true, ts: 5000 },
          'stale-deleted-id': { ok: 0, choice: 0, ts: 9000 },
        },
        fav: {},
        mastery: {},
      },
      'custom-1': {
        records: {
          [qCustom1.id]: { ok: 0, choice: 0, ts: 3000 },
        },
        fav: {},
        mastery: {},
      },
    };

    let meta = syncWrongBookMetaWithBanks(
      createEmptyMetaStore(),
      [builtinBank, customBank],
      progressByBank,
    ).meta;
    // Bump qBuiltin1 wrongCount to 3
    meta = recordRetryWrongInMeta(meta, BUILTIN_AI_BANK_ID, qBuiltin1, 2, 1500);
    meta = recordRetryWrongInMeta(meta, BUILTIN_AI_BANK_ID, qBuiltin1, 3, 2000);

    const items = collectWrongBookItems([builtinBank, customBank], progressByBank, meta);
    expect(items).toHaveLength(3);
    expect(items.some((it) => it.question.id === 'stale-deleted-id')).toBe(false);

    const byWrongCount = filterAndSortWrongItems(items, { bankId: 'all', sort: 'wrongCount' });
    expect(byWrongCount.map((it) => it.question.id)).toEqual([
      qBuiltin1.id, // wrongCount = 3
      qBuiltin2.id, // wrongCount = 1, ts = 5000
      qCustom1.id, // wrongCount = 1, ts = 3000
    ]);

    const byRecent = filterAndSortWrongItems(items, { bankId: 'all', sort: 'recent' });
    expect(byRecent.map((it) => it.question.id)).toEqual([
      qBuiltin2.id, // ts = 5000
      qCustom1.id, // ts = 3000
      qBuiltin1.id, // ts = 2000
    ]);

    const customOnly = filterAndSortWrongItems(items, { bankId: 'custom-1', sort: 'recent' });
    expect(customOnly).toHaveLength(1);
    expect(customOnly[0]?.bankName).toBe('计算机网络精选');
  });

  it('marks objective and subjective questions as mastered and removes them from wrong items', () => {
    const choiceQ = MOCK_QUESTIONS.find((q) => q.type === 'choice')!;
    const multiQ = MOCK_QUESTIONS.find((q) => q.type === 'multi')!;
    const tfQ = MOCK_QUESTIONS.find((q) => q.type === 'tf')!;
    const shortQ = CUSTOM_QUESTIONS[1]!;

    const customBank = makeBank('custom-1', '自定义题库', false, [
      choiceQ,
      multiQ,
      tfQ,
      shortQ,
    ]);

    let store: UserStore = {
      records: {
        [choiceQ.id]: { ok: 0, choice: 0, ts: 100 },
        [multiQ.id]: { ok: 0, choice: [1], ts: 100 },
        [tfQ.id]: { ok: 0, choice: !(tfQ.answer as boolean), ts: 100 },
        [shortQ.id]: { ok: 0, ts: 100 },
      },
      fav: { [shortQ.id]: true },
      mastery: { [shortQ.id]: 0 },
    };

    store = markQuestionMasteredInStore(store, choiceQ, 200);
    expect(store.records[choiceQ.id]).toEqual({ ok: 1, choice: choiceQ.answer, ts: 200 });

    store = markQuestionMasteredInStore(store, multiQ, 210);
    expect(store.records[multiQ.id]).toEqual({ ok: 1, choice: multiQ.answer, ts: 210 });

    store = markQuestionMasteredInStore(store, tfQ, 220);
    expect(store.records[tfQ.id]).toEqual({ ok: 1, choice: tfQ.answer, ts: 220 });

    store = markQuestionMasteredInStore(store, shortQ, 230);
    expect(store.records[shortQ.id]).toEqual({ ok: 1, ts: 230 });
    expect(store.mastery[shortQ.id]).toBe(2);
    expect(store.fav[shortQ.id]).toBe(true);

    const remaining = collectWrongBookItems(
      [customBank],
      { 'custom-1': store },
      createEmptyMetaStore(),
    );
    expect(remaining).toHaveLength(0);
  });

  it('builds clean Markdown review document without undefined strings', () => {
    const builtinBank = makeBank(BUILTIN_AI_BANK_ID, '人工智能导论', true, MOCK_QUESTIONS);
    const customBank = makeBank('custom-1', '自定义题库', false, CUSTOM_QUESTIONS);
    const choiceQ = MOCK_QUESTIONS[0]!;
    const shortQ = CUSTOM_QUESTIONS[1]!;

    const progressByBank: Record<string, UserStore> = {
      [BUILTIN_AI_BANK_ID]: {
        records: { [choiceQ.id]: { ok: 0, choice: 0, ts: 1700000000000 } },
        fav: {},
        mastery: {},
      },
      'custom-1': {
        records: { [shortQ.id]: { ok: 0, ts: 1700000100000 } },
        fav: {},
        mastery: { [shortQ.id]: 1 },
      },
    };

    const meta = syncWrongBookMetaWithBanks(
      createEmptyMetaStore(),
      [builtinBank, customBank],
      progressByBank,
    ).meta;
    const items = filterAndSortWrongItems(
      collectWrongBookItems([builtinBank, customBank], progressByBank, meta),
      { bankId: 'all', sort: 'wrongCount' },
    );

    const md = buildWrongBookMarkdown(items, {
      bankFilterLabel: '全部题库',
      exportedAt: new Date('2026-11-26T10:30:00Z'),
    });

    expect(md).toContain('# QuizHub 智能错题本复习文档');
    expect(md).toContain('筛选范围：全部题库（共 2 题）');
    expect(md).toContain('人工智能导论');
    expect(md).toContain('自定义题库');
    expect(md).toContain('A. 1950年');
    expect(md).toContain('B. 1956年');
    expect(md).toContain('你的历史错选');
    expect(md).toContain('核心要点');
    expect(md).toContain('正则化（L1/L2）');
    expect(md).not.toContain('undefined');

    const emptyMd = buildWrongBookMarkdown([], { bankFilterLabel: '指定题库' });
    expect(emptyMd).toContain('当前筛选范围内暂无错题');
    expect(emptyMd).not.toContain('undefined');
  });

  it('hardens against null choice, non-finite/negative ts, malformed objective answer mastery, and multiline heading stems', () => {
    const choiceQ = MOCK_QUESTIONS.find((q) => q.type === 'choice')!;
    const badChoiceQ: Question = {
      ...choiceQ,
      id: 'bad-choice-q',
      options: ['OptA', 'OptB'],
      answer: 5, // out-of-range malformed answer
    };
    const multiQ = MOCK_QUESTIONS.find((q) => q.type === 'multi')!;
    const badMultiQ: Question = {
      ...multiQ,
      id: 'bad-multi-q',
      answer: [], // empty malformed answer
    };
    const multilineQ: Question = {
      ...choiceQ,
      id: 'multiline-q',
      stem: 'Line 1\n## FakeH2\r\n  Line 2  ',
    };
    const bank = makeBank('hardening-bank', '边界加固库', false, [
      badChoiceQ,
      badMultiQ,
      multilineQ,
    ]);

    // 1. choice: null with ok: 1 is NOT flagged wrong, and with ok: 0 does not emit "null" snapshot
    expect(isWrongRecord(badChoiceQ, { ok: 1, choice: null as unknown as number, ts: 100 })).toBe(false);
    expect(isWrongRecord(badChoiceQ, { ok: 0, choice: null as unknown as number, ts: 100 })).toBe(true);

    const storeWithCorruption: UserStore = {
      records: {
        [badChoiceQ.id]: { ok: 0, choice: null as unknown as number, ts: Number.NaN },
        [badMultiQ.id]: { ok: 0, choice: [0], ts: -50 },
        [multilineQ.id]: { ok: 0, choice: 0, ts: 200 },
      },
      fav: { [badChoiceQ.id]: true },
      mastery: {},
    };

    const synced = syncWrongBookMetaWithBanks(
      createEmptyMetaStore(),
      [bank],
      { 'hardening-bank': storeWithCorruption },
    );
    expect(synced.meta.byBank['hardening-bank']?.[badChoiceQ.id]?.lastWrongTs).toBe(0);
    expect(synced.meta.byBank['hardening-bank']?.[badChoiceQ.id]?.wrongChoices).toEqual([]);
    expect(synced.meta.byBank['hardening-bank']?.[badMultiQ.id]?.lastWrongTs).toBe(0);

    const items = collectWrongBookItems([bank], { 'hardening-bank': storeWithCorruption }, synced.meta);
    const badChoiceItem = items.find((item) => item.question.id === badChoiceQ.id)!;
    const badMultiItem = items.find((item) => item.question.id === badMultiQ.id)!;
    expect(Number.isFinite(badChoiceItem.lastWrongTs)).toBe(true);
    expect(badChoiceItem.lastWrongTs).toBe(0);
    expect(badChoiceItem.wrongChoices).toEqual([]);
    expect(badMultiItem.lastWrongTs).toBe(0);

    // 2. markQuestionMasteredInStore falls back to { ok: 1, ts } when objective answer is malformed
    let masteredStore = markQuestionMasteredInStore(storeWithCorruption, badChoiceQ, 500);
    masteredStore = markQuestionMasteredInStore(masteredStore, badMultiQ, 510);
    expect(masteredStore.records[badChoiceQ.id]).toEqual({ ok: 1, ts: 500 });
    expect(masteredStore.records[badMultiQ.id]).toEqual({ ok: 1, ts: 510 });
    expect(masteredStore.fav[badChoiceQ.id]).toBe(true);
    const remainingAfterMastery = collectWrongBookItems(
      [bank],
      { 'hardening-bank': masteredStore },
      synced.meta,
    );
    expect(remainingAfterMastery.map((item) => item.question.id)).toEqual([multilineQ.id]);

    // 3. Multiline heading stem is collapsed to single line in Markdown export
    const md = buildWrongBookMarkdown(remainingAfterMastery, {
      bankFilterLabel: '边界加固库',
      exportedAt: new Date('2026-11-26T10:30:00Z'),
    });
    expect(md).toContain('## 1. [单选] Line 1 ## FakeH2 Line 2');
    expect(md).not.toContain('Line 1\n## FakeH2');
    expect(md).not.toContain('NaN');
  });

  it('hardens against corrupted non-null rec.choice, extreme Date overflow ts/exportedAt, and bare CR stems', () => {
    const choiceQ = MOCK_QUESTIONS.find((q) => q.type === 'choice')!;
    const multiQ = MOCK_QUESTIONS.find((q) => q.type === 'multi')!;
    const tfQ = MOCK_QUESTIONS.find((q) => q.type === 'tf')!;
    const bareCrQ: Question = {
      ...choiceQ,
      id: 'bare-cr-q',
      stem: 'Line 1\r## BareCr\rLine 2',
      explain: 'Line A\rLine B',
    };

    expect(isValidChoice(-1)).toBe(false);
    expect(isValidChoice(1.5)).toBe(false);
    expect(isValidChoice([0, -1])).toBe(false);
    expect(isValidChoice({ evil: 1 })).toBe(false);
    expect(isValidChoice(0)).toBe(true);
    expect(isValidChoice([0, 2])).toBe(true);
    expect(isValidChoice(false)).toBe(true);

    const bank = makeBank('corrupt-bank', '异常值加固库', false, [
      choiceQ,
      multiQ,
      tfQ,
      bareCrQ,
    ]);

    const corruptedStore: UserStore = {
      records: {
        [choiceQ.id]: { ok: 0, choice: -1, ts: 1000 },
        [multiQ.id]: { ok: 0, choice: [0, -1], ts: 2000 },
        [tfQ.id]: { ok: 0, choice: { evil: 1 } as unknown as boolean, ts: 3000 },
        [bareCrQ.id]: { ok: 0, choice: 0, ts: 1e20 },
      },
      fav: {},
      mastery: {},
    };

    // 1. syncWrongBookMetaWithBanks ignores corrupted non-null rec.choice (both initial and backfill)
    const synced = syncWrongBookMetaWithBanks(
      createEmptyMetaStore(),
      [bank],
      { 'corrupt-bank': corruptedStore },
    );
    expect(synced.meta.byBank['corrupt-bank']?.[choiceQ.id]?.wrongChoices).toEqual([]);
    expect(synced.meta.byBank['corrupt-bank']?.[multiQ.id]?.wrongChoices).toEqual([]);
    expect(synced.meta.byBank['corrupt-bank']?.[tfQ.id]?.wrongChoices).toEqual([]);

    const backfilled = syncWrongBookMetaWithBanks(
      synced.meta,
      [bank],
      { 'corrupt-bank': corruptedStore },
    );
    expect(backfilled.changed).toBe(false);

    // 2. recordRetryWrongInMeta ignores corrupted non-null choice
    const afterRetry = recordRetryWrongInMeta(
      synced.meta,
      'corrupt-bank',
      choiceQ,
      { evil: 1 } as unknown as number,
      4000,
    );
    expect(afterRetry.byBank['corrupt-bank']?.[choiceQ.id]?.wrongChoices).toEqual([]);

    // 3. collectWrongBookItems fallback ignores corrupted non-null rec.choice
    const collectedWithoutMeta = collectWrongBookItems(
      [bank],
      { 'corrupt-bank': corruptedStore },
      createEmptyMetaStore(),
    );
    for (const item of collectedWithoutMeta) {
      if (item.question.id !== bareCrQ.id) {
        expect(item.wrongChoices).toEqual([]);
      }
    }

    // 4. Date overflow ts: 1e20, invalid exportedAt (NaN / invalid Date), and bare \r stems
    expect(formatWrongTimestamp(1e20)).toBe('暂无记录');
    const bareCrItem = collectedWithoutMeta.find((item) => item.question.id === bareCrQ.id)!;
    for (const badExportedAt of [Number.NaN, new Date('invalid'), 1e20]) {
      const md = buildWrongBookMarkdown([bareCrItem], {
        bankFilterLabel: '异常值加固库',
        exportedAt: badExportedAt,
      });
      expect(md).toContain('## 1. [单选] Line 1 ## BareCr Line 2');
      expect(md).toContain('最近做错**：暂无记录');
      expect(md).toContain('  > Line A\n  > Line B');
      expect(md).not.toContain('NaN');
      expect(md).not.toContain('\r');
    }
  });

  it('rejects empty/sparse/type-mismatched choices without backfill churn or blank Markdown history lines', () => {
    const choiceQ = MOCK_QUESTIONS.find((q) => q.type === 'choice')!;
    const multiQ = MOCK_QUESTIONS.find((q) => q.type === 'multi')!;
    const tfQ = MOCK_QUESTIONS.find((q) => q.type === 'tf')!;
    const shortQ = CUSTOM_QUESTIONS[1]!;
    const analysisQ: Question = {
      ...shortQ,
      id: 'analysis-q',
      type: 'analysis',
    };

    // Sparse array [0, , 2] and empty array []
    // eslint-disable-next-line no-sparse-arrays
    const sparseArr = [0, , 2] as unknown as number[];
    expect(isValidChoice([])).toBe(false);
    expect(isValidChoice(sparseArr)).toBe(false);

    // Type-aware validation
    expect(isValidChoiceForQuestion(choiceQ, 0)).toBe(true);
    expect(isValidChoiceForQuestion(choiceQ, [])).toBe(false);
    expect(isValidChoiceForQuestion(choiceQ, true)).toBe(false);
    expect(isValidChoiceForQuestion(choiceQ, [0])).toBe(false);

    expect(isValidChoiceForQuestion(multiQ, [0, 2])).toBe(true);
    expect(isValidChoiceForQuestion(multiQ, [])).toBe(false);
    expect(isValidChoiceForQuestion(multiQ, sparseArr)).toBe(false);
    expect(isValidChoiceForQuestion(multiQ, 0)).toBe(false);

    expect(isValidChoiceForQuestion(tfQ, false)).toBe(true);
    expect(isValidChoiceForQuestion(tfQ, 0)).toBe(false);

    expect(isValidChoiceForQuestion(shortQ, 0)).toBe(false);
    expect(isValidChoiceForQuestion(analysisQ, true)).toBe(false);

    const bank = makeBank('type-mismatch-bank', '题型匹配测试库', false, [
      choiceQ,
      multiQ,
      tfQ,
      shortQ,
    ]);
    const mismatchedStore: UserStore = {
      records: {
        [choiceQ.id]: { ok: 0, choice: [] as unknown as number, ts: 1000 },
        [multiQ.id]: { ok: 0, choice: sparseArr, ts: 1000 },
        [tfQ.id]: { ok: 0, choice: 0 as unknown as boolean, ts: 1000 },
        [shortQ.id]: { ok: 0, choice: 0, ts: 1000 },
      },
      fav: {},
      mastery: {},
    };

    const synced1 = syncWrongBookMetaWithBanks(
      createEmptyMetaStore(),
      [bank],
      { 'type-mismatch-bank': mismatchedStore },
    );
    expect(synced1.changed).toBe(true);
    expect(synced1.meta.byBank['type-mismatch-bank']?.[choiceQ.id]?.wrongChoices).toEqual([]);
    expect(synced1.meta.byBank['type-mismatch-bank']?.[multiQ.id]?.wrongChoices).toEqual([]);
    expect(synced1.meta.byBank['type-mismatch-bank']?.[tfQ.id]?.wrongChoices).toEqual([]);
    expect(synced1.meta.byBank['type-mismatch-bank']?.[shortQ.id]?.wrongChoices).toEqual([]);

    // Zero save/load backfill churn
    saveWrongBookMeta(synced1.meta, LEGACY_GUEST_SCOPE);
    const reloaded = loadWrongBookMeta(LEGACY_GUEST_SCOPE);
    const synced2 = syncWrongBookMetaWithBanks(
      reloaded,
      [bank],
      { 'type-mismatch-bank': mismatchedStore },
    );
    expect(synced2.changed).toBe(false);

    // Fallback in collectWrongBookItems also ignores type-mismatched/empty/sparse choices
    const itemsNoMeta = collectWrongBookItems(
      [bank],
      { 'type-mismatch-bank': mismatchedStore },
      createEmptyMetaStore(),
    );
    expect(itemsNoMeta).toHaveLength(4);
    for (const item of itemsNoMeta) {
      expect(item.wrongChoices).toEqual([]);
    }

    // Markdown never emits blank "- **你的历史错选**：" lines
    const md = buildWrongBookMarkdown(itemsNoMeta, { bankFilterLabel: '题型匹配测试库' });
    expect(md).not.toMatch(/- \*\*你的历史错选\*\*：\s*(\n|$)/);
    expect(md).toContain('- **你的历史错选**：暂无历史错选记录');
  });

  it('bounds timestamps to MAX_VALID_TS (8.64e15) so recent sort and future external wrongCount increments work', () => {
    expect(MAX_VALID_TS).toBe(8.64e15);
    expect(formatWrongTimestamp(1e20)).toBe('暂无记录');
    expect(formatWrongTimestamp(MAX_VALID_TS)).not.toBe('暂无记录');

    const qOverflow = MOCK_QUESTIONS[0]!;
    const qReal = MOCK_QUESTIONS[1]!;
    const bank = makeBank('ts-bound-bank', '时间戳边界库', false, [qOverflow, qReal]);

    const initialStore: UserStore = {
      records: {
        [qOverflow.id]: { ok: 0, choice: 0, ts: 1e20 },
        [qReal.id]: { ok: 0, choice: [0], ts: 1700000000000 },
      },
      fav: {},
      mastery: {},
    };

    const synced1 = syncWrongBookMetaWithBanks(
      createEmptyMetaStore(),
      [bank],
      { 'ts-bound-bank': initialStore },
    );
    const overflowEntry = synced1.meta.byBank['ts-bound-bank']?.[qOverflow.id]!;
    expect(overflowEntry.lastWrongTs).toBe(0);
    expect(overflowEntry.lastObservedTs).toBe(0);
    expect(overflowEntry.wrongChoices[0]?.ts).toBe(0);
    expect(overflowEntry.wrongCount).toBe(1);

    // recent sort puts real timestamp (1700000000000) ahead of clamped 0
    const items = collectWrongBookItems([bank], { 'ts-bound-bank': initialStore }, synced1.meta);
    const byRecent = filterAndSortWrongItems(items, { sort: 'recent' });
    expect(byRecent.map((it) => it.question.id)).toEqual([qReal.id, qOverflow.id]);

    // Subsequent real external wrong attempt increments wrongCount from 1 -> 2
    const nextStore: UserStore = {
      records: {
        [qOverflow.id]: { ok: 0, choice: 2, ts: 1700000005000 },
        [qReal.id]: { ok: 0, choice: [0], ts: 1700000000000 },
      },
      fav: {},
      mastery: {},
    };
    const synced2 = syncWrongBookMetaWithBanks(
      synced1.meta,
      [bank],
      { 'ts-bound-bank': nextStore },
    );
    expect(synced2.changed).toBe(true);
    expect(synced2.meta.byBank['ts-bound-bank']?.[qOverflow.id]?.wrongCount).toBe(2);
    expect(synced2.meta.byBank['ts-bound-bank']?.[qOverflow.id]?.lastWrongTs).toBe(1700000005000);

    // loadWrongBookMeta discards persisted entries/snapshots with ts > MAX_VALID_TS
    localStorage.setItem(
      practiceStorageKey(WRONG_BOOK_META_KEY, LEGACY_GUEST_SCOPE),
      JSON.stringify({
        version: 1,
        byBank: {
          'ts-bound-bank': {
            [qOverflow.id]: {
              wrongCount: 4,
              lastWrongTs: 1e20,
              lastObservedTs: 1e20,
              wrongChoices: [{ choice: 0, label: 'A', ts: 1e20 }],
            },
          },
        },
      }),
    );
    expect(loadWrongBookMeta(LEGACY_GUEST_SCOPE).byBank).toEqual({});
  });

  it('prevents bare CR and top-level ## heading injection across all Markdown export fields', () => {
    const choiceQ = MOCK_QUESTIONS.find((q) => q.type === 'choice')!;
    const shortQ = CUSTOM_QUESTIONS[1]!;

    const injectedChoiceQ: Question = {
      ...choiceQ,
      id: 'injected-choice',
      chapter: 1,
      stem: 'Stem1\r## StemInjected\nStem2',
      options: [
        'OptA\r## OptionCRInjected\n## OptionLFInjected',
        'OptB\r\n## AnswerInjected',
      ],
      answer: 1,
      explain: 'Exp1\r## ExpCR\nExp2',
    };
    const injectedShortQ: Question = {
      ...shortQ,
      id: 'injected-short',
      chapter: 1,
      stem: 'ShortStem',
      answer: 'RefAns\r## RefInjected',
      explain: 'ShortExp',
      keyPoints: ['KP1\r## KPInjected\nKP2'],
    };

    const injectedBank: BankRecord = {
      ...makeBank('injected-bank', 'BankName\r## BankInjected\nEnd', false, [
        injectedChoiceQ,
        injectedShortQ,
      ]),
      data: {
        ...makeBank('injected-bank', 'BankName\r## BankInjected\nEnd', false, [
          injectedChoiceQ,
          injectedShortQ,
        ]).data,
        chapters: [
          {
            id: 1,
            short: 'ChapShort',
            title: 'Chap\r## ChapInjected\nEnd',
          },
        ],
      },
    };

    const progressByBank: Record<string, UserStore> = {
      'injected-bank': {
        records: {
          [injectedChoiceQ.id]: { ok: 0, choice: 0, ts: 1700000000000 },
          [injectedShortQ.id]: { ok: 0, ts: 1700000000000 },
        },
        fav: {},
        mastery: {},
      },
    };

    const meta = syncWrongBookMetaWithBanks(
      createEmptyMetaStore(),
      [injectedBank],
      progressByBank,
    ).meta;
    const items = collectWrongBookItems([injectedBank], progressByBank, meta);
    const md = buildWrongBookMarkdown(items, {
      bankFilterLabel: 'Filter\r## FilterInjected\nEnd',
      exportedAt: new Date('2026-11-26T10:00:00Z'),
    });

    expect(md.includes('\r')).toBe(false);
    const topLevelH2Headings = md
      .split('\n')
      .filter((line) => line.startsWith('## '));
    expect(topLevelH2Headings).toEqual([
      '## 1. [单选] Stem1 ## StemInjected Stem2',
      '## 2. [简答] ShortStem',
    ]);
    expect(md).toContain('- 筛选范围：Filter ## FilterInjected End（共 2 题）');
    expect(md).toContain('- **所属题库**：BankName ## BankInjected End · Chap ## ChapInjected End');
    expect(md).toContain('  - A. OptA ## OptionCRInjected ## OptionLFInjected');
    expect(md).toContain('- **你的历史错选**：A. OptA ## OptionCRInjected ## OptionLFInjected');
    expect(md).toContain('  - KP1 ## KPInjected KP2');
  });

  it('skips DANGEROUS_KEYS (__proto__, constructor, prototype) in wrongBookEngine', () => {
    const choiceQ = MOCK_QUESTIONS.find((q) => q.type === 'choice')!;
    const protoQ: Question = { ...choiceQ, id: '__proto__' };
    const ctorQ: Question = { ...choiceQ, id: 'constructor' };
    const cleanQ: Question = { ...choiceQ, id: 'safe-q' };

    const evilBank = makeBank('__proto__', 'EvilBank', false, [protoQ, cleanQ]);
    const normalBank = makeBank('normal-bank', 'NormalBank', false, [protoQ, ctorQ, cleanQ]);

    const evilRecords = Object.create(null) as UserStore['records'];
    evilRecords['__proto__'] = { ok: 0, choice: 0, ts: 1000 };
    evilRecords['constructor'] = { ok: 0, choice: 0, ts: 1000 };
    evilRecords['safe-q'] = { ok: 0, choice: 0, ts: 1000 };

    const progressByBank = Object.create(null) as Record<string, UserStore>;
    progressByBank['__proto__'] = { records: evilRecords, fav: {}, mastery: {} };
    progressByBank['normal-bank'] = { records: evilRecords, fav: {}, mastery: {} };

    const items = collectWrongBookItems(
      [evilBank, normalBank],
      progressByBank,
      createEmptyMetaStore(),
    );
    expect(items.map((it) => it.key)).toEqual(['normal-bank::safe-q']);

    const baseStore: UserStore = { records: {}, fav: {}, mastery: {} };
    const afterMastered = markQuestionMasteredInStore(baseStore, protoQ, 2000);
    expect(Object.prototype.hasOwnProperty.call(afterMastered.records, '__proto__')).toBe(false);

    const afterRetry = recordRetryWrongInStore(baseStore, protoQ, 0, 2000);
    expect(Object.prototype.hasOwnProperty.call(afterRetry.records, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).ok).toBeUndefined();
  });
});
