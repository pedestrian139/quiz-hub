import { expect, onlyDesktop, onlyMobile, test } from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import { FIXTURE_BANK, seedFixtureBank } from './helpers/fixtureBank.ts';
import {
  btnRevealAnswer,
  modeCard,
  qRefAnswer,
  quizFeedback,
  quizProgressText,
  selectQuizFilters,
  tfBtn,
} from './helpers/selectors.ts';
import { makeEmptyStore } from './helpers/storage.ts';

test.describe('QuizSession Shortcuts, Apple HIG Polish & Mobile Thumb Bar', () => {
  test('Desktop: shortcut hint bar, 1/0 TF, two-stage Enter, input/modal isolation & light/dark audit', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });

    // Light theme checks on Mixed mode
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();

    const hint = page.locator('.shortcut-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('← / → 切题');
    await expect(hint).toContainText('1–4 / A–D 选项');
    await expect(hint).toContainText('1 / 0 判断');
    await expect(hint).toContainText('Enter 提交 / 下一题');
    await expect(hint).not.toContainText('Space');
    await expect(hint).not.toContainText('T/F');

    await assertFullLayoutAudit(page);

    // Choice: Enter before grading does not skip; '1' grades; Enter advances
    await page.keyboard.press('Enter');
    await expect(quizProgressText(page)).toContainText('1 / 10');
    await page.keyboard.press('1');
    await expect(quizFeedback(page)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(quizProgressText(page)).toContainText('2 / 10');

    // Open Spotlight modal -> single-key shortcuts must be isolated
    await page.getByTestId('global-search-trigger').click();
    const dialog = page.getByRole('dialog', { name: '搜索题目', exact: true });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(quizProgressText(page)).toContainText('2 / 10');

    // Switch to dark theme and test Multi two-stage Enter
    await page.getByTestId('quiz-exit').click();
    await page.getByTestId('theme-option-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    await expect(quizProgressText(page)).toContainText('1 /');

    // 0 selected + Enter -> silent no-op
    await page.keyboard.press('Enter');
    await expect(quizProgressText(page)).toContainText('1 /');
    await expect(quizFeedback(page)).toBeHidden();

    // Click option -> focus stays on .option-btn--multi; 1st Enter submits; 2nd Enter advances
    await page.getByTestId('quiz-option-0').click();
    await page.keyboard.press('Enter');
    await expect(quizFeedback(page)).toBeVisible();
    await expect(quizProgressText(page)).toContainText('1 /');
    await assertFullLayoutAudit(page);

    await page.keyboard.press('Enter');
    await expect(quizProgressText(page)).toContainText('2 /');

    // TF in dark theme: T/F ignored, 1/0 work, badges show 1/0, Enter advances
    await page.getByTestId('quiz-exit').click();
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await expect(tfBtn(page, true).locator('.tf-btn__kbd')).toHaveText('1');
    await expect(tfBtn(page, false).locator('.tf-btn__kbd')).toHaveText('0');

    await page.keyboard.press('T');
    await page.keyboard.press('F');
    await expect(quizFeedback(page)).toBeHidden();

    await page.keyboard.press('1');
    await expect(quizFeedback(page)).toBeVisible();
    await assertFullLayoutAudit(page);
    await page.keyboard.press('Enter');
    await expect(quizProgressText(page)).toContainText('2 /');

    // Short-answer: Space does NOT reveal; textarea Enter inserts newline without advancing
    await page.getByTestId('quiz-exit').click();
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await page.keyboard.press('Space');
    await expect(btnRevealAnswer(page)).toBeVisible();
    await expect(qRefAnswer(page)).toBeHidden();

    await page.getByTestId('short-mode-ai').click();
    const textarea = page.getByTestId('short-ai-textarea');
    await textarea.click();
    await page.keyboard.type('第一行');
    await page.keyboard.press('Enter');
    await page.keyboard.type('第二行');
    await expect(textarea).toHaveValue('第一行\n第二行');
    await expect(quizProgressText(page)).toContainText('1 /');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await assertFullLayoutAudit(page);
  });

  test('Mobile (390x844): sticky thumb bar, non-occlusion after scroll, >=16px textarea & light/dark audit', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });

    // Multi mode in light theme
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();

    await expect(page.locator('.shortcut-hint')).toBeHidden();
    const mobileBar = page.getByTestId('workspace-mobile-bar');
    await expect(mobileBar).toBeVisible();
    const mobileSubmit = page.getByTestId('mobile-btn-submit');
    const finishBtn = page.getByTestId('btn-finish');
    await expect(mobileSubmit).toBeVisible();
    await expect(mobileSubmit).toBeDisabled();
    await expect(finishBtn).toBeVisible();

    const barMetrics = await mobileBar.evaluate((el) => {
      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        position: st.position,
        bottomGap: Math.abs(window.innerHeight - r.bottom),
        height: r.height,
      };
    });
    expect(['fixed', 'sticky']).toContain(barMetrics.position);
    expect(barMetrics.height).toBeGreaterThanOrEqual(44);

    // Select option & submit via mobile contextual button
    await page.getByTestId('quiz-option-0').click();
    await expect(mobileSubmit).toBeEnabled();
    await mobileSubmit.click();
    await expect(quizFeedback(page)).toBeVisible();
    await expect(mobileSubmit).toBeHidden();
    await assertFullLayoutAudit(page);

    // Short mode in dark theme: check >=16px textarea font-size and scroll clearance above sticky bar
    await page.getByTestId('quiz-exit').click();
    await page.getByTestId('theme-option-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await page.getByTestId('short-mode-ai').click();

    const textarea = page.getByTestId('short-ai-textarea');
    await expect(textarea).toBeVisible();
    const fontSizePx = await textarea.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).fontSize),
    );
    expect(fontSizePx).toBeGreaterThanOrEqual(16);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const stickyBottomGap = await mobileBar.evaluate((el) =>
      Math.abs(window.innerHeight - el.getBoundingClientRect().bottom),
    );
    expect(stickyBottomGap).toBeLessThanOrEqual(2);

    // Scroll to bottom and confirm last content control clears the fixed bar
    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    });
    const clearance = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="workspace-mobile-bar"]');
      const aiBtn = document.querySelector('[data-testid="ai-btn-explain"]');
      if (!bar || !aiBtn) return null;
      return {
        barTop: bar.getBoundingClientRect().top,
        aiBtnBottom: aiBtn.getBoundingClientRect().bottom,
      };
    });
    expect(clearance).not.toBeNull();
    expect(clearance!.aiBtnBottom).toBeLessThanOrEqual(clearance!.barTop + 1);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await assertFullLayoutAudit(page);

    // Mobile Finish button exits to result screen cleanly
    await page.getByTestId('btn-finish').click();
    await expect(page.getByTestId('result-score')).toBeVisible();
  });
});
