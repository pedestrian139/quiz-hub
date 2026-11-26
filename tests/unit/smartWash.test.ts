// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportWorkbench, type ImportCommitPayload } from '../../src/components/QuizImport/ImportWorkbench';
import { QuizImportPortal } from '../../src/components/QuizImport/QuizImportPortal';
import {
  OPEN_API_SETTINGS_EVENT,
  clearApiConfig,
  createDefaultApiConfig,
  saveApiConfig,
} from '../../src/services/apiConfig';
import {
  BankLibraryProvider,
  useBankLibraryContext,
  type BankLibraryContextValue,
} from '../../src/utils/BankLibraryContext';
import { closeQuizHubDb, resetFallbackMemoryDb } from '../../src/utils/bankDb';
import { appendDraftsToBank } from '../../src/utils/importers';
import type { BankRecord } from '../../src/utils/quizImportTypes';

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

function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

function setCheckbox(el: HTMLInputElement, checked: boolean) {
  if (el.checked !== checked) {
    el.click();
  }
}

async function flushMicrotasks(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function makeMockChatResponse(questions: unknown[]): Response {
  return new Response(
    JSON.stringify({
      model: 'deepseek-chat',
      choices: [
        {
          message: {
            content: JSON.stringify({ questions }),
          },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('Smart Import & AI Washing Workbench (M2)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('sessionStorage', createMemoryStorage());
    vi.stubGlobal('indexedDB', new IDBFactory());
    closeQuizHubDb();
    resetFallbackMemoryDb();
    clearApiConfig();
    window.location.hash = '#/';
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
    vi.restoreAllMocks();
  });

  it('SW-01: Missing API key guard blocks Smart Wash with 0 fetch calls and renders ai-open-settings-inline CTA', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const openSettingsSpy = vi.fn();
    window.addEventListener(OPEN_API_SETTINGS_EVENT, openSettingsSpy);

    const notify = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify,
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    const pasteTab = container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement;
    await act(async () => {
      pasteTab.click();
    });

    const textarea = container.querySelector('[data-testid="import-paste-textarea"]') as HTMLTextAreaElement;
    await act(async () => {
      setNativeValue(textarea, '1. HTTP 默认端口是？\nA. 21\nB. 80');
    });

    const washBtn = container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement;
    await act(async () => {
      washBtn.click();
    });

    expect(mockFetch).not.toHaveBeenCalled();
    const inlineCta = container.querySelector('[data-testid="ai-open-settings-inline"]') as HTMLButtonElement;
    expect(inlineCta).not.toBeNull();

    await act(async () => {
      inlineCta.click();
    });
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);

    // After saving API config, inline warning disappears reactively
    await act(async () => {
      saveApiConfig({
        ...createDefaultApiConfig(),
        apiKey: 'sk-live-key',
        model: 'deepseek-chat',
      });
    });
    expect(container.querySelector('[data-testid="ai-open-settings-inline"]')).toBeNull();
    window.removeEventListener(OPEN_API_SETTINGS_EVENT, openSettingsSpy);
  });

  it('SW-02: Empty/whitespace paste boundary guards AI wash with 0 fetch calls', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
    });
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const notify = vi.fn();

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify,
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    const pasteTab = container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement;
    await act(async () => {
      pasteTab.click();
    });
    const textarea = container.querySelector('[data-testid="import-paste-textarea"]') as HTMLTextAreaElement;
    await act(async () => {
      setNativeValue(textarea, '   \n\t  ');
    });

    const washBtn = container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement;
    await act(async () => {
      washBtn.click();
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="preview-draft-0"]')).toBeNull();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('请先粘贴'), 'error');
  });

  it('SW-03: Multi-chunk wash renders ai-wash-progress, respects wash-pref-explain/tags, and renders AI inferred badge', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
    });

    const requests: string[] = [];
    let resolveChunk1: ((res: Response) => void) | null = null;
    const mockFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const bodyStr = String(init?.body ?? '');
      requests.push(bodyStr);
      if (requests.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveChunk1 = resolve;
        });
      }
      return makeMockChatResponse([
        {
          type: 'choice',
          stem: '梯度下降沿什么方向更新参数？',
          options: ['负梯度方向', '正梯度方向'],
          answer: 0,
          answerInferred: true,
          explain: '',
          tags: [],
        },
      ]);
    });
    vi.stubGlobal('fetch', mockFetch);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    // Toggle preferences off to verify propagation
    const prefExplain = container.querySelector('[data-testid="wash-pref-explain"]') as HTMLInputElement;
    const prefTags = container.querySelector('[data-testid="wash-pref-tags"]') as HTMLInputElement;
    await act(async () => {
      setCheckbox(prefExplain, false);
      setCheckbox(prefTags, false);
    });
    expect(prefExplain.checked).toBe(false);
    expect(prefTags.checked).toBe(false);

    // Upload a .md file containing >2800 chars so it chunks into 2 batches
    const bigMd = [
      `1. HTTP 默认端口？\nA. 21\nB. 80\n答案：B\n${'背景说明 '.repeat(700)}`,
      `2. 梯度下降沿什么方向更新参数？\nA. 负梯度方向\nB. 正梯度方向`,
    ].join('\n\n');
    const fileInput = container.querySelector('[data-testid="bank-import-file-input"]') as HTMLInputElement;
    const mdFile = new File([bigMd], 'lecture.md', { type: 'text/markdown' });
    Object.defineProperty(fileInput, 'files', { value: [mdFile], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMicrotasks();

    const washBtn = container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement;
    expect(washBtn.disabled).toBe(false);

    await act(async () => {
      washBtn.click();
    });
    await flushMicrotasks(2);

    const progressEl = container.querySelector('[data-testid="ai-wash-progress"]');
    expect(progressEl).not.toBeNull();
    expect(progressEl?.textContent).toContain('正在识别');

    // Finish chunk 1
    await act(async () => {
      resolveChunk1?.(
        makeMockChatResponse([
          {
            type: 'choice',
            stem: 'HTTP 默认端口？',
            options: ['21', '80'],
            answer: 1,
            answerInferred: false,
            explain: '',
            tags: [],
          },
        ]),
      );
    });
    await flushMicrotasks();

    expect(container.querySelector('[data-testid="preview-draft-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="preview-draft-1"]')).not.toBeNull();
    const inferredBadge = container.querySelector('[data-testid="draft-ai-inferred-1"]');
    expect(inferredBadge?.textContent).toContain('AI 推断答案');

    // Check preferences propagated into system prompt
    const parsedReq = JSON.parse(requests[0]!) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(parsedReq.messages[0]!.content).toContain('仅保留原文解析');
    expect(parsedReq.messages[0]!.content).toContain('空数组 []');
  });

  it('SW-04: Mid-flight cancel via ai-wash-cancel aborts cleanly and re-enables ai-wash-btn', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    vi.stubGlobal('fetch', mockFetch);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    const pasteTab = container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement;
    await act(async () => {
      pasteTab.click();
    });
    const textarea = container.querySelector('[data-testid="import-paste-textarea"]') as HTMLTextAreaElement;
    await act(async () => {
      setNativeValue(textarea, '1. 慢速洗题文本\nA. X\nB. Y');
    });

    const washBtn = container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement;
    await act(async () => {
      washBtn.click();
    });

    const cancelBtn = container.querySelector('[data-testid="ai-wash-cancel"]') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();

    await act(async () => {
      cancelBtn.click();
    });
    await flushMicrotasks();

    expect(container.querySelector('[data-testid="ai-wash-cancel"]')).toBeNull();
    expect((container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('SW-05: Failed chunk renders ai-wash-retry-chunk-* even when drafts are empty and merges recovered drafts on retry', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
    });

    let attempt = 0;
    const mockFetch = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response(JSON.stringify({ error: { message: 'Upstream 500' } }), {
          status: 500,
        });
      }
      return makeMockChatResponse([
        {
          type: 'tf',
          stem: '重试恢复的判断题',
          answer: true,
          answerInferred: true,
          explain: '恢复成功',
          tags: ['重试'],
        },
      ]);
    });
    vi.stubGlobal('fetch', mockFetch);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    const pasteTab = container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement;
    await act(async () => {
      pasteTab.click();
    });
    const textarea = container.querySelector('[data-testid="import-paste-textarea"]') as HTMLTextAreaElement;
    await act(async () => {
      setNativeValue(textarea, '1. 失败片段测试题');
    });

    await act(async () => {
      (container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();

    const retryBtn = container.querySelector(
      '[data-testid="ai-wash-retry-chunk-0"]',
    ) as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    expect(container.querySelector('[data-testid="preview-draft-0"]')).toBeNull();

    await act(async () => {
      retryBtn.click();
    });
    await flushMicrotasks();

    expect(container.querySelector('[data-testid="ai-wash-retry-chunk-0"]')).toBeNull();
    expect(container.querySelector('[data-testid="preview-draft-0"]')?.textContent).toContain(
      '重试恢复的判断题',
    );
    expect(container.querySelector('[data-testid="draft-ai-inferred-0"]')).not.toBeNull();
  });

  it('SW-06: Inline card edit (stem/options/answer/tags), draft deletion, and sticky commit for both new bank and existing bank append', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn(async () =>
      makeMockChatResponse([
        {
          type: 'choice',
          stem: '原始题干一',
          options: ['原始A', '原始B'],
          answer: 0,
          answerInferred: true,
          explain: '原始解析',
          tags: ['网络'],
        },
        {
          type: 'tf',
          stem: '待删除废题',
          answer: false,
          answerInferred: false,
        },
      ]),
    );
    vi.stubGlobal('fetch', mockFetch);

    const commits: ImportCommitPayload[] = [];
    const existingBank: BankRecord = {
      id: 'bank-custom-existing',
      name: '已有自定义库',
      builtin: false,
      createdAt: 1000,
      updatedAt: 2000,
      data: {
        meta: {
          title: '已有自定义库',
          version: '2.0.0',
          generatedAt: '2026-11-26T00:00:00Z',
          counts: {
            total: 1,
            byType: { choice: 0, multi: 0, tf: 1, short: 0, analysis: 0 },
            byOrigin: { comprehensive_bank: 1, video_popup: 0, review_notes_synthesized: 0 },
          },
        },
        chapters: [{ id: 1, short: '第 1 章', title: '第 1 章' }],
        questions: [
          {
            id: 'imp-c1-tf-001',
            type: 'tf',
            chapter: 1,
            stem: '旧题',
            answer: true,
            explain: '',
            source: { origin: 'comprehensive_bank', file: '已有自定义库', ref: '#1' },
          },
        ],
      },
    };

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          existingBanks: [existingBank],
          notify: vi.fn(),
          onCommit: async (payload) => {
            commits.push(payload);
          },
        }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      setNativeValue(
        container.querySelector('[data-testid="import-paste-textarea"]') as HTMLTextAreaElement,
        '洗题原文',
      );
    });
    await act(async () => {
      setNativeValue(
        container.querySelector('[data-testid="wash-target-bank-name"]') as HTMLInputElement,
        '新建洗题库',
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();

    // Edit draft 0 stem, option 0, toggle answer to option 1, edit tags
    await act(async () => {
      (container.querySelector('[data-testid="draft-edit-0"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      setNativeValue(
        container.querySelector('[data-testid="draft-edit-stem-0"]') as HTMLTextAreaElement,
        '已校对题干一',
      );
      setNativeValue(
        container.querySelector('[data-testid="draft-edit-opt-0-0"]') as HTMLInputElement,
        '校对选项A',
      );
      (container.querySelector('[data-testid="draft-edit-ans-0-1"]') as HTMLButtonElement).click();
      setNativeValue(
        container.querySelector('[data-testid="draft-edit-tags-0"]') as HTMLInputElement,
        '网络, 协议',
      );
    });

    // Delete draft 1
    await act(async () => {
      (container.querySelector('[data-testid="draft-delete-1"]') as HTMLButtonElement).click();
    });

    const stickyBtn = container.querySelector(
      '[data-testid="btn-confirm-import-sticky"]',
    ) as HTMLButtonElement;
    expect(stickyBtn.textContent).toContain('确认导入题库（共 1 题）');

    await act(async () => {
      stickyBtn.click();
    });
    await flushMicrotasks();

    expect(commits).toHaveLength(1);
    const firstCommit = commits[0]!;
    expect(firstCommit.mode).toBe('new');
    if (firstCommit.mode === 'new') {
      expect(firstCommit.input.name).toBe('新建洗题库');
      expect(firstCommit.input.questions).toHaveLength(1);
      expect(firstCommit.input.questions[0]!.stem).toBe('已校对题干一');
      expect(firstCommit.input.questions[0]!.options?.[0]).toBe('校对选项A');
      expect(firstCommit.input.questions[0]!.answer).toBe(1);
      expect(firstCommit.input.questions[0]!.aiInferredAnswer).toBe(true);
      expect(firstCommit.input.questions[0]!.tags).toEqual(['网络', '协议']);
    }

    // Now test mode === 'existing' append flow
    await act(async () => {
      setSelectValue(
        container.querySelector('[data-testid="wash-target-bank-mode"]') as HTMLSelectElement,
        'existing',
      );
      setNativeValue(
        container.querySelector('[data-testid="import-paste-textarea"]') as HTMLTextAreaElement,
        '第二批洗题原文',
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();

    const appendStickyBtn = container.querySelector(
      '[data-testid="btn-confirm-import-sticky"]',
    ) as HTMLButtonElement;
    expect(appendStickyBtn.textContent).toContain('确认追加到题库（共 2 题）');

    await act(async () => {
      appendStickyBtn.click();
    });
    await flushMicrotasks();

    expect(commits).toHaveLength(2);
    const secondCommit = commits[1]!;
    expect(secondCommit.mode).toBe('existing');
    if (secondCommit.mode === 'existing') {
      expect(secondCommit.targetBankId).toBe(existingBank.id);
      const merged = appendDraftsToBank(existingBank, secondCommit.drafts, {
        sourceFormat: secondCommit.sourceFormat,
      });
      expect(merged.data.questions).toHaveLength(3);
      expect(new Set(merged.data.questions.map((q) => q.id)).size).toBe(3);
    }
  });

  it('SW-07: QuizImportPortal binds BankLibraryContext openImportModal/initialTab and syncs imported bank into shared context + #/quiz', async () => {
    let ctxRef: BankLibraryContextValue | null = null;
    const getCtx = (): BankLibraryContextValue | null => ctxRef;
    function ContextProbe() {
      ctxRef = useBankLibraryContext();
      return null;
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(
          BankLibraryProvider,
          null,
          React.createElement(ContextProbe),
          React.createElement(QuizImportPortal),
        ),
      );
    });

    for (let i = 0; i < 20 && !getCtx()?.ready; i++) {
      await flushMicrotasks(1);
    }
    const resolvedCtx = getCtx();
    expect(resolvedCtx?.ready).toBe(true);

    // M3 openImportModal('banks') opens dialog directly on 'banks' tab
    await act(async () => {
      resolvedCtx!.openImportModal('banks');
    });
    expect(container.querySelector('[data-testid="quiz-import-dialog"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bank-list"]')).not.toBeNull();

    // Switch to import tab, paste JSON, commit -> closes modal, updates ctx.activeBank, navigates #/quiz
    await act(async () => {
      (container.querySelector('[data-testid="qi-tab-import"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      setNativeValue(
        container.querySelector('[data-testid="import-paste-textarea"]') as HTMLTextAreaElement,
        '1. 上下文联动测试题？\nA. 甲\nB. 乙\n答案：A',
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="btn-parse-paste"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      setNativeValue(
        container.querySelector('[data-testid="wash-target-bank-name"]') as HTMLInputElement,
        '上下文联动题库',
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="btn-confirm-import-sticky"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();

    expect(container.querySelector('[data-testid="quiz-import-dialog"]')).toBeNull();
    expect(getCtx()!.importModalOpen).toBe(false);
    expect(getCtx()!.activeBank.name).toBe('上下文联动题库');
    expect(window.location.hash).toBe('#/quiz');
  });

  it('SW-08: Inline editing preserves live trailing spaces/newlines, draft-list-container avoids preview-draft- prefix collision, and user-entered bank name is preserved on parse', async () => {
    const commits: ImportCommitPayload[] = [];
    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          existingBanks: [],
          notify: vi.fn(),
          onCommit: async (payload) => {
            commits.push(payload);
          },
        }),
      );
    });

    // Pre-enter custom bank name BEFORE parsing pasted text
    await act(async () => {
      setNativeValue(
        container.querySelector('[data-testid="wash-target-bank-name"]') as HTMLInputElement,
        '我的自定义题库名称',
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      setNativeValue(
        container.querySelector('[data-testid="import-paste-textarea"]') as HTMLTextAreaElement,
        [
          '1. 题目一？',
          'A. 选项A1',
          'B. 选项B1',
          '答案：A',
          '',
          '2. 题目二？',
          'A. 选项A2',
          'B. 选项B2',
          '答案：B',
        ].join('\n'),
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="btn-parse-paste"]') as HTMLButtonElement).click();
    });

    // User-entered bank name must NOT be overwritten by suggestedName ('粘贴导入题库')
    expect(
      (container.querySelector('[data-testid="wash-target-bank-name"]') as HTMLInputElement).value,
    ).toBe('我的自定义题库名称');
    expect(
      (container.querySelector('[data-testid="import-bank-name"]') as HTMLInputElement).value,
    ).toBe('我的自定义题库名称');

    // preview-draft-* selector must match ONLY the 2 draft cards (no container prefix collision)
    expect(container.querySelector('[data-testid="preview-draft-list"]')).toBeNull();
    expect(container.querySelector('[data-testid="draft-list-container"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="preview-draft-"]')).toHaveLength(2);

    // Delete draft 1 -> exactly 1 preview-draft-* card remains
    await act(async () => {
      (container.querySelector('[data-testid="draft-delete-1"]') as HTMLButtonElement).click();
    });
    expect(container.querySelectorAll('[data-testid^="preview-draft-"]')).toHaveLength(1);

    // Open inline editor and verify trailing spaces & newlines are preserved on live typing
    await act(async () => {
      (container.querySelector('[data-testid="draft-edit-0"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      setNativeValue(
        container.querySelector('[data-testid="draft-edit-stem-0"]') as HTMLTextAreaElement,
        'Hello ',
      );
      setNativeValue(
        container.querySelector('[data-testid="draft-edit-opt-0-0"]') as HTMLInputElement,
        'Opt A ',
      );
      setNativeValue(
        container.querySelector('[data-testid="draft-edit-explain-0"]') as HTMLTextAreaElement,
        'line1\n',
      );
    });

    expect(
      (container.querySelector('[data-testid="draft-edit-stem-0"]') as HTMLTextAreaElement).value,
    ).toBe('Hello ');
    expect(
      (container.querySelector('[data-testid="draft-edit-opt-0-0"]') as HTMLInputElement).value,
    ).toBe('Opt A ');
    expect(
      (container.querySelector('[data-testid="draft-edit-explain-0"]') as HTMLTextAreaElement).value,
    ).toBe('line1\n');

    await act(async () => {
      (container.querySelector('[data-testid="btn-confirm-import-sticky"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();

    expect(commits).toHaveLength(1);
    const committed = commits[0]!;
    expect(committed.mode).toBe('new');
    if (committed.mode === 'new') {
      expect(committed.input.name).toBe('我的自定义题库名称');
      expect(committed.input.questions[0]!.stem).toBe('Hello');
      expect(committed.input.questions[0]!.options?.[0]).toBe('Opt A');
      expect(committed.input.questions[0]!.explain).toBe('line1');
    }
  });

  it('SW-09: QuizImportPortal resets stale banks initialTab when btn-open-quiz-import is clicked, and ImportWorkbench gates existing mode on onCommit', async () => {
    let ctxRef: BankLibraryContextValue | null = null;
    const getCtx = (): BankLibraryContextValue | null => ctxRef;
    function ContextProbe() {
      ctxRef = useBankLibraryContext();
      return null;
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(
          BankLibraryProvider,
          null,
          React.createElement(ContextProbe),
          React.createElement(QuizImportPortal),
        ),
      );
    });

    for (let i = 0; i < 20 && !getCtx()?.ready; i++) {
      await flushMicrotasks(1);
    }
    expect(getCtx()?.ready).toBe(true);

    // Open directly on 'banks' tab, then close
    await act(async () => {
      getCtx()!.openImportModal('banks');
    });
    expect(
      container.querySelector('[data-testid="qi-tab-banks"]')?.getAttribute('aria-selected'),
    ).toBe('true');

    await act(async () => {
      (container.querySelector('[data-testid="btn-close-quiz-import"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="quiz-import-dialog"]')).toBeNull();

    // Reopen via btn-open-quiz-import -> must open on 'import' tab (not stale 'banks')
    await act(async () => {
      (container.querySelector('[data-testid="btn-open-quiz-import"]') as HTMLButtonElement).click();
    });
    expect(
      container.querySelector('[data-testid="qi-tab-import"]')?.getAttribute('aria-selected'),
    ).toBe('true');

    // Also verify ImportWorkbench disables 'existing' mode when only legacy onCommitBank is provided
    const legacyBank: BankRecord = {
      id: 'bank-legacy-cb',
      name: '已有自定义库',
      builtin: false,
      createdAt: 1000,
      updatedAt: 1000,
      data: {
        meta: {
          title: '已有自定义库',
          version: '2.0.0',
          generatedAt: '2026-11-26T00:00:00Z',
          counts: {
            total: 0,
            byType: { choice: 0, multi: 0, tf: 0, short: 0, analysis: 0 },
            byOrigin: { comprehensive_bank: 0, video_popup: 0, review_notes_synthesized: 0 },
          },
        },
        chapters: [{ id: 1, short: '第 1 章', title: '第 1 章' }],
        questions: [],
      },
    };
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          existingBanks: [legacyBank],
          notify: vi.fn(),
          onCommitBank: vi.fn(async () => {}),
        }),
      );
    });
    const modeSelect = container.querySelector(
      '[data-testid="wash-target-bank-mode"]',
    ) as HTMLSelectElement;
    const existingOpt = modeSelect.querySelector('option[value="existing"]') as HTMLOptionElement;
    expect(existingOpt.disabled).toBe(true);
    expect(modeSelect.value).toBe('new');
  });

  it('SW-10: F9 4-type checkboxes default all checked, empty guard disables ai-wash-btn, objective preset unchecks short, and retry forwards allowedTypes', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
    });

    const requests: string[] = [];
    const mockFetch = vi
      .fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(String(init?.body ?? ''));
        if (requests.length === 1) {
          return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 });
        }
        return makeMockChatResponse([
          {
            type: 'choice',
            stem: '恢复的单选题',
            options: ['A', 'B'],
            answer: 0,
            answerInferred: false,
            explain: 'ok',
            tags: [],
          },
        ]);
      });
    vi.stubGlobal('fetch', mockFetch);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    const choiceCb = container.querySelector('[data-testid="wash-type-choice"]') as HTMLInputElement;
    const multiCb = container.querySelector('[data-testid="wash-type-multi"]') as HTMLInputElement;
    const tfCb = container.querySelector('[data-testid="wash-type-tf"]') as HTMLInputElement;
    const shortCb = container.querySelector('[data-testid="wash-type-short"]') as HTMLInputElement;
    const washBtn = container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement;

    expect(choiceCb.checked).toBe(true);
    expect(multiCb.checked).toBe(true);
    expect(tfCb.checked).toBe(true);
    expect(shortCb.checked).toBe(true);
    expect(washBtn.disabled).toBe(false);
    expect(container.querySelector('[data-testid="wash-type-guard-hint"]')).toBeNull();

    // Uncheck all 4 -> ai-wash-btn disabled & guard hint visible
    await act(async () => {
      setCheckbox(choiceCb, false);
      setCheckbox(multiCb, false);
      setCheckbox(tfCb, false);
      setCheckbox(shortCb, false);
    });
    expect(washBtn.disabled).toBe(true);
    const guardHint = container.querySelector('[data-testid="wash-type-guard-hint"]');
    expect(guardHint?.textContent).toContain('请至少选择 1 种题型');

    // Click "仅选客观题" -> choice, multi, tf checked; short unchecked; washBtn enabled
    const objBtn = container.querySelector(
      '[data-testid="wash-type-objective-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      objBtn.click();
    });
    expect(choiceCb.checked).toBe(true);
    expect(multiCb.checked).toBe(true);
    expect(tfCb.checked).toBe(true);
    expect(shortCb.checked).toBe(false);
    expect(washBtn.disabled).toBe(false);
    expect(container.querySelector('[data-testid="wash-type-guard-hint"]')).toBeNull();

    // Switch to paste tab and run AI wash (1st call fails -> retry button appears)
    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      setNativeValue(
        container.querySelector('[data-testid="import-paste-textarea"]') as HTMLTextAreaElement,
        '1. HTTP 默认端口？\nA. 21\nB. 80',
      );
    });
    await act(async () => {
      washBtn.click();
    });
    await flushMicrotasks();

    expect(requests).toHaveLength(1);
    const req0Sys = (
      JSON.parse(requests[0]!) as { messages: Array<{ role: string; content: string }> }
    ).messages[0]!.content;
    expect(req0Sys).toContain('"choice"');
    expect(req0Sys).toContain('"multi"');
    expect(req0Sys).toContain('"tf"');
    expect(req0Sys).not.toContain('"short"');

    // Retry failed chunk -> must also forward objective-only allowedTypes
    const retryBtn = container.querySelector(
      '[data-testid="ai-wash-retry-chunk-0"]',
    ) as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    await act(async () => {
      retryBtn.click();
    });
    await flushMicrotasks();

    expect(requests).toHaveLength(2);
    const req1Sys = (
      JSON.parse(requests[1]!) as { messages: Array<{ role: string; content: string }> }
    ).messages[0]!.content;
    expect(req1Sys).toContain('"choice"');
    expect(req1Sys).not.toContain('"short"');
    expect(container.querySelector('[data-testid="preview-draft-0"]')).not.toBeNull();
  });

  it('SW-11: F10 standard JSON paste & AI-wash click with NO API key trigger json-intercept-banner and direct import preserves explain + aiAnalysis with 0 fetch calls', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const commits: ImportCommitPayload[] = [];
    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: async (payload) => {
            commits.push(payload);
          },
        }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });

    const standardShareJson = JSON.stringify({
      schema: 'quizhub-bank-v2',
      exportedAt: '2026-11-26T00:00:00Z',
      bank: {
        name: '标准分享题库',
        description: '含独立 AI 解析',
        data: {
          meta: { title: '标准分享题库', version: '2.0.0' },
          chapters: [{ id: 1, short: '第 1 章', title: '第 1 章' }],
          questions: [
            {
              id: 'q1',
              type: 'choice',
              chapter: 1,
              stem: 'TCP 三次握手第三次发送的是？',
              options: ['SYN', 'ACK', 'FIN', 'RST'],
              answer: 1,
              explain: '原题解析内容',
              aiAnalysis: '独立 AI 深度解析内容',
            },
          ],
        },
      },
    });

    const textarea = container.querySelector(
      '[data-testid="import-paste-textarea"]',
    ) as HTMLTextAreaElement;

    // 1) Paste event triggers json-intercept-banner even without API key
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? standardShareJson : ''),
      },
    });
    await act(async () => {
      textarea.dispatchEvent(pasteEvent);
      setNativeValue(textarea, standardShareJson);
    });

    const banner = container.querySelector('[data-testid="json-intercept-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain(
      '检测到这已经是标准题库格式，是否跳过 AI 消耗直接秒导？',
    );
    expect(container.querySelector('[data-testid="ai-open-settings-inline"]')).not.toBeNull();

    // 2) Also verify clicking ai-wash-btn directly on standard JSON without API key intercepts before API guard
    await act(async () => {
      setNativeValue(textarea, '');
      setNativeValue(textarea, standardShareJson);
    });
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).toBeNull();

    const notify = vi.fn();
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify,
          onCommit: async (payload) => {
            commits.push(payload);
          },
        }),
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement).click();
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith(
      expect.stringContaining('尚未配置 AI API Key'),
      'error',
    );
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).not.toBeNull();

    // 3) Click "直接导入" -> previews and commits losslessly with 0 fetch calls
    await act(async () => {
      (container.querySelector('[data-testid="json-intercept-direct-btn"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).toBeNull();
    expect(container.querySelector('[data-testid="import-preview"]')).not.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector('[data-testid="btn-confirm-import-sticky"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();

    expect(commits).toHaveLength(1);
    const committed = commits[0]!;
    expect(committed.mode).toBe('new');
    if (committed.mode === 'new') {
      expect(committed.input.questions[0]!.explain).toBe('原题解析内容');
      expect(committed.input.questions[0]!.aiAnalysis).toBe('独立 AI 深度解析内容');
    }
  });

  it('SW-12: F10 "仍用 AI 洗题" bypasses exact payload, re-arms on edit, and ignores non-standard JSON/text', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn().mockImplementation(async () =>
      makeMockChatResponse([
        {
          type: 'choice',
          stem: 'AI 洗题结果',
          options: ['X', 'Y'],
          answer: 0,
          answerInferred: false,
          explain: 'ok',
        },
      ]),
    );
    vi.stubGlobal('fetch', mockFetch);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });
    const textarea = container.querySelector(
      '[data-testid="import-paste-textarea"]',
    ) as HTMLTextAreaElement;

    const legacyJson = JSON.stringify({
      meta: { title: '旧版题库' },
      chapters: [{ id: 1, title: '第一章' }],
      questions: [
        {
          id: 'l1',
          type: 'choice',
          chapter: 1,
          stem: '旧版题干',
          options: ['A1', 'B1'],
          answer: 0,
        },
      ],
    });

    // (a) Non-standard JSON & plain text do NOT trigger intercept
    const nonStandardJson = JSON.stringify({ foo: 'bar', count: 2 });
    const pasteBad = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteBad, 'clipboardData', {
      value: { getData: () => nonStandardJson },
    });
    await act(async () => {
      textarea.dispatchEvent(pasteBad);
      setNativeValue(textarea, nonStandardJson);
    });
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).toBeNull();

    // (b) Paste standard JSON (selecting/replacing existing text) -> click "仍用 AI 洗题" -> dismisses banner; subsequent wash calls fetch
    const pasteGood = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteGood, 'clipboardData', {
      value: { getData: () => legacyJson },
    });
    await act(async () => {
      textarea.setSelectionRange(0, textarea.value.length);
      textarea.dispatchEvent(pasteGood);
      setNativeValue(textarea, legacyJson);
    });
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="json-intercept-ai-btn"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // (c) Editing textarea invalidates bypass & re-arms intercept; clicking "仍用 AI 洗题" from wash trigger immediately calls fetch
    const editedJson = JSON.stringify([
      {
        type: 'tf',
        stem: '编辑后的标准数组题',
        answer: true,
      },
    ]);
    await act(async () => {
      setNativeValue(textarea, `${editedJson} `);
      setNativeValue(textarea, editedJson);
    });
    await act(async () => {
      (container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      (container.querySelector('[data-testid="json-intercept-ai-btn"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('SW-13: F10 paste-area drop (standard .json File & JSON array text) triggers intercept while file-tab .json auto-preview stays untouched', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    const standardArr = JSON.stringify([
      {
        type: 'choice',
        stem: '数组格式标准题',
        options: ['甲', '乙'],
        answer: 0,
        explain: '数组解析',
      },
    ]);

    // 1) Switch to paste tab and drop a .json File -> triggers intercept banner (no auto-preview yet)
    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });
    const dropWrap = container.querySelector('.qi-paste-dropwrap') as HTMLDivElement;
    const jsonFile = new File([standardArr], 'standard-arr.json', { type: 'application/json' });
    const dropFileEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropFileEvent, 'dataTransfer', {
      value: {
        files: [jsonFile],
        getData: () => '',
      },
    });
    await act(async () => {
      dropWrap.dispatchEvent(dropFileEvent);
    });
    await flushMicrotasks(2);

    expect(container.querySelector('[data-testid="json-intercept-banner"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="import-preview"]')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    // Direct import from dropped file
    await act(async () => {
      (container.querySelector('[data-testid="json-intercept-direct-btn"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="import-preview"]')).not.toBeNull();

    // 2) Drop plain JSON array text -> triggers intercept banner again
    const dropTextEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropTextEvent, 'dataTransfer', {
      value: {
        files: [],
        getData: (t: string) => (t === 'text/plain' ? standardArr : ''),
      },
    });
    await act(async () => {
      dropWrap.dispatchEvent(dropTextEvent);
    });
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).not.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    // 3) File tab .json upload via bank-import-file-input stays untouched (no intercept banner, immediate preview)
    await act(async () => {
      (container.querySelector('[data-testid="import-tab-file"]') as HTMLButtonElement).click();
    });
    const fileInput = container.querySelector(
      '[data-testid="bank-import-file-input"]',
    ) as HTMLInputElement;
    const tabFile = new File([standardArr], 'direct-file-tab.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [tabFile], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMicrotasks(2);

    expect(container.querySelector('[data-testid="json-intercept-banner"]')).toBeNull();
    expect(container.querySelector('[data-testid="import-preview"]')).not.toBeNull();
  });

  it('SW-14: F10 Windows CRLF multiline JSON paste keeps json-intercept-banner visible after textarea LF normalization and imports with 0 fetch calls', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const commits: ImportCommitPayload[] = [];
    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: async (payload) => {
            commits.push(payload);
          },
        }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });

    const lfJson = JSON.stringify(
      [
        {
          type: 'choice',
          stem: 'CRLF 多行粘贴标准题',
          options: ['选项A', '选项B'],
          answer: 0,
          explain: '原题解析',
          aiAnalysis: 'AI 深度解析',
        },
      ],
      null,
      2,
    );
    const crlfJson = lfJson.replace(/\n/g, '\r\n');

    const textarea = container.querySelector(
      '[data-testid="import-paste-textarea"]',
    ) as HTMLTextAreaElement;

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? crlfJson : ''),
      },
    });
    await act(async () => {
      textarea.dispatchEvent(pasteEvent);
      setNativeValue(textarea, lfJson);
    });

    expect(container.querySelector('[data-testid="json-intercept-banner"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="json-intercept-direct-btn"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="json-intercept-banner"]')).toBeNull();
    expect(container.querySelector('[data-testid="import-preview"]')).not.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector('[data-testid="btn-confirm-import-sticky"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();

    expect(commits).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('SW-15: F10 paste event without clipboardData triggers json-intercept-banner on subsequent input change', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });

    const standardArr = JSON.stringify([
      {
        type: 'tf',
        stem: '无 clipboardData 粘贴事件拦截测试',
        answer: true,
      },
    ]);

    const textarea = container.querySelector(
      '[data-testid="import-paste-textarea"]',
    ) as HTMLTextAreaElement;
    const pasteWithoutClipboard = new Event('paste', { bubbles: true, cancelable: true });

    await act(async () => {
      textarea.dispatchEvent(pasteWithoutClipboard);
      setNativeValue(textarea, standardArr);
    });

    expect(container.querySelector('[data-testid="json-intercept-banner"]')).not.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('SW-16: F9 disables ai-wash-retry-chunk-0 and guards handleRetryChunk with 0 fetch calls when all 4 wash types are unchecked', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
    });

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Upstream 500' } }), {
        status: 500,
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(ImportWorkbench, {
          notify: vi.fn(),
          onCommit: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="import-tab-paste"]') as HTMLButtonElement).click();
    });
    const textarea = container.querySelector(
      '[data-testid="import-paste-textarea"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      setNativeValue(textarea, '1. 失败片段空题型重试校验');
    });

    await act(async () => {
      (container.querySelector('[data-testid="ai-wash-btn"]') as HTMLButtonElement).click();
    });
    await flushMicrotasks();

    const retryBtn = container.querySelector(
      '[data-testid="ai-wash-retry-chunk-0"]',
    ) as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    expect(retryBtn.disabled).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      setCheckbox(
        container.querySelector('[data-testid="wash-type-choice"]') as HTMLInputElement,
        false,
      );
      setCheckbox(
        container.querySelector('[data-testid="wash-type-multi"]') as HTMLInputElement,
        false,
      );
      setCheckbox(
        container.querySelector('[data-testid="wash-type-tf"]') as HTMLInputElement,
        false,
      );
      setCheckbox(
        container.querySelector('[data-testid="wash-type-short"]') as HTMLInputElement,
        false,
      );
    });

    expect(container.querySelector('[data-testid="wash-type-guard-hint"]')).not.toBeNull();
    expect(retryBtn.disabled).toBe(true);

    await act(async () => {
      retryBtn.click();
    });
    await flushMicrotasks();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

function setSelectValue(el: HTMLSelectElement, value: string) {
  setNativeValue(el, value);
}
