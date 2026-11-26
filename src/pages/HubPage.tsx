import { useMemo } from 'react';
import type { HomeStats, UserStore } from '../types/quiz';
import { getOriginLabel } from '../core/questionUtils';
import { computeHomeStats } from '../core/quizEngine';
import {
  NOTES,
  QUESTION_ORIGINS,
  QUESTION_TYPES,
  SECTION_COUNT,
  TYPE_NAME,
} from '../data/catalog';
import type { BankViewModel } from '../utils/bankCatalog';
import type { ImportModalTab } from '../utils/BankLibraryContext';
import { BUILTIN_AI_BANK_ID, type BankRecord } from '../utils/quizImportTypes';
import { ROUTE_HASH } from '../router/useHashRoute';
import { Icon } from '../components/Icons';

interface HubPageProps {
  viewModel: BankViewModel;
  banks: BankRecord[];
  activeBankId: string;
  stats: HomeStats;
  store: UserStore;
  onPracticeChapter: (chapterId: number) => void;
  onSwitchBank: (bankId: string) => void;
  onOpenImport: (tab?: ImportModalTab) => void;
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

export function HubPage({
  viewModel,
  banks,
  activeBankId,
  stats,
  store,
  onPracticeChapter,
  onSwitchBank,
  onOpenImport,
}: HubPageProps) {
  const { bank, counts, chapters, questions } = viewModel;
  const isBuiltinBank = activeBankId === BUILTIN_AI_BANK_ID;
  const accuracyLabel = stats.accuracyPct === null ? '—' : `${stats.accuracyPct}%`;
  const overallCoverage =
    stats.totalCount > 0 ? Math.round((stats.practicedCount / stats.totalCount) * 100) : 0;

  const chapterProgress = useMemo<ChapterProgress[]>(() => {
    const sectionsById = isBuiltinBank
      ? new Map(NOTES.chapters.map((c) => [c.id, c.sections.length]))
      : new Map<number, number>();
    return chapters.map((ch) => {
      const scoped = questions.filter((q) => q.chapter === ch.id);
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
  }, [chapters, isBuiltinBank, questions, store]);

  return (
    <div className="page-wrap page-wrap--hub">
      <section className="hero-card hero-card--hub">
        <div className="hero-eyebrow">
          <span className="pill pill--brand">
            <Icon name="sparkles" size={13} />
            QuizHub · AI 智能刷题门户
          </span>
          <span className="pill pill--subtle">
            <Icon name="shield" size={13} />
            多题库管理 · 本地与云端同步
          </span>
        </div>

        <h1 className="hero-title">
          QuizHub · <span className="hero-title__accent">复习中心</span>
        </h1>
        <p className="hero-subtitle">
          集「AI 智能洗题导入」「沉浸式刷题工作台」与「流式 AI 深度解析与多轮追问」于一体的自主学习平台。当前激活题库为「{bank.name}」，支持随时导入自定义题库并多端同步学习进度。
        </p>

        <div className="bank-switcher-bar" aria-label="题库切换与智能导入">
          <div className="bank-switcher-bar__control">
            <label className="bank-switcher-bar__label" htmlFor="hub-bank-switcher">
              当前题库
            </label>
            <select
              id="hub-bank-switcher"
              data-testid="bank-switcher"
              aria-label="切换当前题库"
              className="bank-switcher__select"
              value={activeBankId}
              onChange={(e) => onSwitchBank(e.target.value)}
            >
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}（{b.data.questions.length} 题）
                </option>
              ))}
            </select>
          </div>

          <div className="bank-switcher-bar__actions">
            <button
              type="button"
              className="btn btn--soft-brand btn--sm"
              onClick={() => onOpenImport('import')}
            >
              <Icon name="sparkles" size={14} />
              AI 智能洗题 / 导入
            </button>
          </div>
        </div>

        <div className="badge-row" aria-label="题库概览统计">
          <span data-testid="hub-badge-total" className="pill pill--primary">
            共 {counts.total} 道题
          </span>
          <span data-testid="hub-badge-chapters" className="pill pill--neutral">
            {isBuiltinBank
              ? `覆盖 ${chapters.length} 章 · ${SECTION_COUNT} 小节`
              : `覆盖 ${chapters.length} 章`}
          </span>
          {QUESTION_TYPES.map((type) => (
            <span key={type} className={`pill pill--type pill--type-${type}`}>
              {TYPE_NAME[type]} {counts.byType[type]}
            </span>
          ))}
        </div>

        <div className="origin-row" aria-label="题目来源分布">
          {QUESTION_ORIGINS.map((origin) => (
            <span key={origin} className={`origin-chip origin-chip--${origin}`}>
              <span className="origin-chip__dot" aria-hidden="true" />
              {getOriginLabel(origin)}：{counts.byOrigin[origin]} 题
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
            <span className="pill pill--brand">{counts.total} 题全题型演练</span>
          </div>
          <h2 className="hub-card__title">刷题工具</h2>
          <p className="hub-card__desc">
            支持单选、多选、判断、简答与综合分析五种题型；提供章节多选、来源筛选、关键词检索、答题卡筛选速跳、LaTeX 公式排版与 AI 深度解析追问。
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
              {NOTES.chapters.length} 章 · {NOTES.appendices.length} 附录
            </span>
          </div>
          <h2 className="hub-card__title">知识点手册</h2>
          <p className="hub-card__desc">
            涵盖 QuizHub 使用指南、沉浸式工作台快捷键体系、AI 智能洗题分段校对流程与多轮追问技巧，支持关键词检索与打印。
          </p>
          <div className="hub-card__meta">
            <span>
              <strong>{SECTION_COUNT}</strong> 核心小节
            </span>
            <span className="hub-card__sep" aria-hidden="true">·</span>
            <span>快捷键 / 洗题技巧 / 速查表</span>
          </div>
          <span className="hub-card__cta">
            查阅知识点手册 <Icon name="arrowRight" size={16} />
          </span>
        </a>
      </section>

      <section className="chapter-preview-card" aria-label="分章掌握进度">
        <div className="section-head">
          <div className="section-head__main">
            <h2 className="section-head__title">当前题库知识版图（{bank.name}）</h2>
            <span className="section-head__hint">
              做题记录、错题本与收藏进度按题库独立保存并支持云端同步
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
                      {ch.sectionCount > 0
                        ? `${ch.sectionCount} 个核心考点小节 · ${ch.total} 题`
                        : `共 ${ch.total} 题`}
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
