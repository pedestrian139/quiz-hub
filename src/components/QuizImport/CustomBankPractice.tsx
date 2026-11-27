import { useMemo, useRef, useState } from 'react';
import {
  formatAnswerText,
  getOptionLabel,
  getTypeLabel,
  isObjectiveQuestion,
} from '../../core/questionUtils';
import {
  buildQueue,
  clearWrongRecords,
  computeHomeStats,
  computeModeStats,
  computeSessionResult,
  getFavoriteQuestions,
  getWrongQuestions,
  recordObjectiveAnswer,
  recordSubjectiveMastery,
  toggleFavorite,
} from '../../core/quizEngine';
import { TYPE_NAME } from '../../data/catalog';
import type {
  MasteryLevel,
  Question,
  QuestionType,
  QuizFilterOptions,
  SessionResult,
  UserRecord,
  UserStore,
} from '../../types/quiz';
import { buildBankViewModel } from '../../utils/bankCatalog';
import type { BankRecord } from '../../utils/quizImportTypes';
import { Icon } from '../ui/Icons';

interface CustomBankPracticeProps {
  bank: BankRecord;
  store: UserStore;
  onUpdateStore: (fn: (prev: UserStore) => UserStore) => UserStore;
  onResetProgress: () => Promise<void>;
  notify: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

type PracticeView =
  | { kind: 'home' }
  | {
      kind: 'session';
      title: string;
      queue: Question[];
      opts: QuizFilterOptions;
      startedAt: number;
    }
  | {
      kind: 'result';
      title: string;
      queue: Question[];
      opts: QuizFilterOptions;
      result: SessionResult;
    }
  | { kind: 'wrong' }
  | { kind: 'fav' };

const PRACTICE_MODES: ('all' | QuestionType)[] = [
  'all',
  'choice',
  'multi',
  'tf',
  'short',
  'analysis',
];

export function CustomBankPractice({
  bank,
  store,
  onUpdateStore,
  onResetProgress,
  notify,
}: CustomBankPracticeProps) {
  const vm = useMemo(() => buildBankViewModel(bank), [bank]);
  const [selectedChapters, setSelectedChapters] = useState<number[]>(() => [...vm.allChapterIds]);
  const [originFilter, setOriginFilter] = useState<'all' | Question['source']['origin']>('all');
  const [countOption, setCountOption] = useState<number>(20);
  const [orderOption, setOrderOption] = useState<'random' | 'seq'>('seq');
  const [search, setSearch] = useState('');

  const [view, setView] = useState<PracticeView>({ kind: 'home' });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionAnswers, setSessionAnswers] = useState<Record<string, UserRecord>>({});
  const [multiDraft, setMultiDraft] = useState<number[]>([]);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [expandedListIds, setExpandedListIds] = useState<Record<string, boolean>>({});
  const sessionStartRef = useRef<number>(Date.now());

  // Sync chapters when switching between custom banks
  const effectiveChapters = useMemo(() => {
    const valid = selectedChapters.filter((id) => vm.chapterById.has(id));
    return valid.length > 0 ? valid : vm.allChapterIds;
  }, [selectedChapters, vm]);

  const homeStats = useMemo(() => computeHomeStats(vm.questions, store), [store, vm.questions]);
  const wrongList = useMemo(() => getWrongQuestions(vm.questions, store), [store, vm.questions]);
  const favList = useMemo(() => getFavoriteQuestions(vm.questions, store), [store, vm.questions]);

  const matchingCounts = useMemo(() => {
    const origins =
      vm.hasMultipleOrigins && originFilter !== 'all' ? [originFilter] : undefined;
    const out: Record<'all' | QuestionType, number> = {
      all: 0,
      choice: 0,
      multi: 0,
      tf: 0,
      short: 0,
      analysis: 0,
    };
    for (const m of PRACTICE_MODES) {
      out[m] = buildQueue(vm.questions, {
        mode: m,
        chapters: effectiveChapters,
        origins,
        search: search.trim() || undefined,
        count: 0,
        order: 'seq',
      }).length;
    }
    return out;
  }, [effectiveChapters, originFilter, search, vm.hasMultipleOrigins, vm.questions]);

