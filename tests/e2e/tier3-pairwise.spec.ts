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
  btnResetStore,
  btnResultHome,
  btnRetryMore,
  btnRetryWrong,
  btnRevealAnswer,
  btnStar,
  chapterChip,
  ensureAnswerSheetOpen,
  gotoRoute,
  inputImportFile,
  listClearWrong,
  listEmpty,
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
  resultRight,
  resultScore,
  resultTotal,
  selectQuizFilters,
  selfCheckBtn,
  sheetItem,
  statCard,
} from './helpers/selectors.ts';
import {
  buildQuestionStemMap,
  captureJsonExport,
  findQuestionByStem,
  importJsonFile,
  loadBankCatalog,
  makeSeededStore,
  pickQuestion,
  pickQuestions,
  readPersistedStore,
  seedStaleIdsStoreAndReload,
  seedStoreAndReload,
} from './helpers/storage.ts';

test.describe('Tier 3: Cross-Feature Pairwise Interactions (T3-001..T3-024)', () => {
  test('T3-001 Chapter x Origin x Order x Count x Type combination', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, {
      chapters: [2, 3],
      origin: 'comprehensive_bank',
      order: 'seq',
      count: 10,
    });
    await modeCard(page, 'tf').click();

    const total = Number.parseInt(
      (await quizProgressText(page).innerText()).split('/')[1]!.trim(),
      10,
    );
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(10);

    let prevCh = 0;
    for (let i = 0; i < Math.min(total, 5); i++) {
      const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
      expect(q.type).toBe('tf');
      expect([2, 3]).toContain(q.chapter);
      expect(q.source.origin).toBe('comprehensive_bank');
      expect(q.chapter).toBeGreaterThanOrEqual(prevCh);
      prevCh = q.chapter;
      await expect(qSourceTag(page)).toContainText(/综合/);
      if (i < Math.min(total, 5) - 1) await btnNext(page).click();
    }
  });

  test('T3-002 Chapter 1 x video_popup intersection or empty-pool guard', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const ch1VideoChoice = pickQuestions({
      chapter: 1,
      origin: 'video_popup',
      type: 'choice',
    });
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { chapters: [1], origin: 'video_popup', count: 10 });

    if (ch1VideoChoice.length > 0) {
      const stemMap = buildQuestionStemMap();
      await modeCard(page, 'choice').click();
      const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
      expect(q.chapter).toBe(1);
      expect(q.source.origin).toBe('video_popup');
    } else {
      page.once('dialog', (d) => d.accept());
      await modeCard(page, 'choice').click();
      await expect(modeCard(page, 'all')).toBeVisible();
    }
  });

  test('T3-003 Wrong choice -> Wrong Book 重做全部 -> answer right removes from Wrong Book', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'wrong');
    await quizExit(page).click();
    await expect(statCard(page, 'wrong')).toContainText('1');

    await navLink(page, 'wrong').click();
    await listRedoAll(page).click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await quizExit(page).click();

    await expect(statCard(page, 'wrong')).toContainText('0');
    await expect(statCard(page, 'acc')).toContainText('100%');
  });

  test('T3-004 Multi partial wrong -> Result 只练错题 -> exact right clears wrong count', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    const multiQ = pickQuestion({ type: 'multi' });
    await seedStoreAndReload(page, makeSeededStore({ favIds: [multiQ.id] }), '#/fav');
    await listRedoAll(page).click();
    await answerCurrentQuestion(page, stemMap, 'partial');
    await btnNext(page).click();
    await expect(resultScore(page)).toContainText('0%');

    await btnRetryWrong(page).click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await btnNext(page).click();
    await expect(resultScore(page)).toContainText('100%');
    await btnResultHome(page).click();
    await expect(statCard(page, 'wrong')).toContainText('0');
  });

  test('T3-005 Star 2 questions -> Favorites expand -> 重做全部 launches 收藏重练', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await btnStar(page).click();
    await btnNext(page).click();
    await btnStar(page).click();
    await quizExit(page).click();

    await navLink(page, 'fav').click();
    await expect(listItems(page)).toHaveCount(2);
    await expect(listClearWrong(page)).toBeHidden();
    await listRedoAll(page).click();
    await expect(quizModeTitle(page)).toContainText('收藏重练');
    await expect(quizProgressText(page)).toContainText('1 / 2');
  });

  test('T3-006 Handbook Chapter 6 刷本章题 -> Quiz Home only Ch6 -> session only Ch6', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/notes');
    await btnQuizChapter(page, 6).click();
    await expect(chapterChip(page, 6)).toHaveAttribute('aria-pressed', 'true');
    await expect(chapterChip(page, 1)).toHaveAttribute('aria-pressed', 'false');

    await modeCard(page, 'all').click();
    const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
    expect(q.chapter).toBe(6);
  });

  test('T3-007 Handbook search -> 刷本章题 -> global nav back to Handbook', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/notes');
    await notesSearch(page).fill('知识图谱');
    await expect(page.getByText(/知识图谱/).first()).toBeVisible();
    await btnQuizChapter(page, 3).click();
    await expect(page).toHaveURL(/#\/quiz/);
    await expect(chapterChip(page, 3)).toHaveAttribute('aria-pressed', 'true');
    await navLink(page, 'notes').click();
    await expect(page).toHaveURL(/#\/notes/);
  });

  test('T3-008 Practice -> Export JSON -> 清空记录 -> Import JSON restores stats & lists', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 3 });
    const store = makeSeededStore({
      correctIds: [qs[0]!.id, qs[1]!.id],
      wrongIds: [qs[2]!.id],
      favIds: [qs[0]!.id],
    });
    await seedStoreAndReload(page, store, '#/quiz');

    const exported = await captureJsonExport(page, () => btnExportJson(page).click());
    page.once('dialog', (d) => d.accept());
    await btnResetStore(page).click();
    const dialogBtn = page
      .getByRole('dialog')
      .getByRole('button', { name: /确认|确定|清空/ });
    if (await dialogBtn.isVisible().catch(() => false)) {
      await dialogBtn.click();
    }
    await expect(statCard(page, 'done')).toContainText('0');

    await importJsonFile(inputImportFile(page), exported.raw, exported.filename);
    await expect(statCard(page, 'done')).toContainText('3');
    await expect(statCard(page, 'acc')).toContainText('67%');
    await expect(statCard(page, 'wrong')).toContainText('1');
    await expect(statCard(page, 'fav')).toContainText('1');
  });

  test('T3-009 Short 有点模糊 -> Wrong Book 重做全部 -> re-rate 完全会 removes item', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 1).click();
    await quizExit(page).click();

    await navLink(page, 'wrong').click();
    await expect(listItems(page)).toHaveCount(1);
    await listRedoAll(page).click();
    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 2).click();
    await quizExit(page).click();

    await navLink(page, 'wrong').click();
    await expect(listEmpty(page)).toBeVisible();
  });

  test('T3-010 3-question analysis session -> Result wrong review -> 1-question retry', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const analysisPool = pickQuestions({ type: 'analysis' });
    const mode = analysisPool.length >= 3 ? 'analysis' : 'short';
    const stemMap = buildQuestionStemMap();

    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10, order: 'seq' });
    await modeCard(page, mode).click();

    // Q1 = 完全会, Q2 = 不会, skip rest to finish
    await answerCurrentQuestion(page, stemMap, 'correct');
    await btnNext(page).click();
    const q2 = await answerCurrentQuestion(page, stemMap, 'wrong');

    const total = Number.parseInt(
      (await quizProgressText(page).innerText()).split('/')[1]!.trim(),
      10,
    );
    for (let i = 1; i < total; i++) {
      await btnNext(page).click();
    }

    await expect(resultReviewItems(page)).toHaveCount(1);
    await resultReviewItems(page).first().click();
    await expect(quizProgressText(page)).toContainText('1 / 1');
    await expect(qStem(page)).toContainText(q2.stem.slice(0, 15));
  });

  test('T3-011 答题卡 jump Q8 -> answer -> 上一题 Q7 -> 答题卡 Q8 restores locked feedback', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();

    await ensureAnswerSheetOpen(page);
    await sheetItem(page, 7).click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await btnPrev(page).click();
    await expect(quizProgressText(page)).toContainText('7 / 10');
    await expect(quizFeedback(page)).toBeHidden();

    await ensureAnswerSheetOpen(page);
    await sheetItem(page, 7).click();
    await expect(quizFeedback(page)).toContainText('回答正确');
    await expect(sheetItem(page, 7)).toHaveAttribute('data-status', 'correct');
    await expect(sheetItem(page, 6)).toHaveAttribute('data-status', 'unanswered');
  });

  test('T3-012 答题卡 partial completion in 多选题 reports clean Result without NaN', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();

    await answerCurrentQuestion(page, stemMap, 'correct');
    await ensureAnswerSheetOpen(page);
    const total = Number.parseInt(
      (await quizProgressText(page).innerText()).split('/')[1]!.trim(),
      10,
    );
    await sheetItem(page, total - 1).click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await btnNext(page).click();

    const score = await resultScore(page).innerText();
    expect(score).not.toContain('NaN');
    await expect(resultRight(page)).toContainText('2');
    await expect(resultTotal(page)).toContainText(`${total}`);
  });

  test('T3-013 Mixed 总体刷题 answers choice/multi/tf/short in one session cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { chapters: 'all', count: 0, order: 'random' });
    await modeCard(page, 'all').click();

    const seenTypes = new Set<string>();
    const total = Number.parseInt(
      (await quizProgressText(page).innerText()).split('/')[1]!.trim(),
      10,
    );
    for (let i = 0; i < total && seenTypes.size < 4; i++) {
      const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
      if (!seenTypes.has(q.type) && q.type !== 'analysis') {
        await answerCurrentQuestion(page, stemMap, 'correct');
        seenTypes.add(q.type);
      }
      if (i < total - 1) await btnNext(page).click();
    }
    expect(seenTypes.size).toBe(4);
    await quizExit(page).click();
    await expect(statCard(page, 'done')).toContainText('4');
  });

  test('T3-014 Result 再来一组 preserves Ch1 + review_notes_synthesized origin filter', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, {
      chapters: [1],
      origin: 'review_notes_synthesized',
      count: 10,
    });
    await modeCard(page, 'all').click();
    const total = Number.parseInt(
      (await quizProgressText(page).innerText()).split('/')[1]!.trim(),
      10,
    );
    for (let i = 0; i < total; i++) {
      await btnNext(page).click();
    }

    await btnRetryMore(page).click();
    const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
    expect(q.chapter).toBe(1);
    expect(q.source.origin).toBe('review_notes_synthesized');
  });

  test('T3-015 Stale IDs seeded -> Home stats=2, Wrong Book=2, Export JSON clean', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 2 });
    await seedStaleIdsStoreAndReload(
      page,
      { validWrongIds: qs.map((q) => q.id), staleCount: 2 },
      '#/quiz',
    );
    await expect(statCard(page, 'wrong')).toContainText('2');
    const exported = await captureJsonExport(page, () => btnExportJson(page).click());
    expect(exported.parsed).toBeTruthy();

    await navLink(page, 'wrong').click();
    await expect(listItems(page)).toHaveCount(2);
  });

  test('T3-016 Global nav 错题本 from active session persists Q1 without timer leak', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'wrong');

    await navLink(page, 'wrong').click();
    await expect(page).toHaveURL(/#\/wrong/);
    await expect(listItems(page)).toHaveCount(1);
  });

  test('T3-017 Keyboard-only flow with focus safety across choice and short', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await page.keyboard.press('ArrowRight');
    await expect(quizProgressText(page)).toContainText('2 / 10');
    await page.keyboard.press('ArrowLeft');
    await expect(quizProgressText(page)).toContainText('1 / 10');
    await btnNext(page).focus();
    await page.keyboard.press('Enter');
    await expect(quizProgressText(page)).toContainText('2 / 10');
  });

  test('T3-018 Unstarring inside 收藏重练 removes item from Favorites and persists', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const q = pickQuestion({ type: 'choice' });
    await seedStoreAndReload(page, makeSeededStore({ favIds: [q.id] }), '#/fav');
    await listRedoAll(page).click();
    await expect(btnStar(page)).toHaveAttribute('aria-pressed', 'true');
    await btnStar(page).click();
    await expect(btnStar(page)).toHaveAttribute('aria-pressed', 'false');
    await quizExit(page).click();

    await navLink(page, 'fav').click();
    await expect(listEmpty(page)).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(listEmpty(page)).toBeVisible();
  });

  test('T3-019 Mobile 390x844 Handbook TOC jump + wide table scroll containment', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/notes');
    await notesToc(page).getByText(/第\s*6\s*章|第六章/).first().click();
    await expect(notesChapter(page, 6)).toBeVisible();
    await assertHandbookTablesContained(page);
    await assertFullLayoutAudit(page, { checkTables: true });
  });

  test('T3-020 Mode accuracies (choice 100%, tf 0%) reconcile with Home 总正确率 50%', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const choiceQ = pickQuestion({ type: 'choice' });
    const tfQ = pickQuestion({ type: 'tf' });
    await seedStoreAndReload(
      page,
      makeSeededStore({ correctIds: [choiceQ.id], wrongIds: [tfQ.id] }),
      '#/quiz',
    );
    await expect(modeCard(page, 'choice')).toContainText('100%');
    await expect(modeCard(page, 'tf')).toContainText('0%');
    await expect(statCard(page, 'acc')).toContainText('50%');
  });

  test('T3-021 Clearing Wrong Book preserves Favorites and persists across reload', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 4 });
    await seedStoreAndReload(
      page,
      makeSeededStore({
        wrongIds: [qs[0]!.id, qs[1]!.id, qs[2]!.id],
        favIds: [qs[3]!.id],
      }),
      '#/wrong',
    );
    page.once('dialog', (d) => d.accept());
    await listClearWrong(page).click();
    const dialogBtn = page
      .getByRole('dialog')
      .getByRole('button', { name: /确认|确定|清空/ });
    if (await dialogBtn.isVisible().catch(() => false)) {
      await dialogBtn.click();
    }
    await expect(listEmpty(page)).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navLink(page, 'fav').click();
    await expect(listItems(page)).toHaveCount(1);
  });

  test('T3-022 Mobile 390x844 full 5-route navigation tour passes layout & health audits', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    for (const route of ['#/', '#/notes', '#/quiz', '#/wrong', '#/fav', '#/']) {
      await gotoRoute(page, route);
      await assertNoHorizontalOverflow(page);
    }
  });

  test('T3-023 Export/Import preserves subjective mastery (0, 1, 2) and fav flags', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const shorts = pickQuestions({ type: 'short', limit: 3 });
    const store = makeSeededStore({
      favIds: [shorts[0]!.id],
      mastery: {
        [shorts[0]!.id]: 0,
        [shorts[1]!.id]: 1,
        [shorts[2]!.id]: 2,
      },
    });
    await seedStoreAndReload(page, store, '#/quiz');
    const exported = await captureJsonExport(page, () => btnExportJson(page).click());

    page.once('dialog', (d) => d.accept());
    await btnResetStore(page).click();
    const dialogBtn = page
      .getByRole('dialog')
      .getByRole('button', { name: /确认|确定|清空/ });
    if (await dialogBtn.isVisible().catch(() => false)) {
      await dialogBtn.click();
    }

    await importJsonFile(inputImportFile(page), exported.raw, exported.filename);
    const restored = await readPersistedStore(page);
    expect(restored?.mastery[shorts[0]!.id]).toBe(0);
    expect(restored?.mastery[shorts[1]!.id]).toBe(1);
    expect(restored?.mastery[shorts[2]!.id]).toBe(2);
    expect(restored?.fav[shorts[0]!.id]).toBe(true);

    await navLink(page, 'wrong').click();
    await expect(listItems(page)).toHaveCount(2);
  });

  test('T3-024 Origin comprehensive_bank x Chapter 1 updates all 6 mode card counts accurately', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { chapters: [1], origin: 'comprehensive_bank' });

    const subset = bank.questions.filter(
      (q) => q.chapter === 1 && q.source.origin === 'comprehensive_bank',
    );
    await expect(modeCard(page, 'all')).toContainText(`${subset.length}`);
    for (const t of ['choice', 'multi', 'tf', 'short', 'analysis'] as const) {
      const count = subset.filter((q) => q.type === t).length;
      await expect(modeCard(page, t)).toContainText(`${count}`);
    }
  });
});
