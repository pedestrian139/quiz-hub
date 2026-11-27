import { assertFullLayoutAudit } from './helpers/audit.ts';
import { FIXTURE_BANK, seedFixtureBank } from './helpers/fixtureBank.ts';
import { expect, test } from './helpers/fixtures.ts';
import {
  answerCurrentQuestion,
  btnNext,
  btnStar,
  gotoRoute,
  modeCard,
  qStem,
  quizExit,
} from './helpers/selectors.ts';
import { buildQuestionStemMap, makeEmptyStore } from './helpers/storage.ts';

const THEME_STORAGE_KEY = 'ai-intro-quiz-theme';

test.describe('Apple Theme Foundation & Header Layout Audit', () => {
  test('supports system/light/dark switching, reload persistence, and live media adaptation', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await gotoRoute(page, '#/');

    const html = page.locator('html');
    const systemBtn = page.getByTestId('theme-option-system');
    const lightBtn = page.getByTestId('theme-option-light');
    const darkBtn = page.getByTestId('theme-option-dark');

    // Default preference is 'system' -> light under light colorScheme
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(html).toHaveAttribute('data-theme-mode', 'system');
    await expect(systemBtn).toHaveAttribute('aria-pressed', 'true');

    // Live system colorScheme change updates theme when in 'system' mode
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Switch to explicit dark mode
    await darkBtn.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).toHaveAttribute('data-theme-mode', 'dark');
    await expect(darkBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(systemBtn).toHaveAttribute('aria-pressed', 'false');

    const storedDark = await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY);
    expect(storedDark).toBe('dark');

    const darkColors = await page.evaluate(() => {
      const s = window.getComputedStyle(document.body);
      return { bg: s.backgroundColor, color: s.color };
    });
    expect(darkColors.bg).toBe('rgb(0, 0, 0)');
    expect(darkColors.color).toBe('rgb(245, 245, 247)');

    // Reload preserves dark mode without FOUC fallback
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('theme-option-dark')).toHaveAttribute('aria-pressed', 'true');

    // Switch to explicit light mode and verify persistence after reload
    await page.getByTestId('theme-option-light').click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(lightBtn).toHaveAttribute('aria-pressed', 'true');

    const lightColors = await page.evaluate(() => {
      const s = window.getComputedStyle(document.body);
      return { bg: s.backgroundColor, color: s.color };
    });
    expect(lightColors.bg).toBe('rgb(245, 245, 247)');
    expect(lightColors.color).toBe('rgb(29, 29, 31)');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('theme-option-light')).toHaveAttribute('aria-pressed', 'true');

    // Return to system mode and verify OS dark/light tracking
    await page.getByTestId('theme-option-system').click();
    await expect(html).toHaveAttribute('data-theme-mode', 'system');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('passes layout audit and header switcher alignment across routes in light and dark modes', async ({
    page,
  }) => {
    const routes = ['#/', '#/quiz', '#/notes'];

    for (const mode of ['light', 'dark'] as const) {
      await gotoRoute(page, '#/');
      await page.getByTestId(`theme-option-${mode}`).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);

      for (const route of routes) {
        await gotoRoute(page, route);
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
        await assertFullLayoutAudit(page);

        const switcherMetrics = await page.evaluate(() => {
          const group = document.querySelector('[data-testid="theme-toggle"]');
          if (!group) return null;
          const groupRect = group.getBoundingClientRect();
          const btns = Array.from(group.querySelectorAll('button')).map((b) =>
            b.getBoundingClientRect(),
          );
          const tops = btns.map((r) => r.top);
          return {
            viewportWidth: window.innerWidth,
            groupLeft: groupRect.left,
            groupRight: groupRect.right,
            btnCount: btns.length,
            topSpread: Math.max(...tops) - Math.min(...tops),
            allVisible: btns.every((r) => r.width > 0 && r.height > 0),
          };
        });

        expect(switcherMetrics).not.toBeNull();
        expect(switcherMetrics!.btnCount).toBe(3);
        expect(switcherMetrics!.allVisible).toBe(true);
        expect(switcherMetrics!.groupLeft).toBeGreaterThanOrEqual(0);
        expect(switcherMetrics!.groupRight).toBeLessThanOrEqual(switcherMetrics!.viewportWidth + 1);
        expect(switcherMetrics!.topSpread).toBeLessThan(4);
      }
    }
  });

  test('verifies dark-mode contrast and layout across graded quiz badges, wrong/fav views, and API modal', async ({
    page,
  }) => {
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);

    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/' });
    await page.getByTestId('theme-option-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // 1. Open and audit API Settings modal in dark mode
    await page.getByTestId('btn-api-settings').click();
    const apiModal = page.locator('.api-modal');
    await expect(apiModal).toBeVisible();
    const modalBg = await apiModal.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(modalBg).toBe('rgb(28, 28, 30)');
    await assertFullLayoutAudit(page);
    await page.locator('.api-modal__close').click();
    await expect(apiModal).toBeHidden();

    // 2. Grade single-choice questions (correct + wrong) and verify WCAG AA solid badge contrast
    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'choice').click();
    await expect(qStem(page)).toBeVisible();

    await answerCurrentQuestion(page, stemMap, 'correct');
    const correctBadge = page.locator('.option-btn.is-correct .option-btn__badge').first();
    await expect(correctBadge).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertFullLayoutAudit(page);

    const measureContrast = async (selector: string) => {
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const parseRgb = (css: string) => {
          const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
        };
        const lum = (rgb: number[]) => {
          const lin = rgb.map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
        };
        const st = window.getComputedStyle(el);
        const fg = parseRgb(st.color);
        const bg = parseRgb(st.backgroundColor);
        if (!fg || !bg) return null;
        const l1 = lum(fg);
        const l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return { color: st.color, backgroundColor: st.backgroundColor, ratio };
      }, selector);
    };

    const correctMetrics = await measureContrast('.option-btn.is-correct .option-btn__badge');
    expect(correctMetrics).not.toBeNull();
    expect(correctMetrics!.ratio).toBeGreaterThanOrEqual(4.5);

    // Star the question so #/fav has an entry, then move to next and answer wrong so #/wrong has an entry
    await btnStar(page).click();
    await btnNext(page).click();
    await expect(qStem(page)).toBeVisible();
    await answerCurrentQuestion(page, stemMap, 'wrong');

    const wrongBadge = page.locator('.option-btn.is-wrong .option-btn__badge').first();
    await expect(wrongBadge).toBeVisible();
    const wrongMetrics = await measureContrast('.option-btn.is-wrong .option-btn__badge');
    expect(wrongMetrics).not.toBeNull();
    expect(wrongMetrics!.ratio).toBeGreaterThanOrEqual(4.5);

    // 3. Exit choice session, start a True/False question in dark mode and verify icon badge contrast
    await quizExit(page).click();
    await modeCard(page, 'tf').click();
    await expect(qStem(page)).toBeVisible();
    await answerCurrentQuestion(page, stemMap, 'correct');
    const tfCorrectIcon = page.locator('.tf-btn.is-correct .tf-btn__icon').first();
    await expect(tfCorrectIcon).toBeVisible();
    const tfMetrics = await measureContrast('.tf-btn.is-correct .tf-btn__icon');
    expect(tfMetrics).not.toBeNull();
    expect(tfMetrics!.ratio).toBeGreaterThanOrEqual(4.5);

    // 4. Audit #/wrong and #/fav in dark mode with populated items
    for (const route of ['#/wrong', '#/fav']) {
      await gotoRoute(page, route);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByTestId('list-item').first()).toBeVisible();
      await assertFullLayoutAudit(page);
    }
  });
});