  const startSession = (title: string, opts: QuizFilterOptions) => {
    const queue = buildQueue(vm.questions, opts);
    if (queue.length === 0) {
      notify('当前筛选条件下暂无匹配题目', 'info');
      return;
    }
    sessionStartRef.current = Date.now();
    setCurrentIndex(0);
    setSessionAnswers({});
    setMultiDraft([]);
    setRevealedIds({});
    setView({
      kind: 'session',
      title,
      queue,
      opts,
      startedAt: sessionStartRef.current,
    });
  };

  const handleToggleChapter = (chId: number) => {
    const set = new Set(effectiveChapters);
    if (set.has(chId)) {
      if (effectiveChapters.length <= 1) {
        notify('至少需要保留 1 个章节', 'info');
        return;
      }
      setSelectedChapters(effectiveChapters.filter((id) => id !== chId));
    } else {
      setSelectedChapters([...effectiveChapters, chId].sort((a, b) => a - b));
    }
  };

  if (view.kind === 'session') {
    const q = view.queue[currentIndex];
    const rec = q ? sessionAnswers[q.id] : undefined;
    const isGraded = rec !== undefined;
    const isFav = q ? store.fav[q.id] === true : false;
    const isRevealed = q ? Boolean(revealedIds[q.id]) : false;

    if (!q) {
      setView({ kind: 'home' });
      return null;
    }

    const handleNextOrFinish = () => {
      if (currentIndex + 1 < view.queue.length) {
        setCurrentIndex((i) => i + 1);
        setMultiDraft([]);
      } else {
        const result = computeSessionResult(
          view.queue,
          sessionAnswers,
          Date.now() - sessionStartRef.current,
        );
        setView({
          kind: 'result',
          title: view.title,
          queue: view.queue,
          opts: view.opts,
          result,
        });
      }
    };

    return (
      <div data-testid="qi-practice-session" className="qi-card">
        <div className="qi-toolbar">
          <button
            type="button"
            data-testid="qi-session-exit"
            className="qi-btn qi-btn--sm"
            onClick={() => setView({ kind: 'home' })}
          >
            返回刷题配置
          </button>
          <span className="qi-pill qi-pill--brand">
            {view.title} · {currentIndex + 1} / {view.queue.length}
          </span>
          <button
            type="button"
            data-testid="qi-btn-star"
            className={`qi-btn qi-btn--sm${isFav ? ' qi-btn--warn' : ''}`}
            onClick={() => onUpdateStore((prev) => toggleFavorite(prev, q.id))}
          >
            {isFav ? (
              <>
                <Icon name="starFill" size={14} />
                <span>已收藏</span>
              </>
            ) : (
              <>
                <Icon name="star" size={14} />
                <span>收藏</span>
              </>
            )}
          </button>
        </div>

        <div className="qi-pill-row">
          <span className="qi-pill">{vm.getChapterLabel(q.chapter)}</span>
          <span className="qi-pill qi-pill--brand">{getTypeLabel(q.type)}</span>
          {q.source.ref && <span className="qi-pill">{q.source.ref}</span>}
        </div>

        <div data-testid="qi-q-stem" style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1.6 }}>
          {q.stem}
        </div>

