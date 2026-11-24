import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { MasteryLevel, Question, QuestionOrigin, QuestionType } from './storage.ts';
import {
  findQuestionByStem,
  getCorrectChoiceFor,
  getPartialWrongChoiceFor,
  getWrongChoiceFor,
} from './storage.ts';

export type NavTarget = 'hub' | 'quiz' | 'wrong' | 'fav' | 'notes';

const NAV_LABELS: Record<NavTarget, string> = {
  hub: '复习中心',
  quiz: '刷题工具',
  wrong: '错题本',
  fav: '收藏夹',
  notes: '知识点手册',
};

export async function gotoRoute(page: Page, hashRoute = '#/'): Promise<void> {
  const normalized =
    hashRoute === '/' || hashRoute === ''
      ? './#/'
      : hashRoute.startsWith('./#')
        ? hashRoute
        : hashRoute.startsWith('#')
          ? `./${hashRoute}`
          : `./#${hashRoute.startsWith('/') ? hashRoute : '/' + hashRoute}`;
  await page.goto(normalized, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toBeEmpty();
}

export function navLink(page: Page, key: NavTarget): Locator {
  return page
    .getByTestId(`nav-${key}`)
    .or(page.getByRole('navigation').getByRole('link', { name: NAV_LABELS[key] }))
    .first();
}

// Portal Hub (#/)
export function hubCardQuiz(page: Page): Locator {
  return page
    .getByTestId('hub-card-quiz')
    .or(page.locator('main').getByRole('link', { name: /刷题工具/ }))
    .first();
}

export function hubCardNotes(page: Page): Locator {
  return page
    .getByTestId('hub-card-notes')
    .or(page.locator('main').getByRole('link', { name: /知识点手册/ }))
    .first();
}

export function hubBadgeTotal(page: Page): Locator {
  return page
    .getByTestId('hub-badge-total')
    .or(page.getByText(/\d+\s*道题/))
    .first();
}

export function hubBadgeChapters(page: Page): Locator {
  return page
    .getByTestId('hub-badge-chapters')
    .or(page.getByText(/9\s*章/))
    .first();
}

// Quiz Home (#/quiz)
export function quizBadgeTotal(page: Page): Locator {
  return page
    .getByTestId('quiz-badge-total')
    .or(page.getByText(/\d+\s*道题/))
    .first();
}

export function statCard(page: Page, kind: 'done' | 'acc' | 'wrong' | 'fav'): Locator {
  return page.getByTestId(`stat-${kind}`);
}

export function modeCard(page: Page, mode: 'all' | QuestionType): Locator {
  const labels: Record<'all' | QuestionType, RegExp> = {
    all: /总体刷题/,
    choice: /单选题|选择题/,
    multi: /多选题/,
    tf: /判断题/,
    short: /简答题/,
    analysis: /综合分析题/,
  };
  return page
    .getByTestId(`mode-${mode}`)
    .or(page.getByRole('button', { name: labels[mode] }))
    .first();
}

export function chapterChip(page: Page, chapter: 'all' | number): Locator {
  if (chapter === 'all') {
    return page
      .getByTestId('chapter-chip-all')
      .or(page.getByRole('button', { name: '全部', exact: true }))
      .first();
  }
  return page.getByTestId(`chapter-chip-${chapter}`);
}

export function filterOrigin(page: Page): Locator {
  return page
    .getByTestId('filter-origin')
    .or(page.getByLabel(/题目来源|来源/))
    .first();
}

export function filterCount(page: Page): Locator {
  return page
    .getByTestId('filter-count')
    .or(page.getByLabel(/题量/))
    .first();
}

export function filterOrder(page: Page): Locator {
  return page
    .getByTestId('filter-order')
    .or(page.getByLabel(/出题顺序|顺序/))
    .first();
}

export function btnOpenWrong(page: Page): Locator {
  return page
    .getByTestId('btn-open-wrong')
    .or(page.getByRole('button', { name: /错题本/ }))
    .first();
}

export function btnOpenFav(page: Page): Locator {
  return page
    .getByTestId('btn-open-fav')
    .or(page.getByRole('button', { name: /收藏夹/ }))
    .first();
}

export function btnResetStore(page: Page): Locator {
  return page
    .getByTestId('btn-reset-store')
    .or(page.getByRole('button', { name: /清空记录/ }))
    .first();
}

export function btnExportJson(page: Page): Locator {
  return page
    .getByTestId('btn-export-json')
    .or(page.getByRole('button', { name: /导出进度/ }))
    .first();
}

export function btnImportJson(page: Page): Locator {
  return page
    .getByTestId('btn-import-json')
    .or(page.getByRole('button', { name: /导入进度/ }))
    .first();
}

export function inputImportFile(page: Page): Locator {
  return page.getByTestId('input-import-file');
}

// Quiz Session
export function quizExit(page: Page): Locator {
  return page
    .getByTestId('quiz-exit')
    .or(page.getByRole('button', { name: /退出刷题|返回/ }))
    .first();
}

export function quizModeTitle(page: Page): Locator {
  return page.getByTestId('quiz-mode-title');
}

export function quizProgressText(page: Page): Locator {
  return page.getByTestId('quiz-progress-text');
}

export function quizProgressBar(page: Page): Locator {
  return page.getByTestId('quiz-progress-bar').or(page.getByRole('progressbar')).first();
}

export function quizTimer(page: Page): Locator {
  return page.getByTestId('quiz-timer');
}

export function qChapterTag(page: Page): Locator {
  return page.getByTestId('q-chapter-tag');
}

export function qTypeTag(page: Page): Locator {
  return page.getByTestId('q-type-tag');
}

export function qSourceTag(page: Page): Locator {
  return page.getByTestId('q-source-tag');
}

export function qStem(page: Page): Locator {
  return page.getByTestId('q-stem');
}

export function btnStar(page: Page): Locator {
  return page
    .getByTestId('btn-star')
    .or(page.getByRole('button', { name: /收藏/ }))
    .first();
}

export function quizOption(page: Page, index: number): Locator {
  return page.getByTestId(`quiz-option-${index}`);
}

export function btnSubmitMulti(page: Page): Locator {
  return page
    .getByTestId('btn-submit-multi')
    .or(page.getByRole('button', { name: /确认提交/ }))
    .first();
}

export function tfBtn(page: Page, value: boolean): Locator {
  return page
    .getByTestId(value ? 'tf-btn-true' : 'tf-btn-false')
    .or(page.getByRole('button', { name: value ? '正确' : '错误', exact: true }))
    .first();
}

export function quizFeedback(page: Page): Locator {
  return page.getByTestId('quiz-feedback');
}

export function btnRevealAnswer(page: Page): Locator {
  return page
    .getByTestId('btn-reveal-answer')
    .or(page.getByRole('button', { name: /显示参考答案/ }))
    .first();
}

export function qRefAnswer(page: Page): Locator {
  return page.getByTestId('q-ref-answer');
}

export function selfCheckBtn(page: Page, level: MasteryLevel): Locator {
  const labels: Record<MasteryLevel, string> = {
    2: '完全会',
    1: '有点模糊',
    0: '不会',
  };
  return page
    .getByTestId(`selfcheck-${level}`)
    .or(page.getByRole('button', { name: labels[level], exact: true }))
    .first();
}

export function btnPrev(page: Page): Locator {
  return page
    .getByTestId('btn-prev')
    .or(page.getByRole('button', { name: '上一题', exact: true }))
    .first();
}

export function btnNext(page: Page): Locator {
  return page
    .getByTestId('btn-next')
    .or(page.getByRole('button', { name: /下一题|看结果|完成/ }))
    .first();
}

export function answerSheet(page: Page): Locator {
  return page
    .getByTestId('answer-sheet')
    .or(page.getByRole('region', { name: /答题卡/ }))
    .first();
}

export function btnToggleSheet(page: Page): Locator {
  return page
    .getByTestId('btn-toggle-sheet')
    .or(page.getByRole('button', { name: /答题卡/ }))
    .first();
}

export function sheetItem(page: Page, index: number): Locator {
  return page.getByTestId(`sheet-item-${index}`);
}

// Result Screen
export function resultScore(page: Page): Locator {
  return page.getByTestId('result-score');
}

export function resultTotal(page: Page): Locator {
  return page.getByTestId('result-total');
}

export function resultRight(page: Page): Locator {
  return page.getByTestId('result-right');
}

export function resultTime(page: Page): Locator {
  return page.getByTestId('result-time');
}

export function btnRetryWrong(page: Page): Locator {
  return page
    .getByTestId('btn-retry-wrong')
    .or(page.getByRole('button', { name: '只练错题' }))
    .first();
}

export function btnRetryMore(page: Page): Locator {
  return page
    .getByTestId('btn-retry-more')
    .or(page.getByRole('button', { name: '再来一组' }))
    .first();
}

export function btnResultHome(page: Page): Locator {
  return page
    .getByTestId('btn-result-home')
    .or(page.getByRole('button', { name: '返回首页' }))
    .first();
}

export function resultReviewItems(page: Page): Locator {
  return page.getByTestId('result-review-item');
}

// Wrong Book & Favorites
export function listRedoAll(page: Page): Locator {
  return page
    .getByTestId('list-redo-all')
    .or(page.getByRole('button', { name: '重做全部' }))
    .first();
}

export function listClearWrong(page: Page): Locator {
  return page
    .getByTestId('list-clear-wrong')
    .or(page.getByRole('button', { name: '清空' }))
    .first();
}

export function listEmpty(page: Page): Locator {
  return page.getByTestId('list-empty');
}

export function listItems(page: Page): Locator {
  return page.getByTestId('list-item');
}

export function listItemToggle(item: Locator): Locator {
  return item
    .getByTestId('list-item-toggle')
    .or(item.getByRole('button', { name: /查看答案/ }))
    .first();
}

export function listItemAnswer(item: Locator): Locator {
  return item.getByTestId('list-item-answer');
}

// Handbook (#/notes)
export function notesSearch(page: Page): Locator {
  return page
    .getByTestId('notes-search')
    .or(page.getByPlaceholder(/搜索知识点/))
    .first();
}

export function notesToc(page: Page): Locator {
  return page.getByTestId('notes-toc');
}

export function notesChapter(page: Page, chapterId: number): Locator {
  return page.getByTestId(`notes-chapter-${chapterId}`);
}

export function btnQuizChapter(page: Page, chapterId: number): Locator {
  return page.getByTestId(`btn-quiz-chapter-${chapterId}`);
}

export function notesTableWraps(page: Page): Locator {
  return page.getByTestId('notes-table-wrap');
}

// Compound interaction helpers
export async function ensureAnswerSheetOpen(page: Page): Promise<void> {
  const sheet = answerSheet(page);
  if (!(await sheet.isVisible())) {
    const toggle = btnToggleSheet(page);
    if (await toggle.isVisible()) {
      await toggle.click();
    }
  }
  await expect(sheet).toBeVisible();
}

export async function selectOnlyChapters(page: Page, keepChapters: number[]): Promise<void> {
  const keepSet = new Set(keepChapters);
  // First ensure every target chapter is active so min-1 never blocks turning off others
  for (const ch of keepChapters) {
    const chip = chapterChip(page, ch);
    if ((await chip.getAttribute('aria-pressed')) !== 'true') {
      await chip.click();
    }
  }
  for (let ch = 1; ch <= 9; ch++) {
    if (keepSet.has(ch)) continue;
    const chip = chapterChip(page, ch);
    if ((await chip.getAttribute('aria-pressed')) === 'true') {
      await chip.click();
    }
  }
}

export async function selectQuizFilters(
  page: Page,
  opts?: {
    chapters?: number[] | 'all';
    origin?: 'all' | QuestionOrigin;
    count?: 10 | 20 | 30 | 0;
    order?: 'random' | 'seq';
  },
): Promise<void> {
  if (opts?.chapters === 'all') {
    await chapterChip(page, 'all').click();
  } else if (opts?.chapters) {
    await selectOnlyChapters(page, opts.chapters);
  }

  if (opts?.origin !== undefined) {
    await filterOrigin(page).selectOption(opts.origin);
  }
  if (opts?.count !== undefined) {
    await filterCount(page).selectOption(String(opts.count));
  }
  if (opts?.order !== undefined) {
    await filterOrder(page).selectOption(opts.order);
  }
}

export async function answerCurrentQuestion(
  page: Page,
  stemMap: Map<string, Question>,
  outcome: 'correct' | 'wrong' | 'partial' = 'correct',
): Promise<Question> {
  const stemText = (await qStem(page).innerText()).trim();
  const question = findQuestionByStem(stemText, stemMap);

  if (question.type === 'choice') {
    const idx =
      outcome === 'correct'
        ? (getCorrectChoiceFor(question) as number)
        : (getWrongChoiceFor(question) as number);
    await quizOption(page, idx).click();
  } else if (question.type === 'tf') {
    const val =
      outcome === 'correct'
        ? (getCorrectChoiceFor(question) as boolean)
        : (getWrongChoiceFor(question) as boolean);
    await tfBtn(page, val).click();
  } else if (question.type === 'multi') {
    const indices =
      outcome === 'correct'
        ? (getCorrectChoiceFor(question) as number[])
        : outcome === 'partial'
          ? getPartialWrongChoiceFor(question)
          : (getWrongChoiceFor(question) as number[]);
    for (const idx of indices) {
      await quizOption(page, idx).click();
    }
    await btnSubmitMulti(page).click();
  } else {
    await btnRevealAnswer(page).click();
    await expect(qRefAnswer(page)).toBeVisible();
    const level: MasteryLevel = outcome === 'correct' ? 2 : outcome === 'partial' ? 1 : 0;
    await selfCheckBtn(page, level).click();
  }

  return question;
}

export function extractInt(text: string): number {
  const m = text.match(/-?\d+/);
  if (!m) {
    throw new Error(`No integer found in text: "${text}"`);
  }
  return Number.parseInt(m[0], 10);
}
