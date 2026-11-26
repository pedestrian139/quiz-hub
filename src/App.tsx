import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChapterMeta,
  NoteChapter,
  NoteSection,
  NoteTable,
  NotesAppendix,
  Question,
  QuestionType,
  UserRecord,
  UserStore,
} from './types/quiz';
import {
  formatAnswerText,
  getOptionLabel,
  getOriginLabel,
  isObjectiveQuestion,
} from './core/questionUtils';
import {
  buildQueue,
  clearWrongRecords,
  computeHomeStats,
  getFavoriteQuestions,
  getWrongQuestions,
  recordObjectiveAnswer,
  recordSubjectiveMastery,
  toggleFavorite,
} from './core/quizEngine';
import { NOTES, SECTION_COUNT, TYPE_NAME } from './data/catalog';
import { useBankLibraryContext } from './utils/BankLibraryContext';
import { TopNav } from './components/TopNav';
import { QuizImportPortal } from './components/QuizImport';
import { UserMenu } from './components/Auth';
import { Icon } from './components/Icons';
import { RichContent } from './components/RichContent';
import { useHashRoute, type Route } from './router/useHashRoute';
import { HubPage } from './pages/HubPage';
import { QuizHome } from './pages/QuizHome';
import { QuizSession } from './pages/QuizSession';
import {
  safeAlert,
  safeConfirm,
  type FilterState,
  type QuizActions,
  type QuizView,
  type ResultSpec,
  type SessionConfig,
  type ToastTone,
} from './pages/quizTypes';

/* ---------------- Result View ---------------- */

function getTierFeedback(
  accuracyPct: number,
  answeredCount: number,
): {
  badge: string;
  headline: string;
  advice: string;
  tone: 'ok' | 'brand' | 'warn' | 'bad';
} {
  if (answeredCount === 0) {
    return {
      badge: '本组未作答',
      headline: '尚未提交有效作答记录',
      advice: '点击“再来一组”重新开始答题，或返回首页调整章节与题型设置。',
      tone: 'warn',
    };
  }
  if (accuracyPct >= 90) {
    return {
      badge: '卓越掌握',
      headline: '核心考点扎实稳固，发挥非常出色！',
      advice: '建议继续挑战综合分析题或跨章节全集刷题，保持做题手感。',
      tone: 'ok',
    };
  }
  if (accuracyPct >= 75) {
    return {
      badge: '表现良好',
      headline: '主体知识脉络清晰，距高分仅一步之遥！',
      advice: '重点复盘下方薄弱题目，留意易混概念与公式符号细节。',
      tone: 'brand',
    };
  }
  if (accuracyPct >= 60) {
    return {
      badge: '基础初成',
      headline: '已掌握基本框架，部分细节仍需巩固。',
      advice: '建议结合 AI 深度解析梳理薄弱考点，再点击“只练错题”强化记忆。',
      tone: 'warn',
    };
  }
  return {
    badge: '亟待强化',
    headline: '查漏补缺正当时，定位薄弱点就是最大收获！',
    advice: '建议先逐题查看解析与 AI 助教追问，再重做错题直至完全掌握。',
    tone: 'bad',
  };
}

interface ResultViewProps {
  spec: ResultSpec;
  chapterById: ReadonlyMap<number, ChapterMeta>;
  onRetryWrong: (wrongIds: string[]) => void;
  onReviewSingle: (questionId: string) => void;
  onRetryMore: () => void;
  onBackHome: () => void;
}

