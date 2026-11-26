import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { LEGACY_GUEST_SCOPE, accountPracticeScope } from '../../src/core/practiceScope';
import { createEmptyStore } from '../../src/core/storage';
import { PracticeScopeContext } from '../../src/hooks/practiceScope';
import {
  WORKSPACE_PREFS_STORAGE_KEY,
  loadWorkspacePrefs,
  useWorkspacePrefs,
} from '../../src/hooks/useWorkspacePrefs';
import { QuizSession } from '../../src/pages/QuizSession';
import type { QuizActions, SessionSpec } from '../../src/pages/quizTypes';
import { saveApiConfig } from '../../src/services/apiConfig';
import type { ChapterMeta, Question, UserStore } from '../../src/types/quiz';
import { BankLibraryProvider, useBankLibraryContext } from '../../src/utils/BankLibraryContext';
import { closeQuizHubDb, resetFallbackMemoryDb } from '../../src/utils/bankDb';
import { BUILTIN_AI_BANK_ID } from '../../src/utils/quizImportTypes';

function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const delta of chunks) {
        const line = `data: ${JSON.stringify({
          model: 'mock-ws-model',
          choices: [{ delta: { content: delta } }],
        })}\n\n`;
        controller.enqueue(encoder.encode(line));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function makeRichQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'ws-q-1',
    type: 'choice',
    chapter: 1,
    stem: '已知矩阵公式 $A = B^2$ 与表格：\n\n| 符号 | 含义 |\n|---|---|\n| $x$ | 变量 |\n\n<script>window.__wsXss=true</script>',
    options: ['选项 $\\alpha$', '选项 $\\beta$'],
    answer: 0,
    explain: '这是标准解析 $E = mc^2$',
    aiInferredAnswer: true,
    source: { origin: 'video_popup', file: 'test.md', ref: '#1' },
    ...overrides,
  };
}

function makeSessionActions(storeRef: { current: UserStore }): QuizActions {
  return {
    answerObjective(q, choice) {
      const isCorrect =
        q.type === 'choice'
          ? choice === q.answer
          : q.type === 'tf'
            ? choice === q.answer
            : false;
      const record = { ok: (isCorrect ? 1 : 0) as 0 | 1, choice, ts: Date.now() };
      storeRef.current = {
        ...storeRef.current,
        records: { ...storeRef.current.records, [q.id]: record },
      };
      return { record, isCorrect };
    },
    rateSubjective(questionId, level) {
      const record = { ok: (level === 2 ? 1 : 0) as 0 | 1, ts: Date.now() };
      storeRef.current = {
        ...storeRef.current,
        records: { ...storeRef.current.records, [questionId]: record },
        mastery: { ...storeRef.current.mastery, [questionId]: level },
      };
      return record;
    },
    toggleFav(questionId) {
      const nextVal = !(storeRef.current.fav[questionId] === true);
      storeRef.current = {
        ...storeRef.current,
        fav: { ...storeRef.current.fav, [questionId]: nextVal },
      };
      return nextVal;
    },
  };
}

