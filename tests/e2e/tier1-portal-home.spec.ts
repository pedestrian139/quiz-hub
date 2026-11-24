import {
  expect,
  onlyDesktop,
  onlyMobile,
  test,
} from './helpers/fixtures.ts';
import {
  assertFullLayoutAudit,
  assertNoHorizontalOverflow,
} from './helpers/audit.ts';
import {
  chapterChip,
  filterCount,
  filterOrder,
  filterOrigin,
  gotoRoute,
  hubBadgeChapters,
  hubBadgeTotal,
  hubCardNotes,
  hubCardQuiz,
  modeCard,
  navLink,
  qSourceTag,
  qStem,
  qTypeTag,
  quizBadgeTotal,
  quizProgressText,
  selectOnlyChapters,
  selectQuizFilters,
  statCard,
} from './helpers/selectors.ts';
import {
  buildQuestionStemMap,
  findQuestionByStem,
  loadBankCatalog,
  makeSeededStore,
  pickQuestions,
  seedStoreAndReload,
} from './helpers/storage.ts';

test.describe('Tier 1: Portal Hub, Navigation & Quiz Home (UF01-UF06)', () => {
  test('T1-001 [UF01] Portal Hub renders title, subtitle, and offline hint', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await expect(page.getByRole('heading', { name: /人工智能导论.*复习中心/ })).toBeVisible();
    await expect(page.getByText(/本地保存进度|离线|localStorage/i).first()).toBeVisible();
  });

  test('T1-002 [UF01] Portal Hub displays two primary clickable entry cards', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await expect(hubCardQuiz(page)).toBeVisible();
    await expect(hubCardNotes(page)).toBeVisible();
  });

  test('T1-003 [UF01] Portal Hub displays dynamic bank summary tags', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    await gotoRoute(page, '#/');
    await expect(hubBadgeTotal(page)).toContainText(`${bank.meta.counts.total}`);
    expect(bank.meta.counts.total).toBeGreaterThan(190);
    await expect(hubBadgeChapters(page)).toContainText('9');
    await expect(page.getByText(/单选|选择/).first()).toBeVisible();
    await expect(page.getByText(/多选/).first()).toBeVisible();
  });

  test('T1-004 [UF01] Clicking 刷题工具 card navigates to Quiz Home', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await hubCardQuiz(page).click();
    await expect(page).toHaveURL(/#\/quiz/);
    await expect(modeCard(page, 'all')).toBeVisible();
  });

  test('T1-005 [UF01] Clicking 知识点手册 card navigates to Handbook', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await hubCardNotes(page).click();
    await expect(page).toHaveURL(/#\/notes/);
    await expect(page.getByText('复习总纲').first()).toBeVisible();
    await expect(page.getByTestId('notes-chapter-1')).toBeVisible();
  });

  test('T1-006 [UF02] Global nav switches across all 5 routes with active state', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');

    await navLink(page, 'quiz').click();
    await expect(page).toHaveURL(/#\/quiz/);
    await expect(navLink(page, 'quiz')).toHaveAttribute('aria-current', 'page');

    await navLink(page, 'wrong').click();
    await expect(page).toHaveURL(/#\/wrong/);
    await expect(navLink(page, 'wrong')).toHaveAttribute('aria-current', 'page');

    await navLink(page, 'fav').click();
    await expect(page).toHaveURL(/#\/fav/);
    await expect(navLink(page, 'fav')).toHaveAttribute('aria-current', 'page');

    await navLink(page, 'notes').click();
    await expect(page).toHaveURL(/#\/notes/);
    await expect(navLink(page, 'notes')).toHaveAttribute('aria-current', 'page');

    await navLink(page, 'hub').click();
    await expect(page).toHaveURL(/#\/?$/);
    await expect(navLink(page, 'hub')).toHaveAttribute('aria-current', 'page');
  });

  test('T1-007 [UF02] Global nav transitions cleanly from #/quiz to #/notes', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await navLink(page, 'notes').click();
    await expect(page).toHaveURL(/#\/notes/);
    await expect(page.getByTestId('notes-chapter-1')).toBeVisible();
  });

  test('T1-008 [UF02] Global nav transitions cleanly from #/notes to #/quiz', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/notes');
    await navLink(page, 'quiz').click();
    await expect(page).toHaveURL(/#\/quiz/);
    await expect(modeCard(page, 'all')).toBeVisible();
  });

  test('T1-009 [UF02] Global nav transitions cleanly from #/wrong to #/ Hub', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/wrong');
    await navLink(page, 'hub').click();
    await expect(page).toHaveURL(/#\/?$/);
    await expect(hubCardQuiz(page)).toBeVisible();
  });

  test('T1-010 [UF02] Mobile global nav fits 390x844 and navigates cleanly', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/');
    await assertFullLayoutAudit(page);
    await navLink(page, 'quiz').click();
    await expect(page).toHaveURL(/#\/quiz/);
    await assertNoHorizontalOverflow(page);
    await navLink(page, 'notes').click();
    await expect(page).toHaveURL(/#\/notes/);
    await assertNoHorizontalOverflow(page);
  });

  test('T1-011 [UF03] Quiz Home hero displays title and dynamic bank badges', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    await gotoRoute(page, '#/quiz');
    await expect(page.getByRole('heading', { name: /人工智能导论.*刷题/ })).toBeVisible();
    await expect(quizBadgeTotal(page)).toContainText(`${bank.meta.counts.total}`);
    await expect(page.getByText(/9\s*章/).first()).toBeVisible();
    await expect(page.getByText(/本地保存进度/).first()).toBeVisible();
  });

  test('T1-012 [UF03] Quiz Home fresh 4-card stats grid shows initial zeros', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await expect(statCard(page, 'done')).toContainText('0');
    await expect(statCard(page, 'acc')).toContainText(/—|0%/);
    await expect(statCard(page, 'wrong')).toContainText('0');
    await expect(statCard(page, 'fav')).toContainText('0');
  });

  test('T1-013 [UF03] Quiz Home stats accurately compute seeded records and favs', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const choices = pickQuestions({ type: 'choice', limit: 3 });
    const store = makeSeededStore({
      correctIds: [choices[0]!.id, choices[1]!.id],
      wrongIds: [choices[2]!.id],
      favIds: [choices[0]!.id, choices[1]!.id],
    });
    await seedStoreAndReload(page, store, '#/quiz');
    await expect(statCard(page, 'done')).toContainText('3');
    await expect(statCard(page, 'acc')).toContainText('67%');
    await expect(statCard(page, 'wrong')).toContainText('1');
    await expect(statCard(page, 'fav')).toContainText('2');
  });

  test('T1-014 [UF03] Home stats immediately reflect new answer after exiting session', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const tfs = pickQuestions({ type: 'tf', limit: 2 });
    const store = makeSeededStore({ correctIds: [tfs[0]!.id] });
    await seedStoreAndReload(page, store, '#/quiz');
    await expect(statCard(page, 'done')).toContainText('1');

    const stemMap = buildQuestionStemMap();
    await selectQuizFilters(page, { chapters: [tfs[1]!.chapter], count: 10 });
    await modeCard(page, 'tf').click();
    const stem = (await qStem(page).innerText()).trim();
    const current = findQuestionByStem(stem, stemMap);
    await page.getByTestId(current.answer ? 'tf-btn-true' : 'tf-btn-false').click();
    await page.getByTestId('quiz-exit').click();

    await expect(statCard(page, 'done')).toContainText('2');
    await expect(statCard(page, 'acc')).toContainText('100%');
  });

  test('T1-015 [UF03] Mobile Quiz Home 4-card stats render cleanly in 2x2 grid', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/quiz');
    await assertFullLayoutAudit(page);
    await expect(statCard(page, 'done')).toBeVisible();
    await expect(statCard(page, 'acc')).toBeVisible();
    await expect(statCard(page, 'wrong')).toBeVisible();
    await expect(statCard(page, 'fav')).toBeVisible();
  });

  test('T1-016 [UF04] Quiz Home renders all 6 mode cards with non-zero counts', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    await gotoRoute(page, '#/quiz');
    await expect(modeCard(page, 'all')).toContainText(`${bank.meta.counts.total}`);
    for (const mode of ['choice', 'multi', 'tf', 'short', 'analysis'] as const) {
      const card = modeCard(page, mode);
      await expect(card).toBeVisible();
      await expect(card).toContainText(`${bank.meta.counts.byType[mode]}`);
    }
  });

  test('T1-017 [UF04] Clicking 总体刷题 starts mixed-type session up to selected count', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await expect(quizProgressText(page)).toContainText('1 / 10');
    await expect(qStem(page)).toBeVisible();
  });

  test('T1-018 [UF04] Clicking 单选题/选择题 mode queues only choice questions', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await expect(qTypeTag(page)).toContainText(/单选|选择/);
  });

  test('T1-019 [UF04] Clicking 多选题 mode queues only multi questions', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    await expect(qTypeTag(page)).toContainText(/多选/);
  });

  test('T1-020 [UF04] Per-type modes (tf/short/analysis) filter strictly & show mode accuracy', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const tfQ = pickQuestions({ type: 'tf', limit: 2 });
    const store = makeSeededStore({
      correctIds: [tfQ[0]!.id],
      wrongIds: [tfQ[1]!.id],
    });
    await seedStoreAndReload(page, store, '#/quiz');
    await expect(modeCard(page, 'tf')).toContainText('50%');

    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await expect(qTypeTag(page)).toContainText(/判断/);
    await page.getByTestId('quiz-exit').click();

    await modeCard(page, 'short').click();
    await expect(qTypeTag(page)).toContainText(/简答/);
    await page.getByTestId('quiz-exit').click();

    await modeCard(page, 'analysis').click();
    await expect(qTypeTag(page)).toContainText(/分析/);
  });

  test('T1-021 [UF05] Chapter filter displays 全部 + 9 active chapter chips by default', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await expect(chapterChip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
    for (let ch = 1; ch <= 9; ch++) {
      await expect(chapterChip(page, ch)).toBeVisible();
      await expect(chapterChip(page, ch)).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('T1-022 [UF05] Chapter chips expose short text and full chapter title', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    await gotoRoute(page, '#/quiz');
    for (const ch of bank.chapters) {
      const chip = chapterChip(page, ch.id);
      await expect(chip).toContainText(ch.short);
      await expect(chip).toHaveAttribute('title', ch.title);
    }
  });

  test('T1-023 [UF05] Selecting only Chapter 1 queues only Chapter 1 questions', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    const ch1Short = bank.chapters.find((c) => c.id === 1)!.short;
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { chapters: [1], count: 10 });
    await modeCard(page, 'all').click();
    for (let i = 0; i < 3; i++) {
      await expect(page.getByTestId('q-chapter-tag')).toContainText(
        new RegExp(`第\\s*1\\s*章|1\\.|${ch1Short}`),
      );
      await page.getByTestId('btn-next').click();
    }
  });

  test('T1-024 [UF05] Clicking 全部 reactivates all 9 chapters and restores totals', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    await gotoRoute(page, '#/quiz');
    await selectOnlyChapters(page, [1, 2]);
    await expect(chapterChip(page, 3)).toHaveAttribute('aria-pressed', 'false');

    await chapterChip(page, 'all').click();
    for (let ch = 1; ch <= 9; ch++) {
      await expect(chapterChip(page, ch)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(modeCard(page, 'all')).toContainText(`${bank.meta.counts.total}`);
  });

  test('T1-025 [UF05] Combining Chapter 3 + Chapter 5 updates mode card count to exact sum', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const ch3Count = pickQuestions({ chapter: 3 }).length;
    const ch5Count = pickQuestions({ chapter: 5 }).length;
    await gotoRoute(page, '#/quiz');
    await selectOnlyChapters(page, [3]);
    await expect(modeCard(page, 'all')).toContainText(`${ch3Count}`);

    await chapterChip(page, 5).click();
    await expect(modeCard(page, 'all')).toContainText(`${ch3Count + ch5Count}`);
  });

  test('T1-026 [UF06] Setting 题量=10 produces 10-question session denominator', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { chapters: 'all', count: 10 });
    await modeCard(page, 'all').click();
    await expect(quizProgressText(page)).toContainText('1 / 10');
  });

  test('T1-027 [UF06] 题量=30 caps at pool size while 全部 queues entire Chapter 1 pool', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const ch1Count = pickQuestions({ chapter: 1 }).length;
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { chapters: [1], count: 30 });
    await modeCard(page, 'all').click();
    await expect(quizProgressText(page)).toContainText(`1 / ${Math.min(30, ch1Count)}`);
    await page.getByTestId('quiz-exit').click();

    await selectQuizFilters(page, { chapters: [1], count: 0 });
    await modeCard(page, 'all').click();
    await expect(quizProgressText(page)).toContainText(`1 / ${ch1Count}`);
  });

  test('T1-028 [UF06] 顺序=seq queues chapters in non-decreasing chapter order', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, {
      chapters: [1, 2, 3],
      order: 'seq',
      count: 0,
    });
    await modeCard(page, 'choice').click();

    const totalText = await quizProgressText(page).innerText();
    const total = Number.parseInt(totalText.split('/')[1]!.trim(), 10);
    let prevChapter = 0;
    const checks = Math.min(total, 15);
    for (let i = 0; i < checks; i++) {
      const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
      expect(q.chapter).toBeGreaterThanOrEqual(prevChapter);
      prevChapter = q.chapter;
      if (i < checks - 1) await page.getByTestId('btn-next').click();
    }
  });

  test('T1-029 [UF06] Origin filter 视频弹题 restricts session strictly to video_popup', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, {
      chapters: 'all',
      origin: 'video_popup',
      count: 10,
    });
    await modeCard(page, 'all').click();
    for (let i = 0; i < 3; i++) {
      await expect(qSourceTag(page)).toContainText(/视频/);
      await page.getByTestId('btn-next').click();
    }
  });

  test('T1-030 [UF06] Origin filters 综合题库 and 复习资料精编 update counts and queue', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    await gotoRoute(page, '#/quiz');

    await filterOrigin(page).selectOption('comprehensive_bank');
    await expect(modeCard(page, 'all')).toContainText(
      `${bank.meta.counts.byOrigin.comprehensive_bank}`,
    );

    await filterOrigin(page).selectOption('review_notes_synthesized');
    await expect(modeCard(page, 'all')).toContainText(
      `${bank.meta.counts.byOrigin.review_notes_synthesized}`,
    );

    await filterCount(page).selectOption('10');
    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'all').click();
    await expect(qSourceTag(page)).toContainText(/复习资料|精编|提炼/);
  });
});
