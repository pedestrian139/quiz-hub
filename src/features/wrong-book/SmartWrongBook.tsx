import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  formatAnswerText,
  getOptionLabel,
  getTypeLabel,
  isObjectiveQuestion,
} from '../../core/questionUtils';
import {
  BankLibraryProvider,
  useOptionalBankLibraryContext,
} from '../../utils/BankLibraryContext';
import { Icon } from '../../components/ui/Icons';
import { downloadWrongBookMarkdown, formatWrongTimestamp } from './markdownExport';
import type { SmartWrongBookProps, WrongBookSort } from './types';
import { useWrongBook } from './useWrongBook';
import { filterAndSortWrongItems } from './wrongBookEngine';
import { WrongBookPracticeView } from './WrongBookPracticeView';
import './WrongBook.css';

function isFocusDropped(el: Element | null): boolean {
  if (el === null || el === document.body || el === document.documentElement) {
    return true;
  }
  return el instanceof HTMLElement && el.getAttribute('role') === 'dialog' && el.tabIndex === -1;
}

function getWrongStatusTone(
  wrongCount: number,
  mastery?: number,
): 'attention' | 'warn' | 'neutral' {
  if (wrongCount >= 2 || mastery === 0) return 'attention';
  if (mastery === 1) return 'warn';
  return 'neutral';
}

export function EnsureBankLibraryProvider({ children }: { children: ReactNode }) {
  const existing = useOptionalBankLibraryContext();
  if (existing) return <>{children}</>;
  return <BankLibraryProvider>{children}</BankLibraryProvider>;
}

