import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MasteryLevel, Question, UserRecord, UserStore } from '../types/quiz';
import {
  formatAnswerText,
  formatElapsed,
  getOptionLabel,
  getOriginLabel,
  isObjectiveQuestion,
} from '../core/questionUtils';
import { computeSessionResult } from '../core/quizEngine';
import { CHAPTER_BY_ID, TYPE_NAME } from '../data/catalog';
import { Icon, type IconName } from '../components/Icons';
import { AiQuestionTutor } from '../components/ApiSettings';
import type { QuizActions, ResultSpec, SessionSpec } from './quizTypes';

interface QuizSessionProps {
  spec: SessionSpec;
  store: UserStore;
  actions: QuizActions;
  onExit: () => void;
  onFinish: (resultSpec: ResultSpec) => void;
}

const MASTERY_OPTIONS: {
  level: MasteryLevel;
  label: string;
  hint: string;
  icon: IconName;
  tone: string;
}[] = [
  { level: 2, label: '完全会', hint: '计入已掌握', icon: 'circleCheck', tone: 'ok' },
  { level: 1, label: '有点模糊', hint: '归入错题本', icon: 'circleHelp', tone: 'warn' },
  { level: 0, label: '不会', hint: '重点攻克', icon: 'circleX', tone: 'bad' },
];

function formatUserChoiceText(q: Question, choice: number | number[] | boolean | undefined): string {
  if (choice === undefined) return '未作答';
  if (q.type === 'choice' && typeof choice === 'number') {
    return getOptionLabel(choice);
  }
  if (q.type === 'multi' && Array.isArray(choice)) {
    return choice.map((i) => getOptionLabel(i)).join('、');
  }
  if (q.type === 'tf' && typeof choice === 'boolean') {
    return choice ? '正确' : '错误';
  }
  return String(choice);
}

