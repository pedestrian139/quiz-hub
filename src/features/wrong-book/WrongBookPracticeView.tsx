import { useEffect, useId, useRef, useState } from 'react';
import {
  formatAnswerText,
  getOptionLabel,
  getTypeLabel,
  isObjectiveQuestion,
} from '../../core/questionUtils';
import { gradeObjectiveQuestion } from '../../core/quizEngine';
import type { MasteryLevel, Question } from '../../types/quiz';
import { Icon } from '../../components/ui/Icons';
import type { WrongBookItem } from './types';
import { formatChoiceSnapshotLabel } from './wrongBookMeta';

function isFocusDropped(el: Element | null): boolean {
  if (el === null || el === document.body || el === document.documentElement) {
    return true;
  }
  return el instanceof HTMLElement && el.getAttribute('role') === 'dialog' && el.tabIndex === -1;
}

function getWrongStatusTone(
  wrongCount: number,
  mastery?: MasteryLevel,
): 'attention' | 'warn' | 'neutral' {
  if (wrongCount >= 2 || mastery === 0) return 'attention';
  if (mastery === 1) return 'warn';
  return 'neutral';
}

interface WrongBookPracticeViewProps {
  items: readonly WrongBookItem[];
  onRetryWrong: (
    bankId: string,
    question: Question,
    choiceOrLevel: number | number[] | boolean | MasteryLevel,
  ) => void;
  onMarkMastered: (bankId: string, question: Question) => void;
  onExit: () => void;
}

interface PracticeAttemptFeedback {
  isCorrect: boolean;
  submittedLabel: string;
}

