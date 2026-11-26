import {
  expect,
  onlyDesktop,
  onlyMobile,
  test,
} from './helpers/fixtures.ts';
import { assertNoHorizontalOverflow } from './helpers/audit.ts';
import {
  answerCurrentQuestion,
  btnNext,
  btnPrev,
  btnResultHome,
  btnRetryMore,
  btnRetryWrong,
  btnRevealAnswer,
  btnStar,
  btnSubmitMulti,
  ensureAnswerSheetOpen,
  gotoRoute,
  modeCard,
  qChapterTag,
  qRefAnswer,
  qSourceTag,
  qStem,
  qTypeTag,
  quizExit,
  quizFeedback,
  quizModeTitle,
  quizOption,
  quizProgressBar,
  quizProgressText,
  resultReviewItems,
  resultRight,
  resultScore,
  resultTime,
  resultTotal,
  selectQuizFilters,
  selfCheckBtn,
  sheetItem,
  statCard,
  tfBtn,
} from './helpers/selectors.ts';
import {
  buildQuestionStemMap,
  findQuestionByStem,
  getCorrectChoiceFor,
  loadBankCatalog,
  pickQuestion,
} from './helpers/storage.ts';

test.describe('Tier 1: Quiz Session, Modes, Answer Sheet & Result (UF07-UF15)', () => {
  test('T1-031 [UF07] Quiz topbar displays exit, title, fraction, and progress bar', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();

    await expect(quizExit(page)).toBeVisible();
    await expect(quizModeTitle(page)).toContainText('总体刷题');
    await expect(quizProgressText(page)).toContainText('1 / 10');
    const bar = quizProgressBar(page);
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
    await expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  test('T1-032 [UF07] Advancing Q1->Q5 updates fraction and progressbar proportionally', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();

    for (let i = 1; i < 5; i++) {
      await btnNext(page).click();
    }
    await expect(quizProgressText(page)).toContainText('5 / 10');
    await expect(quizProgressBar(page)).toHaveAttribute('aria-valuenow', '5');
  });

  test('T1-033 [UF07] Clicking exit returns immediately to Quiz Home without dialog', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await btnNext(page).click();
    await btnNext(page).click();
    await quizExit(page).click();
    await expect(modeCard(page, 'all')).toBeVisible();
  });

  test('T1-034 [UF07] Exiting after answering Q1 persists Q1 in Home stats', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await quizExit(page).click();
    await expect(statCard(page, 'done')).toContainText('1');
  });

  test('T1-035 [UF07] Elapsed duration on Result reflects real session time >= 0:02', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    const q = pickQuestion({ type: 'tf' });
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { chapters: [q.chapter], count: 10, order: 'seq' });
    await modeCard(page, 'tf').click();

    await page.waitForTimeout(2100);
    const total = Number.parseInt(
      (await quizProgressText(page).innerText()).split('/')[1]!.trim(),
      10,
    );
    await answerCurrentQuestion(page, stemMap, 'correct');
    for (let i = 1; i < total; i++) {
      await btnNext(page).click();
    }
    await btnNext(page).click();

    const elapsedText = (await resultTime(page).innerText()).trim();
    const match = elapsedText.match(/(\d+):(\d{2})/);
    expect(match).not.toBeNull();
    const secs = Number(match![1]) * 60 + Number(match![2]);
    expect(secs).toBeGreaterThanOrEqual(2);
  });

  test('T1-036 [UF08] Question card shows chapter, type, source tags and index', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await expect(qChapterTag(page)).toBeVisible();
    await expect(qTypeTag(page)).toBeVisible();
    await expect(qSourceTag(page)).toBeVisible();
    await expect(page.getByText(/第\s*1\s*题/).first()).toBeVisible();
  });

  test('T1-037 [UF08] Clicking favorite toggle stars question and sets aria-pressed', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await expect(btnStar(page)).toHaveAttribute('aria-pressed', 'false');
    await btnStar(page).click();
    await expect(btnStar(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('T1-038 [UF08] Starred question persists across reload and shows 收藏=1', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await btnStar(page).click();
    await quizExit(page).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(statCard(page, 'fav')).toContainText('1');
  });

  test('T1-039 [UF08] Unstarring a starred question reverts aria-pressed and decrements 收藏', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await btnStar(page).click();
    await expect(btnStar(page)).toHaveAttribute('aria-pressed', 'true');
    await btnStar(page).click();
    await expect(btnStar(page)).toHaveAttribute('aria-pressed', 'false');
    await quizExit(page).click();
    await expect(statCard(page, 'fav')).toContainText('0');
  });

  test('T1-040 [UF08] Chapter 2 video_popup question displays matching chapter & source tags', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    const ch2Vid = pickQuestion({ chapter: 2, origin: 'video_popup' });
    const ch2Short = bank.chapters.find((c) => c.id === 2)!.short;
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, {
      chapters: [ch2Vid.chapter],
      origin: 'video_popup',
      count: 10,
    });
    await modeCard(page, 'all').click();
    await expect(qChapterTag(page)).toContainText(
      new RegExp(`第\\s*2\\s*章|${ch2Short}`),
    );
    await expect(qSourceTag(page)).toContainText(/视频/);
  });

  test('T1-041 [UF09] Single-choice question renders 4 labeled options A-D', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const question = loadBankCatalog().questions.find((item) => item.type === 'choice' && item.options?.length === 4);
    if (!question) throw new Error('Expected a choice question with four options');
    await gotoRoute(page, '#/quiz');
    await page.getByTestId('filter-search').fill(question.stem);
    await modeCard(page, 'choice').click();
    await expect(qStem(page)).toContainText(question.stem);
    for (let i = 0; i < 4; i++) {
      await expect(quizOption(page, i)).toBeVisible();
    }
  });

  test('T1-042 [UF09] Clicking correct choice option grades immediately with 解析', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'correct');

    await expect(quizFeedback(page)).toContainText('回答正确');
    await expect(quizFeedback(page)).toContainText('解析');
    await expect(quizOption(page, 0)).toBeDisabled();
  });

  test('T1-043 [UF09] Clicking wrong choice option shows 回答错误, 正确答案, and 解析', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'wrong');

    await expect(quizFeedback(page)).toContainText('回答错误');
    await expect(quizFeedback(page)).toContainText('正确答案');
    await expect(quizFeedback(page)).toContainText('解析');
  });

  test('T1-044 [UF09] Keyboard shortcut 1 selects option A and grades immediately', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await page.keyboard.press('1');
    await expect(quizFeedback(page)).toContainText(/回答正确|回答错误/);
    await expect(quizOption(page, 0)).toBeDisabled();
  });

  test('T1-045 [UF09] Wrong choice answer increments 已练题数 and 错题 on Home', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'wrong');
    await quizExit(page).click();
    await expect(statCard(page, 'done')).toContainText('1');
    await expect(statCard(page, 'wrong')).toContainText('1');
  });

  test('T1-046 [UF10] Multi-select question renders toggleable options and 确认提交 button', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    await expect(quizOption(page, 0)).toHaveAttribute('aria-pressed', 'false');
    await expect(btnSubmitMulti(page)).toBeVisible();
  });

  test('T1-047 [UF10] Multi-select option toggles selected -> unselected without early grading', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    await quizOption(page, 0).click();
    await expect(quizOption(page, 0)).toHaveAttribute('aria-pressed', 'true');
    await expect(quizFeedback(page)).toBeHidden();
    await quizOption(page, 0).click();
    await expect(quizOption(page, 0)).toHaveAttribute('aria-pressed', 'false');
    await expect(quizFeedback(page)).toBeHidden();
  });

  test('T1-048 [UF10] Submitting exact correct multi-select set grades 回答正确', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    await answerCurrentQuestion(page, stemMap, 'correct');

    await expect(quizFeedback(page)).toContainText('回答正确');
    await expect(quizFeedback(page)).toContainText('解析');
    await expect(quizOption(page, 0)).toBeDisabled();
  });

  test('T1-049 [UF10] Submitting wrong multi-select set grades 回答错误 with 正确答案', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    await answerCurrentQuestion(page, stemMap, 'wrong');

    await expect(quizFeedback(page)).toContainText('回答错误');
    await expect(quizFeedback(page)).toContainText('正确答案');
    await expect(quizFeedback(page)).toContainText('解析');
  });

  test('T1-050 [UF10] Selecting multi-select options via keyboard 1/2 and submitting works', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10, order: 'seq' });
    await modeCard(page, 'multi').click();

    const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
    const ans = getCorrectChoiceFor(q) as number[];
    for (const idx of ans) {
      await page.keyboard.press(String(idx + 1));
    }
    await btnSubmitMulti(page).click();
    await expect(quizFeedback(page)).toContainText('回答正确');
  });

  test('T1-051 [UF10] Wrong multi-select question increments 错题 and enters Wrong Book', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    const q = await answerCurrentQuestion(page, stemMap, 'wrong');
    await quizExit(page).click();
    await expect(statCard(page, 'wrong')).toContainText('1');
    await page.getByTestId('btn-open-wrong').click();
    await expect(page.getByTestId('list-item').first()).toContainText(q.stem.slice(0, 15));
  });

  test('T1-052 [UF11] True/false question renders 正确 and 错误 buttons', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await expect(tfBtn(page, true)).toBeVisible();
    await expect(tfBtn(page, false)).toBeVisible();
  });

  test('T1-053 [UF11] Clicking 正确 on true tf question grades 回答正确', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const trueQ = pickQuestion({ type: 'tf' });
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { chapters: [trueQ.chapter], count: 0, order: 'seq' });
    await modeCard(page, 'tf').click();

    const total = Number.parseInt(
      (await quizProgressText(page).innerText()).split('/')[1]!.trim(),
      10,
    );
    for (let i = 0; i < total; i++) {
      const cur = findQuestionByStem(await qStem(page).innerText(), stemMap);
      if (cur.answer === true) {
        await tfBtn(page, true).click();
        await expect(quizFeedback(page)).toContainText('回答正确');
        await expect(tfBtn(page, false)).toBeDisabled();
        break;
      }
      await btnNext(page).click();
    }
  });

  test('T1-054 [UF11] Clicking wrong tf button grades 回答错误 with 正确答案', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await answerCurrentQuestion(page, stemMap, 'wrong');
    await expect(quizFeedback(page)).toContainText('回答错误');
    await expect(quizFeedback(page)).toContainText('正确答案');
  });

  test('T1-055 [UF11] Keyboard T selects 正确 on tf question', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await page.keyboard.press('T');
    await expect(quizFeedback(page)).toContainText(/回答正确|回答错误/);
    await expect(tfBtn(page, true)).toBeDisabled();
  });

  test('T1-056 [UF11] Keyboard F selects 错误 on tf question', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await page.keyboard.press('F');
    await expect(quizFeedback(page)).toContainText(/回答正确|回答错误/);
    await expect(tfBtn(page, false)).toBeDisabled();
  });

  test('T1-057 [UF12] Subjective short question hides answer until revealed', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await expect(btnRevealAnswer(page)).toBeVisible();
    await expect(qRefAnswer(page)).toBeHidden();
  });

  test('T1-058 [UF12] Clicking 显示参考答案 reveals reference answer, keyPoints, and 3 self-eval buttons', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await btnRevealAnswer(page).click();
    await expect(qRefAnswer(page)).toBeVisible();
    await expect(selfCheckBtn(page, 2)).toBeVisible();
    await expect(selfCheckBtn(page, 1)).toBeVisible();
    await expect(selfCheckBtn(page, 0)).toBeVisible();
  });

  test('T1-059 [UF12] Self-rating 完全会 marks mastered and does NOT enter Wrong Book', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 2).click();
    await quizExit(page).click();
    await expect(statCard(page, 'done')).toContainText('1');
    await expect(statCard(page, 'wrong')).toContainText('0');
  });

  test('T1-060 [UF12] Self-rating 有点模糊 adds subjective question to Wrong Book', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 1).click();
    await quizExit(page).click();
    await expect(statCard(page, 'wrong')).toContainText('1');
  });

  test('T1-061 [UF12] Self-rating 不会 on analysis question adds it to Wrong Book', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'analysis').click();
    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 0).click();
    await quizExit(page).click();
    await expect(statCard(page, 'wrong')).toContainText('1');
  });

  test('T1-062 [UF13] 下一题 and 上一题 navigate back and forth; 上一题 disabled on Q1', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await expect(btnPrev(page)).toBeDisabled();
    const stem1 = await qStem(page).innerText();
    await btnNext(page).click();
    await expect(quizProgressText(page)).toContainText('2 / 10');
    await expect(btnPrev(page)).toBeEnabled();
    await btnPrev(page).click();
    await expect(quizProgressText(page)).toContainText('1 / 10');
    await expect(qStem(page)).toHaveText(stem1);
  });

  test('T1-063 [UF13] Revisiting answered choice question restores locked feedback state', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await btnNext(page).click();
    await btnPrev(page).click();
    await expect(quizFeedback(page)).toContainText('回答正确');
    await expect(quizOption(page, 0)).toBeDisabled();
  });

  test('T1-064 [UF13] Revisiting subjective question restores reveal and allows updating mastery', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 1).click();
    await btnNext(page).click();
    await btnPrev(page).click();

    await expect(qRefAnswer(page)).toBeVisible();
    await expect(selfCheckBtn(page, 1)).toHaveAttribute('aria-pressed', 'true');
    await selfCheckBtn(page, 2).click();
    await expect(selfCheckBtn(page, 2)).toHaveAttribute('aria-pressed', 'true');
  });

  test('T1-065 [UF13] ArrowRight and ArrowLeft navigate questions', async ({
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
  });

  test('T1-066 [UF13] Final question displays 看结果 and transitions to Result view', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await ensureAnswerSheetOpen(page);
    await sheetItem(page, 9).click();
    await expect(btnNext(page)).toContainText(/看结果|完成/);
    await btnNext(page).click();
    await expect(resultScore(page)).toBeVisible();
  });

  test('T1-067 [UF14] 答题卡 renders buttons 1..10 with #1 active', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await ensureAnswerSheetOpen(page);
    for (let i = 0; i < 10; i++) {
      await expect(sheetItem(page, i)).toBeVisible();
    }
    await expect(sheetItem(page, 0)).toHaveAttribute('aria-current', 'step');
  });

  test('T1-068 [UF14] Clicking #7 in 答题卡 jumps to Q7 and updates progress to 70%', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await ensureAnswerSheetOpen(page);
    await sheetItem(page, 6).click();
    await expect(quizProgressText(page)).toContainText('7 / 10');
    await expect(quizProgressBar(page)).toHaveAttribute('aria-valuenow', '7');
  });

  test('T1-069 [UF14] 答题卡 reflects correct, wrong, and unanswered status', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await btnNext(page).click();
    await answerCurrentQuestion(page, stemMap, 'wrong');

    await ensureAnswerSheetOpen(page);
    await expect(sheetItem(page, 0)).toHaveAttribute('data-status', 'correct');
    await expect(sheetItem(page, 1)).toHaveAttribute('data-status', 'wrong');
    await expect(sheetItem(page, 2)).toHaveAttribute('data-status', 'unanswered');
  });

  test('T1-070 [UF14] Jumping back from Q7 to Q1 via 答题卡 preserves feedback', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await ensureAnswerSheetOpen(page);
    await sheetItem(page, 6).click();
    await expect(quizProgressText(page)).toContainText('7 / 10');
    await sheetItem(page, 0).click();
    await expect(quizProgressText(page)).toContainText('1 / 10');
    await expect(quizFeedback(page)).toContainText('回答正确');
  });

  test('T1-071 [UF14] Mobile 答题卡 fits 390x844 without overflow and jumps to Q12', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 20 });
    await modeCard(page, 'all').click();
    await ensureAnswerSheetOpen(page);
    await assertNoHorizontalOverflow(page);
    await sheetItem(page, 11).click();
    await expect(quizProgressText(page)).toContainText('12 / 20');
  });

  test('T1-072 [UF15] Completing 10-question set (9 right, 1 wrong) displays 90% settlement', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();

    for (let i = 0; i < 10; i++) {
      await answerCurrentQuestion(page, stemMap, i === 9 ? 'wrong' : 'correct');
      await btnNext(page).click();
    }

    await expect(resultScore(page)).toContainText('90%');
    await expect(resultTotal(page)).toContainText('10');
    await expect(resultRight(page)).toContainText('9');
    await expect(resultTime(page)).toContainText(/\d+:\d{2}/);
  });

  test('T1-073 [UF15] Clicking wrong review item on Result launches 1-question retry', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();

    const wrongStems: string[] = [];
    for (let i = 0; i < 10; i++) {
      const q = await answerCurrentQuestion(page, stemMap, i < 2 ? 'wrong' : 'correct');
      if (i < 2) wrongStems.push(q.stem);
      await btnNext(page).click();
    }

    await expect(resultReviewItems(page)).toHaveCount(2);
    await resultReviewItems(page).first().click();
    await expect(quizProgressText(page)).toContainText('1 / 1');
    await expect(qStem(page)).toContainText(wrongStems[0]!.slice(0, 15));
  });

  test('T1-074 [UF15] Clicking 只练错题 starts session containing only wrong items', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();

    for (let i = 0; i < 10; i++) {
      await answerCurrentQuestion(page, stemMap, i < 2 ? 'wrong' : 'correct');
      await btnNext(page).click();
    }

    await btnRetryWrong(page).click();
    await expect(quizProgressText(page)).toContainText('1 / 2');
  });

  test('T1-075 [UF15] Clicking 再来一组 starts fresh session preserving filters', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { chapters: [1], count: 10 });
    await modeCard(page, 'tf').click();
    const total = Number.parseInt(
      (await quizProgressText(page).innerText()).split('/')[1]!.trim(),
      10,
    );
    for (let i = 0; i < total; i++) {
      await answerCurrentQuestion(page, stemMap, 'correct');
      await btnNext(page).click();
    }

    await btnRetryMore(page).click();
    await expect(quizProgressText(page)).toContainText(`1 / ${total}`);
    const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
    expect(q.chapter).toBe(1);
    expect(q.type).toBe('tf');
  });

  test('T1-076 [UF15] Clicking 返回首页 returns to #/quiz with updated stats', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap();
    await gotoRoute(page, '#/quiz');
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    for (let i = 0; i < 10; i++) {
      const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
      await tfBtn(page, getCorrectChoiceFor(q) as boolean).click();
      await btnNext(page).click();
    }
    await btnResultHome(page).click();
    await expect(statCard(page, 'done')).toContainText('10');
    await expect(statCard(page, 'acc')).toContainText('100%');
  });
});
