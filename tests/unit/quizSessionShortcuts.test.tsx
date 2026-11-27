import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyStore } from '../../src/core/storage';
import { WORKSPACE_PREFS_STORAGE_KEY } from '../../src/hooks/useWorkspacePrefs';
import { QuizSession } from '../../src/pages/QuizSession';
import type { QuizActions, SessionSpec } from '../../src/pages/quizTypes';
import { saveApiConfig } from '../../src/services/apiConfig';
import type { Question, UserStore } from '../../src/types/quiz';

function makeSessionActions(storeRef: { current: UserStore }): QuizActions {
  return {
    answerObjective(q, choice) {
      let isCorrect = false;
      if (q.type === 'choice' || q.type === 'tf') {
        isCorrect = choice === q.answer;
      } else if (q.type === 'multi' && Array.isArray(choice) && Array.isArray(q.answer)) {
        const a = [...choice].sort((x, y) => x - y);
        const b = [...q.answer].sort((x, y) => x - y);
        isCorrect = a.length === b.length && a.every((v, i) => v === b[i]);
      }
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

function makeQuestions(): Question[] {
  return [
    {
      id: 'q-choice',
      type: 'choice',
      chapter: 1,
      stem: '单选题题干',
      options: ['选项 A', '选项 B', '选项 C', '选项 D', '选项 E'],
      answer: 1,
      explain: '选 B',
      source: { origin: 'comprehensive_bank', file: 't.json', ref: '#1' },
    },
    {
      id: 'q-multi',
      type: 'multi',
      chapter: 1,
      stem: '多选题题干',
      options: ['多选 1', '多选 2', '多选 3', '多选 4'],
      answer: [0, 2],
      explain: '选 AC',
      source: { origin: 'comprehensive_bank', file: 't.json', ref: '#2' },
    },
    {
      id: 'q-tf',
      type: 'tf',
      chapter: 1,
      stem: '判断题题干',
      answer: true,
      explain: '正确',
      source: { origin: 'comprehensive_bank', file: 't.json', ref: '#3' },
    },
    {
      id: 'q-short',
      type: 'short',
      chapter: 1,
      stem: '简答题题干',
      answer: '参考答案内容',
      explain: '解析内容',
      source: { origin: 'comprehensive_bank', file: 't.json', ref: '#4' },
    },
    {
      id: 'q-analysis',
      type: 'analysis',
      chapter: 1,
      stem: '分析题题干',
      answer: '分析参考答案',
      explain: '分析解析',
      source: { origin: 'comprehensive_bank', file: 't.json', ref: '#5' },
    },
  ];
}

function dispatchKey(key: string, opts: Partial<KeyboardEventInit> = {}, target: EventTarget = window): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

describe('QuizSession Keyboard Shortcuts & Mobile Bar', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
    sessionStorage.clear();
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
    vi.unstubAllGlobals();
  });

  function renderSession(queue = makeQuestions(), onFinish = vi.fn()) {
    const spec: SessionSpec = {
      id: 101,
      config: { kind: 'mode', title: '混合刷题', opts: { mode: 'all', chapters: [1], count: 0, order: 'seq' } },
      queue,
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
          onFinish={onFinish}
        />,
      );
    });
    return { storeRef, onFinish };
  }

  it('renders updated slim shortcut hint bar without Space or T/F', () => {
    renderSession();
    const hint = container.querySelector('.shortcut-hint');
    expect(hint).not.toBeNull();
    const text = hint!.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain('← / → 切题');
    expect(text).toContain('1–4 / A–D 选项');
    expect(text).toContain('1 / 0 判断');
    expect(text).toContain('Enter 提交 / 下一题');
    expect(text).not.toContain('Space');
    expect(text).not.toContain('T/F');
  });

  it('Choice supports 1-4 and A-D only (ignores 0, 5, E) and advances on Enter only after grading', () => {
    renderSession();
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('1 / 5');

    // Enter before grading does not skip
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('1 / 5');

    // 0, 5, E ignored on choice
    dispatchKey('0');
    dispatchKey('5');
    dispatchKey('E');
    expect(container.querySelector('[data-testid="quiz-feedback"]')).toBeNull();

    // B (index 1) grades choice
    dispatchKey('b');
    expect(container.querySelector('[data-testid="quiz-feedback"]')?.textContent).toContain('回答正确');

    // Enter after grading advances to Q2 (multi)
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('2 / 5');
  });

  it('Multi-select enforces two-stage Enter: 0 selected no-op, 1st Enter submits, 2nd Enter advances, focused option Enter submits', () => {
    renderSession();
    dispatchKey('ArrowRight');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('2 / 5');

    // 0 selected + Enter -> silent ignore, stays on Q2
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('2 / 5');
    expect(container.querySelector('[data-testid="quiz-feedback"]')).toBeNull();

    // Mobile contextual submit & finish buttons rendered
    const mobileSubmit = container.querySelector('[data-testid="mobile-btn-submit"]') as HTMLButtonElement;
    expect(mobileSubmit).not.toBeNull();
    expect(mobileSubmit.disabled).toBe(true);
    expect(container.querySelector('[data-testid="btn-finish"]')).not.toBeNull();

    // Select option 0 via keyboard '1' and option 2 via focused click
    dispatchKey('1');
    const opt2 = container.querySelector('[data-testid="quiz-option-2"]') as HTMLButtonElement;
    act(() => {
      opt2.focus();
      opt2.click();
    });
    expect(mobileSubmit.disabled).toBe(false);

    // Pressing Enter even while focus is on .option-btn--multi submits instead of toggling
    dispatchKey('Enter', {}, opt2);
    expect(container.querySelector('[data-testid="quiz-feedback"]')?.textContent).toContain('回答正确');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('2 / 5');

    // 2nd Enter advances to Q3 (tf)
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('3 / 5');
  });

  it('TF uses 1 (正确) and 0 (错误), deprecates T/F, updates kbd badges, and Enter advances after grading', () => {
    renderSession();
    dispatchKey('ArrowRight');
    dispatchKey('ArrowRight');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('3 / 5');

    const kbds = Array.from(container.querySelectorAll('.tf-btn__kbd')).map((el) => el.textContent?.trim());
    expect(kbds).toEqual(['1', '0']);

    // T and F are ignored
    dispatchKey('T');
    dispatchKey('t');
    dispatchKey('F');
    dispatchKey('f');
    dispatchKey('2');
    dispatchKey('a');
    expect(container.querySelector('[data-testid="quiz-feedback"]')).toBeNull();

    // Enter before grading does not skip
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('3 / 5');

    // '1' picks 正确
    dispatchKey('1');
    expect(container.querySelector('[data-testid="quiz-feedback"]')?.textContent).toContain('回答正确');

    // Enter advances to Q4 (short)
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('4 / 5');

    // Also test '0' picks 错误 on a fresh TF question
    act(() => {
      root?.unmount();
    });
    root = null;
    renderSession([makeQuestions()[2]!]);
    dispatchKey('0');
    expect(container.querySelector('[data-testid="quiz-feedback"]')?.textContent).toContain('回答错误');
  });

  it('Space no longer reveals short or analysis answers; Enter advances only after self-eval grading', () => {
    renderSession();
    dispatchKey('ArrowRight');
    dispatchKey('ArrowRight');
    dispatchKey('ArrowRight');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('4 / 5');

    // Space does NOT reveal
    dispatchKey(' ', { code: 'Space' });
    expect(container.querySelector('[data-testid="q-ref-answer"]')).toBeNull();

    // Enter before grading does NOT advance
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('4 / 5');

    // Click reveal -> still not graded -> Enter still does NOT advance
    act(() => {
      (container.querySelector('[data-testid="btn-reveal-answer"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="q-ref-answer"]')).not.toBeNull();
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('4 / 5');

    // Self-check grades -> Enter advances to Q5 (analysis)
    act(() => {
      (container.querySelector('[data-testid="selfcheck-2"]') as HTMLButtonElement).click();
    });
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('5 / 5');

    // On Q5 (analysis), Space also does NOT reveal
    dispatchKey(' ', { code: 'Space' });
    expect(container.querySelector('[data-testid="q-ref-answer"]')).toBeNull();
  });

  it('isolates all shortcuts inside short-ai-textarea, input, contenteditable, and open modals', async () => {
    localStorage.setItem(
      WORKSPACE_PREFS_STORAGE_KEY,
      JSON.stringify({ autoExplainOnWrong: false, shortAnswerMode: 'ai' }),
    );
    saveApiConfig({
      provider: 'custom',
      baseUrl: 'https://mock.local/v1',
      apiKey: 'sk-test',
      model: 'mock-model',
      temperature: 0.2,
      maxTokens: 512,
      timeoutMs: 10000,
      storageScope: 'local',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 90,
                    suggestedLevel: 2,
                    matchedPoints: ['要点1'],
                    missingPoints: [],
                    comment: '很好',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    renderSession([makeQuestions()[3]!, makeQuestions()[0]!]);

    const textarea = container.querySelector('[data-testid="short-ai-textarea"]') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    // Shortcuts inside textarea (including Enter, ArrowLeft, ArrowRight, 1, 0, A) must NOT navigate or trigger shortcuts
    for (const key of ['1', '0', 'a', 'A', 'ArrowLeft', 'ArrowRight', 'Enter']) {
      const ev = dispatchKey(key, {}, textarea);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('1 / 2');

    // Mobile contextual submit button exists for ungraded AI short-answer
    const mobileSubmit = container.querySelector('[data-testid="mobile-btn-submit"]') as HTMLButtonElement;
    expect(mobileSubmit).not.toBeNull();
    expect(mobileSubmit.disabled).toBe(true);

    // Contenteditable isolation
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    container.appendChild(ce);
    const ceEv = dispatchKey('ArrowRight', {}, ce);
    expect(ceEv.defaultPrevented).toBe(false);
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('1 / 2');

    // Open modal blocks all shortcuts
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    const modalEv = dispatchKey('ArrowRight');
    expect(modalEv.defaultPrevented).toBe(false);
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('1 / 2');
    modal.remove();

    // Submit AI grading -> Enter advances to Q2; OR retry AI -> Enter does NOT advance while re-answering
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '我的简答答案');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (container.querySelector('[data-testid="short-ai-submit"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="short-ai-result"]')).not.toBeNull();

    // Click retry -> should clear shortAiResults[q.id] and NOT advance on Enter
    act(() => {
      (container.querySelector('[data-testid="short-ai-retry"]') as HTMLButtonElement).click();
    });
    dispatchKey('Enter');
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('1 / 2');
  });
});