        {q.type === 'choice' && q.options && (
          <div className="qi-draft-list">
            {q.options.map((opt, idx) => {
              const isPicked = rec?.choice === idx;
              const isAns = isGraded && q.answer === idx;
              const toneCls = isAns
                ? ' qi-btn--primary'
                : isGraded && isPicked
                  ? ' qi-btn--danger'
                  : '';
              return (
                <button
                  key={idx}
                  type="button"
                  data-testid={`qi-option-${idx}`}
                  disabled={isGraded}
                  className={`qi-btn${toneCls}`}
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => {
                    let nextRec: UserRecord = { ok: 0, ts: Date.now() };
                    onUpdateStore((prev) => {
                      const res = recordObjectiveAnswer(prev, q, idx);
                      nextRec = res.record;
                      return res.store;
                    });
                    setSessionAnswers((prev) => ({ ...prev, [q.id]: nextRec }));
                  }}
                >
                  {getOptionLabel(idx)}. {opt}
                </button>
              );
            })}
          </div>
        )}

        {q.type === 'multi' && q.options && (
          <div className="qi-draft-list">
            {q.options.map((opt, idx) => {
              const selected = isGraded
                ? Array.isArray(rec?.choice) && rec.choice.includes(idx)
                : multiDraft.includes(idx);
              const isAns = isGraded && Array.isArray(q.answer) && q.answer.includes(idx);
              const toneCls = isAns
                ? ' qi-btn--primary'
                : isGraded && selected && !isAns
                  ? ' qi-btn--danger'
                  : !isGraded && selected
                    ? ' qi-btn--primary'
                    : '';
              return (
                <button
                  key={idx}
                  type="button"
                  data-testid={`qi-option-${idx}`}
                  disabled={isGraded}
                  className={`qi-btn${toneCls}`}
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => {
                    setMultiDraft((prev) =>
                      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx],
                    );
                  }}
                >
                  {getOptionLabel(idx)}. {opt}
                </button>
              );
            })}
            {!isGraded && (
              <button
                type="button"
                data-testid="qi-btn-submit-multi"
                className="qi-btn qi-btn--primary"
                disabled={multiDraft.length === 0}
                onClick={() => {
                  let nextRec: UserRecord = { ok: 0, ts: Date.now() };
                  onUpdateStore((prev) => {
                    const res = recordObjectiveAnswer(prev, q, multiDraft);
                    nextRec = res.record;
                    return res.store;
                  });
                  setSessionAnswers((prev) => ({ ...prev, [q.id]: nextRec }));
                }}
              >
                确认提交多选
              </button>
            )}
          </div>
        )}

        {q.type === 'tf' && (
          <div className="qi-grid-two">
            {([true, false] as const).map((val) => {
              const isAns = isGraded && q.answer === val;
              const isWrongPick = isGraded && rec?.choice === val && q.answer !== val;
              return (
                <button
                  key={String(val)}
                  type="button"
                  data-testid={val ? 'qi-tf-true' : 'qi-tf-false'}
                  disabled={isGraded}
                  className={`qi-btn${isAns ? ' qi-btn--primary' : isWrongPick ? ' qi-btn--danger' : ''}`}
                  onClick={() => {
                    let nextRec: UserRecord = { ok: 0, ts: Date.now() };
                    onUpdateStore((prev) => {
                      const res = recordObjectiveAnswer(prev, q, val);
                      nextRec = res.record;
                      return res.store;
                    });
                    setSessionAnswers((prev) => ({ ...prev, [q.id]: nextRec }));
                  }}
                >
                  {val ? '正确' : '错误'}
                </button>
              );
            })}
          </div>
        )}

        {isObjectiveQuestion(q.type) && isGraded && rec && (
          <div
            data-testid="qi-quiz-feedback"
            className={`qi-toast${rec.ok === 1 ? ' qi-toast--success' : ' qi-toast--error'}`}
          >
            <div>
              {rec.ok === 1 ? '回答正确' : '回答错误'} · 参考答案：{formatAnswerText(q)}
            </div>
            {q.explain && (
              <div style={{ fontWeight: 400, marginTop: '4px', color: 'var(--ink)' }}>
                解析：{q.explain}
              </div>
            )}
          </div>
        )}

        {!isObjectiveQuestion(q.type) && (
          <div className="qi-draft-list">
            {!isRevealed ? (
              <button
                type="button"
                data-testid="qi-btn-reveal"
                className="qi-btn qi-btn--primary"
                onClick={() => setRevealedIds((p) => ({ ...p, [q.id]: true }))}
              >
                显示参考答案
              </button>
            ) : (
              <>
                <div className="qi-card" style={{ background: 'var(--surface-subtle)' }}>
                  <div>
                    <strong>参考答案：</strong>
                    {formatAnswerText(q)}
                  </div>
                  {q.explain && (
                    <div style={{ fontSize: '13.5px', color: 'var(--sub)' }}>
                      解析：{q.explain}
                    </div>
                  )}
                </div>
                <div className="qi-btn-group">
                  {([
                    { lvl: 2 as MasteryLevel, label: '完全会' },
                    { lvl: 1 as MasteryLevel, label: '有点模糊' },
                    { lvl: 0 as MasteryLevel, label: '不会' },
                  ] as const).map((item) => (
                    <button
                      key={item.lvl}
                      type="button"
                      data-testid={`qi-selfcheck-${item.lvl}`}
                      className={`qi-btn qi-btn--sm${store.mastery[q.id] === item.lvl && isGraded ? ' qi-btn--primary' : ''}`}
                      onClick={() => {
                        const ts = Date.now();
                        onUpdateStore((prev) => recordSubjectiveMastery(prev, q.id, item.lvl, ts));
                        setSessionAnswers((prev) => ({
                          ...prev,
                          [q.id]: { ok: item.lvl === 2 ? 1 : 0, ts },
                        }));
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="qi-toolbar">
          <button
            type="button"
            className="qi-btn"
            disabled={currentIndex === 0}
            onClick={() => {
              setCurrentIndex((i) => Math.max(0, i - 1));
              setMultiDraft([]);
            }}
          >
            上一题
          </button>
          <button
            type="button"
            data-testid="qi-btn-next"
            className="qi-btn qi-btn--primary"
            onClick={handleNextOrFinish}
          >
            {currentIndex + 1 < view.queue.length ? '下一题' : '看结果'}
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === 'result') {
    const { result } = view;
    return (
      <div data-testid="qi-practice-result" className="qi-card">
        <h3 style={{ margin: 0 }}>{bank.name} · 本组结算</h3>
        <div className="qi-stats-grid">
          <div className="qi-card">
            <span style={{ fontSize: '12px', color: 'var(--sub)' }}>正确率</span>
            <strong data-testid="qi-result-score">{result.accuracyPct}%</strong>
          </div>
          <div className="qi-card">
            <span style={{ fontSize: '12px', color: 'var(--sub)' }}>总题数</span>
            <strong>{result.totalCount}</strong>
          </div>
          <div className="qi-card">
            <span style={{ fontSize: '12px', color: 'var(--sub)' }}>答对</span>
            <strong>{result.correctCount}</strong>
          </div>
          <div className="qi-card">
            <span style={{ fontSize: '12px', color: 'var(--sub)' }}>用时</span>
            <strong>{result.elapsedFormatted}</strong>
          </div>
        </div>
        <div className="qi-btn-group">
          {result.wrongQuestionIds.length > 0 && (
            <button
              type="button"
              className="qi-btn qi-btn--danger"
              onClick={() =>
                startSession('错题重练', {
                  mode: 'all',
                  chapters: vm.allChapterIds,
                  onlyIds: result.wrongQuestionIds,
                  count: 0,
                  order: 'seq',
                })
              }
            >
              只练错题 ({result.wrongQuestionIds.length})
            </button>
          )}
          <button
            type="button"
            className="qi-btn qi-btn--primary"
            onClick={() => startSession(view.title, view.opts)}
          >
            再来一组
          </button>
          <button
            type="button"
            className="qi-btn"
            onClick={() => setView({ kind: 'home' })}
          >
            返回刷题首页
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === 'wrong' || view.kind === 'fav') {
    const isWrong = view.kind === 'wrong';
    const list = isWrong ? wrongList : favList;
    return (
      <div data-testid={`qi-list-${view.kind}`} className="qi-card">
        <div className="qi-toolbar">
          <div className="qi-btn-group">
            <button
              type="button"
              className="qi-btn qi-btn--sm"
              onClick={() => setView({ kind: 'home' })}
            >
              返回刷题首页
            </button>
            <strong>
              {bank.name} · {isWrong ? `本库错题本 (${list.length})` : `本库收藏夹 (${list.length})`}
            </strong>
          </div>

          <div className="qi-btn-group">
            {list.length > 0 && (
              <button
                type="button"
                data-testid="qi-list-redo-all"
                className="qi-btn qi-btn--sm qi-btn--primary"
                onClick={() =>
                  startSession(isWrong ? '错题重练' : '收藏重练', {
                    mode: 'all',
                    chapters: vm.allChapterIds,
                    onlyIds: list.map((q) => q.id),
                    count: 0,
                    order: 'seq',
                  })
                }
              >
                重做全部 ({list.length})
              </button>
            )}
            {isWrong && list.length > 0 && (
              <button
                type="button"
                data-testid="qi-list-clear-wrong"
                className="qi-btn qi-btn--sm qi-btn--danger"
                onClick={() => {
                  onUpdateStore(clearWrongRecords);
                  notify(`已清空《${bank.name}》错题本`, 'info');
                }}
              >
                清空错题
              </button>
            )}
          </div>
        </div>

        {list.length === 0 ? (
          <div style={{ padding: '18px 0', textAlign: 'center', color: 'var(--sub)' }}>
            {isWrong ? '该题库暂无错题记录' : '该题库暂无收藏题目'}
          </div>
        ) : (
          <div className="qi-draft-list">
            {list.map((q, idx) => {
              const expanded = Boolean(expandedListIds[q.id]);
              return (
                <div key={q.id} data-testid="qi-list-item" className="qi-draft-card">
                  <div className="qi-toolbar">
                    <div className="qi-pill-row">
                      <span className="qi-pill">#{idx + 1}</span>
                      <span className="qi-pill">{vm.getChapterLabel(q.chapter)}</span>
                      <span className="qi-pill qi-pill--brand">{getTypeLabel(q.type)}</span>
                    </div>
                    <button
                      type="button"
                      className="qi-btn qi-btn--sm"
                      onClick={() =>
                        setExpandedListIds((p) => ({ ...p, [q.id]: !p[q.id] }))
                      }
                    >
                      {expanded ? '收起答案' : '查看答案'}
                    </button>
                  </div>
                  <div style={{ fontWeight: 600 }}>{q.stem}</div>
                  {expanded && (
                    <div style={{ fontSize: '13.5px', color: 'var(--ink-2)' }}>
                      <div>
                        <strong>参考答案：</strong>
                        {formatAnswerText(q)}
                      </div>
                      {q.explain && <div>解析：{q.explain}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="qi-practice-home" className="qi-draft-list">
      <div className="qi-card">
        <div className="qi-toolbar">
          <div>
            <h3 style={{ margin: 0 }}>{bank.name} · 独立刷题区</h3>
            <span style={{ fontSize: '12.5px', color: 'var(--sub)' }}>
              共 {vm.counts.total} 题 · {vm.chapters.length} 章 · 错题/收藏/进度与其他题库完全隔离
            </span>
          </div>
          <div className="qi-btn-group">
            <button
              type="button"
              data-testid="qi-open-wrong"
              className="qi-btn qi-btn--sm qi-btn--danger"
              onClick={() => setView({ kind: 'wrong' })}
            >
              本库错题本 ({homeStats.wrongCount})
            </button>
            <button
              type="button"
              data-testid="qi-open-fav"
              className="qi-btn qi-btn--sm qi-btn--warn"
              onClick={() => setView({ kind: 'fav' })}
            >
              本库收藏夹 ({homeStats.favCount})
            </button>
            <button
              type="button"
              data-testid="qi-reset-progress"
              className="qi-btn qi-btn--sm"
              onClick={() => {
                void onResetProgress();
              }}
            >
              清空本库进度
            </button>
          </div>
        </div>

        <div className="qi-stats-grid">
          <div className="qi-card">
            <span style={{ fontSize: '12px', color: 'var(--sub)' }}>已练题数</span>
            <strong data-testid="qi-stat-done">{homeStats.practicedCount}</strong>
          </div>
          <div className="qi-card">
            <span style={{ fontSize: '12px', color: 'var(--sub)' }}>正确率</span>
            <strong data-testid="qi-stat-acc">
              {homeStats.accuracyPct === null ? '—' : `${homeStats.accuracyPct}%`}
            </strong>
          </div>
          <div className="qi-card">
            <span style={{ fontSize: '12px', color: 'var(--sub)' }}>错题待攻克</span>
            <strong data-testid="qi-stat-wrong">{homeStats.wrongCount}</strong>
          </div>
          <div className="qi-card">
            <span style={{ fontSize: '12px', color: 'var(--sub)' }}>重点收藏</span>
            <strong data-testid="qi-stat-fav">{homeStats.favCount}</strong>
          </div>
        </div>
      </div>

      <div className="qi-card">
        <div className="qi-field">
          <span className="qi-field__label">章节筛选</span>
          <div className="qi-pill-row">
            <button
              type="button"
              data-testid="qi-chapter-chip-all"
              className={`qi-btn qi-btn--sm${effectiveChapters.length === vm.chapters.length ? ' qi-btn--primary' : ''}`}
              onClick={() => setSelectedChapters([...vm.allChapterIds])}
            >
              全部 ({vm.chapters.length} 章)
            </button>
            {vm.chapters.map((ch) => {
              const active = effectiveChapters.includes(ch.id);
              return (
                <button
                  key={ch.id}
                  type="button"
                  data-testid={`qi-chapter-chip-${ch.id}`}
                  className={`qi-btn qi-btn--sm${active ? ' qi-btn--primary' : ''}`}
                  onClick={() => handleToggleChapter(ch.id)}
                >
                  第{ch.id}章 {ch.short}
                </button>
              );
            })}
          </div>
        </div>

        <div className={vm.hasMultipleOrigins ? 'qi-grid-two' : 'qi-grid-two'}>
          <label className="qi-field">
            <span className="qi-field__label">关键词过滤</span>
            <input
              type="search"
              data-testid="qi-filter-search"
              className="qi-input"
              placeholder="搜索题干 / 选项 / 解析"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>

          {vm.hasMultipleOrigins && (
            <label className="qi-field">
              <span className="qi-field__label">题目来源</span>
              <select
                data-testid="qi-filter-origin"
                className="qi-select"
                value={originFilter}
                onChange={(e) =>
                  setOriginFilter(e.target.value as 'all' | Question['source']['origin'])
                }
              >
                <option value="all">全部来源 ({vm.counts.total})</option>
                {vm.distinctOrigins.map((orig) => (
                  <option key={orig} value={orig}>
                    {orig} ({vm.counts.byOrigin[orig]})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="qi-field">
            <span className="qi-field__label">单次题量</span>
            <select
              data-testid="qi-filter-count"
              className="qi-select"
              value={String(countOption)}
              onChange={(e) => setCountOption(Number(e.target.value))}
            >
              <option value="10">10 题</option>
              <option value="20">20 题</option>
              <option value="30">30 题</option>
              <option value="0">全部匹配题 ({matchingCounts.all})</option>
            </select>
          </label>

          <label className="qi-field">
            <span className="qi-field__label">出题顺序</span>
            <select
              data-testid="qi-filter-order"
              className="qi-select"
              value={orderOption}
              onChange={(e) => setOrderOption(e.target.value as 'random' | 'seq')}
            >
              <option value="seq">按章节顺序</option>
              <option value="random">随机乱序</option>
            </select>
          </label>
        </div>

        <div className="qi-mode-grid">
          {PRACTICE_MODES.filter((m) => m === 'all' || vm.counts.byType[m] > 0).map((mode) => {
            const count = matchingCounts[mode];
            const stat = computeModeStats(vm.questions, store, mode);
            const title = mode === 'all' ? '总体刷题' : TYPE_NAME[mode];
            return (
              <button
                key={mode}
                type="button"
                data-testid={`qi-mode-${mode}`}
                disabled={count === 0}
                className="qi-btn"
                style={{ justifyContent: 'space-between', padding: '10px 14px' }}
                onClick={() =>
                  startSession(title, {
                    mode,
                    chapters: effectiveChapters,
                    origins:
                      vm.hasMultipleOrigins && originFilter !== 'all'
                        ? [originFilter]
                        : undefined,
                    search: search.trim() || undefined,
                    count: countOption,
                    order: orderOption,
                  })
                }
              >
                <span>
                  {title}{' '}
                  {stat.practicedCount > 0 && stat.accuracyPct !== null
                    ? `（已练 ${stat.practicedCount} · ${stat.accuracyPct}%）`
                    : ''}
                </span>
                <span className="qi-pill qi-pill--brand">{count} 题</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