function SmartWrongBookInner({
  initialBankId = 'all',
  titleId,
  onClose,
  className = '',
}: SmartWrongBookProps) {
  const { ready, banks, items, recordRetryWrong, markMastered } = useWrongBook();
  const generatedTitleId = useId();
  const headingId = titleId ?? generatedTitleId;

  const [selectedBankId, setSelectedBankId] = useState<string>(initialBankId);
  const [sortBy, setSortBy] = useState<WrongBookSort>('wrongCount');
  const [mode, setMode] = useState<'list' | 'practice'>('list');
  const [practiceQueueKeys, setPracticeQueueKeys] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingModeFocusRef = useRef<'list' | 'practice' | null>(null);
  const pendingListMasterRef = useRef<{ key: string; index: number } | null>(null);

  useEffect(() => {
    setSelectedBankId(initialBankId);
    setMode('list');
    setPracticeQueueKeys([]);
    pendingModeFocusRef.current = null;
    pendingListMasterRef.current = null;
  }, [initialBankId]);

  useEffect(() => {
    if (!ready) return;
    if (selectedBankId !== 'all' && !banks.some((bank) => bank.id === selectedBankId)) {
      setSelectedBankId('all');
    }
  }, [banks, ready, selectedBankId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const effectiveBankId = useMemo(() => {
    if (selectedBankId === 'all') return 'all';
    if (!ready) return selectedBankId;
    return banks.some((bank) => bank.id === selectedBankId) ? selectedBankId : 'all';
  }, [banks, ready, selectedBankId]);

  const countByBank = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.bankId] = (counts[item.bankId] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  const filteredItems = useMemo(
    () => filterAndSortWrongItems(items, { bankId: effectiveBankId, sort: sortBy }),
    [items, effectiveBankId, sortBy],
  );

  const practiceItems = useMemo(() => {
    if (mode !== 'practice' || practiceQueueKeys.length === 0) return [];
    const byKey = new Map(items.map((item) => [item.key, item]));
    const queue = [];
    for (const key of practiceQueueKeys) {
      const latest = byKey.get(key);
      if (latest) {
        queue.push(latest);
      }
    }
    return queue;
  }, [items, mode, practiceQueueKeys]);

  const selectedBankLabel = useMemo(() => {
    if (effectiveBankId === 'all') return '全部题库';
    return banks.find((b) => b.id === effectiveBankId)?.name ?? '指定题库';
  }, [banks, effectiveBankId]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStartPractice = () => {
    if (filteredItems.length === 0) return;
    pendingListMasterRef.current = null;
    if (
      rootRef.current &&
      (rootRef.current.contains(document.activeElement) || isFocusDropped(document.activeElement))
    ) {
      pendingModeFocusRef.current = 'practice';
    }
    setPracticeQueueKeys(filteredItems.map((item) => item.key));
    setMode('practice');
  };

  const handleExitPractice = () => {
    if (
      rootRef.current &&
      (rootRef.current.contains(document.activeElement) || isFocusDropped(document.activeElement))
    ) {
      pendingModeFocusRef.current = 'list';
    }
    setMode('list');
    setPracticeQueueKeys([]);
  };

  useEffect(() => {
    if (!ready) return;
    const pendingMode = pendingModeFocusRef.current;
    if (!pendingMode || pendingMode !== mode) return;
    pendingModeFocusRef.current = null;
    if (!isFocusDropped(document.activeElement)) return;

    const root = rootRef.current;
    if (!root) return;
    if (mode === 'practice') {
      const target =
        root.querySelector<HTMLElement>('[data-testid="wb-back-to-list-btn"]') ??
        root.querySelector<HTMLElement>('button:not([disabled])');
      target?.focus({ preventScroll: true });
      return;
    }

    const target =
      root.querySelector<HTMLElement>('[data-testid="wb-start-practice-btn"]:not([disabled])') ??
      root.querySelector<HTMLElement>('[data-testid="wb-bank-filter"]') ??
      root.querySelector<HTMLElement>('[data-testid="wb-close-btn"]');
    target?.focus({ preventScroll: true });
  }, [mode, ready]);

  useEffect(() => {
    const pending = pendingListMasterRef.current;
    if (!pending || mode !== 'list') return;
    if (filteredItems.some((item) => item.key === pending.key)) {
      return;
    }
    pendingListMasterRef.current = null;
    if (!isFocusDropped(document.activeElement)) return;

    const root = rootRef.current;
    if (!root) return;
    if (filteredItems.length === 0) {
      const target =
        root.querySelector<HTMLElement>('[data-testid="wb-bank-filter"]') ??
        root.querySelector<HTMLElement>('[data-testid="wb-close-btn"]');
      target?.focus({ preventScroll: true });
      return;
    }

    const cards = root.querySelectorAll<HTMLElement>('[data-testid="wb-item-card"]');
    const targetCard = cards[Math.min(pending.index, cards.length - 1)];
    const target =
      targetCard?.querySelector<HTMLElement>('[data-testid="wb-item-mastered-btn"]') ??
      targetCard?.querySelector<HTMLElement>('[data-testid="wb-item-toggle-detail"]') ??
      root.querySelector<HTMLElement>('[data-testid="wb-bank-filter"]');
    target?.focus({ preventScroll: true });
  }, [filteredItems, mode]);

  const handleExportMarkdown = () => {
    if (filteredItems.length === 0) return;
    downloadWrongBookMarkdown(filteredItems, { bankFilterLabel: selectedBankLabel });
    setNotice(`已导出 ${filteredItems.length} 道错题的 Markdown 复习文档`);
  };

  return (
    <div
      ref={rootRef}
      className={`wb-root${className ? ` ${className}` : ''}`}
      data-testid="wb-view-root"
    >
      <header className="wb-header">
        <div className="wb-header__title-wrap">
          <h2 id={headingId} className="wb-header__title">
            智能错题本
          </h2>
          <p className="wb-header__sub">
            跨题库聚合错题 · 累计错误追踪 · 专项重练与 Markdown 导出
          </p>
        </div>
        <div className="wb-header__right">
          <span className="wb-summary-pill" data-testid="wb-total-badge">
            共 {items.length} 道错题
          </span>
          {onClose && (
            <button
              type="button"
              className="wb-close-btn"
              data-testid="wb-close-btn"
              data-dialog-initial-focus=""
              aria-label="关闭智能错题本"
              onClick={onClose}
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
      </header>

      <div className="wb-body">
        {notice && (
          <div className="wb-notice" role="status" data-testid="wb-notice">
            {notice}
          </div>
        )}

        {!ready ? (
          <div className="wb-loading">正在加载题库与错题记录...</div>
        ) : mode === 'practice' ? (
          <WrongBookPracticeView
            items={practiceItems}
            onRetryWrong={recordRetryWrong}
            onMarkMastered={(bankId, q) => {
              void markMastered(bankId, q);
              setNotice('已标记为已掌握并移出错题本');
            }}
            onExit={handleExitPractice}
          />
        ) : (
          <>
            <div className="wb-toolbar">
              <div className="wb-toolbar__filters">
                <label className="wb-filter-group">
                  <span className="wb-filter-label">所属题库</span>
                  <select
                    className="wb-select"
                    data-testid="wb-bank-filter"
                    aria-label="按题库筛选"
                    value={effectiveBankId}
                    onChange={(e) => setSelectedBankId(e.target.value)}
                  >
                    <option value="all">全部题库 ({items.length})</option>
                    {banks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name} ({countByBank[bank.id] ?? 0})
                      </option>
                    ))}
                  </select>
                </label>

                <div className="wb-sort-group" role="group" aria-label="排序方式">
                  <button
                    type="button"
                    className={`wb-sort-btn${sortBy === 'wrongCount' ? ' is-active' : ''}`}
                    aria-pressed={sortBy === 'wrongCount'}
                    data-testid="wb-sort-count"
                    onClick={() => setSortBy('wrongCount')}
                  >
                    错误次数最多
                  </button>
                  <button
                    type="button"
                    className={`wb-sort-btn${sortBy === 'recent' ? ' is-active' : ''}`}
                    aria-pressed={sortBy === 'recent'}
                    data-testid="wb-sort-recent"
                    onClick={() => setSortBy('recent')}
                  >
                    最近做错
                  </button>
                </div>
              </div>

              <div className="wb-toolbar__actions">
                <button
                  type="button"
                  className="wb-btn wb-btn--primary"
                  data-testid="wb-start-practice-btn"
                  disabled={filteredItems.length === 0}
                  onClick={handleStartPractice}
                >
                  <Icon name="refreshCw" size={15} />
                  <span>重练当前筛选错题</span>
                </button>
                <button
                  type="button"
                  className="wb-btn wb-btn--ghost"
                  data-testid="wb-export-md-btn"
                  disabled={filteredItems.length === 0}
                  onClick={handleExportMarkdown}
                >
                  <Icon name="download" size={15} />
                  <span>导出 Markdown</span>
                </button>
              </div>
            </div>

            {filteredItems.length === 0 ? (
              <div className="wb-empty" data-testid="wb-empty-state">
                <div
                  className={`wb-empty__icon${items.length === 0 ? ' is-clear' : ''}`}
                  aria-hidden="true"
                >
                  <Icon
                    name={items.length === 0 ? 'circleCheck' : 'book'}
                    size={26}
                    strokeWidth={1.6}
                  />
                </div>
                <div className="wb-empty__title">
                  {items.length === 0 ? '暂无待巩固错题' : '当前筛选下暂无错题'}
                </div>
                <p className="wb-empty__desc">
                  {items.length === 0
                    ? '在内置题库或自定义导入题库中作答出错的题目会自动汇总到这里。'
                    : '该题库下的错题已全部掌握，可切换「全部题库」查看其他待巩固题目。'}
                </p>
              </div>
            ) : (
              <ul className="wb-list" data-testid="wb-item-list">
                {filteredItems.map((item, idx) => {
                  const q = item.question;
                  const isExpanded = Boolean(expandedKeys[item.key]);
                  const isObj = isObjectiveQuestion(q.type);
                  const statusTone = getWrongStatusTone(item.wrongCount, item.mastery);
                  const historyTone = isObj
                    ? item.wrongChoices.length > 0
                      ? 'bad'
                      : 'neutral'
                    : item.mastery === 1
                      ? 'warn'
                      : 'bad';

                  return (
                    <li
                      key={item.key}
                      className="wb-item-card"
                      data-testid="wb-item-card"
                      data-bank-id={item.bankId}
                      data-question-id={q.id}
                    >
                      <div className="wb-item__top">
                        <div className="wb-item__meta">
                          <span className="wb-tag wb-tag--type">{getTypeLabel(q.type)}</span>
                          <span
                            className="wb-item__source"
                            title={`${item.bankName}${item.chapterLabel ? ` · ${item.chapterLabel}` : ''}`}
                          >
                            <span data-testid="wb-item-bank">{item.bankName}</span>
                            {item.chapterLabel && (
                              <span className="wb-item__chapter"> · {item.chapterLabel}</span>
                            )}
                          </span>
                        </div>
                        <div className="wb-item__stats">
                          <span
                            className={`wb-status-pill wb-status-pill--${statusTone}`}
                            data-testid="wb-item-wrong-count"
                          >
                            错误 {item.wrongCount} 次
                          </span>
                          <span className="wb-item__time" data-testid="wb-item-last-time">
                            {formatWrongTimestamp(item.lastWrongTs)}
                          </span>
                        </div>
                      </div>

                      <div className="wb-item__stem" data-testid="wb-item-stem">
                        {q.stem}
                      </div>

                      <div className="wb-item__history" data-testid="wb-item-wrong-choices">
                        <strong className="wb-item__history-label">历史错选：</strong>
                        <span className={`wb-item__history-value wb-item__history-value--${historyTone}`}>
                          {isObj
                            ? item.wrongChoices.length > 0
                              ? item.wrongChoices.map((c) => c.label).join('、')
                              : '暂无记录'
                            : item.mastery === 1
                              ? '自评有点模糊（待巩固）'
                              : '自评不会（待巩固）'}
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="wb-item__detail" data-testid="wb-item-detail">
                          {Array.isArray(q.options) && q.options.length > 0 && (
                            <ul className="wb-item__options">
                              {q.options.map((opt, idx) => (
                                <li key={idx}>
                                  {getOptionLabel(idx)}. {opt}
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="wb-item__answer">
                            <strong>正确答案：</strong>
                            <span>{formatAnswerText(q) || '暂无参考答案'}</span>
                          </div>
                          {Array.isArray(q.keyPoints) && q.keyPoints.length > 0 && (
                            <div className="wb-item__keypoints">
                              <strong>核心要点：</strong>
                              <ul>
                                {q.keyPoints.map((kp, idx) => (
                                  <li key={idx}>{kp}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="wb-item__explain">
                            <strong>解析：</strong>
                            <span>{q.explain?.trim() || '暂无解析'}</span>
                          </div>
                        </div>
                      )}

                      <div className="wb-item__actions">
                        <button
                          type="button"
                          className="wb-btn wb-btn--ghost wb-btn--sm"
                          data-testid="wb-item-toggle-detail"
                          aria-expanded={isExpanded}
                          onClick={() => toggleExpand(item.key)}
                        >
                          <Icon name={isExpanded ? 'chevronUp' : 'chevronDown'} size={14} />
                          <span>{isExpanded ? '收起解析' : '查看答案与解析'}</span>
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn--ok wb-btn--sm"
                          data-testid="wb-item-mastered-btn"
                          onClick={(e) => {
                            if (
                              document.activeElement === e.currentTarget ||
                              isFocusDropped(document.activeElement)
                            ) {
                              pendingListMasterRef.current = { key: item.key, index: idx };
                            }
                            void markMastered(item.bankId, q);
                            setNotice('已标记为已掌握并移出错题本');
                          }}
                        >
                          <Icon name="check" size={14} />
                          <span>移出错题本（标记为已掌握）</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function SmartWrongBook(props: SmartWrongBookProps) {
  return (
    <EnsureBankLibraryProvider>
      <SmartWrongBookInner {...props} />
    </EnsureBankLibraryProvider>
  );
}
