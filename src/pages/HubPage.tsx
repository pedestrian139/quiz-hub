import { useMemo } from 'react';
import type { HomeStats, UserStore } from '../types/quiz';
import { getOriginLabel } from '../core/questionUtils';
import { computeHomeStats } from '../core/quizEngine';
import {
  CHAPTERS,
  COUNTS,
  NOTES,
  QUESTION_ORIGINS,
  QUESTION_TYPES,
  QUESTIONS,
  SECTION_COUNT,
  TYPE_NAME,
} from '../data/catalog';
import { ROUTE_HASH } from '../router/useHashRoute';
import { Icon } from '../components/Icons';

interface HubPageProps {
  stats: HomeStats;
  store: UserStore;
  onPracticeChapter: (chapterId: number) => void;
}

interface ChapterProgress {
  id: number;
  short: string;
  title: string;
  sectionCount: number;
  total: number;
  practiced: number;
  correct: number;
  accuracyPct: number | null;
  coveragePct: number;
}

function accuracyTone(pct: number | null): 'none' | 'ok' | 'brand' | 'warn' | 'bad' {
  if (pct === null) return 'none';
  if (pct >= 85) return 'ok';
  if (pct >= 70) return 'brand';
  if (pct >= 55) return 'warn';
  return 'bad';
}

