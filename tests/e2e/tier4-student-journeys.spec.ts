import {
  expect,
  onlyDesktop,
  onlyMobile,
  test,
} from './helpers/fixtures.ts';
import {
  assertFullLayoutAudit,
  assertHandbookTablesContained,
  assertNoHorizontalOverflow,
} from './helpers/audit.ts';
import {
  answerCurrentQuestion,
  btnExportJson,
  btnNext,
  btnPrev,
  btnQuizChapter,
  btnResultHome,
  btnRevealAnswer,
  btnStar,
  ensureAnswerSheetOpen,
  gotoRoute,
  hubCardNotes,
  inputImportFile,
  listClearWrong,
  listEmpty,
  listItemAnswer,
  listItemToggle,
  listItems,
  listRedoAll,
  modeCard,
  navLink,
  notesChapter,
  notesSearch,
  notesToc,
  qSourceTag,
  qStem,
  quizExit,
  quizFeedback,
  quizModeTitle,
  quizProgressText,
  resultReviewItems,
  resultScore,
  resultTime,
  selectQuizFilters,
  selfCheckBtn,
  sheetItem,
  statCard,
} from './helpers/selectors.ts';
import {
  buildQuestionStemMap,
  captureJsonExport,
  findQuestionByStem,
  getCorrectChoiceFor,
  importJsonFile,
  loadNotesCatalog,
  makeSeededStore,
  pickQuestions,
  readPersistedStore,
  seedStoreAndReload,
} from './helpers/storage.ts';

