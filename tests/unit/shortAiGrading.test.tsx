import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_GUEST_SCOPE, accountPracticeScope } from '../../src/core/practiceScope';
import { createEmptyStore } from '../../src/core/storage';
import { PracticeScopeContext } from '../../src/hooks/practiceScope';
import {
  WORKSPACE_PREFS_STORAGE_KEY,
  loadWorkspacePrefs,
  saveWorkspacePrefs,
  useWorkspacePrefs,
} from '../../src/hooks/useWorkspacePrefs';
import { QuizSession } from '../../src/pages/QuizSession';
import type { QuizActions, SessionSpec } from '../../src/pages/quizTypes';
import {
  OPEN_API_SETTINGS_EVENT,
  clearApiConfig,
  createDefaultApiConfig,
  saveApiConfig,
} from '../../src/services/apiConfig';
import { LlmApiError } from '../../src/services/llmClient';
import {
  ApiClientError,
  gradeShortAnswer,
  mapScoreToMasteryLevel,
  parseSubjectiveGradeResponse,
} from '../../src/services/quizAiService';
import type { Question, UserStore } from '../../src/types/quiz';

function makeShortQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'short-q-1',
    type: 'short',
    chapter: 1,
    stem: '简述卷积神经网络中“局部感受野”与“权值共享”的作用。',
    answer: '局部感受野用于提取局部空间特征；权值共享大幅减少可训练参数并提升平移不变性。',
    explain: '这是 CNN 相比全连接网络的核心归纳偏置。',
    keyPoints: ['提取局部空间特征', '减少参数数量', '增强平移不变性'],
    source: { origin: 'comprehensive_bank', file: 'short.json', ref: '#1' },
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

