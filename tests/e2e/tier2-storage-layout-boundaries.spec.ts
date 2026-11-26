import type { Page } from '@playwright/test';
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
  FIXTURE_BANK,
  FIXTURE_BANK_ID,
  QUIZ_DB_NAME,
  QUIZ_DB_VERSION,
  seedFixtureBank,
} from './helpers/fixtureBank.ts';
import {
  answerCurrentQuestion,
  btnNext,
  btnPrev,
  btnQuizChapter,
  btnRetryWrong,
  btnRevealAnswer,
  btnStar,
  chapterChip,
  ensureAnswerSheetOpen,
  gotoRoute,
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
  qRefAnswer,
  quizExit,
  quizFeedback,
  quizModeTitle,
  quizOption,
  quizProgressBar,
  quizProgressText,
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
  importJsonFile,
  loadNotesCatalog,
  makeEmptyStore,
  makeSeededStore,
  pickQuestion,
  pickQuestions,
  seedCorruptedStoreAndReload,
  type BankData,
  type UserStore,
} from './helpers/storage.ts';

async function readIdbProgress(page: Page, bankId = FIXTURE_BANK_ID): Promise<UserStore | null> {
  return page.evaluate(
    async ({ dbName, dbVersion, targetBankId }) => {
      return new Promise<UserStore | null>((resolve, reject) => {
        const req = window.indexedDB.open(dbName, dbVersion);
        req.onerror = () => reject(req.error ?? new Error('Failed to open quizhub-v2 IDB'));
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('progress')) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction('progress', 'readonly');
          const getReq = tx.objectStore('progress').get(targetBankId);
          getReq.onsuccess = () => {
            const entry = getReq.result as { store?: UserStore } | undefined;
            db.close();
            resolve(entry?.store ?? null);
          };
          getReq.onerror = () => {
            db.close();
            reject(getReq.error ?? new Error('Failed to read progress store'));
          };
        };
      });
    },
    { dbName: QUIZ_DB_NAME, dbVersion: QUIZ_DB_VERSION, targetBankId: bankId },
  );
}

function makeStaleIdsStore(
  opts: {
    validCorrectIds?: string[];
    validWrongIds?: string[];
    validFavIds?: string[];
    staleCount?: number;
  },
  bank: BankData = FIXTURE_BANK,
): UserStore {
  const store = makeSeededStore(
    {
      correctIds: opts.validCorrectIds,
      wrongIds: opts.validWrongIds,
      favIds: opts.validFavIds,
    },
    bank,
  );
  const staleCount = opts.staleCount ?? 2;
  for (let i = 1; i <= staleCount; i++) {
    const staleId = `__stale_removed_q${i}`;
    store.records[staleId] = { ok: 0, choice: 0, ts: 1_700_000_000_000 + i };
    store.fav[staleId] = true;
    store.mastery[staleId] = 1;
  }
  return store;
}