export function HubPage({ stats, store, onPracticeChapter }: HubPageProps) {
  const accuracyLabel = stats.accuracyPct === null ? '—' : `${stats.accuracyPct}%`;
  const overallCoverage =
    stats.totalCount > 0 ? Math.round((stats.practicedCount / stats.totalCount) * 100) : 0;

  const chapterProgress = useMemo<ChapterProgress[]>(() => {
    const sectionsById = new Map(NOTES.chapters.map((c) => [c.id, c.sections.length]));
    return CHAPTERS.map((ch) => {
      const scoped = QUESTIONS.filter((q) => q.chapter === ch.id);
      const s = computeHomeStats(scoped, store);
      return {
        id: ch.id,
        short: ch.short,
        title: ch.title,
        sectionCount: sectionsById.get(ch.id) ?? 0,
        total: s.totalCount,
        practiced: s.practicedCount,
        correct: s.correctCount,
        accuracyPct: s.accuracyPct,
        coveragePct: s.totalCount > 0 ? Math.round((s.practicedCount / s.totalCount) * 100) : 0,
      };
    });
  }, [store]);

  return (
    <div className="page-wrap page-wrap--hub">
      <section className="hero-card hero-card--hub">
        <div className="hero-eyebrow">
          <span className="pill pill--brand">
            <Icon name="sparkles" size={13} />
            人工智能导论 · 期末备考门户
          </span>
          <span className="pill pill--subtle">
            <Icon name="shield" size={13} />
            本地保存进度 · 支持离线刷题
          </span>
        </div>

        <h1 className="hero-title">
          人工智能导论 · <span className="hero-title__accent">复习中心</span>
        </h1>
        <p className="hero-subtitle">
          聚合课程综合题库、视频课随堂弹题与期末复习讲义提炼题，配套全书 9 章 {SECTION_COUNT}{' '}
          节结构化知识点手册与高频易混对照表，助你系统梳理脉络、高效查漏补缺。
        </p>

        <div className="badge-row" aria-label="题库概览统计">
          <span data-testid="hub-badge-total" className="pill pill--primary">
            共 {COUNTS.total} 道题
          </span>
          <span data-testid="hub-badge-chapters" className="pill pill--neutral">
            覆盖 {CHAPTERS.length} 章 · {SECTION_COUNT} 小节
          </span>
          {QUESTION_TYPES.map((type) => (
            <span key={type} className={`pill pill--type pill--type-${type}`}>
              {TYPE_NAME[type]} {COUNTS.byType[type]}
            </span>
          ))}
        </div>

        <div className="origin-row" aria-label="题目来源分布">
          {QUESTION_ORIGINS.map((origin) => (
            <span key={origin} className={`origin-chip origin-chip--${origin}`}>
              <span className="origin-chip__dot" aria-hidden="true" />
              {getOriginLabel(origin)}：{COUNTS.byOrigin[origin]} 题
            </span>
          ))}
        </div>
      </section>

      <section className="hub-grid" aria-label="核心模块入口">
        <a
          href={ROUTE_HASH.quiz}
          data-testid="hub-card-quiz"
          className="hub-card hub-card--quiz"
        >
          <div className="hub-card__top">
            <span className="hub-card__icon" aria-hidden="true">
              <Icon name="pen" size={22} />
            </span>
            <span className="pill pill--brand">{COUNTS.total} 题全题型演练</span>
          </div>
          <h2 className="hub-card__title">刷题工具</h2>
          <p className="hub-card__desc">
            支持单选、多选、判断、简答与综合分析五种模式；提供章节多选、来源筛选、关键词检索、答题卡速跳、主观题三级掌握度自评及错题自动归集。
          </p>
          <div className="hub-card__meta">
            <span>
              已练 <strong>{stats.practicedCount}</strong> 题
            </span>
            <span className="hub-card__sep" aria-hidden="true">·</span>
            <span>
              正确率 <strong>{accuracyLabel}</strong>
            </span>
            <span className="hub-card__sep" aria-hidden="true">·</span>
            <span>
              错题 <strong>{stats.wrongCount}</strong>
            </span>
          </div>
          <span className="hub-card__cta">
            进入刷题工具 <Icon name="arrowRight" size={16} />
          </span>
        </a>

        <a
          href={ROUTE_HASH.notes}
          data-testid="hub-card-notes"
          className="hub-card hub-card--notes"
        >
          <div className="hub-card__top">
            <span className="hub-card__icon" aria-hidden="true">
              <Icon name="book" size={22} />
            </span>
            <span className="pill pill--teal">
              {CHAPTERS.length} 章 · {NOTES.appendices.length} 附录
            </span>
          </div>
          <h2 className="hub-card__title">知识点手册</h2>
          <p className="hub-card__desc">
            涵盖 AI 发展史、脑科学双通路、知识图谱与描述逻辑、机器学习、视觉/听觉/NLP 大模型、类脑与机器人全章精要，支持关键词检索与打印。
          </p>
          <div className="hub-card__meta">
            <span>
              <strong>{SECTION_COUNT}</strong> 核心小节
            </span>
            <span className="hub-card__sep" aria-hidden="true">·</span>
            <span>时间线/易混表/答题模板</span>
          </div>
          <span className="hub-card__cta">
            查阅知识点手册 <Icon name="arrowRight" size={16} />
          </span>
        </a>
      </section>

      <section className="chapter-preview-card" aria-label="分章掌握进度">
        <div className="section-head">
          <div className="section-head__main">
            <h2 className="section-head__title">全书 9 章知识版图</h2>
            <span className="section-head__hint">
              所有做题记录与收藏均自动保存在本地浏览器（localStorage）
            </span>
          </div>
          <div className="mastery-summary" aria-label="总体练习覆盖率">
            <span
              className="mastery-summary__ring"
              style={{ ['--pct' as string]: `${overallCoverage}` }}
              aria-hidden="true"
            >
              <span className="mastery-summary__ring-inner">{overallCoverage}%</span>
            </span>
            <span className="mastery-summary__text">
              <strong>
                已覆盖 {stats.practicedCount} / {stats.totalCount}
              </strong>
              <span>总正确率 {accuracyLabel}</span>
            </span>
          </div>
        </div>

        <div className="chapter-preview-grid">
          {chapterProgress.map((ch) => {
            const tone = accuracyTone(ch.accuracyPct);
            return (
              <button
                key={ch.id}
                type="button"
                data-testid={`hub-chapter-${ch.id}`}
                className="chapter-mini-item"
                title={`${ch.title}：点击进入本章刷题`}
                aria-label={`第 ${ch.id} 章 ${ch.short}，已练 ${ch.practiced} / ${ch.total} 题${
                  ch.accuracyPct === null ? '' : `，正确率 ${ch.accuracyPct}%`
                }，点击开始本章练习`}
                onClick={() => onPracticeChapter(ch.id)}
              >
                <span className="chapter-mini-item__row">
                  <span className="chapter-mini-item__num">Ch.{ch.id}</span>
                  <span className="chapter-mini-item__body">
                    <span className="chapter-mini-item__title">{ch.short}</span>
                    <span className="chapter-mini-item__sub">
                      {ch.sectionCount} 个核心考点小节 · {ch.total} 题
                    </span>
                  </span>
                  <span className={`acc-badge acc-badge--${tone}`}>
                    {ch.accuracyPct === null ? '未练' : `${ch.accuracyPct}%`}
                  </span>
                </span>
                <span className="chapter-mini-item__progress" aria-hidden="true">
                  <span
                    className="chapter-mini-item__bar"
                    style={{ width: `${ch.coveragePct}%` }}
                  />
                </span>
                <span className="chapter-mini-item__foot">
                  <span>
                    已练 {ch.practiced} / {ch.total}
                  </span>
                  <span className="chapter-mini-item__go">
                    去刷题 <Icon name="chevronRight" size={14} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
