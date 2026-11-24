import { useMemo, useRef, type ChangeEvent } from 'react';
import type { HomeStats, QuestionOrigin, QuestionType, UserStore } from '../types/quiz';
import { buildQueue, computeModeStats } from '../core/quizEngine';
import { exportStoreJson, importStoreJson } from '../core/storage';
import {
  ALL_CHAPTER_IDS,
  CHAPTERS,
  COUNTS,
  QUESTIONS,
} from '../data/catalog';
import type { Route } from '../router/useHashRoute';
import type { CountOption, FilterState, Notify } from './quizTypes';
import { safeAlert, safeConfirm } from './quizTypes';

interface ModeCardDef {
  mode: 'all' | QuestionType;
  title: string;
  subtitle: string;
  badgeTone: string;
  icon: string;
  wide?: boolean;
}

const MODE_CARDS: ModeCardDef[] = [
  {
    mode: 'all',
    title: '总体刷题',
    subtitle: '混合单选、多选、判断、简答与综合分析，模拟真实考卷结构全面演练',
    badgeTone: 'brand',
    icon: '🎯',
    wide: true,
  },
  {
    mode: 'choice',
    title: '单选题',
    subtitle: '四选一概念与方法辨析，点击或按数字键即时判分',
    badgeTone: 'brand',
    icon: '🔘',
  },
  {
    mode: 'multi',
    title: '多选题',
    subtitle: '多维度特征与要素组合判断，少选、多选或错选均判错',
    badgeTone: 'teal',
    icon: '☑️',
  },
  {
    mode: 'tf',
    title: '判断题',
    subtitle: '高频易混命题正误速判，精准扫除概念盲区',
    badgeTone: 'ok',
    icon: '⚖️',
  },
  {
    mode: 'short',
    title: '简答题',
    subtitle: '对照标准参考答案与采分要点，三级掌握度自我评估',
    badgeTone: 'warn',
    icon: '📝',
  },
  {
    mode: 'analysis',
    title: '综合分析题',
    subtitle: '跨章节系统流程设计、模型优劣对比与场景应用深度剖析',
    badgeTone: 'purple',
    icon: '🧠',
  },
];

interface QuizHomeProps {
  store: UserStore;
  stats: HomeStats;
  filters: FilterState;
  onChangeFilters: (next: FilterState) => void;
  onStartMode: (mode: 'all' | QuestionType, matchingCount: number) => void;
  onNavigate: (route: Route) => void;
  onImportStore: (next: UserStore) => void;
  onResetStore: () => void;
  notify: Notify;
}

