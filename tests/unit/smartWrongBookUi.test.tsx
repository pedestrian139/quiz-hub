import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_GUEST_SCOPE,
  accountPracticeScope,
  practiceStorageKey,
  type PracticeScope,
} from '../../src/core/practiceScope';
import { STORAGE_KEY, saveStore } from '../../src/core/storage';
import { SmartWrongBook, SmartWrongBookLauncher } from '../../src/features/wrong-book';
import { PracticeScopeContext } from '../../src/hooks/practiceScope';
import type { Question, UserStore } from '../../src/types/quiz';
import { BUILTIN_AI_BANK } from '../../src/utils/bankCatalog';
import { closeQuizHubDb, getBankDb, resetFallbackMemoryDb } from '../../src/utils/bankDb';
import { BUILTIN_AI_BANK_ID } from '../../src/utils/quizImportTypes';
import { useBankLibrary, type BankLibraryApi } from '../../src/utils/useBankLibrary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function flushAsync(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function waitForSelector(
  container: ParentNode,
  selector: string,
  timeoutMs = 2000,
): Promise<HTMLElement> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = container.querySelector(selector);
    if (el instanceof HTMLElement) {
      return el;
    }
    await flushAsync(2);
  }
  throw new Error(`Timed out waiting for selector: ${selector}`);
}

const CUSTOM_PRACTICE_QUESTIONS: Question[] = [
  {
    id: 'cust-choice-1',
    type: 'choice',
    chapter: 1,
    stem: '自定义单选题：以下哪项是监督学习？',
    options: ['K-Means', '线性回归', 'PCA', 'DBSCAN'],
    answer: 1,
    explain: '线性回归使用带标签数据。',
    source: { origin: 'comprehensive_bank', file: 'cust.json', ref: '#1' },
  },
  {
    id: 'cust-multi-1',
    type: 'multi',
    chapter: 1,
    stem: '自定义多选题：以下哪些属于正则化方法？',
    options: ['L1 正则化', '增大测试集比例', 'Dropout', '移除验证集'],
    answer: [0, 2],
    explain: 'L1 与 Dropout 均可用于缓解过拟合。',
    source: { origin: 'comprehensive_bank', file: 'cust.json', ref: '#2' },
  },
  {
    id: 'cust-analysis-1',
    type: 'analysis',
    chapter: 2,
    stem: '自定义分析题：分析梯度消失的原因及解决思路。',
    answer: '使用 ReLU、残差连接与归一化。',
    explain: '深层网络连乘导致梯度衰减。',
    keyPoints: ['ReLU', '残差连接'],
    source: { origin: 'comprehensive_bank', file: 'cust.json', ref: '#3' },
  },
];

