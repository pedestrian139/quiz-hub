import fs from 'node:fs';
import { expect, test } from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import { installAuthGateway } from './helpers/authGateway.ts';
import {
  gotoRoute,
  modeCard,
  quizOption,
  quizProgressText,
} from './helpers/selectors.ts';
import {
  STORAGE_KEY,
  buildQuestionStemMap,
  findQuestionByStem,
  getCorrectChoiceFor,
  getWrongChoiceFor,
  makeSeededStore,
  pickQuestions,
  seedStoreAndReload,
} from './helpers/storage.ts';

async function readDownloadText(download: import('@playwright/test').Download): Promise<string> {
  const filePath = await download.path();
  if (!filePath) {
    throw new Error('Playwright download path was null');
  }
  return fs.readFileSync(filePath, 'utf-8');
}

test.describe('Smart Wrong Book (R1-R6)', () => {
  test('R1 & R6: launcher renders cleanly on routes, hides on print, and passes layout audit on desktop & mobile', async ({
    page,
  }) => {
    for (const route of ['#/', '#/quiz', '#/notes']) {
      await gotoRoute(page, route);
      await expect(page.getByTestId('wb-launcher-bar')).toBeVisible();
      await expect(page.getByTestId('wb-open-btn')).toBeVisible();
      await assertFullLayoutAudit(page);
    }

    // Print mode hides launcher bar
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('wb-launcher-bar')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });

    // Empty modal layout audit
    await page.getByTestId('wb-open-btn').click();
    await expect(page.getByTestId('wb-modal')).toBeVisible();
    await expect(page.getByTestId('wb-empty-state')).toBeVisible();
    await assertFullLayoutAudit(page);
    await page.getByTestId('wb-close-btn').click();
    await expect(page.getByTestId('wb-modal')).toBeHidden();
  });

  test('R2-R5: aggregates same-tab builtin & custom banks, filters/sorts, re-practices, marks mastered, and exports Markdown', async ({
    page,
  }) => {
    // 1. Answer a built-in question wrong directly in App.tsx (same tab, no reload)
    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'choice').click();
    const firstStem = (await page.getByTestId('q-stem').innerText()).trim();
    const builtinQ = findQuestionByStem(firstStem, buildQuestionStemMap());
    const wrongIdx = getWrongChoiceFor(builtinQ) as number;
    const correctIdx = getCorrectChoiceFor(builtinQ) as number;
    await quizOption(page, wrongIdx).click();
    await expect(page.getByTestId('quiz-feedback')).toContainText('回答错误');

    // 2. Open Smart Wrong Book & re-practice builtin question:
    //    answer wrong again (wrongCount -> 2), then answer right (still kept until mastered)
    await page.getByTestId('wb-open-btn').click();
    await expect(page.getByTestId('wb-item-card')).toHaveCount(1);
    await page.getByTestId('wb-start-practice-btn').click();
    await expect(page.getByTestId('wb-practice-view')).toBeVisible();
    await assertFullLayoutAudit(page);

    const altWrongIdx = (wrongIdx + 1) % (builtinQ.options?.length ?? 4);
    const secondWrongIdx = altWrongIdx === correctIdx ? wrongIdx : altWrongIdx;
    await page.getByTestId(`wb-practice-option-${secondWrongIdx}`).click();
    await expect(page.getByTestId('wb-practice-feedback')).toContainText('回答错误');
    await expect(page.getByTestId('wb-practice-wrong-count')).toContainText('累计错误 2 次');

    await page.getByTestId(`wb-practice-option-${correctIdx}`).click();
    await expect(page.getByTestId('wb-practice-feedback')).toContainText('回答正确');
    await page.getByTestId('wb-back-to-list-btn').click();
    await expect(page.getByTestId('wb-item-card')).toHaveCount(1);
    await page.getByTestId('wb-close-btn').click();

    // 3. Import a custom bank (with 1 choice + 1 short) and mark wrong in QuizImportPortal AFTERWARD
    //    so custom bank items have newer timestamps while builtin has higher wrongCount (2)
    await page.getByTestId('btn-open-quiz-import').click();
    await page.getByTestId('import-tab-paste').click();
    await page.getByTestId('import-paste-textarea').fill(`
# 第一章 智能错题测试
1. 以下哪种数据结构遵循后进先出（LIFO）原则？
A. 队列
B. 栈
C. 链表
D. 哈希表
答案：B
解析：栈遵循后进先出原则。

2. [简答] 请简述梯度下降法的核心思想。
答案：沿目标函数梯度的反方向迭代更新参数以最小化损失函数。
解析：学习率控制每次迭代步长。
`);
    await page.getByTestId('btn-parse-paste').click();
    await page.getByTestId('import-bank-name').fill('算法专项测试库');
    await page.getByTestId('btn-confirm-import').click();

    await expect(page.getByTestId('qi-practice-home')).toBeVisible();
    await page.getByTestId('qi-mode-all').click();
    // Question 1 (choice): pick wrong option A (index 0)
    await expect(page.getByTestId('qi-q-stem')).toContainText('后进先出');
    await page.getByTestId('qi-option-0').click();
    await expect(page.getByTestId('qi-quiz-feedback')).toContainText('回答错误');
    await page.getByTestId('qi-btn-next').click();
    // Question 2 (short): reveal & rate "不会"
    await expect(page.getByTestId('qi-q-stem')).toContainText('梯度下降法');
    await page.getByTestId('qi-btn-reveal').click();
    await page.getByTestId('qi-selfcheck-0').click();
    await page.getByTestId('btn-close-quiz-import').click();

    // 4. Open Smart Wrong Book without reload: both builtin + custom wrong items appear immediately
    await page.getByTestId('wb-open-btn').click();
    const modal = page.getByTestId('wb-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('wb-item-card')).toHaveCount(3);
    await expect(page.getByTestId('wb-item-list')).toContainText('人工智能导论');
    await expect(page.getByTestId('wb-item-list')).toContainText('算法专项测试库');
    await assertFullLayoutAudit(page);

    // 5. Filter by custom bank and back to all
    await page.getByTestId('wb-bank-filter').selectOption({ label: '算法专项测试库 (2)' });
    await expect(page.getByTestId('wb-item-card')).toHaveCount(2);

    await page.getByTestId('wb-bank-filter').selectOption('all');
    await expect(page.getByTestId('wb-item-card')).toHaveCount(3);

    // 6. Sort by wrongCount descending -> builtin question (错误 2 次) is first
    await page.getByTestId('wb-sort-count').click();
    await expect(page.getByTestId('wb-item-card').first()).toContainText('错误 2 次');
    await expect(page.getByTestId('wb-item-card').first()).toContainText('人工智能导论');

    // Sort by recent -> custom bank question is first (answered after builtin)
    await page.getByTestId('wb-sort-recent').click();
    await expect(page.getByTestId('wb-item-card').first()).toContainText('算法专项测试库');

    // 7. Export Markdown & inspect content
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('wb-export-md-btn').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.md$/);
    const mdText = await readDownloadText(download);
    expect(mdText).toContain('# QuizHub 智能错题本复习文档');
    expect(mdText).toContain('后进先出');
    expect(mdText).toContain('正确答案');
    expect(mdText).toContain('你的历史错选');
    expect(mdText).toContain('解析');
    expect(mdText).not.toContain('undefined');

    // 8. Practice all 3 items under 'recent' sort:
    //    - answer item #2 wrong -> stays on item #2 with feedback & explanation (no re-sort teleport)
    //    - navigate to trailing item #3 -> mark mastered -> single-click prev moves to #1
    //    - mark remaining items mastered -> close modal -> launcher badge updates to '暂无错题'
    await page.getByTestId('wb-start-practice-btn').click();
    await expect(page.getByTestId('wb-practice-progress')).toContainText('第 1 / 3 题');
    await expect(page.getByTestId('wb-practice-stem')).toContainText('梯度下降法');

    await page.getByTestId('wb-practice-next-btn').click();
    await expect(page.getByTestId('wb-practice-progress')).toContainText('第 2 / 3 题');
    await expect(page.getByTestId('wb-practice-stem')).toContainText('后进先出');
    await page.getByTestId('wb-practice-option-0').click();
    await expect(page.getByTestId('wb-practice-stem')).toContainText('后进先出');
    await expect(page.getByTestId('wb-practice-feedback')).toContainText('回答错误');
    await expect(page.getByTestId('wb-practice-explanation')).toBeVisible();

    await page.getByTestId('wb-practice-next-btn').click();
    await expect(page.getByTestId('wb-practice-progress')).toContainText('第 3 / 3 题');
    await page.getByTestId('wb-practice-mastered-btn').click();
    await expect(page.getByTestId('wb-practice-progress')).toContainText('第 2 / 2 题');
    await page.getByTestId('wb-practice-prev-btn').click();
    await expect(page.getByTestId('wb-practice-progress')).toContainText('第 1 / 2 题');
    await expect(page.getByTestId('wb-practice-stem')).toContainText('梯度下降法');

    await page.getByTestId('wb-practice-subjective-input').fill('沿着负梯度更新参数');
    await page.getByTestId('wb-practice-reveal-btn').click();
    await expect(page.getByTestId('wb-practice-explanation')).toContainText('学习率控制');
    await page.getByTestId('wb-practice-mastered-btn').click();
    await page.getByTestId('wb-back-to-list-btn').click();
    await expect(page.getByTestId('wb-item-card')).toHaveCount(1);
    await expect(page.getByTestId('wb-item-list')).toContainText('后进先出');

    // Close modal & verify launcher count updates cleanly to '待巩固 1 题'
    await page.getByTestId('wb-close-btn').click();
    await expect(page.getByTestId('wb-launcher-count')).toContainText('待巩固 1 题');

    // 9. Reload page and verify persistence
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('wb-open-btn').click();
    await expect(page.getByTestId('wb-item-card')).toHaveCount(1);
    await expect(page.getByTestId('wb-item-list')).toContainText('后进先出');

    // Mark the final custom-bank item mastered inside modal, close, and verify launcher updates to '暂无错题'
    await page.getByTestId('wb-item-mastered-btn').click();
    await expect(page.getByTestId('wb-empty-state')).toBeVisible();
    await page.getByTestId('wb-close-btn').click();
    await expect(page.getByTestId('wb-launcher-count')).toContainText('暂无错题');
  });

  test('R6: modal traps focus, isolates QuizSession keyboard shortcuts, and restores focus on Escape', async ({
    page,
  }) => {
    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'choice').click();
    await expect(quizProgressText(page)).toContainText('1 /');

    await page.getByTestId('wb-open-btn').click();
    const modal = page.getByTestId('wb-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('wb-close-btn')).toBeFocused();

    // Tab stays inside dialog
    await page.keyboard.press('Tab');
    const focusedInside = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="wb-modal"]');
      return Boolean(dialog && dialog.contains(document.activeElement));
    });
    expect(focusedInside).toBe(true);

    // Quiz shortcuts do not advance or answer underlying session
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('1');
    await page.keyboard.press(' ');
    await expect(quizProgressText(page)).toContainText('1 /');

    // Escape closes modal and restores focus to launcher trigger
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('wb-open-btn')).toBeFocused();
  });

  test('R6: isolates QuizSession shortcuts and recovers focus across unmounting/disabling modal buttons and short Space reveal', async ({
    page,
  }) => {
    const [qChoice1, qChoice2] = pickQuestions({ type: 'choice', limit: 2 });
    const [qShort] = pickQuestions({ type: 'short', limit: 1 });
    if (!qChoice1 || !qChoice2 || !qShort) {
      throw new Error('Expected 2 choice questions and 1 short question');
    }

    await seedStoreAndReload(
      page,
      makeSeededStore({
        wrongIds: [qChoice1.id, qChoice2.id, qShort.id],
      }),
      '#/quiz',
    );

    await modeCard(page, 'choice').click();
    await expect(quizProgressText(page)).toContainText('1 /');
    await expect(page.getByTestId('quiz-feedback')).toHaveCount(0);
    const initialStem = await page.getByTestId('q-stem').innerText();

    const assertQuizSessionUntouched = async () => {
      await expect(page.getByTestId('wb-modal')).toBeVisible();
      await expect(quizProgressText(page)).toContainText('1 /');
      await expect(page.getByTestId('q-stem')).toHaveText(initialStem);
      await expect(page.getByTestId('quiz-feedback')).toHaveCount(0);
    };

    const assertFocusInsideModal = async (expectedTestId?: string) => {
      const info = await page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="wb-modal"]');
        const active = document.activeElement;
        return {
          isBody: active === document.body || active === document.documentElement,
          insideDialog: Boolean(dialog && active && dialog.contains(active)),
          testId: active instanceof HTMLElement ? active.getAttribute('data-testid') : null,
        };
      });
      expect(info.isBody).toBe(false);
      expect(info.insideDialog).toBe(true);
      if (expectedTestId) {
        expect(info.testId).toBe(expectedTestId);
      }
    };

    const pressNavigationAndChoiceShortcuts = async () => {
      for (const key of ['ArrowRight', 'ArrowLeft', '1', 'a']) {
        await page.keyboard.press(key);
      }
    };

    const pressAllQuizShortcuts = async () => {
      for (const key of ['ArrowRight', 'ArrowLeft', '1', 'a', ' ']) {
        await page.keyboard.press(key);
      }
    };

    await page.getByTestId('wb-open-btn').click();
    const modal = page.getByTestId('wb-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('wb-close-btn')).toBeFocused();
    await assertFullLayoutAudit(page);

    // 1. Unmount wb-item-mastered-btn in list view (remove qChoice1, keeping qChoice2 & qShort)
    await page
      .locator(`[data-testid="wb-item-card"][data-question-id="${qChoice1.id}"]`)
      .getByTestId('wb-item-mastered-btn')
      .click();
    await expect(page.getByTestId('wb-item-card')).toHaveCount(2);
    await assertFocusInsideModal('wb-item-mastered-btn');
    await pressNavigationAndChoiceShortcuts();
    await assertQuizSessionUntouched();

    // 2. Unmount wb-start-practice-btn ('list' -> 'practice')
    await page.getByTestId('wb-start-practice-btn').click();
    await expect(page.getByTestId('wb-practice-view')).toBeVisible();
    await assertFocusInsideModal('wb-back-to-list-btn');
    await pressNavigationAndChoiceShortcuts();
    await assertQuizSessionUntouched();

    // 3. Nav boundary disable: next -> disabled on item 2/2 (focuses prev), prev -> disabled on item 1/2 (focuses next)
    await page.getByTestId('wb-practice-next-btn').click();
    await expect(page.getByTestId('wb-practice-progress')).toContainText('第 2 / 2 题');
    await expect(page.getByTestId('wb-practice-next-btn')).toBeDisabled();
    await assertFocusInsideModal('wb-practice-prev-btn');
    await pressNavigationAndChoiceShortcuts();
    await assertQuizSessionUntouched();

    await page.getByTestId('wb-practice-prev-btn').click();
    await expect(page.getByTestId('wb-practice-progress')).toContainText('第 1 / 2 题');
    await expect(page.getByTestId('wb-practice-prev-btn')).toBeDisabled();
    await assertFocusInsideModal('wb-practice-next-btn');
    await pressNavigationAndChoiceShortcuts();
    await assertQuizSessionUntouched();

    // 4. Find the subjective short question, type in textarea, and unmount wb-practice-reveal-btn
    if ((await page.getByTestId('wb-practice-subjective-input').count()) === 0) {
      await page.getByTestId('wb-practice-next-btn').click();
    }
    const textarea = page.getByTestId('wb-practice-subjective-input');
    await expect(textarea).toBeVisible();
    await textarea.click();
    await textarea.type('1a t ');
    await expect(textarea).toHaveValue('1a t ');
    await assertQuizSessionUntouched();

    await page.getByTestId('wb-practice-reveal-btn').click();
    await expect(page.getByTestId('wb-practice-reveal-btn')).toBeHidden();
    await expect(page.getByTestId('wb-practice-explanation')).toBeVisible();
    await assertFocusInsideModal('wb-practice-subjective-wrong-btn');
    await assertFullLayoutAudit(page);
    await pressNavigationAndChoiceShortcuts();
    await assertQuizSessionUntouched();

    // 5. Unmount wb-back-to-list-btn ('practice' -> 'list')
    await page.getByTestId('wb-back-to-list-btn').click();
    await expect(page.getByTestId('wb-item-card')).toHaveCount(2);
    await assertFocusInsideModal('wb-start-practice-btn');
    await pressNavigationAndChoiceShortcuts();
    await assertQuizSessionUntouched();

    // 6. Re-enter practice and master final items into wb-practice-done
    await page.getByTestId('wb-start-practice-btn').click();
    await page.getByTestId('wb-practice-mastered-btn').click();
    await expect(page.getByTestId('wb-practice-progress')).toContainText('第 1 / 1 题');
    await page.getByTestId('wb-practice-mastered-btn').click();
    await expect(page.getByTestId('wb-practice-done')).toBeVisible();
    await assertFocusInsideModal('wb-back-to-list-btn');
    await pressNavigationAndChoiceShortcuts();
    await assertQuizSessionUntouched();

    // 7. Click non-focusable header text to test explicit blur recovery onto dialog,
    //    test all shortcuts including Space, Tab wrapping, and Escape close
    await modal.locator('.wb-header__title').click();
    await assertFocusInsideModal('wb-modal');
    await pressAllQuizShortcuts();
    await assertQuizSessionUntouched();

    await page.keyboard.press('Tab');
    await assertFocusInsideModal();

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('wb-open-btn')).toBeFocused();

    // 8. Subjective 'short' mode Space reveal isolation (both after reveal-btn unmount and with dialog focused)
    await seedStoreAndReload(
      page,
      makeSeededStore({
        wrongIds: [qShort.id],
      }),
      '#/quiz',
    );
    await modeCard(page, 'short').click();
    await expect(page.getByTestId('btn-reveal-answer')).toBeVisible();
    await expect(page.getByTestId('q-ref-answer')).toHaveCount(0);

    await page.getByTestId('wb-open-btn').click();
    await page.getByTestId('wb-start-practice-btn').click();
    await page.getByTestId('wb-practice-reveal-btn').click();
    await expect(page.getByTestId('wb-practice-explanation')).toBeVisible();
    await page.getByTestId('wb-practice-stem').click();
    await assertFocusInsideModal('wb-modal');
    await page.keyboard.press(' ');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wb-modal')).toBeHidden();
    await expect(page.getByTestId('q-ref-answer')).toHaveCount(0);
    await expect(page.getByTestId('btn-reveal-answer')).toBeVisible();
  });

  test('R2 & R4: marking mastered while signed in syncs ok=1 to cloud progress and respects scope isolation', async ({
    page,
  }) => {
    test.skip(process.env.PW_AUTH_DISABLED === '1', 'Requires Supabase gateway env');
    const [q1] = pickQuestions({ type: 'choice', limit: 1 });
    if (!q1) throw new Error('Expected choice question');

    const gateway = await installAuthGateway(page);
    gateway.addAccount('wb-sync@example.com', 'password123', '错题学员');

    // Seed guest localStorage with an unrelated wrong question to verify scope isolation
    await seedStoreAndReload(
      page,
      makeSeededStore({
        wrongIds: [q1.id],
      }),
      '#/quiz',
    );

    // Sign in as account user
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-account-input').fill('wb-sync@example.com');
    await page.getByTestId('auth-password-input').fill('password123');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeHidden();
    await expect(page.getByTestId('user-menu-trigger')).toBeVisible();

    // Answer a choice question wrong as the signed-in account
    await modeCard(page, 'choice').click();
    const accountStem = (await page.getByTestId('q-stem').innerText()).trim();
    const accountQ = findQuestionByStem(accountStem, buildQuestionStemMap());
    const wrongChoice = getWrongChoiceFor(accountQ) as number;
    const correctChoice = getCorrectChoiceFor(accountQ) as number;
    await quizOption(page, wrongChoice).click();
    await expect(page.getByTestId('quiz-feedback')).toContainText('回答错误');

    // Open Smart Wrong Book and mark mastered
    await page.getByTestId('wb-open-btn').click();
    await expect(page.getByTestId('wb-item-card')).toHaveCount(1);
    await page.getByTestId('wb-item-mastered-btn').click();
    await expect(page.getByTestId('wb-empty-state')).toBeVisible();

    // Verify cloud progress synced ok: 1 with correct choice
    await expect
      .poll(() => gateway.getCloudProgress('wb-sync@example.com', 'builtin-ai-intro')?.store.records[accountQ.id])
      .toMatchObject({ ok: 1, choice: correctChoice });

    // Confirm legacy-guest localStorage key wasn't overwritten by account scope write
    const legacyGuestRaw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(legacyGuestRaw).not.toBeNull();
    const parsed = JSON.parse(legacyGuestRaw!) as { records?: Record<string, { ok?: number }> };
    expect(parsed.records?.[q1.id]?.ok).toBe(0);
  });
});
