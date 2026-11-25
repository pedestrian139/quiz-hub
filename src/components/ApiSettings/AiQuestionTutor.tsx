import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { MasteryLevel, Question, UserRecord } from '../../types/quiz';
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
import './ApiSettings.css';

export interface AiQuestionTutorProps {
  question: Question;
  userRecord?: UserRecord;
  isGraded: boolean;
  isRevealed: boolean;
  chapterTitle?: string;
  onSuggestedMastery?: (level: MasteryLevel) => void;
}

type TutorTab = 'none' | 'explain' | 'grade' | 'chat';

const MASTERY_LABEL: Record<MasteryLevel, string> = {
  2: '完全会',
  1: '有点模糊',
  0: '不会',
};

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={`b-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={`c-${key++}`}>{token.slice(1, -1)}</code>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let blockKey = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${blockKey++}`}>
        {listItems.map((item, idx) => (
          <li key={idx}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      continue;
    }
    flushList();
    const headingMatch = line.match(/^#{1,4}\s+(.*)$/);
    if (headingMatch) {
      blocks.push(
        <p key={`h-${blockKey++}`}>
          <strong>{renderInlineMarkdown(headingMatch[1])}</strong>
        </p>,
      );
      continue;
    }
    blocks.push(<p key={`p-${blockKey++}`}>{renderInlineMarkdown(line)}</p>);
  }
  flushList();

  return <div className="ai-tutor-markdown">{blocks}</div>;
}

export function AiQuestionTutor({
  question,
  userRecord,
  isGraded,
  isRevealed,
  chapterTitle,
  onSuggestedMastery,
}: AiQuestionTutorProps) {
  const scope = usePracticeScope();
  const [config, setConfig] = useState<ApiConfig>(() => loadApiConfig(scope));
  const [activeTab, setActiveTab] = useState<TutorTab>('none');

  // Deep explanation state
  const [explainText, setExplainText] = useState('');
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  // Subjective AI grader state
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

  useEffect(() => {
    setConfig(loadApiConfig(scope));
    return subscribeApiConfig(setConfig, scope);
  }, [scope]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const objective = isObjectiveQuestion(question.type);
  const ready = isApiConfigReady(config);

  // Objective questions: never show AI tutor before grading (zero spoilers)
  if (objective && !isGraded) {
    return null;
  }

  const stopActiveRequest = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setExplainLoading(false);
    setGradeLoading(false);
    setChatLoading(false);
  };

  const runExplain = async (force = false) => {
    setActiveTab('explain');
    if (!force && explainText.trim() && !explainError) return;
    if (!ready) {
      setExplainError('尚未配置大模型 API，点击下方按钮完成配置后即可使用 AI 深度解析。');
      return;
    }

    stopActiveRequest();
    const controller = new AbortController();
    abortRef.current = controller;

    setExplainLoading(true);
    setExplainError(null);
    setExplainText('');
    try {
      await explainQuestionStream(
        question,
        { userRecord, chapterTitle },
        (_chunk, accumulated) => setExplainText(accumulated),
        { signal: controller.signal, practiceScope: scope },
      );
    } catch (err) {
      if (err instanceof LlmApiError && err.code === 'ABORTED') return;
      setExplainError(err instanceof LlmApiError ? err.userMessage : 'AI 解析生成失败，请稍后重试。');
    } finally {
      setExplainLoading(false);
    }
  };

  const runGrade = async () => {
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
      const { feedback } = await gradeSubjectiveDraft(question, draftAnswer, {
        signal: controller.signal,
        practiceScope: scope,
      });
      setGradeResult(feedback);
    } catch (err) {
      if (err instanceof LlmApiError && err.code === 'ABORTED') return;
      setGradeError(err instanceof LlmApiError ? err.userMessage : 'AI 批改失败，请稍后重试。');
    } finally {
      setGradeLoading(false);
    }
  };

  const runFollowUp = async (e: FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    if (!ready) {
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
    setChatHistory(nextHistory);
    setChatInput('');
    setChatLoading(true);
    setChatError(null);

    try {
      const res = await askQuestionFollowUpStream(
        question,
        historySnapshot,
        text,
        { userRecord, chapterTitle },
        (_chunk, accumulated) => {
          setChatHistory([
            ...historySnapshot,
            { role: 'user', content: text },
            { role: 'assistant', content: accumulated },
          ]);
        },
        { signal: controller.signal, practiceScope: scope },
      );
      setChatHistory([
        ...historySnapshot,
        { role: 'user', content: text },
        { role: 'assistant', content: res.content },
      ]);
    } catch (err) {
      if (err instanceof LlmApiError && err.code === 'ABORTED') return;
      setChatError(err instanceof LlmApiError ? err.userMessage : 'AI 回复失败，请稍后重试。');
      setChatHistory(historySnapshot);
      setChatInput(text);
    } finally {
      setChatLoading(false);
    }
  };

  const handleApplyMastery = (level: MasteryLevel) => {
    onSuggestedMastery?.(level);
    setAppliedMastery(level);
  };

  const showFullToolbar = objective || isRevealed;

  return (
    <section className="ai-tutor-root" data-testid="ai-tutor-panel" aria-label="AI 助教工具">
      <div className="ai-tutor-bar">
        <div className="ai-tutor-bar__actions">
          {!objective && (
            <button
              type="button"
              data-testid="ai-btn-grade-toggle"
              className={`ai-tutor-btn ai-tutor-btn--accent${activeTab === 'grade' ? ' is-active' : ''}`}
              onClick={() => setActiveTab((prev) => (prev === 'grade' ? 'none' : 'grade'))}
            >
              <span>{isRevealed ? 'AI 批改我的作答' : 'AI 辅助作答与批改'}</span>
            </button>
          )}

          {showFullToolbar && (
            <>
              <button
                type="button"
                data-testid="ai-btn-explain"
                className={`ai-tutor-btn${activeTab === 'explain' ? ' is-active' : ''}`}
                onClick={() => {
                  if (activeTab === 'explain') {
                    setActiveTab('none');
                  } else {
                    void runExplain(false);
                  }
                }}
              >
                <span>AI 深度解析</span>
              </button>

              <button
                type="button"
                data-testid="ai-btn-chat"
                className={`ai-tutor-btn${activeTab === 'chat' ? ' is-active' : ''}`}
                onClick={() => setActiveTab((prev) => (prev === 'chat' ? 'none' : 'chat'))}
              >
                <span>追问助教</span>
              </button>
            </>
          )}
        </div>

        <div className="ai-tutor-meta">
          {ready ? (
            <span>当前模型：{config.model}</span>
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

      {activeTab === 'explain' && (
        <div className="ai-tutor-card" data-testid="ai-explain-card">
          <div className="ai-tutor-card__head">
            <span className="ai-tutor-card__title">AI 深度解析</span>
            <div className="ai-tutor-card__tools">
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
            </div>
          </div>

          {explainError && (
            <div className="api-banner api-banner--bad">
              <div>{explainError}</div>
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

          {explainLoading && !explainText && (
            <div className="api-field__hint">正在流式生成解析，请稍候...</div>
          )}

          {explainText && <SimpleMarkdown text={explainText} />}
        </div>
      )}

      {activeTab === 'grade' && !objective && (
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

                {onSuggestedMastery && (
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
                  <SimpleMarkdown text={gradeResult.improvedAnswer} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'chat' && showFullToolbar && (
        <div className="ai-tutor-card" data-testid="ai-chat-card">
          <div className="ai-tutor-card__head">
            <span className="ai-tutor-card__title">追问 AI 助教</span>
            {chatHistory.length > 0 && (
              <button
                type="button"
                className="ai-tutor-mini-btn"
                onClick={() => {
                  stopActiveRequest();
                  setChatHistory([]);
                  setChatError(null);
                }}
              >
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
                    <SimpleMarkdown text={msg.content} />
                  ) : (
                    <span className="api-field__hint">正在思考中...</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="api-field__hint">
              针对这道题有哪里没懂？例如：“为什么 B 选项不对？”“能举个生活中的例子解释吗？”
            </div>
          )}

          {chatError && (
            <div className="api-banner api-banner--bad">
              <div>{chatError}</div>
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

          <form className="ai-chat-form" onSubmit={runFollowUp}>
            <input
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
      )}
    </section>
  );
}