function ResultView({
  spec,
  chapterById,
  onRetryWrong,
  onReviewSingle,
  onRetryMore,
  onBackHome,
}: ResultViewProps) {
  const { result, queue, config } = spec;
  const tier = getTierFeedback(result.accuracyPct, result.answeredCount);

  const queueMap = useMemo(() => new Map<string, Question>(queue.map((q) => [q.id, q])), [queue]);
  const wrongQuestions: Question[] = useMemo(
    () =>
      result.wrongQuestionIds
        .map((id) => queueMap.get(id))
        .filter((q): q is Question => Boolean(q)),
    [queueMap, result.wrongQuestionIds],
  );

  return (
    <div className="page-wrap page-wrap--result">
      <section className={`result-hero result-hero--${tier.tone}`}>
        <div className="result-hero__eyebrow">
          <span className="pill pill--neutral">{config.title} · 结算报告</span>
          <span className={`pill pill--${tier.tone}`}>{tier.badge}</span>
        </div>

        <div
          className="result-score-ring"
          style={{ ['--pct' as string]: `${result.accuracyPct}` }}
        >
          <div className="result-score-ring__inner">
            <div data-testid="result-score" className="result-score">
              {result.accuracyPct}%
            </div>
            <span className="result-score-ring__sub" aria-hidden="true">
              本组正确率
            </span>
          </div>
        </div>
        <h1 className="result-headline">{tier.headline}</h1>
        <p className="result-advice">{tier.advice}</p>

        <div className="result-metrics">
          <div className="result-metric">
            <span className="result-metric__label">本组总题数</span>
            <strong data-testid="result-total" className="result-metric__value">
              {result.totalCount}
            </strong>
          </div>
          <div className="result-metric">
            <span className="result-metric__label">答对 / 已掌握</span>
            <strong data-testid="result-right" className="result-metric__value is-ok">
              {result.correctCount}
            </strong>
          </div>
          <div className="result-metric">
            <span className="result-metric__label">用时总计</span>
            <strong data-testid="result-time" className="result-metric__value">
              {result.elapsedFormatted}
            </strong>
          </div>
        </div>

        {result.unansweredCount > 0 && (
          <p className="result-subnote">
            注：本组已作答 {result.answeredCount} 题，跳过未答 {result.unansweredCount} 题。
          </p>
        )}

        <div className="result-actions">
          <button
            type="button"
            data-testid="btn-retry-wrong"
            className="btn btn--soft-bad"
            disabled={wrongQuestions.length === 0}
            onClick={() => onRetryWrong(result.wrongQuestionIds)}
          >
            只练错题{wrongQuestions.length > 0 ? ` (${wrongQuestions.length})` : ''}
          </button>
          <button
            type="button"
            data-testid="btn-retry-more"
            className="btn btn--primary"
            onClick={onRetryMore}
          >
            再来一组
          </button>
          <button
            type="button"
            data-testid="btn-result-home"
            className="btn btn--ghost"
            onClick={onBackHome}
          >
            返回首页
          </button>
        </div>
      </section>

      {wrongQuestions.length > 0 && (
        <section className="result-review-section" aria-label="本组错题与待强化题目复盘">
          <div className="section-head">
            <h2 className="section-head__title">本组错题复盘（{wrongQuestions.length} 题）</h2>
            <span className="section-head__hint">点击任意错题卡片即可单独重练该题</span>
          </div>

          <div className="result-review-list">
            {wrongQuestions.map((q, i) => {
              const ch = chapterById.get(q.chapter);
              return (
                <button
                  key={q.id}
                  type="button"
                  data-testid="result-review-item"
                  className="review-item-btn"
                  onClick={() => onReviewSingle(q.id)}
                >
                  <div className="review-item-btn__top">
                    <div className="review-item-btn__tags">
                      <span className="pill pill--bad">错题 #{i + 1}</span>
                      <span className="pill pill--neutral">
                        第 {q.chapter} 章{ch ? ` · ${ch.short}` : ''}
                      </span>
                      <span className={`pill pill--type pill--type-${q.type}`}>
                        {TYPE_NAME[q.type]}
                      </span>
                    </div>
                    <span className="review-item-btn__cta">
                      单题重练 <Icon name="arrowRight" size={14} />
                    </span>
                  </div>
                  <div className="review-item-btn__stem">
                    <RichContent inline content={q.stem} />
                  </div>
                  <div className="review-item-btn__ans">
                    参考答案：<RichContent inline content={formatAnswerText(q)} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------- Wrong Book & Favorites View ---------------- */

interface QuestionListViewProps {
  kind: 'wrong' | 'fav';
  bankName: string;
  questions: Question[];
  chapterById: ReadonlyMap<number, ChapterMeta>;
  store: UserStore;
  onRedoAll: (questionIds: string[]) => void;
  onClearWrong: () => void;
  onToggleFav: (questionId: string) => boolean;
  onGoQuizHome: () => void;
}

const MASTERY_LABELS: Record<0 | 1 | 2, string> = {
  0: '自评：不会',
  1: '自评：有点模糊',
  2: '自评：完全会',
};

function QuestionListView({
  kind,
  bankName,
  questions,
  chapterById,
  store,
  onRedoAll,
  onClearWrong,
  onToggleFav,
  onGoQuizHome,
}: QuestionListViewProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const items = useMemo(
    () =>
      kind === 'wrong'
        ? getWrongQuestions(questions, store)
        : getFavoriteQuestions(questions, store),
    [kind, questions, store],
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleClear = () => {
    if (safeConfirm('确定要清空当前题库错题本中的所有错题记录吗？（收藏夹不受影响）')) {
      onClearWrong();
    }
  };

  const isWrongBook = kind === 'wrong';

  return (
    <div className="page-wrap">
      <section className="list-header-card">
        <div>
          <div className="hero-eyebrow">
            <span className={`pill ${isWrongBook ? 'pill--bad' : 'pill--warn'}`}>
              <Icon name={isWrongBook ? 'bookX' : 'star'} size={13} />
              {isWrongBook ? '错题攻克清单' : '重点题目收藏'}
            </span>
            <span className="pill pill--subtle">
              {bankName} · 按章节升序排列 · 共 {items.length} 题
            </span>
          </div>
          <h1 className="hero-title">{isWrongBook ? '错题本' : '收藏夹'}</h1>
          <p className="hero-subtitle">
            {isWrongBook
              ? '自动收录答错的客观题与自评“有点模糊 / 不会”的主观题；重做答对或自评“完全会”后自动移出。'
              : '集中保存你在刷题时标记星号的重点题与高频简答题，便于考前快速串联复盘。'}
          </p>
        </div>

        {items.length > 0 && (
          <div className="list-header-card__actions">
            <button
              type="button"
              data-testid="list-redo-all"
              className="btn btn--primary"
              onClick={() => onRedoAll(items.map((q) => q.id))}
            >
              重做全部 ({items.length})
            </button>
            {isWrongBook && (
              <button
                type="button"
                data-testid="list-clear-wrong"
                className="btn btn--danger-outline"
                onClick={handleClear}
              >
                清空
              </button>
            )}
          </div>
        )}
      </section>

      {items.length === 0 ? (
        <div data-testid="list-empty" className="empty-card">
          <div className="empty-card__badge" aria-hidden="true">
            <Icon name={isWrongBook ? 'circleCheck' : 'star'} size={28} />
          </div>
          <h2 className="empty-card__title">
            {isWrongBook ? '当前没有待攻克的错题' : '收藏夹暂时为空'}
          </h2>
          <p className="empty-card__desc">
            {isWrongBook
              ? '保持出色状态！前往刷题工具继续练习，遇到薄弱题会自动汇总到这里。'
              : '在刷题页面点击题目右上角的“收藏”按钮，即可将重点考题加入此处。'}
          </p>
          <button type="button" className="btn btn--primary" onClick={onGoQuizHome}>
            前往刷题工具 <Icon name="arrowRight" size={15} />
          </button>
        </div>
      ) : (
        <div className="list-stack">
          {items.map((q, idx) => {
            const ch = chapterById.get(q.chapter);
            const isFav = store.fav[q.id] === true;
            const expanded = Boolean(expandedIds[q.id]);
            const masteryLvl = store.mastery[q.id];
            const explainText =
              (q.explain ?? '').trim() ||
              (q.explanation ?? '').trim() ||
              (q.aiAnalysis ?? '').trim() ||
              (store.aiExplanations?.[q.id]?.content ?? '').trim();

            return (
              <article key={q.id} data-testid="list-item" className="list-item-card">
                <div className="list-item-card__top">
                  <div className="list-item-card__tags">
                    <span className="pill pill--index">#{idx + 1}</span>
                    <span className="pill pill--neutral">
                      第 {q.chapter} 章{ch ? ` · ${ch.short}` : ''}
                    </span>
                    <span className={`pill pill--type pill--type-${q.type}`}>
                      {TYPE_NAME[q.type]}
                    </span>
                    <span className="pill pill--subtle">
                      {getOriginLabel(q.source?.origin ?? 'comprehensive_bank')}
                    </span>
                    {!isObjectiveQuestion(q.type) && masteryLvl !== undefined && (
                      <span className="pill pill--warn">{MASTERY_LABELS[masteryLvl]}</span>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`btn-star${isFav ? ' is-starred' : ''}`}
                    aria-pressed={isFav ? 'true' : 'false'}
                    onClick={() => onToggleFav(q.id)}
                  >
                    <Icon name={isFav ? 'starFill' : 'star'} size={15} />
                    <span>{isFav ? '已收藏' : '收藏'}</span>
                  </button>
                </div>

                <div className="list-item-card__stem">
                  <RichContent content={q.stem} />
                </div>

                {(q.type === 'choice' || q.type === 'multi') && q.options && (
                  <ul className="list-item-card__options">
                    {q.options.map((opt, oIdx) => (
                      <li key={oIdx}>
                        {getOptionLabel(oIdx)}. <RichContent inline content={opt} />
                      </li>
                    ))}
                  </ul>
                )}

                <div>
                  <button
                    type="button"
                    data-testid="list-item-toggle"
                    aria-expanded={expanded}
                    className="btn btn--ghost btn--sm"
                    onClick={() => toggleExpand(q.id)}
                  >
                    {expanded ? '收起答案与解析 ▲' : '查看答案与解析 ▼'}
                  </button>
                </div>

                {expanded && (
                  <div data-testid="list-item-answer" className="list-item-answer">
                    <div>
                      <strong>参考答案：</strong>
                      <RichContent inline content={formatAnswerText(q)} />
                    </div>
                    {Array.isArray(q.keyPoints) && q.keyPoints.length > 0 && (
                      <div>
                        <strong>核心采分要点：</strong>
                        <ul className="ref-answer-card__kp">
                          {q.keyPoints.map((kp, kpIdx) => (
                            <li key={kpIdx}>
                              <RichContent inline content={kp} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {explainText && (
                      <div>
                        <strong>解析：</strong>
                        <RichContent content={explainText} />
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Knowledge Handbook (#/notes) ---------------- */

function tableMatches(table: NoteTable, q: string): boolean {
  if (table.caption && table.caption.toLowerCase().includes(q)) return true;
  if (table.headers.some((h) => h.toLowerCase().includes(q))) return true;
  return table.rows.some((row) => row.some((cell) => cell.toLowerCase().includes(q)));
}

function sectionMatches(sec: NoteSection, q: string): boolean {
  if (sec.id.toLowerCase().includes(q)) return true;
  if (sec.title.toLowerCase().includes(q)) return true;
  if (sec.summary.toLowerCase().includes(q)) return true;
  if (sec.callout && sec.callout.toLowerCase().includes(q)) return true;
  if (sec.keyPoints.some((kp) => kp.toLowerCase().includes(q))) return true;
  if (
    sec.terms &&
    sec.terms.some(
      (t) => t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q),
    )
  ) {
    return true;
  }
  if (sec.tables && sec.tables.some((tb) => tableMatches(tb, q))) return true;
  return false;
}

function appendixMatches(app: NotesAppendix, q: string): boolean {
  if (app.title.toLowerCase().includes(q)) return true;
  if (app.tables && app.tables.some((tb) => tableMatches(tb, q))) return true;
  if (
    app.items &&
    app.items.some(
      (it) => it.title.toLowerCase().includes(q) || it.content.toLowerCase().includes(q),
    )
  ) {
    return true;
  }
  return false;
}

function HandbookTable({ table }: { table: NoteTable }) {
  return (
    <div data-testid="notes-table-wrap" className="notes-table-wrap">
      <table className="notes-table">
        {table.caption && <caption>{table.caption}</caption>}
        <thead>
          <tr>
            {table.headers.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rIdx) => (
            <tr key={rIdx}>
              {row.map((cell, cIdx) => (
                <td key={cIdx}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface NotesViewProps {
  onPracticeChapter: (chapterId: number) => void;
}

function NotesView({ onPracticeChapter }: NotesViewProps) {
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim().toLowerCase();

  const filteredChapters = useMemo<NoteChapter[]>(() => {
    if (!trimmedQuery) return NOTES.chapters;
    const out: NoteChapter[] = [];
    for (const ch of NOTES.chapters) {
      const chHeaderHit =
        ch.title.toLowerCase().includes(trimmedQuery) ||
        ch.short.toLowerCase().includes(trimmedQuery) ||
        ch.overview.toLowerCase().includes(trimmedQuery);
      if (chHeaderHit) {
        out.push(ch);
      } else {
        const matchedSections = ch.sections.filter((s) => sectionMatches(s, trimmedQuery));
        if (matchedSections.length > 0) {
          out.push({ ...ch, sections: matchedSections });
        }
      }
    }
    return out;
  }, [trimmedQuery]);

  const filteredAppendices = useMemo<NotesAppendix[]>(() => {
    if (!trimmedQuery) return NOTES.appendices;
    return NOTES.appendices
      .filter((app) => appendixMatches(app, trimmedQuery))
      .map((app) => {
        if (!app.items) return app;
        const matchedItems = app.items.filter(
          (it) =>
            app.title.toLowerCase().includes(trimmedQuery) ||
            it.title.toLowerCase().includes(trimmedQuery) ||
            it.content.toLowerCase().includes(trimmedQuery),
        );
        return matchedItems.length > 0 ? { ...app, items: matchedItems } : app;
      });
  }, [trimmedQuery]);

  const showOverview = useMemo(() => {
    if (!trimmedQuery) return true;
    return (
      NOTES.overview.title.toLowerCase().includes(trimmedQuery) ||
      NOTES.overview.bullets.some((b) => b.toLowerCase().includes(trimmedQuery)) ||
      NOTES.overview.examTips.some((t) => t.toLowerCase().includes(trimmedQuery))
    );
  }, [trimmedQuery]);

  const jumpTo = (targetId: string) => {
    const scrollNow = () => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    };
    if (trimmedQuery) {
      setQuery('');
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(scrollNow);
      });
    } else {
      scrollNow();
    }
  };

  const noMatches =
    trimmedQuery.length > 0 &&
    !showOverview &&
    filteredChapters.length === 0 &&
    filteredAppendices.length === 0;

  return (
    <div className="page-wrap page-wrap--notes">
      <section className="hero-card hero-card--notes">
        <div className="hero-eyebrow">
          <span className="pill pill--brand">
            <Icon name="book" size={13} />
            QuizHub 知识体系精编
          </span>
          <span className="pill pill--neutral">
            {NOTES.chapters.length} 章 · {SECTION_COUNT} 节 · {NOTES.appendices.length} 项速查指南
          </span>
          <span className="pill pill--subtle">
            <Icon name="fileText" size={13} />
            支持浏览器直接打印导出 PDF
          </span>
        </div>
        <h1 className="hero-title">{NOTES.meta.title}</h1>
        <p className="hero-subtitle">
          QuizHub（acequiz.xyz）官方使用指南与功能速查，涵盖沉浸式工作台快捷键、AI 智能洗题分段校对流程与多轮追问技巧。
        </p>

        <div className="notes-toolbar">
          <input
            type="search"
            data-testid="notes-search"
            aria-label="搜索知识点"
            placeholder="搜索使用指南、快捷键、AI 洗题、公式排版或云同步..."
            className="notes-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setQuery('')}
            >
              清空搜索
            </button>
          )}
        </div>
      </section>

      <div className="notes-layout">
        <aside data-testid="notes-toc" className="notes-toc" aria-label="知识点目录导航">
          <p className="notes-toc__title">章节与附录速跳</p>
          <div className="notes-toc__list">
            <button
              type="button"
              className="toc-btn"
              onClick={() => jumpTo('notes-overview')}
            >
              复习总纲
            </button>
            {NOTES.chapters.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className="toc-btn"
                onClick={() => jumpTo(`notes-chapter-${ch.id}`)}
              >
                第 {ch.id} 章 {ch.short}
              </button>
            ))}
            {NOTES.appendices.map((app) => (
              <button
                key={app.id}
                type="button"
                className="toc-btn toc-btn--app"
                onClick={() => jumpTo(app.id)}
              >
                {app.title}
              </button>
            ))}
          </div>
        </aside>

        <div className="notes-content">
          {showOverview && (
            <section id="notes-overview" className="notes-overview-card">
              <div className="hero-eyebrow">
                <span className="pill pill--brand">平台总览</span>
              </div>
              <h2 className="notes-chapter__title" style={{ marginBottom: '12px' }}>
                {NOTES.overview.title}
              </h2>
              <ul className="notes-kp-list">
                {NOTES.overview.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              <div className="notes-callout" style={{ marginTop: '14px' }}>
                <strong className="notes-callout__lead">
                  <Icon name="target" size={15} />
                  高效使用建议：
                </strong>
                <ul className="notes-kp-list" style={{ marginTop: '6px' }}>
                  {NOTES.overview.examTips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {noMatches && (
            <div className="empty-card">
              <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--ink)' }}>
                未找到与“{query}”匹配的知识点
              </h2>
              <p style={{ margin: 0 }}>
                请尝试缩短关键词（例如搜索“洗题”“快捷键”“KaTeX”或“云同步”）。
              </p>
              <button type="button" className="btn btn--ghost" onClick={() => setQuery('')}>
                恢复显示全部章节
              </button>
            </div>
          )}

          {filteredChapters.map((ch) => (
            <section
              key={ch.id}
              id={`notes-chapter-${ch.id}`}
              data-testid={`notes-chapter-${ch.id}`}
              className="notes-chapter"
            >
              <div className="notes-chapter__head">
                <div className="notes-chapter__title-wrap">
                  <span className="pill pill--brand">第 {ch.id} 章</span>
                  <h2 className="notes-chapter__title">{ch.title}</h2>
                </div>
                <button
                  type="button"
                  data-testid={`btn-quiz-chapter-${ch.id}`}
                  className="btn btn--soft-brand btn--sm btn-quiz-chapter"
                  onClick={() => onPracticeChapter(ch.id)}
                >
                  刷本章题 <Icon name="arrowRight" size={14} />
                </button>
              </div>

              <p className="notes-chapter__overview">{ch.overview}</p>

              <div className="notes-sections">
                {ch.sections.map((sec) => (
                  <article key={sec.id} id={sec.id} className="notes-section">
                    <div className="notes-section__head">
                      <span className="notes-section__id">{sec.id}</span>
                      <h3 className="notes-section__title">{sec.title}</h3>
                    </div>

                    <p className="notes-section__summary">{sec.summary}</p>

                    <ul className="notes-kp-list">
                      {sec.keyPoints.map((kp, i) => (
                        <li key={i} className={kp.trimStart().startsWith('↳') ? 'is-sub' : undefined}>
                          {kp}
                        </li>
                      ))}
                    </ul>

                    {sec.terms && sec.terms.length > 0 && (
                      <div className="notes-terms">
                        {sec.terms.map((t, i) => (
                          <div key={i} className="notes-term-item">
                            <strong>{t.term}：</strong>
                            {t.definition}
                          </div>
                        ))}
                      </div>
                    )}

                    {sec.tables &&
                      sec.tables.map((tb, tIdx) => <HandbookTable key={tIdx} table={tb} />)}

                    {sec.callout && (
                      <blockquote className="notes-callout">
                        <strong className="notes-callout__lead">
                          <Icon name="sparkles" size={15} />
                          使用提示：
                        </strong>
                        {sec.callout}
                      </blockquote>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}

          {filteredAppendices.map((app) => (
            <section key={app.id} id={app.id} className="notes-appendix">
              <div className="notes-chapter__head">
                <div className="notes-chapter__title-wrap">
                  <span className="pill pill--teal">附录</span>
                  <h2 className="notes-chapter__title">{app.title}</h2>
                </div>
              </div>

              {app.tables && (
                <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {app.tables.map((tb, tIdx) => (
                    <HandbookTable key={tIdx} table={tb} />
                  ))}
                </div>
              )}

              {app.items && app.items.length > 0 && (
                <div className="appendix-items">
                  {app.items.map((item, idx) => (
                    <div key={idx} className="appendix-item-card">
                      <div className="appendix-item-card__title">{item.title}</div>
                      <div className="appendix-item-card__body">{item.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Root Application ---------------- */

export default function App() {
  const library = useBankLibraryContext();
  const viewModel = library.activeViewModel;
  const activeStoreApi = library.storeApiFor(library.activeBankId);
  const { questions, chapterById, allChapterIds } = viewModel;

  const [filters, setFilters] = useState<FilterState>(() => ({
    chapters: [...allChapterIds],
    origin: 'all',
    count: 20,
    order: 'random',
    search: '',
  }));
  const [quizView, setQuizView] = useState<QuizView>({ type: 'home' });
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);

  const sessionSeqRef = useRef(1);
  const toastTimerRef = useRef<number | null>(null);
  const preserveQuizViewRef = useRef(false);
  const prevBankIdRef = useRef<string>(library.activeBankId);
  const migrationToastShownRef = useRef(false);

  const questionsById = useMemo(
    () => new Map<string, Question>(questions.map((item) => [item.id, item])),
    [questions],
  );

  // Sync filters & reset active session when active bank changes
  useEffect(() => {
    if (prevBankIdRef.current !== library.activeBankId) {
      prevBankIdRef.current = library.activeBankId;
      setFilters((prev) => ({
        ...prev,
        chapters: [...allChapterIds],
        origin: 'all',
        search: '',
      }));
      setQuizView({ type: 'home' });
      return;
    }

    setFilters((prev) => {
      const validSet = new Set(allChapterIds);
      const validSelected = prev.chapters.filter((id) => validSet.has(id));
      if (validSelected.length > 0 && validSelected.length === prev.chapters.length) {
        return prev;
      }
      const nextChapters = validSelected.length > 0 ? validSelected : [...allChapterIds];
      return {
        ...prev,
        chapters: nextChapters,
      };
    });
  }, [allChapterIds, library.activeBankId]);

  const handleRouteChanged = useCallback((next: Route) => {
    if (preserveQuizViewRef.current && next === 'quiz') {
      preserveQuizViewRef.current = false;
      return;
    }
    preserveQuizViewRef.current = false;
    if (
      next !== 'quiz' ||
      (typeof window !== 'undefined' &&
        (window.location.hash === '#/quiz' || window.location.hash === '#/quiz/'))
    ) {
      setQuizView({ type: 'home' });
    }
  }, []);

  const { route, navigate } = useHashRoute(handleRouteChanged);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3600);
  }, []);

  useEffect(() => {
    if (library.migratedFromV1 && !migrationToastShownRef.current) {
      migrationToastShownRef.current = true;
      notify('已自动无损迁移 V1 本地刷题进度至多题库存储（quizhub-v2）', 'success');
    }
  }, [library.migratedFromV1, notify]);

  const homeStats = useMemo(
    () => computeHomeStats(questions, activeStoreApi.store),
    [activeStoreApi.store, questions],
  );

  const quizActions = useMemo<QuizActions>(
    () => ({
      answerObjective(q, choice) {
        let savedRecord: UserRecord = { ok: 0, ts: Date.now() };
        let correctFlag = false;
        activeStoreApi.update((prev) => {
          const res = recordObjectiveAnswer(prev, q, choice);
          savedRecord = res.record;
          correctFlag = res.isCorrect;
          return res.store;
        });
        return { record: savedRecord, isCorrect: correctFlag };
      },
      rateSubjective(questionId, level) {
        const ts = Date.now();
        activeStoreApi.update((prev) => recordSubjectiveMastery(prev, questionId, level, ts));
        return { ok: level === 2 ? 1 : 0, ts };
      },
      toggleFav(questionId) {
        let nowFav = false;
        activeStoreApi.update((prev) => {
          const next = toggleFavorite(prev, questionId);
          nowFav = next.fav[questionId] === true;
          return next;
        });
        return nowFav;
      },
    }),
    [activeStoreApi],
  );

  const startSessionWithConfig = useCallback(
    (config: SessionConfig) => {
      const queue = buildQueue(questions, config.opts);
      if (queue.length === 0) {
        const msg = '当前筛选条件下暂无匹配题目，请调整章节或来源设置。';
        notify(msg, 'info');
        safeAlert(msg);
        return;
      }
      const nextId = sessionSeqRef.current++;
      setQuizView({
        type: 'session',
        spec: {
          id: nextId,
          config: {
            ...config,
            bankId: library.activeBankId,
            bankName: library.activeBank.name,
          },
          queue,
        },
      });
      if (route !== 'quiz') {
        preserveQuizViewRef.current = true;
        navigate('quiz');
      }
      window.scrollTo(0, 0);
    },
    [library.activeBank.name, library.activeBankId, navigate, notify, questions, route],
  );

  const handleStartMode = useCallback(
    (mode: 'all' | QuestionType) => {
      const title = mode === 'all' ? '总体刷题' : TYPE_NAME[mode];
      const search = filters.search.trim() || undefined;
      startSessionWithConfig({
        kind: 'mode',
        title,
        opts: {
          mode,
          chapters: filters.chapters,
          origins: filters.origin === 'all' ? undefined : [filters.origin],
          search,
          count: filters.count,
          order: filters.order,
        },
      });
    },
    [filters, startSessionWithConfig],
  );

  const handleNavClick = useCallback(
    (target: Route) => {
      preserveQuizViewRef.current = false;
      if (target === 'quiz') {
        setQuizView({ type: 'home' });
      }
    },
    [],
  );

  const handlePracticeChapter = useCallback(
    (chapterId: number) => {
      preserveQuizViewRef.current = false;
      const validChapter = allChapterIds.includes(chapterId)
        ? [chapterId]
        : [...allChapterIds];
      setFilters((prev) => ({
        ...prev,
        chapters: validChapter,
        origin: 'all',
        search: '',
      }));
      setQuizView({ type: 'home' });
      navigate('quiz');
      window.scrollTo(0, 0);
    },
    [allChapterIds, navigate],
  );

  const handleSwitchBank = useCallback(
    (bankId: string) => {
      void library.switchBank(bankId);
    },
    [library],
  );

  return (
    <div className="app-shell">
      <div className="site-masthead">
        <TopNav
          route={route}
          wrongCount={homeStats.wrongCount}
          favCount={homeStats.favCount}
          onNavClick={handleNavClick}
        />
        <UserMenu />
      </div>
      <QuizImportPortal />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`toast-banner${toast.tone === 'success' ? ' toast-banner--success' : toast.tone === 'error' ? ' toast-banner--error' : ''}`}
        >
          <span>{toast.message}</span>
        </div>
      )}

      <main className="app-main" aria-busy={!library.ready}>
        {!library.ready && <p className="page-wrap" role="status">正在读取题库…</p>}
        {library.ready && route === 'hub' && (
          <HubPage
            viewModel={viewModel}
            banks={library.switchableBanks}
            activeBankId={library.activeBankId}
            stats={homeStats}
            store={activeStoreApi.store}
            onPracticeChapter={handlePracticeChapter}
            onSwitchBank={handleSwitchBank}
            onOpenImport={library.openImportModal}
          />
        )}

        {library.ready && route === 'quiz' && quizView.type === 'home' && (
          <QuizHome
            viewModel={viewModel}
            banks={library.switchableBanks}
            activeBankId={library.activeBankId}
            store={activeStoreApi.store}
            stats={homeStats}
            filters={filters}
            onChangeFilters={setFilters}
            onSwitchBank={handleSwitchBank}
            onOpenImport={library.openImportModal}
            onStartMode={handleStartMode}
            onNavigate={navigate}
            onImportStore={(next) => activeStoreApi.commit(next)}
            onResetStore={() => activeStoreApi.wipe()}
            notify={notify}
          />
        )}

        {library.ready && route === 'quiz' && quizView.type === 'session' && (
          <QuizSession
            key={quizView.spec.id}
            spec={quizView.spec}
            bankId={library.activeBankId}
            bankName={library.activeBank.name}
            chapterById={chapterById}
            questionsById={questionsById}
            store={activeStoreApi.store}
            actions={quizActions}
            onSaveAiAnalysis={(qId, content, model) =>
              library.saveQuestionAiAnalysis(library.activeBankId, qId, content, model)
            }
            onExit={() => {
              setQuizView({ type: 'home' });
              try {
                const { pathname, search } = window.location;
                window.history.replaceState(window.history.state, '', `${pathname}${search}#/quiz`);
              } catch {
                // ignore
              }
              window.scrollTo(0, 0);
            }}
            onFinish={(resultSpec) => {
              setQuizView({ type: 'result', spec: resultSpec });
              try {
                const { pathname, search } = window.location;
                window.history.replaceState(
                  window.history.state,
                  '',
                  `${pathname}${search}#/quiz/result`,
                );
              } catch {
                // ignore
              }
              window.scrollTo(0, 0);
            }}
          />
        )}

        {library.ready && route === 'quiz' && quizView.type === 'result' && (
          <ResultView
            spec={quizView.spec}
            chapterById={chapterById}
            onRetryWrong={(wrongIds) => {
              if (wrongIds.length === 0) return;
              startSessionWithConfig({
                kind: 'retry',
                title: '错题重练',
                opts: {
                  mode: 'all',
                  chapters: allChapterIds,
                  onlyIds: wrongIds,
                  count: 0,
                  order: 'seq',
                },
              });
            }}
            onReviewSingle={(qId) => {
              startSessionWithConfig({
                kind: 'review',
                title: '错题重练',
                opts: {
                  mode: 'all',
                  chapters: allChapterIds,
                  onlyIds: [qId],
                  count: 0,
                  order: 'seq',
                },
              });
            }}
            onRetryMore={() => startSessionWithConfig(quizView.spec.config)}
            onBackHome={() => {
              setQuizView({ type: 'home' });
              try {
                const { pathname, search } = window.location;
                window.history.replaceState(window.history.state, '', `${pathname}${search}#/quiz`);
              } catch {
                // ignore
              }
              window.scrollTo(0, 0);
            }}
          />
        )}

        {library.ready && (route === 'wrong' || route === 'fav') && (
          <QuestionListView
            kind={route}
            bankName={library.activeBank.name}
            questions={questions}
            chapterById={chapterById}
            store={activeStoreApi.store}
            onRedoAll={(ids) => {
              startSessionWithConfig({
                kind: route === 'wrong' ? 'wrong' : 'fav',
                title: route === 'wrong' ? '错题重练' : '收藏重练',
                opts: {
                  mode: 'all',
                  chapters: allChapterIds,
                  onlyIds: ids,
                  count: 0,
                  order: 'seq',
                },
              });
            }}
            onClearWrong={() => {
              activeStoreApi.update(clearWrongRecords);
              notify('已清空当前题库错题记录，收藏夹保持不变', 'info');
            }}
            onToggleFav={(id) => quizActions.toggleFav(id)}
            onGoQuizHome={() => {
              setQuizView({ type: 'home' });
              navigate('quiz');
            }}
          />
        )}

        {route === 'notes' && <NotesView onPracticeChapter={handlePracticeChapter} />}
      </main>

      <footer className="site-footer">
        QuizHub · AI 智能刷题与题库管理平台（acequiz.xyz）· 支持本地离线与云端同步
      </footer>
    </div>
  );
}