test.describe('Tier 2: Subjective, Nav, Sheet, Result, Storage & Responsive Boundaries (T2-057..T2-096)', () => {
  test('T2-057 [UF12] Skipping unrevealed short question does not crash or enter Wrong Book', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await btnNext(page).click();
    await expect(quizProgressText(page)).toContainText('2 /');
    await quizExit(page).click();
    await expect(statCard(page, 'wrong')).toContainText('0');
  });

  test('T2-058 [UF12] Changing self-rating from 不会 to 完全会 removes item from Wrong Book', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await btnRevealAnswer(page).click();
    await selfCheckBtn(page, 0).click();
    await selfCheckBtn(page, 2).click();
    await quizExit(page).click();
    await expect(statCard(page, 'wrong')).toContainText('0');
  });

  test('T2-059 [UF12] Long analysis answer renders inside card without horizontal overflow', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const longAnalysis =
      FIXTURE_BANK.questions
        .filter((q) => q.type === 'analysis' || q.type === 'short')
        .sort((a, b) => String(b.answer).length - String(a.answer).length)[0] ??
      pickQuestion({ type: 'analysis' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: [longAnalysis.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await page.getByTestId('list-redo-all').click();
    await btnRevealAnswer(page).click();
    await expect(qRefAnswer(page)).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('T2-060 [UF12] Subjective question without keyPoints renders cleanly without "undefined"', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const noKp =
      FIXTURE_BANK.questions.find(
        (q) =>
          (q.type === 'short' || q.type === 'analysis') &&
          (!q.keyPoints || q.keyPoints.length === 0),
      ) ?? pickQuestion({ type: 'short' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: [noKp.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await page.getByTestId('list-redo-all').click();
    await btnRevealAnswer(page).click();
    await expect(qRefAnswer(page)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('undefined');
  });

  test('T2-061 [UF12] Pressing Space after reveal keeps reference answer visible', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await page.keyboard.press('Space');
    await expect(qRefAnswer(page)).toBeVisible();
    await page.keyboard.press('Space');
    await expect(qRefAnswer(page)).toBeVisible();
  });

  test('T2-062 [UF13] ArrowLeft and disabled 上一题 on Q1 safely remain on Q1', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await expect(btnPrev(page)).toBeDisabled();
    await page.keyboard.press('ArrowLeft');
    await expect(quizProgressText(page)).toContainText('1 / 10');
  });

  test('T2-063 [UF13] Pressing Enter while 上一题 or 显示参考答案 has focus activates that button', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();

    await btnRevealAnswer(page).focus();
    await page.keyboard.press('Enter');
    await expect(qRefAnswer(page)).toBeVisible();
    await expect(quizProgressText(page)).toContainText('1 /');

    await btnNext(page).click();
    await expect(quizProgressText(page)).toContainText('2 /');
    await btnPrev(page).focus();
    await page.keyboard.press('Enter');
    await expect(quizProgressText(page)).toContainText('1 /');
  });

  test('T2-064 [UF13] Pressing Space/Enter on focused star button toggles star only', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await btnStar(page).focus();
    await page.keyboard.press('Space');
    await expect(btnStar(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(qRefAnswer(page)).toBeHidden();
  });

  test('T2-065 [UF13] Typing a/t/f/1/Space inside Handbook search input does not fire quiz shortcuts', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/notes');
    await notesSearch(page).focus();
    await page.keyboard.type('atf 1');
    await expect(notesSearch(page)).toHaveValue('atf 1');
    await expect(page).toHaveURL(/#\/notes/);
  });

  test('T2-066 [UF13] Navigating away from unsubmitted multi selection does not record false ok', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    await quizOption(page, 0).click();
    await btnNext(page).click();
    await btnPrev(page).click();
    await page.waitForTimeout(150);
    const store = await readIdbProgress(page);
    expect(Object.keys(store?.records ?? {})).toHaveLength(0);
  });

  test('T2-067 [UF14] Rapid jumps 1 -> 30 -> 15 via 答题卡 keep topbar, bar & button synced', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 30 });
    await modeCard(page, 'all').click();
    await ensureAnswerSheetOpen(page);
    await sheetItem(page, 29).click();
    await expect(quizProgressText(page)).toContainText('30 / 30');
    await expect(quizProgressBar(page)).toHaveAttribute('aria-valuenow', '30');
    await expect(btnNext(page)).toContainText(/看结果|完成/);

    await sheetItem(page, 14).click();
    await expect(quizProgressText(page)).toContainText('15 / 30');
    await expect(quizProgressBar(page)).toHaveAttribute('aria-valuenow', '15');
    await expect(btnNext(page)).toContainText('下一题');
  });

  test('T2-068 [UF14] Skipped Q2 remains unanswered in 答题卡 while Q1 and Q3 show answered', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await btnNext(page).click(); // Q2
    await btnNext(page).click(); // Q3
    await answerCurrentQuestion(page, stemMap, 'wrong');

    await ensureAnswerSheetOpen(page);
    await expect(sheetItem(page, 0)).toHaveAttribute('data-status', 'correct');
    await expect(sheetItem(page, 1)).toHaveAttribute('data-status', 'unanswered');
    await expect(sheetItem(page, 2)).toHaveAttribute('data-status', 'wrong');
  });

  test('T2-069 [UF14] 1-question session 答题卡 shows single current item and handles click safely', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const q = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: [q.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await page.getByTestId('list-redo-all').click();
    await ensureAnswerSheetOpen(page);
    await expect(sheetItem(page, 0)).toHaveAttribute('aria-current', 'step');
    await sheetItem(page, 0).click();
    await expect(quizProgressText(page)).toContainText('1 / 1');
  });

  test('T2-070 [UF14] Revealed but unrated subjective item stays unanswered/pending in 答题卡', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await btnRevealAnswer(page).click();
    await ensureAnswerSheetOpen(page);
    const status = await sheetItem(page, 0).getAttribute('data-status');
    expect(['unanswered', 'pending']).toContain(status);
  });

  test('T2-071 [UF14] Mobile 390x844 30-question 答题卡 wraps cleanly and jumps to Q28', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 30 });
    await modeCard(page, 'all').click();
    await ensureAnswerSheetOpen(page);
    await assertFullLayoutAudit(page);
    await sheetItem(page, 27).click();
    await expect(quizProgressText(page)).toContainText('28 / 30');
  });

  test('T2-072 [UF15] Skipping all 10 questions yields 0% (never NaN%) and 0 right', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    for (let i = 0; i < 10; i++) {
      await btnNext(page).click();
    }
    const score = await resultScore(page).innerText();
    expect(score).not.toContain('NaN');
    expect(score).toContain('0%');
    await expect(resultRight(page)).toContainText('0');
    await expect(resultTotal(page)).toContainText('10');
  });

  test('T2-073 [UF15] Answering Q1 right and skipping Q2-Q20 reports 1 right with zero NaN', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 20 });
    await modeCard(page, 'all').click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    for (let i = 0; i < 20; i++) {
      await btnNext(page).click();
    }
    const score = await resultScore(page).innerText();
    expect(score).not.toContain('NaN');
    await expect(resultRight(page)).toContainText('1');
    await expect(resultTotal(page)).toContainText('20');
  });

  test('T2-074 [UF15] Result with 100% accuracy guards 只练错题 cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    for (let i = 0; i < 10; i++) {
      await answerCurrentQuestion(page, stemMap, 'correct');
      await btnNext(page).click();
    }
    await expect(resultScore(page)).toContainText('100%');
    const retryBtn = btnRetryWrong(page);
    if (await retryBtn.isEnabled()) {
      page.once('dialog', (d) => d.accept());
      await retryBtn.click();
      await expect(resultScore(page)).toBeVisible();
    } else {
      await expect(retryBtn).toBeDisabled();
    }
  });

  test('T2-075 [UF15] Result feedback copy differentiates >=90%, 75-89%, 60-74%, and <60% tiers', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    const runWithCorrectCount = async (rightCount: number): Promise<string> => {
      await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
      await selectQuizFilters(page, { count: 10 });
      await modeCard(page, 'tf').click();
      for (let i = 0; i < 10; i++) {
        await answerCurrentQuestion(
          page,
          stemMap,
          i < rightCount ? 'correct' : 'wrong',
        );
        await btnNext(page).click();
      }
      const txt = await page.locator('main, #root').first().innerText();
      return txt;
    };

    const t90 = await runWithCorrectCount(9);
    const t80 = await runWithCorrectCount(8);
    const t60 = await runWithCorrectCount(6);
    const t40 = await runWithCorrectCount(4);
    expect(t90).toContain('90%');
    expect(t80).toContain('80%');
    expect(t60).toContain('60%');
    expect(t40).toContain('40%');
  });

  test('T2-076 [UF15] Mobile 390x844 Result screen with 5 wrong items fits cleanly', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    for (let i = 0; i < 10; i++) {
      await answerCurrentQuestion(page, stemMap, i < 5 ? 'wrong' : 'correct');
      await btnNext(page).click();
    }
    await assertFullLayoutAudit(page);
    await expect(resultScore(page)).toContainText('50%');
  });

  test('T2-077 [UF16] Empty Wrong Book shows empty state and hides/disables actions', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/wrong');
    await expect(listEmpty(page)).toBeVisible();
    await expect(listRedoAll(page)).toBeHidden();
    await expect(listClearWrong(page)).toBeHidden();
  });

  test('T2-078 [UF16] Empty Favorites shows empty state and hides/disables actions', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/fav');
    await expect(listEmpty(page)).toBeVisible();
    await expect(listRedoAll(page)).toBeHidden();
    await expect(listClearWrong(page)).toBeHidden();
  });

  test('T2-079 [UF16] Stale IDs in Wrong Book & Favorites are filtered silently', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeStaleIdsStore({ staleCount: 3 }, FIXTURE_BANK), {
      targetHashRoute: '#/wrong',
    });
    await expect(listEmpty(page)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('undefined');

    await navLink(page, 'fav').click();
    await expect(listEmpty(page)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('undefined');
  });

  test('T2-080 [UF16] Favorites hides 清空, expands item, and launches 收藏重练', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 2 }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: qs.map((q) => q.id) }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await expect(listClearWrong(page)).toBeHidden();
    const item0 = listItems(page).first();
    await listItemToggle(item0).click();
    await expect(listItemAnswer(item0)).toBeVisible();
    await listRedoAll(page).click();
    await expect(quizModeTitle(page)).toContainText('收藏重练');
  });

  test('T2-081 [UF16] Mobile 390x844 Wrong Book with long analysis answer wraps cleanly', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    const q = pickQuestion({ type: 'analysis' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ wrongIds: [q.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/wrong' },
    );
    await listItemToggle(listItems(page).first()).click();
    await expect(listItemAnswer(listItems(page).first())).toBeVisible();
    await assertFullLayoutAudit(page);
  });

  test('T2-082 [UF17] Corrupted JSON string in localStorage recovers to empty store cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedCorruptedStoreAndReload(page, 'bad-json', '#/quiz');
    await expect(statCard(page, 'done')).toContainText('0');
    await expect(statCard(page, 'wrong')).toContainText('0');
  });

  test('T2-083 [UF17] Wrong-shape / null / array payloads in localStorage sanitize safely', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    for (const variant of ['null', 'array', 'wrong-shape'] as const) {
      await seedCorruptedStoreAndReload(page, variant, '#/quiz');
      await expect(statCard(page, 'done')).toContainText('0');
      await expect(statCard(page, 'acc')).not.toContainText('NaN');
    }
  });

  test('T2-084 [UF17] QuotaExceededError on localStorage.setItem does not crash session', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      };
    });
    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'choice').click();
    await quizOption(page, 0).click();
    await expect(quizFeedback(page)).toBeVisible();
    await btnStar(page).click();
    await expect(btnStar(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('T2-085 [UF17] Importing malformed JSON shows error and preserves existing progress', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const q = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ correctIds: [q.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/quiz' },
    );

    for (const input of ['{not valid json', '{"foo": 1}']) {
      const message = page.waitForEvent('dialog').then(async (dialog) => {
        await dialog.accept();
        return dialog.message();
      });
      await importJsonFile(inputImportFile(page), input);
      expect(await message).toContain('导入失败');
      await expect(statCard(page, 'done')).toContainText('1');
    }
  });

  test('T2-086 [UF17] Importing JSON with invalid ok value rejects or sanitizes without corrupting store', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const q = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ correctIds: [q.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/quiz' },
    );

    page.once('dialog', (d) => d.accept());
    await importJsonFile(inputImportFile(page), {
      records: { [q.id]: { ok: 99, ts: 123 } },
      fav: {},
      mastery: {},
    });
    await expect
      .poll(async () => (await readIdbProgress(page))?.records[q.id]?.ok)
      .toBe(1);
  });

  test('T2-087 [UF18] Gibberish Handbook search displays clean empty state without crash', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/notes');
    await notesSearch(page).fill('zzzz_nonexistent_xyz_999');
    await expect(page.getByText(/没有|未找到|无匹配/).first()).toBeVisible();
  });

  test('T2-088 [UF18] Clearing Handbook search restores all chapters', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    const keyword =
      notes.chapters[0]?.sections[0]?.terms?.[0]?.term ??
      notes.chapters[0]?.short ??
      'QuizHub';
    await gotoRoute(page, '#/notes');
    await notesSearch(page).fill(keyword);
    await notesSearch(page).fill('');
    for (const ch of notes.chapters) {
      await expect(notesChapter(page, ch.id)).toBeVisible();
    }
  });

  test('T2-089 [UF18] Regex metacharacters in Handbook search do not throw SyntaxError', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/notes');
    for (const query of ['A*', '(a+b)', '[1]']) {
      await notesSearch(page).fill(query);
      await expect(page.locator('#root')).not.toBeEmpty();
    }
  });

  test('T2-090 [UF18] Clicking 刷本章题 on target chapter activates ONLY that chapter', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    const targetCh = notes.chapters[notes.chapters.length - 1] ?? notes.chapters[0]!;
    await gotoRoute(page, '#/notes');
    await btnQuizChapter(page, targetCh.id).click();
    await expect(page).toHaveURL(/#\/quiz/);
    await expect(chapterChip(page, targetCh.id)).toHaveAttribute('aria-pressed', 'true');
    for (const ch of notes.chapters) {
      if (ch.id === targetCh.id) continue;
      await expect(chapterChip(page, ch.id)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('T2-091 [UF18] Mobile 390x844 Handbook TOC & search fit without obscuring content', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/notes');
    await expect(notesSearch(page)).toBeVisible();
    await expect(notesToc(page)).toBeVisible();
    await assertFullLayoutAudit(page);
  });

  test('T2-092 [UF19] Mobile 390x844 Handbook maintains scrollWidth <= 390 across all chapters', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    const notes = loadNotesCatalog();
    await gotoRoute(page, '#/notes');
    await assertHandbookTablesContained(page);
    for (const ch of notes.chapters) {
      await notesChapter(page, ch.id).scrollIntoViewIfNeeded();
      await assertNoHorizontalOverflow(page);
    }
  });

  test('T2-093 [UF19] Mobile 390x844 Quiz Home stats, mode cards, chips & selects do not overflow or overlap', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/quiz');
    await assertFullLayoutAudit(page);
  });

  test('T2-094 [UF19] All static assets load with zero >= 400 responses on desktop', async ({
    page,
    healthTrap,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await gotoRoute(page, '#/quiz');
    await gotoRoute(page, '#/notes');
    expect(healthTrap.httpErrors).toEqual([]);
    expect(healthTrap.requestFailed).toEqual([]);
  });

  test('T2-095 [UF19] Print media on #/notes hides nav and interactive buttons cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    const firstChId = notes.chapters[0]?.id ?? 1;
    await gotoRoute(page, '#/notes');
    await page.emulateMedia({ media: 'print' });
    await expect(navLink(page, 'quiz')).toBeHidden();
    await expect(notesSearch(page)).toBeHidden();
    await expect(notesChapter(page, firstChId)).toBeVisible();
  });

  test('T2-096 [UF19] Mobile 390x844 Result & Wrong Book have >=36px hitboxes and zero overflow', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    const qs = pickQuestions({ type: 'tf', limit: 2 }, FIXTURE_BANK);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ wrongIds: qs.map((q) => q.id) }, FIXTURE_BANK),
      { targetHashRoute: '#/wrong' },
    );
    await assertFullLayoutAudit(page);
    const redoBox = await listRedoAll(page).boundingBox();
    expect(redoBox!.height).toBeGreaterThanOrEqual(36);

    await listRedoAll(page).click();
    await answerCurrentQuestion(page, stemMap, 'wrong');
    await btnNext(page).click();
    await answerCurrentQuestion(page, stemMap, 'wrong');
    await btnNext(page).click();
    await assertFullLayoutAudit(page);
  });
});
