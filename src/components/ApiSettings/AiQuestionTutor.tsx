import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import type { MasteryLevel, Question, UserRecord, UserStore } from '../../types/quiz';
import { isObjectiveQuestion } from '../../core/questionUtils';
import { usePracticeScope } from '../../hooks/practiceScope';
import {
  askQuestionFollowUpStream,
  explainQuestionStream,
  gradeSubjectiveDraft,
  isApiConfigReady,
  loadApiConfig,
  LlmApiError,
  requestOpenApiSettings,
  subscribeApiConfig,
  type ApiConfig,
  type ChatMessage,
  type SubjectiveGradeFeedback,
} from '../../services';
import { Icon } from '../Icons';
import { RichContent } from '../RichContent';
import './ApiSettings.css';

export const QUICK_FOLLOWUPS = [
  '为什么不选其他干扰项？',
  '请举一道同类考点变式题',
] as const;

export interface AiQuestionTutorProps {
  question: Question;
  userRecord?: UserRecord;
  isGraded: boolean;
  isRevealed: boolean;
  chapterTitle?: string;
  bankName?: string;
  store?: UserStore;
  autoExplainOnWrong?: boolean;
  onToggleAutoExplain?: (next: boolean) => void;
  onSuggestedMastery?: (level: MasteryLevel) => void;
  onSaveAiAnalysis?: (questionId: string, content: string, model?: string) => Promise<void> | void;
}

const MASTERY_LABEL: Record<MasteryLevel, string> = {
  2: '完全会',
  1: '有点模糊',
  0: '不会',
};

/**
 * Resolve persisted AI explanation cache for a question.
 * Intentionally excludes legacy/short `question.explain` so first-time
 * "AI 深度解析" still calls the LLM to generate structured 3-section analysis.
 */