export function WrongBookPracticeView({
  items,
  onRetryWrong,
  onMarkMastered,
  onExit,
}: WrongBookPracticeViewProps) {
  const notesId = useId();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [multiDraft, setMultiDraft] = useState<number[]>([]);
  const [subjectiveDraft, setSubjectiveDraft] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState<PracticeAttemptFeedback | null>(null);
  const [subjectiveRatedWrong, setSubjectiveRatedWrong] = useState(false);

  const safeIndex = items.length > 0 ? Math.min(currentIndex, items.length - 1) : 0;
  const currentItem = items[safeIndex];
  const currentKey = currentItem?.key ?? '';

  const doneBackBtnRef = useRef<HTMLButtonElement>(null);
  const topBackBtnRef = useRef<HTMLButtonElement>(null);
  const prevBtnRef = useRef<HTMLButtonElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const wrongBtnRef = useRef<HTMLButtonElement>(null);
  const masteredBtnRef = useRef<HTMLButtonElement>(null);
  const pendingRevealFocusRef = useRef(false);
  const pendingNavFocusRef = useRef<'prev' | 'next' | null>(null);
  const prevKeyRef = useRef<string>(currentKey);

  useEffect(() => {
    if (currentIndex !== safeIndex) {
      setCurrentIndex(safeIndex);
    }
  }, [currentIndex, safeIndex]);

  // Reset per-question transient input state when switching question
  useEffect(() => {
    setMultiDraft([]);
    setSubjectiveDraft('');
    setRevealed(false);
    setFeedback(null);
    setSubjectiveRatedWrong(false);
    pendingRevealFocusRef.current = false;
  }, [currentKey]);

  // Recover focus when wb-practice-reveal-btn unmounts on reveal
  useEffect(() => {
    if (!pendingRevealFocusRef.current || !revealed) return;
    pendingRevealFocusRef.current = false;
    if (!isFocusDropped(document.activeElement)) return;
    (wrongBtnRef.current ?? masteredBtnRef.current)?.focus({ preventScroll: true });
  }, [currentKey, revealed]);

  // Recover focus when prev/next boundary button disables itself on click
  useEffect(() => {
    const pendingNav = pendingNavFocusRef.current;
    if (!pendingNav) return;
    pendingNavFocusRef.current = null;
    if (pendingNav === 'prev' && prevBtnRef.current?.disabled) {
      if (
        document.activeElement === prevBtnRef.current ||
        isFocusDropped(document.activeElement)
      ) {
        const target =
          nextBtnRef.current && !nextBtnRef.current.disabled
            ? nextBtnRef.current
            : topBackBtnRef.current;
        target?.focus({ preventScroll: true });
      }
    } else if (pendingNav === 'next' && nextBtnRef.current?.disabled) {
      if (
        document.activeElement === nextBtnRef.current ||
        isFocusDropped(document.activeElement)
      ) {
        const target =
          prevBtnRef.current && !prevBtnRef.current.disabled
            ? prevBtnRef.current
            : topBackBtnRef.current;
        target?.focus({ preventScroll: true });
      }
    }
  }, [items.length, safeIndex]);

  // Recover focus when mastering final item switches into wb-practice-done or queue shrinks externally
  useEffect(() => {
    if (prevKeyRef.current === currentKey) return;
    prevKeyRef.current = currentKey;
    if (!isFocusDropped(document.activeElement)) return;
    const target = currentItem ? topBackBtnRef.current : doneBackBtnRef.current;
    target?.focus({ preventScroll: true });
  }, [currentItem, currentKey]);

  if (!currentItem) {
    return (
      <div className="wb-practice-empty" data-testid="wb-practice-done">
        <div className="wb-practice-empty__icon" aria-hidden="true">
          <Icon name="check" size={22} strokeWidth={2.4} />
        </div>
        <h3>当前筛选错题已全部掌握</h3>
        <p>已全部移出当前错题队列，可以返回错题本列表继续查看其他题库。</p>
        <button
          ref={doneBackBtnRef}
          type="button"
          className="wb-btn wb-btn--primary"
          data-testid="wb-back-to-list-btn"
          onClick={onExit}
        >
          返回错题列表
        </button>
      </div>
    );
  }

  const q = currentItem.question;
  const isObjective = isObjectiveQuestion(q.type);

  const handleObjectiveSubmit = (choice: number | number[] | boolean) => {
    const { isCorrect } = gradeObjectiveQuestion(q, choice);
    const label = formatChoiceSnapshotLabel(q, choice);
    setFeedback({ isCorrect, submittedLabel: label });
    setRevealed(true);
    if (!isCorrect) {
      onRetryWrong(currentItem.bankId, q, choice);
    }
  };

  const toggleMultiOption = (idx: number) => {
    setMultiDraft((prev) =>
      prev.includes(idx) ? prev.filter((item) => item !== idx) : [...prev, idx].sort((a, b) => a - b),
    );
  };

  const handleSubjectiveWrong = (level: MasteryLevel) => {
    setSubjectiveRatedWrong(true);
    setRevealed(true);
    onRetryWrong(currentItem.bankId, q, level);
  };

  const handleMarkMasteredClick = () => {
    onMarkMastered(currentItem.bankId, q);
  };

  return (
    <div className="wb-practice" data-testid="wb-practice-view">
      <div className="wb-practice__topbar">
        <button
          ref={topBackBtnRef}
          type="button"
          className="wb-btn wb-btn--ghost"
          data-testid="wb-back-to-list-btn"
          onClick={onExit}
        >
          <Icon name="arrowLeft" size={15} />
          <span>返回错题列表</span>
        </button>
        <div className="wb-practice__progress" data-testid="wb-practice-progress">
          第 {safeIndex + 1} / {items.length} 题
        </div>
        <div className="wb-practice__nav">
          <button
            ref={prevBtnRef}
            type="button"
            className="wb-btn wb-btn--ghost"
            data-testid="wb-practice-prev-btn"
            disabled={safeIndex <= 0}
            onClick={(e) => {
              if (
                document.activeElement === e.currentTarget ||
                isFocusDropped(document.activeElement)
              ) {
                pendingNavFocusRef.current = 'prev';
              }
              setCurrentIndex(Math.max(0, safeIndex - 1));
            }}
          >
            上一题
          </button>
          <button
            ref={nextBtnRef}
            type="button"
            className="wb-btn wb-btn--ghost"
            data-testid="wb-practice-next-btn"
            disabled={safeIndex >= items.length - 1}
            onClick={(e) => {
              if (
                document.activeElement === e.currentTarget ||
                isFocusDropped(document.activeElement)
              ) {
                pendingNavFocusRef.current = 'next';
              }
              setCurrentIndex(Math.min(items.length - 1, safeIndex + 1));
            }}
          >
            下一题
          </button>
        </div>
      </div>

      <article className="wb-practice-card">
        <div className="wb-item__top wb-practice-card__meta-row">
          <div className="wb-item__meta">
            <span className="wb-tag wb-tag--type">{getTypeLabel(q.type)}</span>
            <span
              className="wb-item__source"
              title={`${currentItem.bankName}${currentItem.chapterLabel ? ` · ${currentItem.chapterLabel}` : ''}`}
            >
              <span>{currentItem.bankName}</span>
              {currentItem.chapterLabel && (
                <span className="wb-item__chapter"> · {currentItem.chapterLabel}</span>
              )}
            </span>
          </div>
          <div className="wb-item__stats">
            <span
              className={`wb-status-pill wb-status-pill--${getWrongStatusTone(currentItem.wrongCount, currentItem.mastery)}`}
              data-testid="wb-practice-wrong-count"
            >
              累计错误 {currentItem.wrongCount} 次
            </span>
          </div>
        </div>

        <h3 className="wb-practice-card__stem" data-testid="wb-practice-stem">
          {q.stem}
        </h3>

        {q.type === 'choice' && Array.isArray(q.options) && (
          <div className="wb-options" role="group" aria-label="单选题选项">
            {q.options.map((opt, idx) => (
              <button
                key={idx}
                type="button"
                className="wb-option-btn"
                data-testid={`wb-practice-option-${idx}`}
                onClick={() => handleObjectiveSubmit(idx)}
              >
                <span className="wb-option-btn__key">{getOptionLabel(idx)}</span>
                <span className="wb-option-btn__text">{opt}</span>
              </button>
            ))}
          </div>
        )}

        {q.type === 'multi' && Array.isArray(q.options) && (
          <div className="wb-multi-wrap">
            <div className="wb-options" role="group" aria-label="多选题选项">
              {q.options.map((opt, idx) => {
                const selected = multiDraft.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    aria-pressed={selected}
                    className={`wb-option-btn${selected ? ' is-selected' : ''}`}
                    data-testid={`wb-practice-option-${idx}`}
                    onClick={() => toggleMultiOption(idx)}
                  >
                    <span className="wb-option-btn__key">{getOptionLabel(idx)}</span>
                    <span className="wb-option-btn__text">{opt}</span>
                  </button>
                );
              })}
            </div>
            <div className="wb-multi-submit">
              <button
                type="button"
                className="wb-btn wb-btn--primary"
                data-testid="wb-practice-submit-multi-btn"
                disabled={multiDraft.length === 0}
                onClick={() => handleObjectiveSubmit(multiDraft)}
              >
                提交多选答案
              </button>
            </div>
          </div>
        )}

        {q.type === 'tf' && (
          <div className="wb-tf-options" role="group" aria-label="判断题选项">
            <button
              type="button"
              className="wb-option-btn"
              data-testid="wb-practice-tf-true"
              onClick={() => handleObjectiveSubmit(true)}
            >
              <span className="wb-option-btn__key">T</span>
              <span className="wb-option-btn__text">正确</span>
            </button>
            <button
              type="button"
              className="wb-option-btn"
              data-testid="wb-practice-tf-false"
              onClick={() => handleObjectiveSubmit(false)}
            >
              <span className="wb-option-btn__key">F</span>
              <span className="wb-option-btn__text">错误</span>
            </button>
          </div>
        )}

        {!isObjective && (
          <div className="wb-subjective-wrap">
            <label className="wb-subjective-label" htmlFor={notesId}>
              作答思路草稿（可选）
            </label>
            <textarea
              id={notesId}
              className="wb-subjective-textarea"
              data-testid="wb-practice-subjective-input"
              rows={4}
              value={subjectiveDraft}
              onChange={(e) => setSubjectiveDraft(e.target.value)}
              placeholder="在此整理要点后，点击下方按钮对照参考答案与解析..."
            />
            {!revealed && (
              <div className="wb-subjective-actions">
                <button
                  type="button"
                  className="wb-btn wb-btn--primary"
                  data-testid="wb-practice-reveal-btn"
                  onClick={(e) => {
                    if (
                      document.activeElement === e.currentTarget ||
                      isFocusDropped(document.activeElement)
                    ) {
                      pendingRevealFocusRef.current = true;
                    }
                    setRevealed(true);
                  }}
                >
                  查看参考答案与解析
                </button>
              </div>
            )}
          </div>
        )}

        {feedback && (
          <div
            className={`wb-feedback ${feedback.isCorrect ? 'wb-feedback--ok' : 'wb-feedback--bad'}`}
            data-testid="wb-practice-feedback"
          >
            <div className="wb-feedback__title">
              <Icon name={feedback.isCorrect ? 'circleCheck' : 'alertTriangle'} size={16} />
              <span>
                {feedback.isCorrect
                  ? '回答正确！原错题记录暂时保留，确认掌握后可点击下方按钮移出错题本。'
                  : `回答错误（本次选择：${feedback.submittedLabel}），已累加错误次数并记录历史错选。`}
              </span>
            </div>
          </div>
        )}

        {subjectiveRatedWrong && !isObjective && (
          <div className="wb-feedback wb-feedback--bad" data-testid="wb-practice-feedback">
            <div className="wb-feedback__title">
              <Icon name="alertTriangle" size={16} />
              <span>已标记为仍需巩固，错误次数已累加。可对照下方解析后再次尝试。</span>
            </div>
          </div>
        )}

        {revealed && (
          <div className="wb-explanation" data-testid="wb-practice-explanation">
            <div className="wb-explanation__row">
              <strong>参考答案：</strong>
              <span className="wb-explanation__answer">
                {formatAnswerText(q) || '暂无参考答案'}
              </span>
            </div>
            {Array.isArray(q.keyPoints) && q.keyPoints.length > 0 && (
              <div className="wb-explanation__row">
                <strong>核心要点：</strong>
                <ul className="wb-explanation__points">
                  {q.keyPoints.map((kp, idx) => (
                    <li key={idx}>{kp}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="wb-explanation__row">
              <strong>解析：</strong>
              <span>{q.explain?.trim() || '暂无解析'}</span>
            </div>
          </div>
        )}

        <div className="wb-practice-card__footer">
          {!isObjective && revealed && (
            <button
              ref={wrongBtnRef}
              type="button"
              className="wb-btn wb-btn--warn"
              data-testid="wb-practice-subjective-wrong-btn"
              onClick={() => handleSubjectiveWrong(0)}
            >
              自评未掌握（错误次数 +1）
            </button>
          )}
          <button
            ref={masteredBtnRef}
            type="button"
            className="wb-btn wb-btn--ok"
            data-testid="wb-practice-mastered-btn"
            onClick={handleMarkMasteredClick}
          >
            <Icon name="check" size={15} />
            <span>移出错题本（标记为已掌握）</span>
          </button>
        </div>
      </article>
    </div>
  );
}