describe('Quiz Workspace (M3)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    closeQuizHubDb();
    resetFallbackMemoryDb();
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = '#/';
    window.scrollTo = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    closeQuizHubDb();
    resetFallbackMemoryDb();
    vi.unstubAllGlobals();
  });

  it('useWorkspacePrefs persists per scope and resists localStorage SecurityError', () => {
    const accountScope = accountPracticeScope('user-42');
    let latestApi: ReturnType<typeof useWorkspacePrefs> | null = null;

    function PrefsProbe() {
      latestApi = useWorkspacePrefs();
      return <span data-testid="pref-val">{String(latestApi.prefs.autoExplainOnWrong)}</span>;
    }

    root = createRoot(container);
    act(() => {
      root!.render(
        <PracticeScopeContext.Provider value={LEGACY_GUEST_SCOPE}>
          <PrefsProbe />
        </PracticeScopeContext.Provider>,
      );
    });
    expect(latestApi!.prefs.autoExplainOnWrong).toBe(false);

    act(() => {
      latestApi!.setAutoExplainOnWrong(true);
    });
    expect(loadWorkspacePrefs(LEGACY_GUEST_SCOPE).autoExplainOnWrong).toBe(true);
    expect(loadWorkspacePrefs(accountScope).autoExplainOnWrong).toBe(false);

    // Switch scope reloads cleanly to account default (false)
    act(() => {
      root!.render(
        <PracticeScopeContext.Provider value={accountScope}>
          <PrefsProbe />
        </PracticeScopeContext.Provider>,
      );
    });
    expect(latestApi!.prefs.autoExplainOnWrong).toBe(false);
    expect(localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY)).toBeTruthy();

    // SecurityError resilience
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });

    expect(() => loadWorkspacePrefs(accountScope)).not.toThrow();
    expect(loadWorkspacePrefs(accountScope).autoExplainOnWrong).toBe(false);
    expect(() => {
      act(() => {
        latestApi!.toggleAutoExplainOnWrong();
      });
    }).not.toThrow();
    expect(latestApi!.prefs.autoExplainOnWrong).toBe(true);

    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('QuizSession renders RichContent, aiInferredAnswer badge, mobile bar, shortcuts, and filterable answer sheet preserving original indices', async () => {
    const legacyQWithoutExplain = {
      id: 'ws-q-2',
      type: 'choice',
      chapter: 1,
      stem: 'Phase 1 旧题 $\\broken{$ 安全降级',
      options: ['旧选项 A', '旧选项 B'],
      answer: 1,
      source: { origin: 'comprehensive_bank', file: 'legacy.json', ref: '#2' },
    } as unknown as Question;

    const q1 = makeRichQuestion({ id: 'ws-q-1' });
    const q3 = makeRichQuestion({
      id: 'ws-q-3',
      type: 'tf',
      stem: '判断题题干',
      options: undefined,
      answer: true,
      aiInferredAnswer: false,
    });

    const spec: SessionSpec = {
      id: 1,
      config: { kind: 'mode', title: '混合刷题', opts: { mode: 'all', chapters: [1], count: 0, order: 'seq' } },
      queue: [q1, legacyQWithoutExplain, q3],
    };
    const chapterById = new Map<number, ChapterMeta>([
      [1, { id: 1, short: '核心基础', title: '第一章 核心基础' }],
    ]);
    const storeRef = { current: createEmptyStore() };
    const actions = makeSessionActions(storeRef);

    function Harness() {
      const [store, setStore] = [
        storeRef.current,
        (next: UserStore) => {
          storeRef.current = next;
        },
      ];
      void setStore;
      return (
        <QuizSession
          spec={spec}
          bankName="测试工作台题库"
          chapterById={chapterById}
          store={store}
          actions={actions}
          onExit={vi.fn()}
          onFinish={vi.fn()}
        />
      );
    }

    root = createRoot(container);
    act(() => {
      root!.render(<Harness />);
    });

    // RichContent + XSS protection + aiInferredAnswer badge + mobile bar
    const stemEl = container.querySelector('[data-testid="q-stem"]')!;
    expect(stemEl.querySelector('.katex')).not.toBeNull();
    expect(stemEl.querySelector('table')).not.toBeNull();
    expect(stemEl.querySelector('script')).toBeNull();
    expect((window as { __wsXss?: boolean }).__wsXss).toBeUndefined();
    expect(container.querySelector('[data-testid="q-ai-inferred-badge"]')?.textContent).toContain(
      'AI 推断答案',
    );
    expect(container.querySelectorAll('[data-testid="workspace-mobile-bar"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="btn-prev"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="btn-next"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="btn-star"]')).toHaveLength(1);

    // Keyboard shortcut '1' picks option 0 (correct)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="quiz-feedback"]')?.textContent).toContain('回答正确');
    expect(container.querySelector('[data-testid="quiz-feedback"] .katex')).not.toBeNull();

    // Keyboard ArrowRight moves to Q2 (legacy without explain)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain(
      '2 / 3',
    );
    // Pick wrong option (0) on Q2
    act(() => {
      (container.querySelector('[data-testid="quiz-option-0"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="quiz-feedback"]')?.textContent).toContain('回答错误');

    // Open answer sheet and verify filters preserve original 0-based indices
    act(() => {
      (container.querySelector('[data-testid="btn-toggle-sheet"]') as HTMLButtonElement).click();
    });
    expect(container.querySelectorAll('[data-testid^="sheet-item-"]')).toHaveLength(3);

    act(() => {
      (container.querySelector('[data-testid="sheet-filter-wrong"]') as HTMLButtonElement).click();
    });
    const wrongItems = container.querySelectorAll('[data-testid^="sheet-item-"]');
    expect(wrongItems).toHaveLength(1);
    expect(wrongItems[0]!.getAttribute('data-testid')).toBe('sheet-item-1');
    expect(wrongItems[0]!.getAttribute('data-status')).toBe('wrong');

    act(() => {
      (container.querySelector('[data-testid="sheet-filter-unanswered"]') as HTMLButtonElement).click();
    });
    const unansweredItems = container.querySelectorAll('[data-testid^="sheet-item-"]');
    expect(unansweredItems).toHaveLength(1);
    expect(unansweredItems[0]!.getAttribute('data-testid')).toBe('sheet-item-2');

    // Clicking filtered item jumps to Q3 (3 / 3)
    act(() => {
      (unansweredItems[0] as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain(
      '3 / 3',
    );

    // Shortcuts must be ignored inside input elements
    const strayInput = document.createElement('input');
    container.appendChild(strayInput);
    act(() => {
      strayInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain(
      '3 / 3',
    );
  });

  it('autoExplainOnWrong triggers ONLY on wrong answer, never on correct answer', async () => {
    saveApiConfig({
      provider: 'custom',
      baseUrl: 'https://mock-ws.local/v1',
      apiKey: 'sk-ws-test',
      model: 'mock-ws-model',
      temperature: 0.3,
      maxTokens: 512,
      timeoutMs: 10000,
      storageScope: 'local',
    });

    const fetchMock = vi.fn().mockImplementation(async () =>
      makeSseResponse(['### 【核心考点】\n自动触发测试解析']),
    );
    vi.stubGlobal('fetch', fetchMock);

    const q1 = makeRichQuestion({ id: 'auto-q1', answer: 0 });
    const q2 = makeRichQuestion({ id: 'auto-q2', answer: 1 });
    const spec: SessionSpec = {
      id: 2,
      config: { kind: 'mode', title: '单选', opts: { mode: 'choice', chapters: [1], count: 0, order: 'seq' } },
      queue: [q1, q2],
    };
    const storeRef = { current: createEmptyStore() };
    const actions = makeSessionActions(storeRef);

    root = createRoot(container);
    act(() => {
      root!.render(
        <QuizSession
          spec={spec}
          store={storeRef.current}
          actions={actions}
          onExit={vi.fn()}
          onFinish={vi.fn()}
        />,
      );
    });

    // Enable auto-explain before answering
    const toggle = container.querySelector('[data-testid="ai-auto-explain-toggle"]') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    act(() => {
      toggle.click();
    });
    expect(toggle.checked).toBe(true);

    // Correct answer on Q1 -> 0 fetch calls, drawer stays closed
    act(() => {
      (container.querySelector('[data-testid="quiz-option-0"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(container.querySelector('[data-testid="ai-explain-drawer"]')).toBeNull();

    // Move to Q2 and pick WRONG answer (0 when answer is 1) -> triggers auto-explain!
    act(() => {
      (container.querySelector('[data-testid="btn-next"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="quiz-option-0"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const drawer = container.querySelector('[data-testid="ai-explain-drawer"]');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent).toContain('自动触发测试解析');
  });

  it('App integrates BankLibraryContext with bank-switcher and contains zero legacy course branding', async () => {
    window.location.hash = '#/quiz';
    let libApi: ReturnType<typeof useBankLibraryContext> | null = null;
    const getLib = (): ReturnType<typeof useBankLibraryContext> | null => libApi;
    function Probe() {
      libApi = useBankLibraryContext();
      return null;
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <BankLibraryProvider>
          <Probe />
          <App />
        </BankLibraryProvider>,
      );
    });

    for (let i = 0; i < 20 && !getLib()?.ready; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    expect(getLib()?.ready).toBe(true);

    // Built-in onboarding bank shows 3 questions & QuizHub branding
    expect(container.querySelector('[data-testid="quiz-badge-total"]')?.textContent).toContain('3');
    expect(container.textContent).toContain('QuizHub');
    expect(container.textContent).not.toContain('人工智能导论');

    // Create a custom bank and switch via bank-switcher
    let customId = '';
    await act(async () => {
      const created = await libApi!.importNewBank(
        {
          name: '线性代数自测库',
          chapters: [{ id: 1, short: '矩阵', title: '第 1 章 矩阵' }],
          questions: [
            {
              id: 'la-1',
              type: 'tf',
              chapter: 1,
              stem: '可逆矩阵必为方阵。',
              answer: true,
              explain: '定义要求。',
              source: { origin: 'comprehensive_bank', file: 'la.txt', ref: '#1' },
            },
          ],
        },
        false,
      );
      customId = created.id;
    });

    const switcher = container.querySelector('[data-testid="bank-switcher"]') as HTMLSelectElement;
    expect(switcher).not.toBeNull();
    expect(switcher.value).toBe(BUILTIN_AI_BANK_ID);

    await act(async () => {
      switcher.value = customId;
      switcher.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(container.querySelector('[data-testid="quiz-badge-total"]')?.textContent).toContain('1');
    expect(container.textContent).toContain('线性代数自测库');
    expect(container.textContent).not.toContain('人工智能导论');
  });
});