describe('Short-Answer AI Grading (feat/short-ai-grading)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    sessionStorage.clear();
    clearApiConfig();
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
    vi.restoreAllMocks();
  });

  it('mapScoreToMasteryLevel maps boundaries and non-finite/out-of-range inputs', () => {
    expect(mapScoreToMasteryLevel(100)).toBe(2);
    expect(mapScoreToMasteryLevel(80)).toBe(2);
    expect(mapScoreToMasteryLevel(79)).toBe(1);
    expect(mapScoreToMasteryLevel(50)).toBe(1);
    expect(mapScoreToMasteryLevel(49)).toBe(0);
    expect(mapScoreToMasteryLevel(0)).toBe(0);
    expect(mapScoreToMasteryLevel(-1)).toBe(0);
    expect(mapScoreToMasteryLevel(125)).toBe(2);
    expect(mapScoreToMasteryLevel(Number.NaN)).toBe(0);
    expect(mapScoreToMasteryLevel(Number.POSITIVE_INFINITY)).toBe(0);
    expect(mapScoreToMasteryLevel(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('parseSubjectiveGradeResponse handles fences, <think>, prose, LaTeX backslashes, numeric strings, and fallbacks', () => {
    const rawFenced = [
      '<think>内部推理过程：先核对公式 \\frac{1}{2}。</think>',
      '以下是批改结果：',
      '```json',
      '{',
      '  "score": "85",',
      '  "matchedPoints": ["写出了目标函数 $\\frac{1}{2}x^2$"],',
      '  "missingPoints": "- 缺少约束条件\\n- 未说明边界 $\\alpha$",',
      '  "comment": "总体准确，梯度推导 $\\nabla f(x)$ 清晰。"',
      '}',
      '```',
      '请继续复习。',
    ].join('\n');

    const parsed1 = parseSubjectiveGradeResponse(rawFenced);
    expect(parsed1.score).toBe(85);
    expect(parsed1.suggestedLevel).toBe(2);
    expect(parsed1.recommendedMastery).toBe(2);
    expect(parsed1.matchedPoints).toEqual(['写出了目标函数 $\\frac{1}{2}x^2$']);
    expect(parsed1.missingPoints).toEqual(['缺少约束条件', '未说明边界 $\\alpha$']);
    expect(parsed1.comment).toContain('\\nabla f(x)');
    expect(parsed1.summary).toBe(parsed1.comment);

    // Backward-compatibility with recommendedMastery / summary & invalid suggestedLevel fallback
    const parsed2 = parseSubjectiveGradeResponse({
      score: 64,
      suggestedLevel: 99,
      recommendedMastery: 1,
      summary: '掌握核心概念但缺少细节。',
      matchedPoints: '核心定义准确；逻辑通顺',
      missingPoints: [],
    });
    expect(parsed2.score).toBe(64);
    expect(parsed2.suggestedLevel).toBe(1);
    expect(parsed2.recommendedMastery).toBe(1);
    expect(parsed2.comment).toBe('掌握核心概念但缺少细节。');
    expect(parsed2.summary).toBe('掌握核心概念但缺少细节。');
    expect(parsed2.matchedPoints).toEqual(['核心定义准确', '逻辑通顺']);

    // Invalid suggestedLevel & missing recommendedMastery falls back to mapScoreToMasteryLevel
    const parsed3 = parseSubjectiveGradeResponse({
      score: 42,
      suggestedLevel: 'invalid',
      comment: '需要重温基础概念。',
    });
    expect(parsed3.score).toBe(42);
    expect(parsed3.suggestedLevel).toBe(0);
    expect(parsed3.recommendedMastery).toBe(0);

    expect(() => parseSubjectiveGradeResponse('not valid json at all')).toThrowError(LlmApiError);
  });

  it('parseSubjectiveGradeResponse tolerates multi-fence, prose braces, multiple JSON objects, and unclosed <think> while rejecting non-grading objects', () => {
    // 1. Non-JSON fence before ```json fence
    const multiFenceRaw = [
      '先看标准公式推导：',
      '```latex',
      '\\frac{1}{2} \\sum_{i=1}^{n} (y_i - \\hat{y}_i)^2',
      '```',
      '批改结果如下：',
      '```json',
      '{"score": 90, "matchedPoints": ["公式正确"], "missingPoints": [], "comment": "推导完整"}',
      '```',
    ].join('\n');
    const resMultiFence = parseSubjectiveGradeResponse(multiFenceRaw);
    expect(resMultiFence.score).toBe(90);
    expect(resMultiFence.suggestedLevel).toBe(2);
    expect(resMultiFence.comment).toBe('推导完整');

    // 2. Prose containing {a, b} before grading JSON
    const proseBracesRaw =
      '用户答案提到了集合 {a, b} 的映射关系，据此评分：{"score": 82, "matchedPoints": ["集合映射"], "comment": "表达清楚"}';
    const resProseBraces = parseSubjectiveGradeResponse(proseBracesRaw);
    expect(resProseBraces.score).toBe(82);
    expect(resProseBraces.suggestedLevel).toBe(2);
    expect(resProseBraces.matchedPoints).toEqual(['集合映射']);

    // 3. Multiple JSON objects (non-grading metadata object followed by grading object)
    const multiObjRaw =
      '{"step": "check", "ok": true}\n随后给出评分：{"score": 88, "suggestedLevel": 2, "comment": "逻辑严谨"}';
    const resMultiObj = parseSubjectiveGradeResponse(multiObjRaw);
    expect(resMultiObj.score).toBe(88);
    expect(resMultiObj.suggestedLevel).toBe(2);
    expect(resMultiObj.comment).toBe('逻辑严谨');

    // 4. Unclosed <think> tag with braces (both balanced and unbalanced) before grading JSON
    const unclosedThinkRaw =
      '<think>思考过程：检查 {a, b} 以及未闭合的 { 和 {"step": 1} 后得出结论：\n{"score": 74, "comment": "基本正确，略缺细节"}';
    const resUnclosedThink = parseSubjectiveGradeResponse(unclosedThinkRaw);
    expect(resUnclosedThink.score).toBe(74);
    expect(resUnclosedThink.suggestedLevel).toBe(1);
    expect(resUnclosedThink.comment).toBe('基本正确，略缺细节');

    // 5. Empty object or unrelated object without grading keys throws PARSE_ERROR
    for (const invalidInput of [{}, { foo: 'bar' }, '{}', '{"foo": "bar"}'] as const) {
      let caught: unknown = null;
      try {
        parseSubjectiveGradeResponse(invalidInput);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(LlmApiError);
      expect(caught).toBeInstanceOf(ApiClientError);
      expect((caught as LlmApiError).code).toBe('PARSE_ERROR');
    }
  });

  it('gradeShortAnswer sends stem, answer, explain, and userAnswer, and guards missing config / HTTP errors', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      gradeShortAnswer({
        stem: '题干内容',
        answer: '参考答案',
        explain: '原题解析',
        userAnswer: '我的答案',
      }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    saveApiConfig({
      ...createDefaultApiConfig(),
      baseUrl: 'https://mock-grade.example.test/v1',
      apiKey: 'sk-short-grade',
      model: 'mock-grader',
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'mock-grader',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 76,
                  suggestedLevel: 1,
                  matchedPoints: ['局部特征'],
                  missingPoints: ['参数共享'],
                  comment: '命中部分要点，建议补充权值共享。',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { feedback } = await gradeShortAnswer({
      stem: '简述 CNN 特点',
      answer: '局部感受野与权值共享',
      explain: '减少全连接参数量',
      keyPoints: ['局部感受野', '权值共享'],
      userAnswer: '具有局部连接特点',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const reqInit = fetchSpy.mock.calls[0]![1] as RequestInit;
    const reqBody = JSON.parse(String(reqInit.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = reqBody.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userPrompt).toContain('简述 CNN 特点');
    expect(userPrompt).toContain('局部感受野与权值共享');
    expect(userPrompt).toContain('减少全连接参数量');
    expect(userPrompt).toContain('具有局部连接特点');
    expect(feedback.score).toBe(76);
    expect(feedback.suggestedLevel).toBe(1);
    expect(feedback.recommendedMastery).toBe(1);
    expect(feedback.comment).toBe('命中部分要点，建议补充权值共享。');

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }),
    );
    await expect(
      gradeShortAnswer({
        stem: '题干',
        answer: '答案',
        userAnswer: '作答',
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', statusCode: 429 });
  });

  it('useWorkspacePrefs persists shortAnswerMode per scope and falls back safely on corrupted JSON', () => {
    const accountScope = accountPracticeScope('user-99');
    expect(loadWorkspacePrefs(LEGACY_GUEST_SCOPE).shortAnswerMode).toBe('self');

    localStorage.setItem(WORKSPACE_PREFS_STORAGE_KEY, '{corrupted-json');
    expect(loadWorkspacePrefs(LEGACY_GUEST_SCOPE).shortAnswerMode).toBe('self');

    localStorage.setItem(
      WORKSPACE_PREFS_STORAGE_KEY,
      JSON.stringify({ autoExplainOnWrong: true, shortAnswerMode: 'unexpected-mode' }),
    );
    expect(loadWorkspacePrefs(LEGACY_GUEST_SCOPE)).toEqual({
      autoExplainOnWrong: true,
      shortAnswerMode: 'self',
    });

    saveWorkspacePrefs({ autoExplainOnWrong: false, shortAnswerMode: 'ai' }, LEGACY_GUEST_SCOPE);
    expect(loadWorkspacePrefs(LEGACY_GUEST_SCOPE).shortAnswerMode).toBe('ai');
    expect(loadWorkspacePrefs(accountScope).shortAnswerMode).toBe('self');

    let latestApi: ReturnType<typeof useWorkspacePrefs> | null = null;
    function Probe() {
      latestApi = useWorkspacePrefs();
      return null;
    }

    root = createRoot(container);
    act(() => {
      root!.render(
        <PracticeScopeContext.Provider value={LEGACY_GUEST_SCOPE}>
          <Probe />
        </PracticeScopeContext.Provider>,
      );
    });
    expect(latestApi!.prefs.shortAnswerMode).toBe('ai');

    act(() => {
      latestApi!.setShortAnswerMode('self');
    });
    expect(loadWorkspacePrefs(LEGACY_GUEST_SCOPE).shortAnswerMode).toBe('self');
  });

  it('QuizSession handles default self mode, AI grading workflow, missing key, errors, retry, override, and cross-question memory', async () => {
    const q1 = makeShortQuestion({ id: 'sq-1' });
    const q2 = makeShortQuestion({
      id: 'sq-2',
      stem: '简述梯度裁剪（Gradient Clipping）解决什么问题？',
      answer: '缓解深层网络反向传播过程中的梯度爆炸问题。',
      explain: '常用于 RNN 等序列模型训练。',
    });
    const spec: SessionSpec = {
      id: 101,
      config: { kind: 'mode', title: '简答练习', opts: { mode: 'short', chapters: [1], count: 0, order: 'seq' } },
      queue: [q1, q2],
    };
    const storeRef = { current: createEmptyStore() };
    const actions = makeSessionActions(storeRef);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

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

    // 1. Default state is 'self' with zero API calls
    const selfBtn = container.querySelector('[data-testid="short-mode-self"]') as HTMLButtonElement;
    const aiBtn = container.querySelector('[data-testid="short-mode-ai"]') as HTMLButtonElement;
    expect(selfBtn.getAttribute('aria-pressed')).toBe('true');
    expect(aiBtn.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="btn-reveal-answer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="short-ai-textarea"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // 2. Switch to AI mode -> visible cost reminder, disabled empty submit, Spacebar does NOT reveal ref answer
    act(() => {
      aiBtn.click();
    });
    expect(aiBtn.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="short-ai-cost-hint"]')?.textContent).toContain('Token');
    const submitBtn = () => container.querySelector('[data-testid="short-ai-submit"]') as HTMLButtonElement;
    const textarea = () => container.querySelector('[data-testid="short-ai-textarea"]') as HTMLTextAreaElement;
    expect(submitBtn().disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="q-ref-answer"]')).toBeNull();

    // 3. Type draft with missing API key -> click submit -> 0 fetch calls, missing-key banner + open-settings + switch-self
    const setTextareaValue = (el: HTMLTextAreaElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    act(() => {
      setTextareaValue(textarea(), '局部感受野提取特征，权值共享减少参数。');
    });
    expect(submitBtn().disabled).toBe(false);

    act(() => {
      submitBtn().click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(container.querySelector('[data-testid="short-ai-missing-key"]')).not.toBeNull();

    const openSettingsSpy = vi.fn();
    window.addEventListener(OPEN_API_SETTINGS_EVENT, openSettingsSpy);
    act(() => {
      (container.querySelector('[data-testid="short-ai-open-settings"]') as HTMLButtonElement).click();
    });
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_API_SETTINGS_EVENT, openSettingsSpy);

    // Quick switch back to self works and restores reveal button
    act(() => {
      (container.querySelector('[data-testid="short-ai-switch-self"]') as HTMLButtonElement).click();
    });
    expect(selfBtn.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="btn-reveal-answer"]')).not.toBeNull();

    // 4. Configure API key and switch back to AI mode; test 429 error preserves draft
    act(() => {
      saveApiConfig({
        ...createDefaultApiConfig(),
        baseUrl: 'https://mock-ws-grade.example.test/v1',
        apiKey: 'sk-valid-key',
        model: 'mock-grader',
      });
      (container.querySelector('[data-testid="short-mode-ai"]') as HTMLButtonElement).click();
    });
    expect(textarea().value).toBe('局部感受野提取特征，权值共享减少参数。');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'too many requests' } }), { status: 429 }),
    );
    await act(async () => {
      submitBtn().click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="short-ai-error"]')).not.toBeNull();
    expect(textarea().value).toBe('局部感受野提取特征，权值共享减少参数。');

    // 5. Submit again with deferred promise to check loading lock, then resolve with score 88
    let resolveFetch!: (res: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    act(() => {
      submitBtn().click();
    });
    expect(textarea().disabled).toBe(true);
    expect(submitBtn().disabled).toBe(true);
    expect(submitBtn().textContent).toContain('批改中');

    await act(async () => {
      resolveFetch(
        new Response(
          JSON.stringify({
            model: 'mock-grader',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 88,
                    suggestedLevel: 2,
                    matchedPoints: ['局部感受野提取特征', '权值共享减少参数'],
                    missingPoints: ['平移不变性'],
                    comment: '核心要点已命中，可补充平移不变性。',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    // Result card, expanded q-ref-answer, and auto-recorded selfcheck-2
    const resultCard = container.querySelector('[data-testid="short-ai-result"]');
    expect(resultCard?.textContent).toContain('88 / 100');
    expect(resultCard?.textContent).toContain('局部感受野提取特征');
    expect(resultCard?.textContent).toContain('平移不变性');
    expect(resultCard?.textContent).toContain('核心要点已命中，可补充平移不变性。');
    expect(container.querySelector('[data-testid="q-ref-answer"]')).not.toBeNull();
    expect(storeRef.current.mastery['sq-1']).toBe(2);
    expect(container.querySelector('[data-testid="selfcheck-2"]')?.getAttribute('aria-pressed')).toBe('true');

    // Manual override via selfcheck-1
    act(() => {
      (container.querySelector('[data-testid="selfcheck-1"]') as HTMLButtonElement).click();
    });
    expect(storeRef.current.mastery['sq-1']).toBe(1);
    expect(container.querySelector('[data-testid="selfcheck-1"]')?.getAttribute('aria-pressed')).toBe('true');

    // Retry button clears result and unlocks textarea
    act(() => {
      (container.querySelector('[data-testid="short-ai-retry"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="short-ai-result"]')).toBeNull();
    expect(textarea().disabled).toBe(false);
    expect(textarea().value).toBe('局部感受野提取特征，权值共享减少参数。');

    // 6. Navigate to next question -> stays in AI mode
    act(() => {
      (container.querySelector('[data-testid="btn-next"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="quiz-progress-text"]')?.textContent).toContain('2 / 2');
    expect(
      container.querySelector('[data-testid="short-mode-ai"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(container.querySelector('[data-testid="short-ai-textarea"]')).not.toBeNull();
  });

  it('QuizSession prevents duplicate API requests on synchronous double-click of short-ai-submit', async () => {
    saveApiConfig({
      ...createDefaultApiConfig(),
      baseUrl: 'https://mock-double-click.example.test/v1',
      apiKey: 'sk-double-click',
      model: 'mock-grader',
    });
    saveWorkspacePrefs({ autoExplainOnWrong: false, shortAnswerMode: 'ai' }, LEGACY_GUEST_SCOPE);

    const q1 = makeShortQuestion({ id: 'sq-double-click' });
    const spec: SessionSpec = {
      id: 102,
      config: { kind: 'mode', title: '简答防连击', opts: { mode: 'short', chapters: [1], count: 0, order: 'seq' } },
      queue: [q1],
    };
    const storeRef = { current: createEmptyStore() };
    const actions = makeSessionActions(storeRef);

    let resolveFetch!: (res: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

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

    const textarea = container.querySelector('[data-testid="short-ai-textarea"]') as HTMLTextAreaElement;
    const submitBtn = () => container.querySelector('[data-testid="short-ai-submit"]') as HTMLButtonElement;

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '局部感受野提取局部空间特征，权值共享减少参数。');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Synchronous double-click inside a single act() before React commits shortAiLoading=true
    act(() => {
      const btn = submitBtn();
      btn.click();
      btn.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch(
        new Response(
          JSON.stringify({
            model: 'mock-grader',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 85,
                    suggestedLevel: 2,
                    matchedPoints: ['局部感受野', '权值共享'],
                    missingPoints: [],
                    comment: '回答准确。',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="short-ai-result"]')?.textContent).toContain('85 / 100');

    // Verify lock is cleanly released so retry + resubmit works
    act(() => {
      (container.querySelector('[data-testid="short-ai-retry"]') as HTMLButtonElement).click();
    });
    act(() => {
      const btn = submitBtn();
      btn.click();
      btn.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFetch(
        new Response(
          JSON.stringify({
            model: 'mock-grader',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 92,
                    suggestedLevel: 2,
                    matchedPoints: ['局部感受野', '权值共享'],
                    missingPoints: [],
                    comment: '二次提交成功。',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector('[data-testid="short-ai-result"]')?.textContent).toContain('92 / 100');
  });
});
