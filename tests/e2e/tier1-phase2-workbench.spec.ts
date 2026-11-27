import type { Locator, Page } from '@playwright/test';
import {
  expect,
  onlyDesktop,
  onlyMobile,
  test,
} from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import {
  BUILTIN_GUIDE_BANK_ID,
  FIXTURE_BANK,
  FIXTURE_BANK_ID,
  MARKDOWN_LATEX_BANK,
  SMART_WASH_RAW_TEXT,
  makeMdUploadFile,
  makeTxtUploadFile,
  seedFixtureBank,
} from './helpers/fixtureBank.ts';
import { installMockLlm, seedGuestApiConfig } from './helpers/mockLlm.ts';
import {
  aiBtnExplain,
  aiChatCard,
  aiChatInput,
  aiChatSend,
  aiExplainDrawer,
  aiFollowupPill,
  aiWashBtn,
  answerCurrentQuestion,
  answerSheet,
  bankImportFileInput,
  bankSwitcher,
  btnConfirmImportSticky,
  btnNext,
  btnOpenQuizImport,
  btnPrev,
  btnStar,
  draftAiInferred,
  draftEdit,
  ensureAnswerSheetOpen,
  filterCount,
  filterOrder,
  gotoRoute,
  importPasteTextarea,
  importTab,
  modeCard,
  navLink,
  previewDraft,
  qStem,
  quizBadgeTotal,
  quizFeedback,
  quizImportDialog,
  quizOption,
  quizProgressText,
  resultRight,
  resultScore,
  selectQuizFilters,
  sheetFilter,
  statCard,
  washPrefExplain,
  washPrefTags,
  washTargetBankMode,
  washTargetBankName,
  workbenchSidebarToggle,
  workspaceMobileBar,
} from './helpers/selectors.ts';
import {
  buildQuestionStemMap,
  loadBankCatalog,
  makeEmptyStore,
} from './helpers/storage.ts';

async function openSmartImportPasteTab(page: Page): Promise<void> {
  await btnOpenQuizImport(page).click();
  await expect(quizImportDialog(page)).toBeVisible();
  const pasteTab = importTab(page, 'paste');
  if (await pasteTab.isVisible()) {
    await pasteTab.click();
  }
}

async function togglePrefControl(locator: Locator): Promise<boolean> {
  await expect(locator).toBeVisible();
  const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'input') {
    const before = await locator.isChecked();
    await locator.click();
    const after = await locator.isChecked();
    expect(after).toBe(!before);
    return after;
  }
  const beforeAttr =
    (await locator.getAttribute('aria-checked')) ??
    (await locator.getAttribute('aria-pressed'));
  await locator.click();
  if (beforeAttr !== null) {
    const afterAttr =
      (await locator.getAttribute('aria-checked')) ??
      (await locator.getAttribute('aria-pressed'));
    expect(afterAttr).not.toBe(beforeAttr);
    return afterAttr === 'true';
  }
  return true;
}

async function ensureWorkbenchSidebarOpen(page: Page): Promise<void> {
  const toggle = workbenchSidebarToggle(page);
  if (await toggle.isVisible().catch(() => false)) {
    const expanded = await toggle.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await toggle.click();
    }
  }
}

async function setWashTargetNewBank(page: Page, bankName: string): Promise<void> {
  await ensureWorkbenchSidebarOpen(page);
  const modeEl = washTargetBankMode(page);
  if (await modeEl.isVisible()) {
    const tagName = await modeEl.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
      const targetVal = await modeEl.evaluate((sel) => {
        const options = Array.from((sel as HTMLSelectElement).options);
        const match = options.find((o) => /^(new|create)$/i.test(o.value) || /新建/.test(o.text));
        return match?.value ?? options[0]?.value ?? '';
      });
      if (targetVal) {
        await modeEl.selectOption(targetVal);
      }
    } else {
      const pressed = await modeEl.getAttribute('aria-pressed');
      if (pressed === 'false') {
        await modeEl.click();
      }
    }
  }
  const nameInput = washTargetBankName(page);
  await expect(nameInput).toBeVisible();
  await nameInput.fill(bankName);
}

