import type { HomeStats } from '../types/quiz';
import { getOriginLabel } from '../core/questionUtils';
import {
  CHAPTERS,
  COUNTS,
  NOTES,
  QUESTION_ORIGINS,
  QUESTION_TYPES,
  SECTION_COUNT,
  TYPE_NAME,
} from '../data/catalog';
import { ROUTE_HASH } from '../router/useHashRoute';

interface HubPageProps {
  stats: HomeStats;
}

export function HubPage({ stats }: HubPageProps) {
  const accuracyLabel = stats.accuracyPct === null ? '—' : `${stats.accuracyPct}%`;

  return (
    <div className="page-wrap page-wrap--hub">
      <section className="hero-card hero-card--hub">
        <div className="hero-eyebrow">
          <span className="pill pill--brand">人工智能导论 · 期末备考门户</span>
          <span className="pill pill--subtle">💾 本地保存进度 · 支持离线刷题</span>
        </div>

        <h1 className="hero-title">人工智能导论 · 复习中心</h1>
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
            <span key={origin} className="origin-chip">
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
              ✍️
            </span>
            <span className="pill pill--brand">{COUNTS.total} 题全题型演练</span>
          </div>
          <h2 className="hub-card__title">刷题工具</h2>
          <p className="hub-card__desc">
            支持单选、多选、判断、简答与综合分析五种模式；提供章节多选、来源筛选、答题卡速跳、主观题三级掌握度自评及错题自动归集。
          </p>
          <div className="hub-card__meta">
            <span>
              已练 <strong>{stats.practicedCount}</strong> 题
            </span>
            <span>·</span>
            <span>
              正确率 <strong>{accuracyLabel}</strong>
            </span>
            <span>·</span>
            <span>
              错题 <strong>{stats.wrongCount}</strong>
            </span>
          </div>
          <span className="hub-card__cta">进入刷题工具 →</span>
        </a>

        <a
          href={ROUTE_HASH.notes}
          data-testid="hub-card-notes"
          className="hub-card hub-card--notes"
        >
          <div className="hub-card__top">
            <span className="hub-card__icon" aria-hidden="true">
              📘
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
            <span>·</span>
            <span>时间线/易混表/答题模板</span>
          </div>
          <span className="hub-card__cta">查阅知识点手册 →</span>
        </a>
      </section>

      <section className="chapter-preview-card">
        <div className="section-head">
          <h2 className="section-head__title">全书 9 章知识版图</h2>
          <span className="section-head__hint">所有做题记录与收藏均自动保存在本地浏览器（localStorage）</span>
        </div>
        <div className="chapter-preview-grid">
          {NOTES.chapters.map((ch) => (
            <div key={ch.id} className="chapter-mini-item">
              <span className="chapter-mini-item__num">Ch.{ch.id}</span>
              <div className="chapter-mini-item__body">
                <div className="chapter-mini-item__title">{ch.short}</div>
                <div className="chapter-mini-item__sub">{ch.sections.length} 个核心考点小节</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
