import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiQuestionTutor } from '../../src/components/ApiSettings/AiQuestionTutor';
import {
  OPEN_API_SETTINGS_EVENT,
  clearApiConfig,
  saveApiConfig,
} from '../../src/services/apiConfig';
import type { Question, UserStore } from '../../src/types/quiz';

function makeSseResponse(chunks: string[], model = 'mock-tutor-model'): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const delta of chunks) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              model,
              choices: [{ delta: { content: delta } }],
            })}\n\n`,
          ),
        );
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

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'tutor-q1',
    type: 'choice',
    chapter: 1,
    stem: '若 $f(x) = x^2$，则 $f\'(x)$ 等于？',
    options: ['$2x$', '$x$', '$x^2$', '$2$'],
    answer: 0,
    explain: '基础导数公式',
    source: { origin: 'comprehensive_bank', file: 'calc.md', ref: '#1' },
    ...overrides,
  };
}

function seedReadyApiConfig(): void {
  saveApiConfig({
    provider: 'custom',
    baseUrl: 'https://mock-tutor.local/v1',
    apiKey: 'sk-tutor-123',
    model: 'mock-tutor-model',
    temperature: 0.3,
    maxTokens: 1024,
    timeoutMs: 10000,
    storageScope: 'local',
  });
}

describe('AiQuestionTutor (M3)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    sessionStorage.clear();
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

  it('hides ai-tutor-panel before grading objective question, and shows missing API key guard with 0 fetch calls', async () => {
    clearApiConfig();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const openEvents: Event[] = [];
    const onOpen = (e: Event) => openEvents.push(e);
    window.addEventListener(OPEN_API_SETTINGS_EVENT, onOpen);

    const q = makeQuestion();
    root = createRoot(container);
    act(() => {
      root!.render(
        <AiQuestionTutor question={q} isGraded={false} isRevealed={false} />,
      );
    });

    // Zero spoiler before grading
    expect(container.querySelector('[data-testid="ai-tutor-panel"]')).toBeNull();
    const explainBtn = container.querySelector('[data-testid="ai-btn-explain"]') as HTMLButtonElement;
    expect(explainBtn).not.toBeNull();

    // Clicking explain with unconfigured API key must intercept with 0 fetch calls
    await act(async () => {
      explainBtn.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(container.querySelector('[data-testid="ai-explain-drawer"]')).not.toBeNull();
    const jumpCta = container.querySelector(
      '[data-testid="ai-open-settings-inline"]',
    ) as HTMLButtonElement;
    expect(jumpCta).not.toBeNull();

    act(() => {
      jumpCta.click();
    });
    expect(openEvents).toHaveLength(1);
    window.removeEventListener(OPEN_API_SETTINGS_EVENT, onOpen);
  });

  it('streams structured 3-section KaTeX analysis and persists via onSaveAiAnalysis', async () => {
    seedReadyApiConfig();
    const streamChunks = [
      '### 【核心考点】\n幂函数求导法则：$f\'(x)=nx^{n-1}$。\n\n',
      '### 【解题思路】\n将 $n=2$ 代入得到 $2x$。\n\n',
      '### 【逐项排错】\n- B/C/D 均不符合求导法则。',
    ];
    const fetchMock = vi.fn().mockImplementation(async () => makeSseResponse(streamChunks));
    vi.stubGlobal('fetch', fetchMock);
    const onSave = vi.fn();

    const q = makeQuestion();
    root = createRoot(container);
    act(() => {
      root!.render(
        <AiQuestionTutor
          question={q}
          isGraded={true}
          isRevealed={false}
          onSaveAiAnalysis={onSave}
        />,
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="ai-btn-explain"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const card = container.querySelector('[data-testid="ai-explain-card"]')!;
    expect(card.textContent).toContain('核心考点');
    expect(card.textContent).toContain('解题思路');
    expect(card.textContent).toContain('逐项排错');
    expect(card.querySelector('.katex')).not.toBeNull();
    expect(onSave).toHaveBeenCalledWith(
      q.id,
      streamChunks.join(''),
      'mock-tutor-model',
    );
  });

  it('keeps the generated analysis visible and retries a failed save without calling the model again', async () => {
    seedReadyApiConfig();
    const analysis = '### 【核心考点】\n生成成功，等待保存';
    const fetchMock = vi.fn(async () => makeSseResponse([analysis]));
    vi.stubGlobal('fetch', fetchMock);
    const save = vi.fn().mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    }).mockResolvedValue(undefined);

    root = createRoot(container);
    act(() => {
      root!.render(
        <AiQuestionTutor question={makeQuestion()} isGraded isRevealed={false} onSaveAiAnalysis={save} />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ai-btn-explain"]')!.click();
    });

    const card = container.querySelector('[data-testid="ai-explain-card"]')!;
    expect(card.textContent).toContain('生成成功，等待保存');
    expect(card.textContent).toContain('解析保存失败');
    const retry = Array.from(card.querySelectorAll('button')).find((button) => button.textContent === '重试保存')!;
    await act(async () => retry.click());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('tutor-q1', analysis, 'mock-tutor-model');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(card.textContent).not.toContain('解析保存失败');
  });

  it('hits cached store.aiExplanations or question.aiAnalysis with 0 LLM calls and supports regenerate', async () => {
    seedReadyApiConfig();
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        makeSseResponse(['### 【核心考点】\n重新生成的新解析']),
      );
    vi.stubGlobal('fetch', fetchMock);
    const onSave = vi.fn();

    const q = makeQuestion({ id: 'cached-q1' });
    const store: UserStore = {
      records: {},
      fav: {},
      mastery: {},
      aiExplanations: {
        'cached-q1': { content: '### 【核心考点】\n本地/云端缓存命中解析', updatedAt: 1000 },
      },
    };

    root = createRoot(container);
    act(() => {
      root!.render(
        <AiQuestionTutor
          question={q}
          store={store}
          isGraded={true}
          isRevealed={false}
          onSaveAiAnalysis={onSave}
        />,
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="ai-btn-explain"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(container.querySelector('[data-testid="ai-explain-card"]')!.textContent).toContain(
      '本地/云端缓存命中解析',
    );

    // Regenerate bypasses cache and persists new content
    const regenBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '重新生成',
    )!;
    await act(async () => {
      regenBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="ai-explain-card"]')!.textContent).toContain(
      '重新生成的新解析',
    );
    expect(onSave).toHaveBeenCalledWith(
      'cached-q1',
      '### 【核心考点】\n重新生成的新解析',
      'mock-tutor-model',
    );
  });

  it('aborts active stream and clears stale state when switching questions', async () => {
    seedReadyApiConfig();
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const q1 = makeQuestion({ id: 'switch-q1' });
    const q2 = makeQuestion({ id: 'switch-q2', stem: '第二题题干' });

    root = createRoot(container);
    act(() => {
      root!.render(<AiQuestionTutor question={q1} isGraded={true} isRevealed={false} />);
    });

    act(() => {
      (container.querySelector('[data-testid="ai-btn-explain"]') as HTMLButtonElement).click();
    });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // Switch to Q2 without unmounting
    await act(async () => {
      root!.render(<AiQuestionTutor question={q2} isGraded={false} isRevealed={false} />);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(capturedSignal!.aborted).toBe(true);
    expect(container.querySelector('[data-testid="ai-explain-drawer"]')).toBeNull();
    expect(container.querySelector('[data-testid="ai-tutor-panel"]')).toBeNull();
  });

  it('supports quick follow-up pills and multi-turn chat preserving conversation history', async () => {
    seedReadyApiConfig();
    const capturedBodies: Array<{ messages?: Array<{ role: string; content: string }> }> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        messages?: Array<{ role: string; content: string }>;
      };
      capturedBodies.push(body);
      const lastUser = body.messages?.[body.messages.length - 1]?.content ?? '';
      if (lastUser.includes('干扰项')) {
        return makeSseResponse(['针对追问：选项 B 忽略了常数系数。']);
      }
      if (lastUser.includes('自定义第一轮')) {
        return makeSseResponse(['第一轮回复：导数衡量瞬时变化率。']);
      }
      return makeSseResponse(['第二轮回复：几何意义即切线斜率。']);
    });
    vi.stubGlobal('fetch', fetchMock);

    const q = makeQuestion({ id: 'chat-q1', aiAnalysis: '### 【核心考点】\n已有缓存解析' });
    root = createRoot(container);
    act(() => {
      root!.render(<AiQuestionTutor question={q} isGraded={true} isRevealed={false} />);
    });

    // Open drawer (cache hit -> 0 fetch)
    await act(async () => {
      (container.querySelector('[data-testid="ai-btn-explain"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    // Click quick follow-up pill 0
    await act(async () => {
      (container.querySelector('[data-testid="ai-followup-pill-0"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(capturedBodies).toHaveLength(1);
    expect(JSON.stringify(capturedBodies[0]!.messages)).toContain('已有缓存解析');
    expect(container.querySelector('[data-testid="ai-chat-card"]')!.textContent).toContain(
      '针对追问：选项 B 忽略了常数系数',
    );

    // Send custom Turn 2 message via form
    const input = container.querySelector('[data-testid="ai-chat-input"]') as HTMLInputElement;
    const form = input.closest('form')!;
    const setReactInputValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;

    act(() => {
      setReactInputValue.call(input, '自定义第一轮追问');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(capturedBodies).toHaveLength(2);
    const secondSerialized = JSON.stringify(capturedBodies[1]!.messages);
    expect(secondSerialized).toContain('为什么不选其他干扰项');
    expect(secondSerialized).toContain('针对追问：选项 B 忽略了常数系数');
    expect(secondSerialized).toContain('自定义第一轮追问');
    expect(container.querySelector('[data-testid="ai-chat-card"]')!.textContent).toContain(
      '第一轮回复：导数衡量瞬时变化率',
    );
  });
});