describe('SmartWrongBook UI & hook regression tests', () => {
  let rootHost: HTMLDivElement;
  let roots: Root[] = [];
  const originalOwnLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeEach(() => {
    closeQuizHubDb();
    resetFallbackMemoryDb();
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('indexedDB', new IDBFactory());

    document.body.innerHTML = '';
    rootHost = document.createElement('div');
    rootHost.id = 'root';
    document.body.appendChild(rootHost);
    roots = [];
  });

  afterEach(async () => {
    for (const r of roots) {
      await act(async () => {
        r.unmount();
      });
    }
    roots = [];
    closeQuizHubDb();
    resetFallbackMemoryDb();
    vi.unstubAllGlobals();
    if (originalOwnLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalOwnLocalStorage);
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
    document.body.innerHTML = '';
  });

  function mountWithScope(scope: PracticeScope, node: React.ReactNode): HTMLDivElement {
    const container = document.createElement('div');
    rootHost.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<PracticeScopeContext.Provider value={scope}>{node}</PracticeScopeContext.Provider>);
    });
    return container;
  }

  it('does not ghost stale bankDb builtin progress after guest wipe before mount, and reconciles signed-in wipe immediately', async () => {
    const builtinChoiceQ = BUILTIN_AI_BANK.data.questions.find((q) => q.type === 'choice')!;
    const builtinTfQ = BUILTIN_AI_BANK.data.questions.find((q) => q.type === 'tf')!;

    // 1. Guest wipe BEFORE mount: bankDb holds stale builtin wrong records, localStorage is cleared
    const guestDb = getBankDb(LEGACY_GUEST_SCOPE);
    await guestDb.saveBankProgress(BUILTIN_AI_BANK_ID, {
      records: {
        [builtinChoiceQ.id]: { ok: 0, choice: 0, ts: 1000 },
        [builtinTfQ.id]: { ok: 0, choice: !(builtinTfQ.answer as boolean), ts: 2000 },
      },
      fav: {},
      mastery: {},
    });
    localStorage.removeItem(practiceStorageKey(STORAGE_KEY, LEGACY_GUEST_SCOPE));

    const guestContainer = mountWithScope(LEGACY_GUEST_SCOPE, <SmartWrongBook />);
    await waitForSelector(guestContainer, '[data-testid="wb-empty-state"]');
    expect(guestContainer.querySelectorAll('[data-testid="wb-item-card"]')).toHaveLength(0);
    expect(guestContainer.querySelector('[data-testid="wb-total-badge"]')?.textContent).toContain('共 0 道错题');
    expect(localStorage.getItem(practiceStorageKey(STORAGE_KEY, LEGACY_GUEST_SCOPE))).toBeNull();

    // 2. Signed-in wipe while mounted: key initially exists, then deleted by App.tsx wipe()
    const accScope = accountPracticeScope('user-wipe-test');
    const accStore: UserStore = {
      records: {
        [builtinChoiceQ.id]: { ok: 0, choice: 0, ts: 3000 },
      },
      fav: {},
      mastery: {},
    };
    saveStore(accStore, accScope);
    await getBankDb(accScope).saveBankProgress(BUILTIN_AI_BANK_ID, accStore);

    const accContainer = mountWithScope(accScope, <SmartWrongBook />);
    await waitForSelector(accContainer, '[data-testid="wb-item-card"]');
    expect(accContainer.querySelectorAll('[data-testid="wb-item-card"]')).toHaveLength(1);

    // Simulate App.tsx signed-in wipe: remove scoped localStorage key + pointerdown
    localStorage.removeItem(practiceStorageKey(STORAGE_KEY, accScope));
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await waitForSelector(accContainer, '[data-testid="wb-empty-state"]');
    expect(accContainer.querySelectorAll('[data-testid="wb-item-card"]')).toHaveLength(0);
  });

  it('freezes practice queue order on entry in both recent and wrongCount sorts so retrying wrong never teleports or wipes feedback', async () => {
    const db = getBankDb(LEGACY_GUEST_SCOPE);
    const customBank = await db.createCustomBank({
      id: 'cust-practice-sort',
      name: '排序稳定性测试库',
      chapters: [{ id: 1, short: '一', title: '第一章' }, { id: 2, short: '二', title: '第二章' }],
      questions: CUSTOM_PRACTICE_QUESTIONS,
    });

    // q0 has newest ts (3000) and highest wrongCount (via seeded ts / order)
    // q1 (index 1) and q2 (index 2) have older timestamps
    await db.saveBankProgress(customBank.id, {
      records: {
        'cust-choice-1': { ok: 0, choice: 0, ts: 3000 },
        'cust-multi-1': { ok: 0, choice: [1], ts: 2000 },
        'cust-analysis-1': { ok: 0, ts: 1000 },
      },
      fav: {},
      mastery: { 'cust-analysis-1': 0 },
    });

    const container = mountWithScope(LEGACY_GUEST_SCOPE, <SmartWrongBook />);
    await waitForSelector(container, '[data-testid="wb-item-card"]');

    // A. Switch to 'recent' sort: [choice(3000), multi(2000), analysis(1000)]
    const recentBtn = await waitForSelector(container, '[data-testid="wb-sort-recent"]');
    await act(async () => {
      recentBtn.click();
    });
    const startPracticeBtnA = await waitForSelector(container, '[data-testid="wb-start-practice-btn"]');
    await act(async () => {
      startPracticeBtnA.click();
    });

    // Navigate to index 2 (cust-analysis-1)
    const nextBtnA1 = await waitForSelector(container, '[data-testid="wb-practice-next-btn"]');
    await act(async () => {
      nextBtnA1.click();
    });
    const nextBtnA2 = await waitForSelector(container, '[data-testid="wb-practice-next-btn"]');
    await act(async () => {
      nextBtnA2.click();
    });
    expect(container.querySelector('[data-testid="wb-practice-progress"]')?.textContent).toContain('第 3 / 3 题');
    expect(container.querySelector('[data-testid="wb-practice-stem"]')?.textContent).toContain('梯度消失');

    // Reveal and rate wrong -> lastWrongTs becomes Date.now() (> 3000), must NOT teleport away!
    const revealBtn = await waitForSelector(container, '[data-testid="wb-practice-reveal-btn"]');
    await act(async () => {
      revealBtn.click();
    });
    const subjWrongBtn = await waitForSelector(container, '[data-testid="wb-practice-subjective-wrong-btn"]');
    await act(async () => {
      subjWrongBtn.click();
    });
    await flushAsync();
    expect(container.querySelector('[data-testid="wb-practice-stem"]')?.textContent).toContain('梯度消失');
    expect(container.querySelector('[data-testid="wb-practice-feedback"]')?.textContent).toContain('错误次数已累加');
    expect(container.querySelector('[data-testid="wb-practice-explanation"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wb-practice-wrong-count"]')?.textContent).toContain('累计错误 2 次');

    // B. Exit to list, switch to 'wrongCount' sort: analysis now has wrongCount=2 (index 0), choice=1 (index 1), multi=1 (index 2)
    const backBtn = await waitForSelector(container, '[data-testid="wb-back-to-list-btn"]');
    await act(async () => {
      backBtn.click();
    });
    const sortCountBtn = await waitForSelector(container, '[data-testid="wb-sort-count"]');
    await act(async () => {
      sortCountBtn.click();
    });
    const startPracticeBtnB = await waitForSelector(container, '[data-testid="wb-start-practice-btn"]');
    await act(async () => {
      startPracticeBtnB.click();
    });

    // Navigate to index 1 (cust-choice-1, wrongCount=1) and answer wrong twice to overtake analysis (wrongCount=2 -> 3)
    const nextBtnB = await waitForSelector(container, '[data-testid="wb-practice-next-btn"]');
    await act(async () => {
      nextBtnB.click();
    });
    expect(container.querySelector('[data-testid="wb-practice-stem"]')?.textContent).toContain('监督学习');
    const opt0Btn = await waitForSelector(container, '[data-testid="wb-practice-option-0"]');
    await act(async () => {
      opt0Btn.click();
    });
    const opt2Btn = await waitForSelector(container, '[data-testid="wb-practice-option-2"]');
    await act(async () => {
      opt2Btn.click();
    });
    await flushAsync();
    expect(container.querySelector('[data-testid="wb-practice-stem"]')?.textContent).toContain('监督学习');
    expect(container.querySelector('[data-testid="wb-practice-wrong-count"]')?.textContent).toContain('累计错误 3 次');
    expect(container.querySelector('[data-testid="wb-practice-feedback"]')?.textContent).toContain('回答错误');
  });

  it('allows single-click prev navigation after mastering the trailing item in practice view', async () => {
    const db = getBankDb(LEGACY_GUEST_SCOPE);
    const customBank = await db.createCustomBank({
      id: 'cust-trailing-mastery',
      name: '末尾掌握测试库',
      chapters: [{ id: 1, short: '一', title: '第一章' }, { id: 2, short: '二', title: '第二章' }],
      questions: CUSTOM_PRACTICE_QUESTIONS,
    });
    await db.saveBankProgress(customBank.id, {
      records: {
        'cust-choice-1': { ok: 0, choice: 0, ts: 3000 },
        'cust-multi-1': { ok: 0, choice: [1], ts: 2000 },
        'cust-analysis-1': { ok: 0, ts: 1000 },
      },
      fav: {},
      mastery: { 'cust-analysis-1': 0 },
    });

    const container = mountWithScope(LEGACY_GUEST_SCOPE, <SmartWrongBook />);
    await waitForSelector(container, '[data-testid="wb-item-card"]');

    const recentBtn = await waitForSelector(container, '[data-testid="wb-sort-recent"]');
    await act(async () => {
      recentBtn.click();
    });
    const startPracticeBtn = await waitForSelector(container, '[data-testid="wb-start-practice-btn"]');
    await act(async () => {
      startPracticeBtn.click();
    });
    const nextBtn1 = await waitForSelector(container, '[data-testid="wb-practice-next-btn"]');
    await act(async () => {
      nextBtn1.click();
    });
    const nextBtn2 = await waitForSelector(container, '[data-testid="wb-practice-next-btn"]');
    await act(async () => {
      nextBtn2.click();
    });
    expect(container.querySelector('[data-testid="wb-practice-progress"]')?.textContent).toContain('第 3 / 3 题');

    // Mark trailing item (#3) mastered -> clamps to 第 2 / 2 题
    const masteredBtn = await waitForSelector(container, '[data-testid="wb-practice-mastered-btn"]');
    await act(async () => {
      masteredBtn.click();
    });
    await flushAsync();
    expect(container.querySelector('[data-testid="wb-practice-progress"]')?.textContent).toContain('第 2 / 2 题');

    // Single click on 上一题 must immediately move to 第 1 / 2 题
    const prevBtn = await waitForSelector(container, '[data-testid="wb-practice-prev-btn"]');
    await act(async () => {
      prevBtn.click();
    });
    expect(container.querySelector('[data-testid="wb-practice-progress"]')?.textContent).toContain('第 1 / 2 题');
    expect(container.querySelector('[data-testid="wb-practice-stem"]')?.textContent).toContain('监督学习');
  });

  it('synchronizes custom-bank markMastered across SmartWrongBookLauncher badge and sibling useBankLibrary, isolates non-Escape keys inside modal, uses unique useId headings, and resets deleted bank filter', async () => {
    const db = getBankDb(LEGACY_GUEST_SCOPE);
    const customBank = await db.createCustomBank({
      id: 'cust-sync-bank',
      name: '同步测试题库',
      chapters: [{ id: 1, short: '一', title: '第一章' }],
      questions: [CUSTOM_PRACTICE_QUESTIONS[0]!],
    });
    await db.saveBankProgress(customBank.id, {
      records: { 'cust-choice-1': { ok: 0, choice: 0, ts: 5000 } },
      fav: {},
      mastery: {},
    });

    let siblingApi: BankLibraryApi | null = null;
    function SiblingBankObserver({ onReady }: { onReady: (api: BankLibraryApi) => void }) {
      const api = useBankLibrary();
      useEffect(() => {
        onReady(api);
      }, [api, onReady]);
      return null;
    }

    const quizSessionKeys: string[] = [];
    const onQuizWindowKey = (e: KeyboardEvent) => {
      quizSessionKeys.push(e.key);
    };
    window.addEventListener('keydown', onQuizWindowKey);

    try {
      const host = mountWithScope(
        LEGACY_GUEST_SCOPE,
        <>
          <SiblingBankObserver onReady={(api) => { siblingApi = api; }} />
          <SmartWrongBookLauncher />
        </>,
      );

      await waitForSelector(host, '[data-testid="wb-launcher-count"]');
      await flushAsync();
      expect(host.querySelector('[data-testid="wb-launcher-count"]')?.textContent).toBe('待巩固 1 题');

      // Open modal
      const openBtn = await waitForSelector(host, '[data-testid="wb-open-btn"]');
      await act(async () => {
        openBtn.click();
      });
      const modal = await waitForSelector(document.body, '[data-testid="wb-modal"]');
      const titleId = modal.getAttribute('aria-labelledby');
      expect(titleId).toBeTruthy();
      expect(modal.querySelector(`#${CSS.escape(titleId!)}`)?.textContent).toContain('智能错题本');

      // Non-Escape keys inside modal do not reach QuizSession window bubble listener
      const closeBtn = await waitForSelector(modal, '[data-testid="wb-close-btn"]');
      await act(async () => {
        closeBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        closeBtn.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
      });
      expect(quizSessionKeys).toEqual([]);

      // Mark custom-bank item mastered inside modal -> close modal -> badge & sibling useBankLibrary updated
      const itemMasteredBtn = await waitForSelector(modal, '[data-testid="wb-item-mastered-btn"]');
      await act(async () => {
        itemMasteredBtn.click();
      });
      await waitForSelector(modal, '[data-testid="wb-empty-state"]');
      await flushAsync();

      await act(async () => {
        closeBtn.click();
      });
      await flushAsync();

      expect(host.querySelector('[data-testid="wb-launcher-count"]')?.textContent).toBe('暂无错题');
      expect(siblingApi!.getProgressFor(customBank.id).records['cust-choice-1']).toMatchObject({
        ok: 1,
        choice: 1,
      });
    } finally {
      window.removeEventListener('keydown', onQuizWindowKey);
    }

    // Two standalone SmartWrongBook instances get distinct heading IDs & recover from deleted bank filter
    const twoContainer = mountWithScope(
      LEGACY_GUEST_SCOPE,
      <>
        <SmartWrongBook initialBankId="deleted-nonexistent-bank" />
        <SmartWrongBook />
      </>,
    );
    await flushAsync();
    const titles = Array.from(twoContainer.querySelectorAll('.wb-header__title'));
    expect(titles).toHaveLength(2);
    expect(titles[0]!.id).not.toBe('');
    expect(titles[0]!.id).not.toBe(titles[1]!.id);
    const selectEl = twoContainer.querySelector('[data-testid="wb-bank-filter"]') as HTMLSelectElement;
    expect(selectEl.value).toBe('all');
  });

  it('performs O(1) raw-string check on pointerdown/keyup without reparsing unchanged JSON', async () => {
    const builtinChoiceQ = BUILTIN_AI_BANK.data.questions.find((q) => q.type === 'choice')!;
    saveStore(
      {
        records: { [builtinChoiceQ.id]: { ok: 0, choice: 0, ts: 1000 } },
        fav: {},
        mastery: {},
      },
      LEGACY_GUEST_SCOPE,
    );

    const container = mountWithScope(LEGACY_GUEST_SCOPE, <SmartWrongBook />);
    await waitForSelector(container, '[data-testid="wb-item-card"]');

    const parseSpy = vi.spyOn(JSON, 'parse');
    parseSpy.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    });

    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('isolates QuizSession shortcuts, recovers focus across unmounting/disabling modal buttons, preserves textarea typing, and keeps Tab/Escape working after focus loss', async () => {
    const db = getBankDb(LEGACY_GUEST_SCOPE);
    const customBank = await db.createCustomBank({
      id: 'cust-focus-isolation',
      name: '焦点隔离回归测试库',
      chapters: [
        { id: 1, short: '一', title: '第一章' },
        { id: 2, short: '二', title: '第二章' },
      ],
      questions: CUSTOM_PRACTICE_QUESTIONS,
    });
    await db.saveBankProgress(customBank.id, {
      records: {
        'cust-choice-1': { ok: 0, choice: 0, ts: 3000 },
        'cust-multi-1': { ok: 0, choice: [1], ts: 2000 },
        'cust-analysis-1': { ok: 0, ts: 1000 },
      },
      fav: {},
      mastery: { 'cust-analysis-1': 0 },
    });

    const quizSessionKeys: string[] = [];
    const onQuizWindowKey = (e: KeyboardEvent) => {
      if (!e.defaultPrevented) {
        quizSessionKeys.push(e.key);
      }
    };
    window.addEventListener('keydown', onQuizWindowKey);

    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockImplementation(() => [{ width: 10, height: 10 }] as unknown as DOMRectList);

    try {
      const host = mountWithScope(LEGACY_GUEST_SCOPE, <SmartWrongBookLauncher />);
      const openBtn = await waitForSelector(host, '[data-testid="wb-open-btn"]');
      await flushAsync();

      await act(async () => {
        openBtn.focus();
        openBtn.click();
      });

      const modal = await waitForSelector(document.body, '[data-testid="wb-modal"]');
      const closeBtn = await waitForSelector(modal, '[data-testid="wb-close-btn"]');
      expect(document.activeElement).toBe(closeBtn);

      const assertAllShortcutsIsolated = () => {
        for (const key of ['ArrowRight', 'ArrowLeft', '1', 't', ' ']) {
          const activeTarget = (document.activeElement as HTMLElement | null) ?? document.body;
          activeTarget.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          );
          document.body.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          );
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: false, cancelable: true }),
          );
        }
        expect(quizSessionKeys).toEqual([]);
      };

      // 1. Unmount wb-item-mastered-btn in list view -> focus recovers onto next card's button
      await waitForSelector(modal, '[data-testid="wb-item-mastered-btn"]');
      const firstMasteredBtn = modal.querySelectorAll<HTMLButtonElement>(
        '[data-testid="wb-item-mastered-btn"]',
      )[0]!;
      await act(async () => {
        firstMasteredBtn.focus();
        expect(document.activeElement).toBe(firstMasteredBtn);
        firstMasteredBtn.click();
      });
      await flushAsync();
      expect(firstMasteredBtn.isConnected).toBe(false);
      expect(modal.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(document.body);
      expect(
        (document.activeElement as HTMLElement).getAttribute('data-testid'),
      ).toBe('wb-item-mastered-btn');
      assertAllShortcutsIsolated();

      // 2. Unmount wb-start-practice-btn ('list' -> 'practice') -> focus recovers to wb-back-to-list-btn
      const startPracticeBtn = await waitForSelector(modal, '[data-testid="wb-start-practice-btn"]');
      await act(async () => {
        startPracticeBtn.focus();
        startPracticeBtn.click();
      });
      await flushAsync();
      expect(startPracticeBtn.isConnected).toBe(false);
      expect(modal.contains(document.activeElement)).toBe(true);
      expect(
        (document.activeElement as HTMLElement).getAttribute('data-testid'),
      ).toBe('wb-back-to-list-btn');
      assertAllShortcutsIsolated();

      // 3. Nav boundary disable: click wb-practice-next-btn into last item -> recovers to wb-practice-prev-btn
      const nextBtn = await waitForSelector(modal, '[data-testid="wb-practice-next-btn"]') as HTMLButtonElement;
      await act(async () => {
        nextBtn.focus();
        nextBtn.click();
      });
      await flushAsync();
      expect(nextBtn.disabled).toBe(true);
      expect(
        (document.activeElement as HTMLElement).getAttribute('data-testid'),
      ).toBe('wb-practice-prev-btn');
      assertAllShortcutsIsolated();

      // Click wb-practice-prev-btn back to index 0 -> recovers to wb-practice-next-btn, then advance again
      const prevBtn = await waitForSelector(modal, '[data-testid="wb-practice-prev-btn"]') as HTMLButtonElement;
      await act(async () => {
        prevBtn.focus();
        prevBtn.click();
      });
      await flushAsync();
      expect(prevBtn.disabled).toBe(true);
      expect(
        (document.activeElement as HTMLElement).getAttribute('data-testid'),
      ).toBe('wb-practice-next-btn');

      await act(async () => {
        nextBtn.click();
      });
      await flushAsync();

      // 4. Preserve <textarea> local keydown events while still isolating QuizSession window listener
      const textarea = await waitForSelector(
        modal,
        '[data-testid="wb-practice-subjective-input"]',
      ) as HTMLTextAreaElement;
      const textareaKeys: string[] = [];
      const onTextareaKey = (e: KeyboardEvent) => {
        textareaKeys.push(e.key);
      };
      textarea.addEventListener('keydown', onTextareaKey);
      await act(async () => {
        textarea.focus();
        for (const key of ['1', 'a', 't', ' ', 'ArrowLeft']) {
          textarea.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          );
        }
      });
      textarea.removeEventListener('keydown', onTextareaKey);
      expect(textareaKeys).toEqual(['1', 'a', 't', ' ', 'ArrowLeft']);
      expect(quizSessionKeys).toEqual([]);

      // 5. Unmount wb-practice-reveal-btn -> focus recovers to wb-practice-subjective-wrong-btn
      const revealBtn = await waitForSelector(modal, '[data-testid="wb-practice-reveal-btn"]');
      await act(async () => {
        revealBtn.focus();
        revealBtn.click();
      });
      await flushAsync();
      expect(revealBtn.isConnected).toBe(false);
      expect(modal.querySelector('[data-testid="wb-practice-explanation"]')).not.toBeNull();
      expect(
        (document.activeElement as HTMLElement).getAttribute('data-testid'),
      ).toBe('wb-practice-subjective-wrong-btn');
      assertAllShortcutsIsolated();

      // 6. Unmount wb-back-to-list-btn ('practice' -> 'list') -> focus recovers to wb-start-practice-btn
      const backBtn = await waitForSelector(modal, '[data-testid="wb-back-to-list-btn"]');
      await act(async () => {
        backBtn.focus();
        backBtn.click();
      });
      await flushAsync();
      expect(backBtn.isConnected).toBe(false);
      expect(
        (document.activeElement as HTMLElement).getAttribute('data-testid'),
      ).toBe('wb-start-practice-btn');
      assertAllShortcutsIsolated();

      // 7. Re-enter practice and master final item -> unmounts wb-practice-mastered-btn into wb-practice-done
      const startAgainBtn = await waitForSelector(modal, '[data-testid="wb-start-practice-btn"]');
      await act(async () => {
        startAgainBtn.focus();
        startAgainBtn.click();
      });
      await flushAsync();
      const masteredBtn1 = await waitForSelector(modal, '[data-testid="wb-practice-mastered-btn"]');
      await act(async () => {
        masteredBtn1.focus();
        masteredBtn1.click();
      });
      await flushAsync();
      const masteredBtn2 = await waitForSelector(modal, '[data-testid="wb-practice-mastered-btn"]');
      await act(async () => {
        masteredBtn2.focus();
        masteredBtn2.click();
      });
      await flushAsync();
      expect(masteredBtn2.isConnected).toBe(false);
      expect(modal.querySelector('[data-testid="wb-practice-done"]')).not.toBeNull();
      expect(
        (document.activeElement as HTMLElement).getAttribute('data-testid'),
      ).toBe('wb-back-to-list-btn');
      assertAllShortcutsIsolated();

      // 8. Explicit blur to document.body triggers MutationObserver/focusout recovery onto dialog,
      //    keeps shortcuts isolated, preserves Tab wrapping, and Escape closes + restores wb-open-btn
      await act(async () => {
        (document.activeElement as HTMLElement).blur();
      });
      await flushAsync(2);
      expect(document.activeElement).toBe(modal);
      assertAllShortcutsIsolated();

      await act(async () => {
        (document.activeElement as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
        );
      });
      expect(modal.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(modal);

      await act(async () => {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      });
      await flushAsync();
      expect(document.querySelector('[data-testid="wb-modal"]')).toBeNull();
      expect(document.activeElement).toBe(openBtn);
    } finally {
      rectSpy.mockRestore();
      window.removeEventListener('keydown', onQuizWindowKey);
    }
  });
});