export function QuizHome({
  store,
  stats,
  filters,
  onChangeFilters,
  onStartMode,
  onNavigate,
  onImportStore,
  onResetStore,
  notify,
}: QuizHomeProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedChapterSet = useMemo(() => new Set(filters.chapters), [filters.chapters]);
  const allChaptersSelected = filters.chapters.length === CHAPTERS.length;

  const matchingCounts = useMemo(() => {
    const origins = filters.origin === 'all' ? undefined : [filters.origin];
    const result: Record<'all' | QuestionType, number> = {
      all: 0,
      choice: 0,
      multi: 0,
      tf: 0,
      short: 0,
      analysis: 0,
    };
    for (const def of MODE_CARDS) {
      result[def.mode] = buildQueue(QUESTIONS, {
        mode: def.mode,
        chapters: filters.chapters,
        origins,
        count: 0,
        order: 'seq',
      }).length;
    }
    return result;
  }, [filters.chapters, filters.origin]);

  const modeStatsMap = useMemo(() => {
    return {
      all: computeModeStats(QUESTIONS, store, 'all'),
      choice: computeModeStats(QUESTIONS, store, 'choice'),
      multi: computeModeStats(QUESTIONS, store, 'multi'),
      tf: computeModeStats(QUESTIONS, store, 'tf'),
      short: computeModeStats(QUESTIONS, store, 'short'),
      analysis: computeModeStats(QUESTIONS, store, 'analysis'),
    };
  }, [store]);

  const handleToggleAllChapters = () => {
    onChangeFilters({
      ...filters,
      chapters: [...ALL_CHAPTER_IDS],
    });
  };

  const handleToggleChapter = (chapterId: number) => {
    const isActive = selectedChapterSet.has(chapterId);
    if (isActive) {
      if (filters.chapters.length <= 1) {
        notify('至少需要保留 1 个刷题章节', 'info');
        return;
      }
      onChangeFilters({
        ...filters,
        chapters: filters.chapters.filter((id) => id !== chapterId),
      });
    } else {
      const nextChapters = [...filters.chapters, chapterId].sort((a, b) => a - b);
      onChangeFilters({
        ...filters,
        chapters: nextChapters,
      });
    }
  };

  const handleModeClick = (mode: 'all' | QuestionType) => {
    const count = matchingCounts[mode];
    if (count <= 0) {
      const msg = '当前章节与题目来源筛选组合下暂无该题型题目，请调整筛选条件。';
      notify(msg, 'info');
      safeAlert(msg);
      return;
    }
    onStartMode(mode, count);
  };

  const handleExport = () => {
    const json = exportStoreJson(store);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai-intro-quiz-backup.json';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('学习进度已导出为 JSON 备份文件', 'success');
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    let rawText = '';
    try {
      rawText = await file.text();
    } catch {
      const msg = '读取备份文件失败，请重试';
      notify(msg, 'error');
      safeAlert(msg);
      return;
    }

    const parsed = importStoreJson(rawText);
    if (!parsed.ok) {
      const msg = `导入失败：${parsed.error}`;
      notify(msg, 'error');
      safeAlert(msg);
      return;
    }

    onImportStore(parsed.store);
    notify('学习进度与收藏记录已成功恢复', 'success');
  };

  const handleReset = () => {
    if (safeConfirm('确定要清空全部做题记录、错题与收藏进度吗？此操作不可恢复。')) {
      onResetStore();
      notify('已清空全部本地做题记录', 'info');
    }
  };

  return (
    <div className="page-wrap page-wrap--quiz">
      <section className="hero-card hero-card--quiz">
        <div className="hero-eyebrow">
          <span data-testid="quiz-badge-total" className="pill pill--primary">
            题库共 {COUNTS.total} 道题
          </span>
          <span className="pill pill--neutral">{CHAPTERS.length} 章全覆盖</span>
          <span className="pill pill--subtle">💾 本地保存进度</span>
        </div>
        <h1 className="hero-title">人工智能导论 · 自助刷题工具</h1>
        <p className="hero-subtitle">
          先在下方按需筛选章节、题目来源与单次题量，再点击任一题型卡片即可开始练习。支持键盘快捷键（1–4 / A–D、T/F、空格看答案、方向键切题）。
        </p>

        <div className="stats-grid" aria-label="做题统计概览">
          <div data-testid="stat-done" className="stat-card">
            <span className="stat-card__label">已练题数</span>
            <strong className="stat-card__value">{stats.practicedCount}</strong>
            <span className="stat-card__hint">总题库 {stats.totalCount} 题</span>
          </div>
          <div data-testid="stat-acc" className="stat-card stat-card--brand">
            <span className="stat-card__label">总正确率</span>
            <strong className="stat-card__value">
              {stats.accuracyPct === null ? '—' : `${stats.accuracyPct}%`}
            </strong>
            <span className="stat-card__hint">
              {stats.practicedCount > 0 ? `答对 ${stats.correctCount} 题` : '答题后自动统计'}
            </span>
          </div>
          <div data-testid="stat-wrong" className="stat-card stat-card--bad">
            <span className="stat-card__label">错题待攻克</span>
            <strong className="stat-card__value">{stats.wrongCount}</strong>
            <span className="stat-card__hint">答对后自动移出</span>
          </div>
          <div data-testid="stat-fav" className="stat-card stat-card--warn">
            <span className="stat-card__label">重点收藏</span>
            <strong className="stat-card__value">{stats.favCount}</strong>
            <span className="stat-card__hint">随时集中复盘</span>
          </div>
        </div>
      </section>

      <section className="mode-section" aria-label="刷题模式选择">
        <div className="section-head">
          <h2 className="section-head__title">选择刷题模式</h2>
          <span className="section-head__hint">
            当前筛选范围：{filters.chapters.length === CHAPTERS.length ? '全部 9 章' : `已选 ${filters.chapters.length} 章`} · 匹配{' '}
            <strong>{matchingCounts.all}</strong> 题
          </span>
        </div>

        <div className="mode-grid">
          {MODE_CARDS.map((card) => {
            const count = matchingCounts[card.mode];
            const mStat = modeStatsMap[card.mode];
            const isEmpty = count === 0;
            return (
              <button
                key={card.mode}
                type="button"
                data-testid={`mode-${card.mode}`}
                className={`mode-card mode-card--${card.badgeTone}${card.wide ? ' mode-card--wide' : ''}${isEmpty ? ' is-empty' : ''}`}
                onClick={() => handleModeClick(card.mode)}
              >
                <div className="mode-card__header">
                  <div className="mode-card__title-group">
                    <span className="mode-card__icon" aria-hidden="true">
                      {card.icon}
                    </span>
                    <span className="mode-card__title">{card.title}</span>
                  </div>
                  <span className={`mode-card__count pill pill--${card.badgeTone}`}>
                    {count} 题
                  </span>
                </div>
                <p className="mode-card__desc">{card.subtitle}</p>
                <div className="mode-card__footer">
                  {mStat.practicedCount > 0 && mStat.accuracyPct !== null ? (
                    <span className="mode-card__acc">
                      已练 {mStat.practicedCount} 题 · 正确率 {mStat.accuracyPct}%
                    </span>
                  ) : (
                    <span className="mode-card__acc mode-card__acc--muted">
                      {isEmpty ? '当前筛选无匹配题目' : '尚未练习 · 点击开始'}
                    </span>
                  )}
                  <span className="mode-card__arrow" aria-hidden="true">
                    开始 →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="filter-panel" aria-label="出题筛选与数据管理">
        <div className="filter-group">
          <div className="filter-group__head">
            <span className="filter-group__label">章节范围（可多选，至少保留 1 章）</span>
            <span className="filter-group__meta">
              已选 {filters.chapters.length} / {CHAPTERS.length} 章
            </span>
          </div>
          <div className="chip-list">
            <button
              type="button"
              data-testid="chapter-chip-all"
              className={`chapter-chip${allChaptersSelected ? ' is-active' : ''}`}
              aria-pressed={allChaptersSelected ? 'true' : 'false'}
              onClick={handleToggleAllChapters}
            >
              全部
            </button>
            {CHAPTERS.map((ch) => {
              const active = selectedChapterSet.has(ch.id);
              return (
                <button
                  key={ch.id}
                  type="button"
                  data-testid={`chapter-chip-${ch.id}`}
                  title={ch.title}
                  className={`chapter-chip${active ? ' is-active' : ''}`}
                  aria-pressed={active ? 'true' : 'false'}
                  onClick={() => handleToggleChapter(ch.id)}
                >
                  第{ch.id}章 {ch.short}
                </button>
              );
            })}
          </div>
        </div>

        <div className="filter-controls-grid">
          <label className="select-field" htmlFor="filter-origin-select">
            <span className="select-field__label">题目来源</span>
            <select
              id="filter-origin-select"
              data-testid="filter-origin"
              className="select-field__control"
              value={filters.origin}
              onChange={(e) =>
                onChangeFilters({
                  ...filters,
                  origin: e.target.value as 'all' | QuestionOrigin,
                })
              }
            >
              <option value="all">全部来源（{COUNTS.total} 题）</option>
              <option value="comprehensive_bank">
                综合题库（{COUNTS.byOrigin.comprehensive_bank} 题）
              </option>
              <option value="video_popup">
                视频课弹题（{COUNTS.byOrigin.video_popup} 题）
              </option>
              <option value="review_notes_synthesized">
                复习资料提炼（{COUNTS.byOrigin.review_notes_synthesized} 题）
              </option>
            </select>
          </label>

          <label className="select-field" htmlFor="filter-count-select">
            <span className="select-field__label">单次题量</span>
            <select
              id="filter-count-select"
              data-testid="filter-count"
              className="select-field__control"
              value={String(filters.count)}
              onChange={(e) =>
                onChangeFilters({
                  ...filters,
                  count: Number(e.target.value) as CountOption,
                })
              }
            >
              <option value="10">10 题 / 组</option>
              <option value="20">20 题 / 组</option>
              <option value="30">30 题 / 组</option>
              <option value="0">全部匹配题目</option>
            </select>
          </label>

          <label className="select-field" htmlFor="filter-order-select">
            <span className="select-field__label">出题顺序</span>
            <select
              id="filter-order-select"
              data-testid="filter-order"
              className="select-field__control"
              value={filters.order}
              onChange={(e) =>
                onChangeFilters({
                  ...filters,
                  order: e.target.value as 'random' | 'seq',
                })
              }
            >
              <option value="random">随机乱序</option>
              <option value="seq">按章节顺序</option>
            </select>
          </label>
        </div>

        <div className="utility-bar">
          <div className="utility-bar__group">
            <button
              type="button"
              data-testid="btn-open-wrong"
              className="btn btn--soft-bad"
              onClick={() => onNavigate('wrong')}
            >
              📕 错题本 ({stats.wrongCount})
            </button>
            <button
              type="button"
              data-testid="btn-open-fav"
              className="btn btn--soft-warn"
              onClick={() => onNavigate('fav')}
            >
              ⭐ 收藏夹 ({stats.favCount})
            </button>
          </div>

          <div className="utility-bar__group">
            <button
              type="button"
              data-testid="btn-export-json"
              className="btn btn--ghost"
              onClick={handleExport}
            >
              ⬇️ 导出进度
            </button>
            <button
              type="button"
              data-testid="btn-import-json"
              className="btn btn--ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              ⬆️ 导入进度
            </button>
            <input
              ref={fileInputRef}
              data-testid="input-import-file"
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              data-testid="btn-reset-store"
              className="btn btn--danger-outline"
              onClick={handleReset}
            >
              🗑️ 清空记录
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