test.describe('Tier 4: Real-World Student Journeys (T4-001..T4-012)', () => {
  test('T4-001 First-Time Onboarding: Hub -> Handbook search -> Chapter Practice -> Settlement', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/');
    await assertFullLayoutAudit(page);
    await hubCardNotes(page).click();

    await expect(page).toHaveURL(/#\/notes/);
    await notesSearch(page).fill('启发式搜索');
    await expect(page.getByText(/启发式/).first()).toBeVisible();
    await notesSearch(page).fill('');

    await btnQuizChapter(page, 3).click();
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();

    const total = Number.parseInt(
      (await quizProgressText(page).innerText()).split('/')[1]!.trim(),
      10,
    );
    await btnStar(page).click();
    for (let i = 0; i < total; i++) {
      await answerCurrentQuestion(page, stemMap, i === 0 ? 'wrong' : 'correct');
      await btnNext(page).click();
    }

    await expect(resultScore(page)).toBeVisible();
    await expect(resultTime(page)).toContainText(/\d+:\d{2}/);
    await expect(resultReviewItems(page)).toHaveCount(1);
    await btnResultHome(page).click();
    await expect(statCard(page, 'fav')).toContainText('1');
    await expect(statCard(page, 'wrong')).toContainText('1');
  });

  test('T4-002 Mobile Commuter Quick 10-Question Drill (390x844)', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await assertFullLayoutAudit(page);
    await selectQuizFilters(page, { chapters: [1, 2, 3], count: 10 });
    await modeCard(page, 'choice').click();

    for (let i = 0; i < 10; i++) {
      await assertNoHorizontalOverflow(page);
      await answerCurrentQuestion(page, stemMap, 'correct');
      if (i === 4) {
        await ensureAnswerSheetOpen(page);
        await assertNoHorizontalOverflow(page);
      }
      await btnNext(page).click();
    }
    await expect(resultScore(page)).toContainText('100%');
    await assertFullLayoutAudit(page);
  });

  test('T4-003 Subjective Memorization Loop (简答题 & Wrong Book Mastery)', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    const shortIdxApp = notes.appendices.find((a) => a.type === 'short_index');
    await gotoRoute(page, '#/notes');
    if (shortIdxApp) {
      await expect(page.getByText(shortIdxApp.title).first()).toBeVisible();
    }

    await navLink(page, 'quiz').click();
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();

    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 2).click();
    await btnNext(page).click();

    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 1).click();
    await btnNext(page).click();

    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 0).click();
    await quizExit(page).click();

    await expect(statCard(page, 'wrong')).toContainText('2');
    await navLink(page, 'wrong').click();
    await expect(listItems(page)).toHaveCount(2);

    await listRedoAll(page).click();
    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 2).click();
    await quizExit(page).click();
    await expect(statCard(page, 'wrong')).toContainText('1');
  });

  test('T4-004 Pre-Exam Mobile Handbook & Wide-Table Study + Targeted Retry (390x844)', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/notes');
    await notesToc(page).getByText(/易混|对照|第\s*2\s*章/).first().click();
    await assertHandbookTablesContained(page);

    await btnQuizChapter(page, 2).click();
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();

    const total = Math.min(
      5,
      Number.parseInt((await quizProgressText(page).innerText()).split('/')[1]!.trim(), 10),
    );
    for (let i = 0; i < total; i++) {
      await answerCurrentQuestion(page, stemMap, i === 0 ? 'wrong' : 'correct');
      if (i < total - 1) await btnNext(page).click();
    }
    // Jump to end and finish
    await ensureAnswerSheetOpen(page);
    const maxIdx =
      Number.parseInt((await quizProgressText(page).innerText()).split('/')[1]!.trim(), 10) - 1;
    await sheetItem(page, maxIdx).click();
    await btnNext(page).click();

    await expect(resultReviewItems(page)).toHaveCount(1);
    await resultReviewItems(page).first().click();
    await expect(quizProgressText(page)).toContainText('1 / 1');
    await assertNoHorizontalOverflow(page);
  });

  test('T4-005 Multi-Select & Video Popup Source Drill', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    const vidMultis = pickQuestions({ origin: 'video_popup', type: 'multi' });
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { origin: 'video_popup', count: 10 });
    const mode = vidMultis.length > 0 ? 'multi' : 'all';
    await modeCard(page, mode).click();

    await expect(qSourceTag(page)).toContainText(/视频/);
    await answerCurrentQuestion(page, stemMap, vidMultis.length > 0 ? 'partial' : 'wrong');
    await expect(quizFeedback(page)).toContainText('回答错误');
    await quizExit(page).click();
    await expect(statCard(page, 'wrong')).toContainText('1');
  });

  test('T4-006 Wrong Book Cleanup Marathon', async ({ page }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    const ch1 = pickQuestions({ chapter: 1, type: 'tf', limit: 2 });
    const ch4 = pickQuestions({ chapter: 4, type: 'tf', limit: 2 });
    const ch7 = pickQuestions({ chapter: 7, type: 'tf', limit: 1 });
    const wrongIds = [...ch1, ...ch4, ...ch7].map((q) => q.id);

    await seedStoreAndReload(page, makeSeededStore({ wrongIds }), '#/wrong');
    await expect(listItems(page)).toHaveCount(5);

    await listItemToggle(listItems(page).nth(0)).click();
    await expect(listItemAnswer(listItems(page).nth(0))).toBeVisible();
    await listItemToggle(listItems(page).nth(1)).click();
    await expect(listItemAnswer(listItems(page).nth(1))).toBeVisible();

    await listRedoAll(page).click();
    await expect(quizModeTitle(page)).toContainText('错题重练');
    for (let i = 0; i < 5; i++) {
      await answerCurrentQuestion(page, stemMap, i < 3 ? 'correct' : 'wrong');
      if (i < 4) await btnNext(page).click();
    }
    await quizExit(page).click();
    await expect(statCard(page, 'wrong')).toContainText('2');

    await navLink(page, 'wrong').click();
    await expect(listItems(page)).toHaveCount(2);
    page.once('dialog', (d) => d.accept());
    await listClearWrong(page).click();
    const dialogBtn = page
      .getByRole('dialog')
      .getByRole('button', { name: /确认|确定|清空/ });
    if (await dialogBtn.isVisible().catch(() => false)) {
      await dialogBtn.click();
    }
    await expect(listEmpty(page)).toBeVisible();
  });

  test('T4-007 Cross-Device Backup & Restore (Desktop 1440x900 -> Mobile 390x844)', async ({
    page,
    browser,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const choices = pickQuestions({ type: 'choice', limit: 4 });
    const shorts = pickQuestions({ type: 'short', limit: 2 });
    const seed = makeSeededStore({
      correctIds: [choices[0]!.id, choices[1]!.id],
      wrongIds: [choices[2]!.id, choices[3]!.id],
      favIds: [choices[0]!.id, shorts[0]!.id],
      mastery: { [shorts[0]!.id]: 2, [shorts[1]!.id]: 1 },
    });
    await seedStoreAndReload(page, seed, '#/quiz');
    const exported = await captureJsonExport(page, () => btnExportJson(page).click());

    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const mPage = await mobileCtx.newPage();
      await mPage.goto(page.url(), { waitUntil: 'domcontentloaded' });
      await importJsonFile(inputImportFile(mPage), exported.raw, exported.filename);
      await expect(statCard(mPage, 'done')).toContainText('6');
      await expect(statCard(mPage, 'wrong')).toContainText('3');
      await expect(statCard(mPage, 'fav')).toContainText('2');
      await assertFullLayoutAudit(mPage);
    } finally {
      await mobileCtx.close();
    }
  });

  test('T4-008 Keyboard-Only Power User Session', async ({ page }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();

    for (let i = 0; i < 10; i++) {
      const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
      const ans = getCorrectChoiceFor(q) as number;
      await page.keyboard.press(String(ans + 1));
      await expect(quizFeedback(page)).toContainText('回答正确');
      if (i === 1) {
        await btnPrev(page).focus();
        await page.keyboard.press('Enter');
        await expect(quizProgressText(page)).toContainText('1 / 10');
        await page.keyboard.press('ArrowRight');
        await expect(quizProgressText(page)).toContainText('2 / 10');
      }
      await page.keyboard.press('ArrowRight');
    }
    await expect(resultScore(page)).toContainText('100%');
  });

  test('T4-009 Curated Favorites Exam-Eve Review (390x844)', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();

    for (let i = 0; i < 3; i++) {
      await btnStar(page).click();
      if (i < 2) await btnNext(page).click();
    }
    await quizExit(page).click();

    await navLink(page, 'fav').click();
    await expect(listItems(page)).toHaveCount(3);
    await listItemToggle(listItems(page).first()).click();
    await assertFullLayoutAudit(page);

    await listRedoAll(page).click();
    await expect(quizModeTitle(page)).toContainText('收藏重练');
    await btnStar(page).click();
    await quizExit(page).click();

    await navLink(page, 'fav').click();
    await expect(listItems(page)).toHaveCount(2);
  });

  test('T4-010 Interrupted Session & Persistence Recovery', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 20 });
    await modeCard(page, 'tf').click();

    for (let i = 0; i < 4; i++) {
      await answerCurrentQuestion(page, stemMap, 'correct');
      await btnNext(page).click();
    }
    await ensureAnswerSheetOpen(page);
    await sheetItem(page, 9).click();
    await answerCurrentQuestion(page, stemMap, 'wrong');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoRoute(page, '#/quiz');
    await expect(statCard(page, 'done')).toContainText('5');
    await expect(statCard(page, 'wrong')).toContainText('1');
    const persisted = await readPersistedStore(page);
    expect(Object.keys(persisted?.records ?? {})).toHaveLength(5);
  });

  test('T4-011 Handbook Print-to-PDF Preparation', async ({ page }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/notes');
    await notesSearch(page).fill('');
    await page.emulateMedia({ media: 'print' });

    await expect(navLink(page, 'hub')).toBeHidden();
    await expect(notesSearch(page)).toBeHidden();
    await expect(btnQuizChapter(page, 1)).toBeHidden();
    for (let ch = 1; ch <= 9; ch++) {
      await expect(notesChapter(page, ch)).toBeVisible();
    }
  });

  test('T4-012 Shared URL Deep-Link & Static Integrity Audit (Desktop & Mobile)', async ({
    page,
    healthTrap,
  }) => {
    // Runs on BOTH desktop (1440x900) and mobile (390x844)
    for (const route of ['#/notes', '#/quiz', '#/wrong', '#/fav']) {
      await gotoRoute(page, route);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#root')).not.toBeEmpty();
      await assertNoHorizontalOverflow(page);
    }
    await gotoRoute(page, '#/unknown-shared-link');
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(healthTrap.httpErrors).toEqual([]);
    expect(healthTrap.consoleErrors).toEqual([]);
    expect(healthTrap.pageErrors).toEqual([]);
  });
});