async function switchActiveBank(page: Page, bankId: string, bankTitlePattern: RegExp): Promise<void> {
  const switcher = bankSwitcher(page);
  await expect(switcher).toBeVisible();
  const tagName = await switcher.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    await switcher.selectOption(bankId);
    return;
  }
  await switcher.click();
  const optionByTestId = page
    .locator(`[data-bank-id="${bankId}"], [data-testid="bank-option-${bankId}"]`)
    .first();
  if (await optionByTestId.isVisible()) {
    await optionByTestId.click();
    return;
  }
  await page.getByRole('option', { name: bankTitlePattern }).or(
    page.getByRole('menuitem', { name: bankTitlePattern }),
  ).or(
    page.getByRole('button', { name: bankTitlePattern }),
  ).first().click();
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  tolerancePx = 1,
): boolean {
  const ixW = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const ixH = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return ixW > tolerancePx && ixH > tolerancePx;
}

test.describe('Tier 1 (Phase 2): QuizHub Brand, Smart Import Workbench, Unified Workspace & AI Explanation', () => {
  // =========================================================================
  // F8: Brand Unification & Onboarding Bank
  // =========================================================================
  test('T1-P2-001 [F8] Document metadata, TopNav, HubPage, footer & AuthModal reflect QuizHub brand with zero legacy demo text', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await assertFullLayoutAudit(page);

    const title = await page.title();
    expect(title).toContain('QuizHub');
    expect(title).not.toContain('人工智能导论');

    const metaDesc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(metaDesc ?? '').toContain('QuizHub');
    expect(metaDesc ?? '').not.toContain('人工智能导论');

    await expect(page.locator('header')).toContainText('QuizHub');
    await expect(page.locator('main')).toContainText('QuizHub');
    const footerCount = await page.locator('footer').count();
    if (footerCount > 0) {
      await expect(page.locator('footer').first()).toContainText('QuizHub');
    }

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('人工智能导论');

    const authBtn = page.getByTestId('auth-open-btn');
    if (await authBtn.isVisible()) {
      await authBtn.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('QuizHub');
      expect(await dialog.innerText()).not.toContain('人工智能导论');
      await page.keyboard.press('Escape');
    }
  });

  test('T1-P2-002 [F8] QuizHome & Notes Handbook show QuizHub onboarding bank (3 questions) and clean guide manual', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await assertFullLayoutAudit(page);

    await expect(quizBadgeTotal(page)).toContainText('3');
    await expect(page.locator('main')).toContainText('QuizHub');
    expect(await page.locator('body').innerText()).not.toContain('人工智能导论');
    await expect(statCard(page, 'done')).toContainText('0');

    await navLink(page, 'notes').click();
    await expect(page).toHaveURL(/#\/notes/);
    await assertFullLayoutAudit(page, { checkTables: true });
    await expect(page.locator('main')).toContainText('QuizHub 使用指南与功能手册');
    expect(await page.locator('body').innerText()).not.toContain('人工智能导论');
  });

  test('T1-P2-003 [F8] Built-in onboarding bank delivers 3 showcase questions playable end-to-end', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const onboardingBank = loadBankCatalog();
    expect(onboardingBank.meta.title).toBe('QuizHub 使用引导示例题库');
    expect(onboardingBank.questions.length).toBeGreaterThanOrEqual(2);
    expect(onboardingBank.questions.length).toBeLessThanOrEqual(3);

    for (const anchor of ['在 QuizHub 刷题工作台中', '以下哪些特性是受支持的', '两点分布']) {
      const matched = onboardingBank.questions.find((q) => q.stem.includes(anchor));
      expect(matched, `Expected onboarding bank question matching "${anchor}"`).toBeDefined();
    }
    await gotoRoute(page, '#/quiz');
    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'all').click();
    await expect(quizProgressText(page)).toContainText(`1 / ${onboardingBank.questions.length}`);

    for (let i = 0; i < onboardingBank.questions.length; i++) {
      const question = onboardingBank.questions[i]!;
      if (Array.isArray(question.answer)) {
        for (const option of question.answer) await quizOption(page, option).click();
        await page.getByTestId('btn-submit-multi').click();
      } else if (typeof question.answer === 'number') {
        await quizOption(page, question.answer).click();
      } else {
        throw new Error(`Expected an objective onboarding question, received ${question.type}`);
      }
      await expect(quizFeedback(page)).toContainText('回答正确');
      await btnNext(page).click();
    }

    await expect(resultScore(page)).toContainText('100%');
    await expect(resultRight(page)).toContainText(String(onboardingBank.questions.length));
  });

  test('T1-P2-004 [F8] Mobile 390x844 Hub, QuizHome & Notes render QuizHub brand cleanly with zero overflow', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/');
    await assertFullLayoutAudit(page);
    await expect(page.locator('body')).toContainText('QuizHub');
    expect(await page.locator('body').innerText()).not.toContain('人工智能导论');

    await gotoRoute(page, '#/quiz');
    await assertFullLayoutAudit(page);
    await expect(quizBadgeTotal(page)).toContainText('3');

    await gotoRoute(page, '#/notes');
    await assertFullLayoutAudit(page, { checkTables: true });
    await expect(page.locator('main')).toContainText('QuizHub 使用指南与功能手册');
  });

  // =========================================================================
  // F4 + F5: Smart Import & Washing Workbench
  // =========================================================================
  test('T1-P2-005 [F4/F5] Paste SMART_WASH_RAW_TEXT, toggle wash prefs, set target bank & run AI wash with AI-inferred badge', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    const mockLlm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);

    await importPasteTextarea(page).fill(SMART_WASH_RAW_TEXT);

    // Toggle auto-explain and auto-tags preferences on/off and back to enabled
    await togglePrefControl(washPrefExplain(page));
    await togglePrefControl(washPrefExplain(page));
    await togglePrefControl(washPrefTags(page));
    await togglePrefControl(washPrefTags(page));

    await setWashTargetNewBank(page, 'AI 智能洗题测试库');
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 0)).toBeVisible();
    await expect(previewDraft(page, 3)).toBeVisible();

    // Q2 in SMART_WASH_RAW_TEXT has no explicit answer -> must carry AI-inferred badge
    await expect(draftAiInferred(page, 1)).toBeVisible();
    await expect(draftAiInferred(page, 1)).toContainText(/AI\s*推断/);

    const washRequests = mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions'));
    expect(washRequests.length).toBeGreaterThanOrEqual(1);
    const firstUserMsg = washRequests[0]?.body?.messages?.find((m) => m.role === 'user')?.content ?? '';
    expect(firstUserMsg).toContain('HTTP');
  });

  test('T1-P2-006 [F5] Inline stem/option/answer edit on washed cards & sticky confirm activates bank in #/quiz', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page);

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);
    await importPasteTextarea(page).fill(SMART_WASH_RAW_TEXT);
    await setWashTargetNewBank(page, '洗题校对入库测试库');
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 1)).toBeVisible();
    await expect(draftAiInferred(page, 1)).toBeVisible();

    const stemEditor = page.getByTestId('draft-edit-stem-1');
    if (!(await stemEditor.isVisible())) {
      await draftEdit(page, 1).click();
    }
    await expect(stemEditor).toBeVisible();
    await stemEditor.fill('已人工校对的梯度下降题干内容');
    await page.getByTestId('draft-edit-opt-1-0').fill('沿着负梯度方向迭代收敛');
    await page.getByTestId('draft-edit-ans-1-2').click();

    await expect(previewDraft(page, 1)).toContainText('已人工校对的梯度下降题干内容');

    const stickyBtn = btnConfirmImportSticky(page);
    await expect(stickyBtn).toBeVisible();
    await expect(stickyBtn).toContainText('确认导入题库');
    await expect(stickyBtn).toContainText('4');
    await stickyBtn.click();
    await expect(quizImportDialog(page)).toBeHidden({ timeout: 10_000 });

    // Bank becomes active in #/quiz workspace
    if (!/#\/quiz/.test(page.url())) {
      await gotoRoute(page, '#/quiz');
    }
    await expect(page.locator('main')).toContainText('洗题校对入库测试库');
    await expect(quizBadgeTotal(page)).toContainText('4');

    await selectQuizFilters(page, { order: 'seq', count: 10 });
    await modeCard(page, 'choice').click();
    // Navigate until we see the edited stem
    const firstStem = await qStem(page).innerText();
    if (!firstStem.includes('已人工校对的梯度下降题干内容')) {
      await btnNext(page).click();
    }
    await expect(qStem(page)).toContainText('已人工校对的梯度下降题干内容');
  });

  test('T1-P2-007 [F4/F5] Upload .txt file -> AI wash -> sticky confirm activates bank in #/quiz', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await expect(quizImportDialog(page)).toBeVisible();

    await bankImportFileInput(page).setInputFiles(makeTxtUploadFile('txt-wash-bank.txt'));
    await expect(workbenchSidebarToggle(page)).toBeVisible();
    await setWashTargetNewBank(page, 'TXT洗题导入库');
    if (await aiWashBtn(page).isEnabled()) {
      await aiWashBtn(page).click();
    }

    await expect(previewDraft(page, 0)).toBeVisible();
    await expect(draftAiInferred(page, 1)).toBeVisible();

    const stickyBtn = btnConfirmImportSticky(page);
    await expect(stickyBtn).toBeEnabled();
    await stickyBtn.click();
    await expect(quizImportDialog(page)).toBeHidden({ timeout: 10_000 });

    if (!/#\/quiz/.test(page.url())) {
      await gotoRoute(page, '#/quiz');
    }
    await expect(page.locator('main')).toContainText('TXT洗题导入库');
    await expect(quizBadgeTotal(page)).toContainText('4');
  });

  test('T1-P2-008 [F4/F5] Upload .md file -> AI wash -> sticky confirm activates bank in #/quiz', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await expect(quizImportDialog(page)).toBeVisible();

    await bankImportFileInput(page).setInputFiles(makeMdUploadFile('md-wash-bank.md'));
    await expect(workbenchSidebarToggle(page)).toBeVisible();
    await setWashTargetNewBank(page, 'Markdown洗题导入库');
    if (await aiWashBtn(page).isEnabled()) {
      await aiWashBtn(page).click();
    }

    await expect(previewDraft(page, 0)).toBeVisible();
    await expect(draftAiInferred(page, 1)).toBeVisible();

    await btnConfirmImportSticky(page).click();
    await expect(quizImportDialog(page)).toBeHidden({ timeout: 10_000 });
    if (!/#\/quiz/.test(page.url())) {
      await gotoRoute(page, '#/quiz');
    }
    await expect(page.locator('main')).toContainText('Markdown洗题导入库');
    await expect(quizBadgeTotal(page)).toContainText('4');
  });

  test('T1-P2-009 [F5] Mobile 390x844 Smart Import workbench renders stacked layout & sticky confirm cleanly', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page);

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);
    await assertFullLayoutAudit(page);

    await importPasteTextarea(page).fill(SMART_WASH_RAW_TEXT);
    await setWashTargetNewBank(page, '移动端洗题题库');
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 0)).toBeVisible();
    await expect(btnConfirmImportSticky(page)).toBeVisible();
    await assertFullLayoutAudit(page);
  });

  // =========================================================================
  // F6: Unified Workspace & Upgraded Quiz UI
  // =========================================================================
  test('T1-P2-010 [F6] bank-switcher switches cleanly between built-in onboarding bank and seeded custom bank', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      targetHashRoute: '#/quiz',
    });

    await expect(quizBadgeTotal(page)).toContainText(`${FIXTURE_BANK.meta.counts.total}`);
    await expect(bankSwitcher(page)).toBeVisible();

    await switchActiveBank(page, BUILTIN_GUIDE_BANK_ID, /QuizHub 使用引导示例题库/);
    await expect(quizBadgeTotal(page)).toContainText('3');

    await switchActiveBank(page, FIXTURE_BANK_ID, new RegExp(FIXTURE_BANK.meta.title));
    await expect(quizBadgeTotal(page)).toContainText(`${FIXTURE_BANK.meta.counts.total}`);
  });

  test('T1-P2-011 [F6] RichContent renders Markdown headings, lists, code blocks, GFM tables, and KaTeX LaTeX delimiters', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, MARKDOWN_LATEX_BANK, makeEmptyStore(), {
      bankId: 'e2e-md-latex-bank',
      activate: true,
      targetHashRoute: '#/quiz',
    });

    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'all').click();

    const stem = qStem(page);
    await expect(stem).toBeVisible();
    await expect(stem.locator('h3, h2, h4').first()).toContainText('能量与求和公式推导');
    await expect(stem.locator('table')).toBeVisible();
    await expect(stem.locator('table')).toContainText('Newton');
    expect(await stem.locator('.katex').count()).toBeGreaterThanOrEqual(3);

    // Option 0 contains \[\nabla f(x)\]
    expect(await quizOption(page, 0).locator('.katex').count()).toBeGreaterThanOrEqual(1);

    await assertFullLayoutAudit(page, { checkTables: true });

    // Answer Q1 and check Markdown list + code block + KaTeX inside feedback
    await quizOption(page, 0).click();
    const feedback = quizFeedback(page);
    await expect(feedback).toBeVisible();
    await expect(feedback.locator('pre, code').first()).toBeVisible();
    await expect(feedback.locator('ul, li').first()).toBeVisible();
    expect(await feedback.locator('.katex').count()).toBeGreaterThanOrEqual(1);
  });

  test('T1-P2-012 [F6] Desktop keyboard shortcuts (1-4, A-D, ArrowRight, ArrowLeft) select options and navigate questions', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      targetHashRoute: '#/quiz',
    });

    await selectQuizFilters(page, { count: 10, order: 'seq' });
    await modeCard(page, 'choice').click();
    await expect(quizProgressText(page)).toContainText('1 / 10');
    await qStem(page).click();

    await page.keyboard.press('1');
    await expect(quizFeedback(page)).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(quizProgressText(page)).toContainText('2 / 10');

    await page.keyboard.press('b');
    await expect(quizFeedback(page)).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(quizProgressText(page)).toContainText('1 / 10');
  });

  test('T1-P2-013 [F6] Answer sheet filters (all, unanswered, wrong, fav) isolate items accurately', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      targetHashRoute: '#/quiz',
    });

    await selectQuizFilters(page, { count: 10, order: 'seq' });
    await modeCard(page, 'choice').click();

    // Q1 correct
    await answerCurrentQuestion(page, stemMap, 'correct');
    await btnNext(page).click();

    // Q2 wrong + favorited
    await answerCurrentQuestion(page, stemMap, 'wrong');
    await btnStar(page).click();
    await btnNext(page).click();

    await ensureAnswerSheetOpen(page);
    await expect(answerSheet(page)).toBeVisible();

    await sheetFilter(page, 'all').click();
    await expect(page.locator('[data-testid^="sheet-item-"]')).toHaveCount(10);

    await sheetFilter(page, 'wrong').click();
    await expect(page.locator('[data-testid^="sheet-item-"]')).toHaveCount(1);

    await sheetFilter(page, 'fav').click();
    await expect(page.locator('[data-testid^="sheet-item-"]')).toHaveCount(1);

    await sheetFilter(page, 'unanswered').click();
    await expect(page.locator('[data-testid^="sheet-item-"]')).toHaveCount(8);

    // Jump to Q2 via wrong filter
    await sheetFilter(page, 'wrong').click();
    await page.locator('[data-testid^="sheet-item-"]').first().click();
    await expect(quizProgressText(page)).toContainText('2 / 10');
  });

  test('T1-P2-014 [F6] Mobile 390x844 workspace-mobile-bar thumb controls navigate, star, and toggle answer sheet cleanly', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      targetHashRoute: '#/quiz',
    });

    await filterCount(page).selectOption('10');
    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'choice').click();

    const mobileBar = workspaceMobileBar(page);
    await expect(mobileBar).toBeVisible();
    await assertFullLayoutAudit(page);

    await btnStar(page).click();
    await btnNext(page).click();
    await expect(quizProgressText(page)).toContainText('2 / 10');

    await btnPrev(page).click();
    await expect(quizProgressText(page)).toContainText('1 / 10');

    await ensureAnswerSheetOpen(page);
    await assertFullLayoutAudit(page);
  });

  // =========================================================================
  // F7: AI Deep Explanation & Multi-turn Chat
  // =========================================================================
  test('T1-P2-015 [F7] Manual ai-btn-explain opens desktop right drawer without occluding stem/options and streams structured analysis', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      apiConfig: {},
      targetHashRoute: '#/quiz',
    });
    const mockLlm = await installMockLlm(page);

    await filterCount(page).selectOption('10');
    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'choice').click();

    await quizOption(page, 0).click();
    await expect(aiBtnExplain(page)).toBeVisible();
    await aiBtnExplain(page).click();

    const drawer = aiExplainDrawer(page);
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('核心考点');
    await expect(drawer).toContainText('解题思路');
    await expect(drawer).toContainText('逐项排错');
    expect(await drawer.locator('.katex').count()).toBeGreaterThanOrEqual(1);

    // Desktop side drawer/split panel must NOT occlude stem or options
    const drawerBox = await drawer.boundingBox();
    const stemBox = await qStem(page).boundingBox();
    const opt0Box = await quizOption(page, 0).boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(stemBox).not.toBeNull();
    expect(opt0Box).not.toBeNull();
    expect(boxesOverlap(drawerBox!, stemBox!)).toBe(false);
    expect(boxesOverlap(drawerBox!, opt0Box!)).toBe(false);

    const streamReqs = mockLlm.requests.filter((r) => r.body?.stream === true);
    expect(streamReqs).toHaveLength(1);
    const accountButton = page.getByTestId('auth-open-btn');
    if (await accountButton.isVisible()) {
      await page.evaluate(() => window.scrollTo({ top: 60, behavior: 'instant' }));
      const settingsBox = await page.getByTestId('btn-api-settings').boundingBox();
      const accountBox = await accountButton.boundingBox();
      expect(settingsBox).not.toBeNull();
      expect(accountBox).not.toBeNull();
      expect(boxesOverlap(settingsBox!, accountBox!)).toBe(false);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await assertFullLayoutAudit(page);
  });

  test('T1-P2-016 [F7] Quick follow-up pill ai-followup-pill-0 sends contextual prompt and streams reply', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      apiConfig: {},
      targetHashRoute: '#/quiz',
    });
    const mockLlm = await installMockLlm(page);

    await filterCount(page).selectOption('10');
    await modeCard(page, 'choice').click();
    await quizOption(page, 0).click();

    await aiBtnExplain(page).click();
    await expect(aiExplainDrawer(page)).toContainText('逐项排错');

    const pill0 = aiFollowupPill(page, 0);
    await expect(pill0).toBeVisible();
    await pill0.click();

    await expect(aiExplainDrawer(page).or(aiChatCard(page)).first()).toContainText('针对追问');
    const streamReqs = mockLlm.requests.filter((r) => r.body?.stream === true);
    expect(streamReqs.length).toBeGreaterThanOrEqual(2);
  });

  test('T1-P2-017 [F7] Custom multi-turn chat via ai-chat-input & ai-chat-send forwards prior conversation history', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      apiConfig: {},
      targetHashRoute: '#/quiz',
    });
    const mockLlm = await installMockLlm(page);

    await filterCount(page).selectOption('10');
    await modeCard(page, 'choice').click();
    await quizOption(page, 0).click();

    await aiBtnExplain(page).click();
    await expect(aiExplainDrawer(page)).toContainText('逐项排错');

    await aiChatInput(page).fill('第一轮追问：为什么不是选项 B？');
    await aiChatSend(page).click();
    await expect(aiExplainDrawer(page)).toContainText('第一轮追问：为什么不是选项 B？');

    await aiChatInput(page).fill('第二轮追问：请举一个边界反例');
    await aiChatSend(page).click();
    await expect(aiExplainDrawer(page)).toContainText('第二轮追问：请举一个边界反例');

    const streamReqs = mockLlm.requests.filter((r) => r.body?.stream === true);
    expect(streamReqs.length).toBeGreaterThanOrEqual(3);
    const lastMessages = streamReqs[streamReqs.length - 1]?.body?.messages ?? [];
    const serialized = JSON.stringify(lastMessages);
    expect(serialized).toContain('第一轮追问');
    expect(serialized).toContain('第二轮追问');
    expect(lastMessages.some((m) => m.role === 'assistant')).toBe(true);
  });

  test('T1-P2-018 [F7] Mobile 390x844 AI explain bottom sheet/expandable panel & follow-up pill pass layout audit', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      apiConfig: {},
      targetHashRoute: '#/quiz',
    });
    await installMockLlm(page);

    await filterCount(page).selectOption('10');
    await modeCard(page, 'choice').click();
    await quizOption(page, 0).click();

    await aiBtnExplain(page).click();
    const drawer = aiExplainDrawer(page);
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('核心考点');
    await expect(drawer).toContainText('逐项排错');

    await aiFollowupPill(page, 0).click();
    await expect(drawer).toContainText('针对追问');
    await assertFullLayoutAudit(page);
  });
});