export function QuizSession({ spec, store, actions, onExit, onFinish }: QuizSessionProps) {
  const { queue, config } = spec;
  const total = queue.length;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionAnswers, setSessionAnswers] = useState<Record<string, UserRecord>>({});
  const [sessionMastery, setSessionMastery] = useState<Record<string, MasteryLevel>>({});
  const [multiDrafts, setMultiDrafts] = useState<Record<string, number[]>>({});
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  const startedAtRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAtRef.current));
    }, 250);
    return () => window.clearInterval(id);
  }, [spec.id]);

  const safeIndex = Math.min(Math.max(0, currentIndex), Math.max(0, total - 1));
  const q: Question | undefined = queue[safeIndex];

  const currentRecord: UserRecord | undefined =
    q && Object.prototype.hasOwnProperty.call(sessionAnswers, q.id)
      ? sessionAnswers[q.id]
      : undefined;
  const isGraded = currentRecord !== undefined;
  const isRevealed = q ? Boolean(revealedIds[q.id]) : false;
  const currentMastery: MasteryLevel | undefined =
    q && Object.prototype.hasOwnProperty.call(sessionMastery, q.id)
      ? sessionMastery[q.id]
      : undefined;
  const isFav = q ? store.fav[q.id] === true : false;
  const isLast = safeIndex >= total - 1;

  const answeredCount = useMemo(() => Object.keys(sessionAnswers).length, [sessionAnswers]);

  const finishSession = useCallback(
    (latestAnswers: Record<string, UserRecord>, latestMastery: Record<string, MasteryLevel>) => {
      const finalElapsed = Math.max(0, Date.now() - startedAtRef.current);
      const result = computeSessionResult(queue, latestAnswers, finalElapsed);
      onFinish({
        id: spec.id,
        config,
        queue,
        answers: latestAnswers,
        mastery: latestMastery,
        result,
      });
    },
    [config, onFinish, queue, spec.id],
  );

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : 0));
  }, []);

  const handleNext = useCallback(() => {
    if (safeIndex < total - 1) {
      setCurrentIndex(safeIndex + 1);
    } else {
      finishSession(sessionAnswers, sessionMastery);
    }
  }, [finishSession, safeIndex, sessionAnswers, sessionMastery, total]);

  const handleChoicePick = useCallback(
    (optionIdx: number) => {
      if (!q || q.type !== 'choice' || isGraded) return;
      const optCount = q.options?.length ?? 0;
      if (optionIdx < 0 || optionIdx >= optCount) return;
      const { record } = actions.answerObjective(q, optionIdx);
      setSessionAnswers((prev) => ({ ...prev, [q.id]: record }));
    },
    [actions, isGraded, q],
  );

  const handleMultiToggle = useCallback(
    (optionIdx: number) => {
      if (!q || q.type !== 'multi' || isGraded) return;
      const optCount = q.options?.length ?? 0;
      if (optionIdx < 0 || optionIdx >= optCount) return;
      setMultiDrafts((prev) => {
        const cur = prev[q.id] ?? [];
        const exists = cur.includes(optionIdx);
        const next = exists
          ? cur.filter((x) => x !== optionIdx)
          : [...cur, optionIdx].sort((a, b) => a - b);
        return { ...prev, [q.id]: next };
      });
    },
    [isGraded, q],
  );

  const handleSubmitMulti = useCallback(() => {
    if (!q || q.type !== 'multi' || isGraded) return;
    const picked = multiDrafts[q.id] ?? [];
    if (picked.length === 0) return;
    const { record } = actions.answerObjective(q, picked);
    setSessionAnswers((prev) => ({ ...prev, [q.id]: record }));
  }, [actions, isGraded, multiDrafts, q]);

  const handleTfPick = useCallback(
    (val: boolean) => {
      if (!q || q.type !== 'tf' || isGraded) return;
      const { record } = actions.answerObjective(q, val);
      setSessionAnswers((prev) => ({ ...prev, [q.id]: record }));
    },
    [actions, isGraded, q],
  );

  const handleReveal = useCallback(() => {
    if (!q) return;
    setRevealedIds((prev) => (prev[q.id] ? prev : { ...prev, [q.id]: true }));
  }, [q]);

  const handleSelfCheck = useCallback(
    (level: MasteryLevel) => {
      if (!q) return;
      const record = actions.rateSubjective(q.id, level);
      setRevealedIds((prev) => (prev[q.id] ? prev : { ...prev, [q.id]: true }));
      setSessionMastery((prev) => ({ ...prev, [q.id]: level }));
      setSessionAnswers((prev) => ({ ...prev, [q.id]: record }));
    },
    [actions, q],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!q) return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;

      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }

      const onInteractive = Boolean(
        target &&
          target.closest(
            'button, a[href], summary, [role="button"], [role="link"], [role="tab"]',
          ),
      );
      if ((e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && onInteractive) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
        return;
      }

      if ((q.type === 'choice' || q.type === 'multi') && !isGraded) {
        let optIdx = -1;
        if (e.key >= '1' && e.key <= '9') {
          optIdx = Number(e.key) - 1;
        } else if (/^[a-iA-I]$/.test(e.key)) {
          optIdx = e.key.toLowerCase().charCodeAt(0) - 97;
        }
        const optCount = q.options?.length ?? 0;
        if (optIdx >= 0 && optIdx < optCount) {
          e.preventDefault();
          if (q.type === 'choice') {
            handleChoicePick(optIdx);
          } else {
            handleMultiToggle(optIdx);
          }
        }
        return;
      }

      if (q.type === 'tf' && !isGraded) {
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          handleTfPick(true);
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          handleTfPick(false);
        }
        return;
      }

      if (
        (q.type === 'short' || q.type === 'analysis') &&
        (e.key === ' ' || e.code === 'Space')
      ) {
        e.preventDefault();
        handleReveal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleChoicePick,
    handleMultiToggle,
    handleNext,
    handlePrev,
    handleReveal,
    handleTfPick,
    isGraded,
    q,
  ]);

  if (!q) {
    return (
      <div className="page-wrap page-wrap--quiz">
        <div className="empty-card">
          <p>当前题组为空，请返回重新选择筛选条件。</p>
          <button type="button" data-testid="quiz-exit" className="btn btn--primary" onClick={onExit}>
            返回刷题首页
          </button>
        </div>
      </div>
    );
  }

  const chMeta = CHAPTER_BY_ID.get(q.chapter);
  const chapterTagText = chMeta ? `第 ${q.chapter} 章 · ${chMeta.short}` : `第 ${q.chapter} 章`;
  const sourceTagText = `${getOriginLabel(q.source.origin)}${q.source.ref ? ` · ${q.source.ref}` : ''}`;
  const progressPct = total > 0 ? Math.round(((safeIndex + 1) / total) * 100) : 100;

  const selectedMulti =
    q.type === 'multi'
      ? isGraded && Array.isArray(currentRecord?.choice)
        ? currentRecord.choice
        : (multiDrafts[q.id] ?? [])
      : [];
  const selectedMultiSet = new Set(selectedMulti);
  const correctMultiSet =
    q.type === 'multi' && Array.isArray(q.answer) ? new Set<number>(q.answer) : new Set<number>();

  return (
    <div className="page-wrap page-wrap--session">
      <div className="session-topbar">
        <div className="session-topbar__row">
          <button
            type="button"
            data-testid="quiz-exit"
            className="btn btn--ghost btn--sm"
            onClick={onExit}
          >
            <Icon name="arrowLeft" size={15} />
            退出刷题
          </button>

          <div className="session-topbar__center">
            <span data-testid="quiz-mode-title" className="session-mode-title">
              {config.title}
            </span>
            <span data-testid="quiz-progress-text" className="session-progress-text">
              {safeIndex + 1} / {total}
            </span>
          </div>

          <div className="session-topbar__right">
            <span className="session-timer" aria-label="已用时">
              <Icon name="clock" size={14} />
              <span data-testid="quiz-timer">{formatElapsed(elapsedMs)}</span>
            </span>
            <button
              type="button"
              data-testid="btn-toggle-sheet"
              className={`btn btn--ghost btn--sm${sheetOpen ? ' is-active' : ''}`}
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen((prev) => !prev)}
            >
              <Icon name="grid" size={14} />
              答题卡 ({answeredCount}/{total})
            </button>
          </div>
        </div>

        <div
          data-testid="quiz-progress-bar"
          role="progressbar"
          aria-label="当前答题进度"
          aria-valuemin={1}
          aria-valuenow={safeIndex + 1}
          aria-valuemax={total}
          className="session-progress-track"
        >
          <div className="session-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <article className="question-card">
        <div className="question-card__head">
          <div className="question-card__tags">
            <span className="pill pill--index">第 {safeIndex + 1} 题</span>
            <span data-testid="q-chapter-tag" className="pill pill--neutral">
              {chapterTagText}
            </span>
            <span data-testid="q-type-tag" className={`pill pill--type pill--type-${q.type}`}>
              {TYPE_NAME[q.type]}
            </span>
            <span data-testid="q-source-tag" className="pill pill--subtle">
              {sourceTagText}
            </span>
          </div>

          <button
            type="button"
            data-testid="btn-star"
            className={`btn-star${isFav ? ' is-starred' : ''}`}
            aria-pressed={isFav ? 'true' : 'false'}
            onClick={() => actions.toggleFav(q.id)}
          >
            <Icon name={isFav ? 'starFill' : 'star'} size={15} />
            <span>{isFav ? '已收藏' : '收藏'}</span>
          </button>
        </div>

        <div data-testid="q-stem" className="question-stem">
          {q.stem}
        </div>

        {q.type === 'choice' && (
          <div className="option-list" role="group" aria-label="单选题选项">
            {(q.options ?? []).map((optText, idx) => {
              const isCorrectOption = isGraded && q.answer === idx;
              const isUserWrong = isGraded && currentRecord?.choice === idx && q.answer !== idx;
              const isUserPicked = currentRecord?.choice === idx;
              const stateCls = isCorrectOption
                ? ' is-correct'
                : isUserWrong
                  ? ' is-wrong'
                  : isUserPicked
                    ? ' is-selected'
                    : '';
              return (
                <button
                  key={idx}
                  type="button"
                  data-testid={`quiz-option-${idx}`}
                  disabled={isGraded}
                  className={`option-btn${stateCls}`}
                  onClick={() => handleChoicePick(idx)}
                >
                  <span className="option-btn__badge" aria-hidden="true">
                    {getOptionLabel(idx)}
                  </span>
                  <span className="option-btn__text">{optText}</span>
                  {isGraded && (isCorrectOption || isUserWrong) && (
                    <span className="option-btn__mark" aria-hidden="true">
                      <Icon name={isCorrectOption ? 'check' : 'x'} size={16} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {q.type === 'multi' && (
          <div className="multi-block">
            <div className="option-list" role="group" aria-label="多选题选项">
              {(q.options ?? []).map((optText, idx) => {
                const picked = selectedMultiSet.has(idx);
                const shouldPick = correctMultiSet.has(idx);
                let stateCls = '';
                let markText = '';
                if (!isGraded) {
                  if (picked) stateCls = ' is-selected';
                } else if (shouldPick && picked) {
                  stateCls = ' is-correct';
                  markText = '✓';
                } else if (shouldPick && !picked) {
                  stateCls = ' is-missed';
                  markText = '漏选';
                } else if (!shouldPick && picked) {
                  stateCls = ' is-wrong';
                  markText = '✕';
                }
                return (
                  <button
                    key={idx}
                    type="button"
                    data-testid={`quiz-option-${idx}`}
                    aria-pressed={picked ? 'true' : 'false'}
                    disabled={isGraded}
                    className={`option-btn option-btn--multi${stateCls}`}
                    onClick={() => handleMultiToggle(idx)}
                  >
                    <span className="option-btn__badge" aria-hidden="true">
                      {getOptionLabel(idx)}
                    </span>
                    <span className="option-btn__text">{optText}</span>
                    {!isGraded ? (
                      <span
                        className={`option-btn__check${picked ? ' is-checked' : ''}`}
                        aria-hidden="true"
                      >
                        {picked && <Icon name="check" size={13} strokeWidth={2.6} />}
                      </span>
                    ) : (
                      markText && (
                        <span className="option-btn__mark" aria-hidden="true">
                          {markText}
                        </span>
                      )
                    )}
                  </button>
                );
              })}
            </div>

            <div className="multi-submit-row">
              <button
                type="button"
                data-testid="btn-submit-multi"
                className="btn btn--primary"
                disabled={isGraded || selectedMulti.length === 0}
                onClick={handleSubmitMulti}
              >
                <Icon name="checkSquare" size={16} />
                确认提交
                {!isGraded && selectedMulti.length > 0 ? `（已选 ${selectedMulti.length} 项）` : ''}
              </button>
              {!isGraded && (
                <span className="multi-hint">可多选，选齐全部正确项后点击“确认提交”判分</span>
              )}
            </div>
          </div>
        )}

        {q.type === 'tf' && (
          <div className="tf-grid" role="group" aria-label="判断题选项">
            {([true, false] as const).map((val) => {
              const isCorrectVal = isGraded && q.answer === val;
              const isWrongVal = isGraded && currentRecord?.choice === val && q.answer !== val;
              const stateCls = isCorrectVal ? ' is-correct' : isWrongVal ? ' is-wrong' : '';
              return (
                <button
                  key={String(val)}
                  type="button"
                  data-testid={val ? 'tf-btn-true' : 'tf-btn-false'}
                  disabled={isGraded}
                  className={`tf-btn${stateCls}`}
                  onClick={() => handleTfPick(val)}
                >
                  <span className="tf-btn__icon" aria-hidden="true">
                    <Icon name={val ? 'check' : 'x'} size={18} strokeWidth={2.4} />
                  </span>
                  <span>{val ? '正确' : '错误'}</span>
                  <kbd className="tf-btn__kbd" aria-hidden="true">
                    {val ? 'T' : 'F'}
                  </kbd>
                </button>
              );
            })}
          </div>
        )}

        {isObjectiveQuestion(q.type) && isGraded && currentRecord && (
          <div
            data-testid="quiz-feedback"
            className={`quiz-feedback ${currentRecord.ok === 1 ? 'is-correct' : 'is-wrong'}`}
          >
            <div className="quiz-feedback__head">
              <strong className="quiz-feedback__status">
                <Icon
                  name={currentRecord.ok === 1 ? 'circleCheck' : 'circleX'}
                  size={17}
                  strokeWidth={2.1}
                />
                {currentRecord.ok === 1 ? '回答正确' : '回答错误'}
              </strong>
              <span className="quiz-feedback__ans">
                你的作答：{formatUserChoiceText(q, currentRecord.choice)} · 正确答案：
                <strong>{formatAnswerText(q)}</strong>
              </span>
            </div>
            <div className="quiz-feedback__explain">
              <strong>解析：</strong>
              {q.explain || '请对照课程讲义巩固该知识点。'}
            </div>
            {q.source.note && <div className="quiz-feedback__note">补充说明：{q.source.note}</div>}
          </div>
        )}

        {!isObjectiveQuestion(q.type) && (
          <div className="subjective-block">
            {!isRevealed ? (
              <div className="reveal-box">
                <p className="reveal-box__tip">
                  建议先在脑海或草稿中梳理核心采分关键词，再展开标准参考答案对照自评。
                </p>
                <button
                  type="button"
                  data-testid="btn-reveal-answer"
                  className="btn btn--primary"
                  onClick={handleReveal}
                >
                  <Icon name="sparkles" size={16} />
                  显示参考答案
                </button>
              </div>
            ) : (
              <>
                <div data-testid="q-ref-answer" className="ref-answer-card">
                  <div className="ref-answer-card__section">
                    <div className="ref-answer-card__label">标准参考答案</div>
                    <div className="ref-answer-card__text">{formatAnswerText(q)}</div>
                  </div>

                  {Array.isArray(q.keyPoints) && q.keyPoints.length > 0 && (
                    <div className="ref-answer-card__section">
                      <div className="ref-answer-card__label">核心采分要点</div>
                      <ul className="ref-answer-card__kp">
                        {q.keyPoints.map((kp, i) => (
                          <li key={i}>{kp}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {q.explain && (
                    <div className="ref-answer-card__explain">
                      <strong>解析与考点溯源：</strong>
                      {q.explain}
                    </div>
                  )}
                </div>

                <div className="selfcheck-panel" role="group" aria-label="主观题掌握程度自评">
                  <div className="selfcheck-panel__title">
                    请自评掌握程度（选“有点模糊”或“不会”将自动加入错题本）：
                  </div>
                  <div className="selfcheck-grid">
                    {MASTERY_OPTIONS.map((item) => {
                      const active = currentMastery === item.level;
                      return (
                        <button
                          key={item.level}
                          type="button"
                          data-testid={`selfcheck-${item.level}`}
                          aria-pressed={active ? 'true' : 'false'}
                          className={`selfcheck-btn selfcheck-btn--${item.tone}${active ? ' is-active' : ''}`}
                          onClick={() => handleSelfCheck(item.level)}
                        >
                          <span className="selfcheck-btn__main">
                            <Icon name={item.icon} size={17} />
                            <span>{item.label}</span>
                          </span>
                          <span className="selfcheck-btn__hint" aria-hidden="true">
                            {item.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        <AiQuestionTutor key={q.id} question={q} userRecord={currentRecord} isGraded={isGraded} isRevealed={isRevealed} chapterTitle={chMeta?.short} onSuggestedMastery={!isObjectiveQuestion(q.type) ? handleSelfCheck : undefined} />
      </article>

      <div className="session-nav-bar">
        <button
          type="button"
          data-testid="btn-prev"
          className="btn btn--ghost"
          disabled={safeIndex === 0}
          onClick={handlePrev}
        >
          <Icon name="arrowLeft" size={16} />
          上一题
        </button>

        <span className="shortcut-hint">
          快捷键：<kbd>←</kbd> / <kbd>→</kbd> 切题 · <kbd>1–4</kbd> / <kbd>A–D</kbd> 选项 · <kbd>T</kbd>/<kbd>F</kbd> 判断 · <kbd>Space</kbd> 看答案
        </span>

        <button
          type="button"
          data-testid="btn-next"
          className="btn btn--primary"
          onClick={handleNext}
        >
          {isLast ? '看结果' : '下一题'}
          <Icon name="arrowRight" size={16} />
        </button>
      </div>

      {sheetOpen && (
        <section
          data-testid="answer-sheet"
          role="region"
          aria-label="答题卡"
          className="answer-sheet-card"
        >
          <div className="answer-sheet-card__head">
            <h3 className="answer-sheet-card__title">答题卡速跳</h3>
            <div className="answer-sheet-legend">
              <span className="legend-item legend-item--ok">已掌握/正确</span>
              <span className="legend-item legend-item--bad">需巩固/答错</span>
              <span className="legend-item legend-item--none">未作答</span>
            </div>
          </div>

          <div className="answer-sheet-grid">
            {queue.map((item, idx) => {
              const rec = Object.prototype.hasOwnProperty.call(sessionAnswers, item.id)
                ? sessionAnswers[item.id]
                : undefined;
              const status: 'correct' | 'wrong' | 'unanswered' = !rec
                ? 'unanswered'
                : rec.ok === 1
                  ? 'correct'
                  : 'wrong';
              const isCurrent = idx === safeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`sheet-item-${idx}`}
                  data-status={status}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`sheet-btn sheet-btn--${status}${isCurrent ? ' is-current' : ''}`}
                  onClick={() => setCurrentIndex(idx)}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