export function getCachedAiExplanation(question: Question, store?: UserStore): string {
  const candidates = [
    store?.aiExplanations?.[question.id]?.content,
    question.aiAnalysis,
    question.explanation,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return '';
}

interface AnalysisSave {
  questionId: string;
  content: string;
  model?: string;
}

export interface AiQuestionTutorController {
  question: Question;
  objective: boolean;
  isGraded: boolean;
  isRevealed: boolean;
  config: ApiConfig;
  ready: boolean;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  explainText: string;
  explainLoading: boolean;
  explainError: string | null;
  analysisSaveFailed: boolean;
  retryAnalysisSave: () => Promise<void>;
  isCachedHit: boolean;
  gradeOpen: boolean;
  setGradeOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  draftAnswer: string;
  setDraftAnswer: (val: string) => void;
  gradeLoading: boolean;
  gradeError: string | null;
  gradeResult: SubjectiveGradeFeedback | null;
  appliedMastery: MasteryLevel | null;
  chatHistory: ChatMessage[];
  chatInput: string;
  setChatInput: (val: string) => void;
  chatLoading: boolean;
  chatError: string | null;
  chatInputRef: RefObject<HTMLInputElement | null>;
  stopActiveRequest: () => void;
  runExplain: (force?: boolean, recordOverride?: UserRecord) => Promise<void>;
  runGrade: () => Promise<void>;
  sendFollowUp: (rawText: string) => Promise<void>;
  runFollowUp: (e: FormEvent) => Promise<void>;
  clearChat: () => void;
  openChatDrawer: () => void;
  canApplyMastery: boolean;
  handleApplyMastery: (level: MasteryLevel) => void;
}

export function useAiQuestionTutor({
  question,
  userRecord,
  isGraded,
  isRevealed,
  chapterTitle,
  bankName,
  store,
  onSuggestedMastery,
  onSaveAiAnalysis,
}: AiQuestionTutorProps): AiQuestionTutorController {
  const scope = usePracticeScope();
  const [config, setConfig] = useState<ApiConfig>(() => loadApiConfig(scope));
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Deep explanation state
  const [explainText, setExplainText] = useState('');
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [failedAnalysisSave, setFailedAnalysisSave] = useState<AnalysisSave | null>(null);
  const [isCachedHit, setIsCachedHit] = useState(false);

  // Subjective AI grader state
  const [gradeOpen, setGradeOpen] = useState(false);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [gradeLoading, setGradeLoading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [gradeResult, setGradeResult] = useState<SubjectiveGradeFeedback | null>(null);
  const [appliedMastery, setAppliedMastery] = useState<MasteryLevel | null>(null);

  // Follow-up chat state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const activeQuestionIdRef = useRef<string>(question.id);
  const activeSaveRef = useRef<AnalysisSave | null>(null);
  const localSavedCacheRef = useRef<Record<string, string>>({});
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setConfig(loadApiConfig(scope));
    return subscribeApiConfig(setConfig, scope);
  }, [scope]);

  // Abort in-flight streams and reset transient state whenever question changes
  useEffect(() => {
    activeQuestionIdRef.current = question.id;
    activeSaveRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;

    setDrawerOpen(false);
    setExplainText('');
    setExplainLoading(false);
    setExplainError(null);
    setFailedAnalysisSave(null);
    setIsCachedHit(false);

    setGradeOpen(false);
    setDraftAnswer('');
    setGradeLoading(false);
    setGradeError(null);
    setGradeResult(null);
    setAppliedMastery(null);

    setChatHistory([]);
    setChatInput('');
    setChatLoading(false);
    setChatError(null);
  }, [question.id]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      activeSaveRef.current = null;
    };
  }, []);

  const saveAnalysis = useCallback(async (save: AnalysisSave) => {
    activeSaveRef.current = save;
    setFailedAnalysisSave(null);
    try {
      await onSaveAiAnalysis?.(save.questionId, save.content, save.model);
    } catch {
      if (activeSaveRef.current === save) setFailedAnalysisSave(save);
    } finally {
      if (activeSaveRef.current === save) activeSaveRef.current = null;
    }
  }, [onSaveAiAnalysis]);

  const retryAnalysisSave = useCallback(async () => {
    if (failedAnalysisSave?.questionId === question.id) await saveAnalysis(failedAnalysisSave);
  }, [failedAnalysisSave, question.id, saveAnalysis]);

  const objective = isObjectiveQuestion(question.type);
  const ready = isApiConfigReady(config);

  const stopActiveRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setExplainLoading(false);
    setGradeLoading(false);
    setChatLoading(false);
  }, []);

  const runExplain = useCallback(
    async (force = false, recordOverride?: UserRecord) => {
      const targetQuestion = question;
      const targetQuestionId = targetQuestion.id;
      const effectiveRecord = recordOverride ?? userRecord;

      const persistedCache =
        getCachedAiExplanation(targetQuestion, store) ||
        localSavedCacheRef.current[targetQuestionId] ||
        '';

      if (!force && persistedCache) {
        stopActiveRequest();
        setDrawerOpen(true);
        setExplainError(null);
        setExplainLoading(false);
        setExplainText(persistedCache);
        setIsCachedHit(true);
        return;
      }

      if (!force && explainText.trim() && !explainError) {
        setDrawerOpen(true);
        return;
      }

      if (!ready) {
        stopActiveRequest();
        setDrawerOpen(true);
        setExplainText('');
        setIsCachedHit(false);
        setExplainError('尚未配置大模型 API，点击下方按钮完成配置后即可使用 AI 深度解析。');
        return;
      }

      stopActiveRequest();
      const controller = new AbortController();
      abortRef.current = controller;

      setDrawerOpen(true);
      setExplainLoading(true);
      setExplainError(null);
      setExplainText('');
      setIsCachedHit(false);

      try {
        const result = await explainQuestionStream(
          targetQuestion,
          { userRecord: effectiveRecord, chapterTitle, bankName },
          (_chunk, accumulated) => {
            if (controller.signal.aborted || activeQuestionIdRef.current !== targetQuestionId) {
              return;
            }
            setExplainText(accumulated);
          },
          { signal: controller.signal, practiceScope: scope },
        );
        if (controller.signal.aborted || activeQuestionIdRef.current !== targetQuestionId) {
          return;
        }
        const finalContent = result.content.trim() ? result.content : '';
        setExplainText(finalContent);
        if (finalContent) {
          localSavedCacheRef.current[targetQuestionId] = finalContent;
          void saveAnalysis({ questionId: targetQuestionId, content: finalContent, model: result.model });
        }
      } catch (err) {
        if (controller.signal.aborted || activeQuestionIdRef.current !== targetQuestionId) {
          return;
        }
        if (err instanceof LlmApiError && err.code === 'ABORTED') return;
        setExplainError(
          err instanceof LlmApiError ? err.userMessage : 'AI 解析生成失败，请稍后重试。',
        );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (!controller.signal.aborted && activeQuestionIdRef.current === targetQuestionId) {
          setExplainLoading(false);
        }
      }
    },
    [
      bankName,
      chapterTitle,
      explainError,
      explainText,
      question,
      ready,
      saveAnalysis,
      scope,
      stopActiveRequest,
      store,
      userRecord,
    ],
  );

  const runGrade = useCallback(async () => {
    const targetQuestion = question;
    const targetQuestionId = targetQuestion.id;

    if (!draftAnswer.trim()) {
      setGradeError('请先输入你的作答思路或关键词，再点击 AI 批改。');
      return;
    }
    if (!ready) {
      setGradeError('尚未配置大模型 API，请先点击“API 设置”填写密钥与模型。');
      return;
    }

    stopActiveRequest();
    const controller = new AbortController();
    abortRef.current = controller;

    setGradeLoading(true);
    setGradeError(null);
    setAppliedMastery(null);
    try {
      const { feedback } = await gradeSubjectiveDraft(targetQuestion, draftAnswer, {
        signal: controller.signal,
        practiceScope: scope,
      });
      if (controller.signal.aborted || activeQuestionIdRef.current !== targetQuestionId) {
        return;
      }
      setGradeResult(feedback);
    } catch (err) {
      if (controller.signal.aborted || activeQuestionIdRef.current !== targetQuestionId) {
        return;
      }
      if (err instanceof LlmApiError && err.code === 'ABORTED') return;
      setGradeError(err instanceof LlmApiError ? err.userMessage : 'AI 批改失败，请稍后重试。');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (!controller.signal.aborted && activeQuestionIdRef.current === targetQuestionId) {
        setGradeLoading(false);
      }
    }
  }, [draftAnswer, question, ready, scope, stopActiveRequest]);

  const sendFollowUp = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      const targetQuestion = question;
      const targetQuestionId = targetQuestion.id;
      if (!text || chatLoading) return;

      if (!ready) {
        setDrawerOpen(true);
        setChatError('尚未配置大模型 API，请先点击“API 设置”完成配置。');
        return;
      }

      stopActiveRequest();
      const controller = new AbortController();
      abortRef.current = controller;

      const historySnapshot = [...chatHistory];
      const nextHistory: ChatMessage[] = [
        ...historySnapshot,
        { role: 'user', content: text },
        { role: 'assistant', content: '' },
      ];
      setDrawerOpen(true);
      setChatHistory(nextHistory);
      if (rawText === chatInput) {
        setChatInput('');
      }
      setChatLoading(true);
      setChatError(null);

      const previousExplanation =
        explainText.trim() ||
        getCachedAiExplanation(targetQuestion, store) ||
        localSavedCacheRef.current[targetQuestionId] ||
        undefined;

      try {
        const res = await askQuestionFollowUpStream(
          targetQuestion,
          historySnapshot,
          text,
          { userRecord, chapterTitle, bankName, previousExplanation },
          (_chunk, accumulated) => {
            if (controller.signal.aborted || activeQuestionIdRef.current !== targetQuestionId) {
              return;
            }
            setChatHistory([
              ...historySnapshot,
              { role: 'user', content: text },
              { role: 'assistant', content: accumulated },
            ]);
          },
          { signal: controller.signal, practiceScope: scope },
        );
        if (controller.signal.aborted || activeQuestionIdRef.current !== targetQuestionId) {
          return;
        }
        setChatHistory([
          ...historySnapshot,
          { role: 'user', content: text },
          { role: 'assistant', content: res.content },
        ]);
      } catch (err) {
        if (controller.signal.aborted || activeQuestionIdRef.current !== targetQuestionId) {
          return;
        }
        if (err instanceof LlmApiError && err.code === 'ABORTED') return;
        setChatError(err instanceof LlmApiError ? err.userMessage : 'AI 回复失败，请稍后重试。');
        setChatHistory(historySnapshot);
        if (rawText === chatInput) {
          setChatInput(text);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (!controller.signal.aborted && activeQuestionIdRef.current === targetQuestionId) {
          setChatLoading(false);
        }
      }
    },
    [
      bankName,
      chapterTitle,
      chatHistory,
      chatInput,
      chatLoading,
      explainText,
      question,
      ready,
      scope,
      stopActiveRequest,
      store,
      userRecord,
    ],
  );

  const runFollowUp = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      await sendFollowUp(chatInput);
    },
    [chatInput, sendFollowUp],
  );

  const clearChat = useCallback(() => {
    stopActiveRequest();
    setChatHistory([]);
    setChatError(null);
  }, [stopActiveRequest]);

  const openChatDrawer = useCallback(() => {
    setDrawerOpen(true);
    window.requestAnimationFrame(() => {
      chatInputRef.current?.focus();
    });
  }, []);

  const handleApplyMastery = useCallback(
    (level: MasteryLevel) => {
      onSuggestedMastery?.(level);
      setAppliedMastery(level);
    },
    [onSuggestedMastery],
  );

  return {
    question,
    objective,
    isGraded,
    isRevealed,
    config,
    ready,
    drawerOpen,
    setDrawerOpen,
    explainText,
    explainLoading,
    explainError,
    analysisSaveFailed: failedAnalysisSave?.questionId === question.id,
    retryAnalysisSave,
    isCachedHit,
    gradeOpen,
    setGradeOpen,
    draftAnswer,
    setDraftAnswer,
    gradeLoading,
    gradeError,
    gradeResult,
    appliedMastery,
    chatHistory,
    chatInput,
    setChatInput,
    chatLoading,
    chatError,
    chatInputRef,
    stopActiveRequest,
    runExplain,
    runGrade,
    sendFollowUp,
    runFollowUp,
    clearChat,
    openChatDrawer,
    canApplyMastery: Boolean(onSuggestedMastery),
    handleApplyMastery,
  };
}

export function AiTutorInlinePanel({ tutor }: { tutor: AiQuestionTutorController }) {
  const {
    objective,
    isGraded,
    isRevealed,
    drawerOpen,
    ready,
    config,
    gradeOpen,
    setGradeOpen,
    draftAnswer,
    setDraftAnswer,
    gradeLoading,
    gradeError,
    gradeResult,
    appliedMastery,
    stopActiveRequest,
    runGrade,
    openChatDrawer,
    handleApplyMastery,
  } = tutor;

  // Objective questions: keep ai-tutor-panel hidden before grading unless drawer is explicitly opened
  if (objective && !isGraded && !drawerOpen) {
    return null;
  }

  const showFollowupButton = objective || isRevealed || drawerOpen;
  const drawerShowsInlineSettingsCta =
    drawerOpen && !ready && (Boolean(tutor.explainError) || Boolean(tutor.chatError));

  return (
    <section className="ai-tutor-root" data-testid="ai-tutor-panel" aria-label="AI 助教工具">
      <div className="ai-tutor-bar">
        <div className="ai-tutor-bar__actions">
          {!objective && (
            <button
              type="button"
              data-testid="ai-btn-grade-toggle"
              className={`ai-tutor-btn ai-tutor-btn--accent${gradeOpen ? ' is-active' : ''}`}
              onClick={() => setGradeOpen((prev) => !prev)}
            >
              <span>{isRevealed ? 'AI 批改我的作答' : 'AI 辅助作答与批改'}</span>
            </button>
          )}

          {showFollowupButton && (
            <button
              type="button"
              data-testid="ai-btn-chat"
              className={`ai-tutor-btn${drawerOpen ? ' is-active' : ''}`}
              onClick={openChatDrawer}
            >
              <span>追问助教</span>
            </button>
          )}
        </div>

        <div className="ai-tutor-meta">
          {ready ? (
            <span>当前模型：{config.model}</span>
          ) : drawerShowsInlineSettingsCta ? (
            <span>未配置 API</span>
          ) : (
            <button
              type="button"
              className="ai-tutor-link"
              data-testid="ai-open-settings-inline"
              onClick={requestOpenApiSettings}
            >
              未配置 API · 去设置
            </button>
          )}
        </div>
      </div>

      {gradeOpen && !objective && (
        <div className="ai-tutor-card" data-testid="ai-grade-card">
          <div className="ai-tutor-card__head">
            <span className="ai-tutor-card__title">主观题 AI 智能批改</span>
            {gradeLoading && (
              <button type="button" className="ai-tutor-mini-btn" onClick={stopActiveRequest}>
                取消批改
              </button>
            )}
          </div>

          <textarea
            data-testid="ai-grade-textarea"
            className="ai-tutor-textarea"
            placeholder="在这里写下你的回答要点或完整作答，AI 将对照标准参考答案与采分点逐项打分..."
            value={draftAnswer}
            onChange={(e) => setDraftAnswer(e.target.value)}
          />

          <div className="ai-tutor-bar">
            <span className="api-field__hint">
              支持先写后改：批改后可一键同步到下方“掌握程度自评”。
            </span>
            <button
              type="button"
              data-testid="ai-btn-submit-grade"
              className="btn btn--primary"
              disabled={gradeLoading || !draftAnswer.trim()}
              onClick={() => void runGrade()}
            >
              {gradeLoading ? 'AI 批改中...' : '开始 AI 批改'}
            </button>
          </div>

          {gradeError && (
            <div className="api-banner api-banner--bad">
              <div>{gradeError}</div>
              {!ready && (
                <button
                  type="button"
                  className="ai-tutor-link"
                  style={{ marginTop: 6 }}
                  onClick={requestOpenApiSettings}
                >
                  立即打开 API 设置
                </button>
              )}
            </div>
          )}

          {gradeResult && (
            <div className="ai-grade-result" data-testid="ai-grade-result">
              <div className="ai-grade-score-row">
                <span
                  className={`ai-grade-score ${
                    gradeResult.score >= 80
                      ? 'ai-grade-score--ok'
                      : gradeResult.score >= 50
                        ? 'ai-grade-score--warn'
                        : 'ai-grade-score--bad'
                  }`}
                >
                  {gradeResult.score} / 100
                </span>

                {tutor.canApplyMastery && (
                  <button
                    type="button"
                    data-testid="ai-btn-apply-mastery"
                    className="ai-tutor-btn ai-tutor-btn--accent"
                    onClick={() => handleApplyMastery(gradeResult.recommendedMastery)}
                  >
                    {appliedMastery === gradeResult.recommendedMastery
                      ? `已同步自评：${MASTERY_LABEL[gradeResult.recommendedMastery]}`
                      : `采纳推荐自评：${MASTERY_LABEL[gradeResult.recommendedMastery]}`}
                  </button>
                )}
              </div>

              <div className="ai-tutor-markdown">
                <p>
                  <strong>总体点评：</strong>
                  {gradeResult.summary}
                </p>
              </div>

              {(gradeResult.matchedPoints.length > 0 || gradeResult.missingPoints.length > 0) && (
                <div className="ai-grade-cols">
                  <div className="ai-grade-box ai-grade-box--ok">
                    <div className="ai-grade-box__label">已命中采分点</div>
                    {gradeResult.matchedPoints.length > 0 ? (
                      <ul>
                        {gradeResult.matchedPoints.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    ) : (
                      <div>暂未命中明确采分要点</div>
                    )}
                  </div>
                  <div className="ai-grade-box ai-grade-box--warn">
                    <div className="ai-grade-box__label">遗漏 / 需补充要点</div>
                    {gradeResult.missingPoints.length > 0 ? (
                      <ul>
                        {gradeResult.missingPoints.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    ) : (
                      <div>核心要点已覆盖完整！</div>
                    )}
                  </div>
                </div>
              )}

              {gradeResult.improvedAnswer && (
                <div className="ai-grade-box">
                  <div className="ai-grade-box__label">高分示范改写</div>
                  <RichContent content={gradeResult.improvedAnswer} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function AiExplainDrawer({ tutor }: { tutor: AiQuestionTutorController }) {
  const {
    drawerOpen,
    setDrawerOpen,
    ready,
    explainText,
    explainLoading,
    explainError,
    analysisSaveFailed,
    retryAnalysisSave,
    isCachedHit,
    chatHistory,
    chatInput,
    setChatInput,
    chatLoading,
    chatError,
    chatInputRef,
    stopActiveRequest,
    runExplain,
    sendFollowUp,
    runFollowUp,
    clearChat,
  } = tutor;

  if (!drawerOpen) {
    return null;
  }

  return (
    <aside
      data-testid="ai-explain-drawer"
      className="ai-explain-drawer"
      aria-label="AI 深度解析与多轮追问抽屉"
    >
      <div className="ai-explain-drawer__head">
        <div className="ai-explain-drawer__title-group">
          <Icon name="sparkles" size={16} />
          <h3 className="ai-explain-drawer__title">AI 深度解析</h3>
          {isCachedHit && !explainLoading && (
            <span className="pill pill--subtle">已命中缓存</span>
          )}
        </div>
        <div className="ai-explain-drawer__actions">
          {explainLoading ? (
            <button type="button" className="ai-tutor-mini-btn" onClick={stopActiveRequest}>
              停止生成
            </button>
          ) : (
            <button
              type="button"
              className="ai-tutor-mini-btn"
              onClick={() => void runExplain(true)}
            >
              重新生成
            </button>
          )}
          <button
            type="button"
            className="ai-tutor-mini-btn"
            aria-label="关闭 AI 解析抽屉"
            onClick={() => {
              stopActiveRequest();
              setDrawerOpen(false);
            }}
          >
            收起
          </button>
        </div>
      </div>

      <div className="ai-tutor-card ai-explain-card" data-testid="ai-explain-card">
        {analysisSaveFailed && (
          <div className="api-banner api-banner--bad" role="alert">
            <div>AI 解析保存失败，当前结果仍可查看。</div>
            <button type="button" className="ai-tutor-link" onClick={() => void retryAnalysisSave()}>
              重试保存
            </button>
          </div>
        )}
        {explainError && (
          <div className="api-banner api-banner--bad">
            <div>{explainError}</div>
            {!ready && (
              <button
                type="button"
                data-testid="ai-open-settings-inline"
                className="ai-tutor-link"
                style={{ marginTop: 6 }}
                onClick={requestOpenApiSettings}
              >
                立即打开 API 设置
              </button>
            )}
          </div>
        )}

        {explainLoading && !explainText && (
          <div className="api-field__hint">正在流式生成结构化解析，请稍候...</div>
        )}

        {explainText ? (
          <RichContent content={explainText} />
        ) : (
          !explainLoading &&
          !explainError && (
            <div className="api-field__hint">
              点击上方“重新生成”或直接在下方输入问题开始追问。
            </div>
          )
        )}
      </div>

      <div className="ai-followup-pills" role="group" aria-label="快捷追问">
        {QUICK_FOLLOWUPS.map((prompt, idx) => (
          <button
            key={prompt}
            type="button"
            data-testid={`ai-followup-pill-${idx}`}
            className="ai-followup-pill"
            disabled={chatLoading}
            onClick={() => void sendFollowUp(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="ai-tutor-card ai-chat-card" data-testid="ai-chat-card">
        <div className="ai-tutor-card__head">
          <span className="ai-tutor-card__title">追问 AI 助教</span>
          {chatHistory.length > 0 && (
            <button type="button" className="ai-tutor-mini-btn" onClick={clearChat}>
              清空对话
            </button>
          )}
        </div>

        {chatHistory.length > 0 ? (
          <div className="ai-chat-list">
            {chatHistory.map((msg, idx) => (
              <div
                key={idx}
                className={`ai-chat-msg ${msg.role === 'user' ? 'ai-chat-msg--user' : 'ai-chat-msg--assistant'}`}
              >
                {msg.role === 'user' ? (
                  msg.content
                ) : msg.content ? (
                  <RichContent content={msg.content} />
                ) : (
                  <span className="api-field__hint">正在思考中...</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="api-field__hint">
            针对这道题有哪里没懂？可直接点击上方快捷追问胶囊或输入自定义问题。
          </div>
        )}

        {chatError && (
          <div className="api-banner api-banner--bad">
            <div>{chatError}</div>
            {!ready && !explainError && (
              <button
                type="button"
                data-testid="ai-open-settings-inline"
                className="ai-tutor-link"
                style={{ marginTop: 6 }}
                onClick={requestOpenApiSettings}
              >
                立即打开 API 设置
              </button>
            )}
          </div>
        )}

        <form className="ai-chat-form" onSubmit={runFollowUp}>
          <input
            ref={chatInputRef}
            type="text"
            data-testid="ai-chat-input"
            className="api-input"
            placeholder="输入你的追问..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
          />
          {chatLoading ? (
            <button type="button" className="api-btn-inline" onClick={stopActiveRequest}>
              停止
            </button>
          ) : (
            <button
              type="submit"
              data-testid="ai-chat-send"
              className="btn btn--primary"
              disabled={!chatInput.trim()}
            >
              发送
            </button>
          )}
        </form>
      </div>
    </aside>
  );
}

export function AiQuestionTutor(props: AiQuestionTutorProps) {
  const tutor = useAiQuestionTutor(props);
  const { autoExplainOnWrong = false, onToggleAutoExplain } = props;

  return (
    <div className="ai-tutor-standalone">
      <div className="ai-workspace-controls">
        {onToggleAutoExplain ? (
          <label className="workspace-auto-toggle">
            <input
              type="checkbox"
              data-testid="ai-auto-explain-toggle"
              checked={autoExplainOnWrong}
              onChange={(e) => onToggleAutoExplain(e.target.checked)}
            />
            <span>答错自动触发 AI 解析</span>
          </label>
        ) : (
          <span />
        )}

        <button
          type="button"
          data-testid="ai-btn-explain"
          className={`ai-tutor-btn ai-tutor-btn--accent${tutor.drawerOpen ? ' is-active' : ''}`}
          onClick={() => void tutor.runExplain(false)}
        >
          <Icon name="sparkles" size={14} />
          <span>AI 深度解析</span>
        </button>
      </div>

      <AiTutorInlinePanel tutor={tutor} />
      <AiExplainDrawer tutor={tutor} />
    </div>
  );
}
