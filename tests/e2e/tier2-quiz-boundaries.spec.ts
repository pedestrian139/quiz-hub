import type { Page } from '@playwright/test';
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
  FIXTURE_BANK,
  FIXTURE_BANK_ID,
  QUIZ_DB_NAME,
  QUIZ_DB_VERSION,
  seedFixtureBank,
} from './helpers/fixtureBank.ts';
import {
  answerCurrentQuestion,
  btnNext,
  btnStar,
  btnSubmitMulti,
  chapterChip,
  filterOrigin,
  gotoRoute,
  hubCardNotes,
  hubCardQuiz,
  modeCard,
  navLink,
  notesChapter,
  qChapterTag,
  qStem,
  quizExit,
  quizFeedback,
  quizModeTitle,
  quizOption,
  quizProgressBar,
  quizProgressText,
  quizTimer,
  selectOnlyChapters,
  selectQuizFilters,
  statCard,
  tfBtn,
} from './helpers/selectors.ts';
import {
  buildQuestionStemMap,
  findQuestionByStem,
  getCorrectChoiceFor,
  getPartialWrongChoiceFor,
  loadBankCatalog,
  loadNotesCatalog,
  makeEmptyStore,
  makeSeededStore,
  pickQuestion,
  pickQuestions,
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

test.describe('Tier 2: Portal, Home, Modes & Objective Quiz Boundaries (T2-001..T2-056)', () => {
  test('T2-001 [UF01] Hub loads cleanly with trailing slash and query params', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await page.goto('./?share=1#/', { waitUntil: 'domcontentloaded' });
    await expect(hubCardQuiz(page)).toBeVisible();
    await expect(hubCardNotes(page)).toBeVisible();
  });

  test('T2-002 [UF01] Mobile 390x844 Hub cards stack cleanly with zero overlap', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/');
    await assertFullLayoutAudit(page);
    const quizBox = await hubCardQuiz(page).boundingBox();
    const notesBox = await hubCardNotes(page).boundingBox();
    expect(quizBox).not.toBeNull();
    expect(notesBox).not.toBeNull();
    expect(notesBox!.y).toBeGreaterThanOrEqual(quizBox!.y + quizBox!.height - 1);
  });

  test('T2-003 [UF01] Hub loads gracefully when localStorage throws SecurityError', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Blocked', 'SecurityError');
        },
      });
    });
    await gotoRoute(page, '#/');
    await expect(hubCardQuiz(page)).toBeVisible();
  });

  test('T2-004 [UF01] Unknown hash route falls back safely without blank crash', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/nonexistent-route-xyz');
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(navLink(page, 'hub')).toBeVisible();
  });

  test('T2-005 [UF01] Rapid double-click on 刷题工具 card navigates cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await hubCardQuiz(page).dblclick();
    await expect(page).toHaveURL(/#\/quiz/);
    await expect(modeCard(page, 'all')).toBeVisible();
  });

  test('T2-006 [UF02] Navigating mid-session via global nav tears down session cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    const firstChId = notes.chapters[0]?.id ?? 1;
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await expect(quizTimer(page)).toBeVisible();
    await navLink(page, 'notes').click();
    await expect(page).toHaveURL(/#\/notes/);
    await expect(notesChapter(page, firstChId)).toBeVisible();
  });

  test('T2-007 [UF02] Reloading deep-link #/notes preserves Handbook view', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    const firstChId = notes.chapters[0]?.id ?? 1;
    await gotoRoute(page, '#/notes');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/#\/notes/);
    await expect(notesChapter(page, firstChId)).toBeVisible();
  });

  test('T2-008 [UF02] Reloading deep-link #/wrong with 0 wrong items renders empty state', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/wrong');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/#\/wrong/);
    await expect(page.getByTestId('list-empty')).toBeVisible();
  });

  test('T2-009 [UF02] Clicking active 刷题工具 nav link on Quiz Home preserves filters', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const bank = loadBankCatalog();
    const targetCh = bank.chapters[bank.chapters.length - 1]?.id ?? 1;
    await gotoRoute(page, '#/quiz');
    await selectOnlyChapters(page, [targetCh]);
    await navLink(page, 'quiz').click();
    await expect(page).toHaveURL(/#\/quiz/);
    await expect(chapterChip(page, targetCh)).toHaveAttribute('aria-pressed', 'true');
  });

  test('T2-010 [UF02] Mobile 390x844 global nav stays clickable after scrolling Handbook', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/notes');
    await page.evaluate(() => window.scrollTo(0, 600));
    await assertFullLayoutAudit(page);
    await navLink(page, 'quiz').click();
    await expect(page).toHaveURL(/#\/quiz/);
  });

  test('T2-011 [UF03] Stale/deleted IDs in store are excluded from Home stats', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 5 }, FIXTURE_BANK);
    const store = makeStaleIdsStore(
      {
        validCorrectIds: [qs[0]!.id, qs[1]!.id, qs[2]!.id, qs[3]!.id],
        validWrongIds: [qs[4]!.id],
        validFavIds: [qs[0]!.id],
        staleCount: 3,
      },
      FIXTURE_BANK,
    );
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/quiz' });
    await expect(statCard(page, 'done')).toContainText('5');
    await expect(statCard(page, 'acc')).toContainText('80%');
    await expect(statCard(page, 'wrong')).toContainText('1');
    await expect(statCard(page, 'fav')).toContainText('1');
  });

  test('T2-012 [UF03] Zero practiced questions never renders NaN% accuracy', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/quiz');
    const accText = await statCard(page, 'acc').innerText();
    expect(accText).not.toContain('NaN');
    expect(accText).toMatch(/—|0%/);
  });

  test('T2-013 [UF03] All 10 wrong records report 已练题数=10, 总正确率=0%, 错题=10', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'tf', limit: 10 }, FIXTURE_BANK);
    const store = makeSeededStore({ wrongIds: qs.map((q) => q.id) }, FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/quiz' });
    await expect(statCard(page, 'done')).toContainText('10');
    await expect(statCard(page, 'acc')).toContainText('0%');
    await expect(statCard(page, 'wrong')).toContainText('10');
  });

  test('T2-014 [UF03] All 10 right records report 已练题数=10, 总正确率=100%, 错题=0', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'tf', limit: 10 }, FIXTURE_BANK);
    const store = makeSeededStore({ correctIds: qs.map((q) => q.id) }, FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/quiz' });
    await expect(statCard(page, 'done')).toContainText('10');
    await expect(statCard(page, 'acc')).toContainText('100%');
    await expect(statCard(page, 'wrong')).toContainText('0');
  });

  test('T2-015 [UF03] Retrying a wrong question correctly updates unique record & decrements 错题', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const q = pickQuestion({ type: 'tf' }, FIXTURE_BANK);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    const store = makeSeededStore({ wrongIds: [q.id] }, FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/wrong' });
    await page.getByTestId('list-redo-all').click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await quizExit(page).click();
    await expect(statCard(page, 'done')).toContainText('1');
    await expect(statCard(page, 'acc')).toContainText('100%');
    await expect(statCard(page, 'wrong')).toContainText('0');
  });

  test('T2-016 [UF04] Clicking mode card with 0 matching questions stays on Home cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const origins = [
      'comprehensive_bank',
      'video_popup',
      'review_notes_synthesized',
    ] as const;
    const types = ['choice', 'multi', 'tf', 'short', 'analysis'] as const;
    let emptyPair: { origin: (typeof origins)[number]; type: (typeof types)[number] } | null =
      null;
    for (const origin of origins) {
      for (const type of types) {
        if (
          FIXTURE_BANK.questions.filter((q) => q.source.origin === origin && q.type === type)
            .length === 0
        ) {
          emptyPair = { origin, type };
          break;
        }
      }
      if (emptyPair) break;
    }

    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    if (emptyPair) {
      await filterOrigin(page).selectOption(emptyPair.origin);
      page.once('dialog', (d) => d.accept());
      await modeCard(page, emptyPair.type).click();
      await expect(modeCard(page, 'all')).toBeVisible();
      await expect(quizProgressText(page)).toBeHidden();
    } else {
      let foundCh = 1;
      let foundType: (typeof types)[number] = 'analysis';
      for (const ch of FIXTURE_BANK.chapters) {
        for (const t of types) {
          if (
            FIXTURE_BANK.questions.filter((q) => q.chapter === ch.id && q.type === t).length === 0
          ) {
            foundCh = ch.id;
            foundType = t;
            break;
          }
        }
      }
      await selectOnlyChapters(page, [foundCh]);
      page.once('dialog', (d) => d.accept());
      await modeCard(page, foundType).click();
      await expect(modeCard(page, 'all')).toBeVisible();
    }
  });

  test('T2-017 [UF04] Unpracticed multi shows no false accuracy while choice shows 75%', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const choices = pickQuestions({ type: 'choice', limit: 4 }, FIXTURE_BANK);
    const store = makeSeededStore(
      {
        correctIds: [choices[0]!.id, choices[1]!.id, choices[2]!.id],
        wrongIds: [choices[3]!.id],
      },
      FIXTURE_BANK,
    );
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/quiz' });
    await expect(modeCard(page, 'choice')).toContainText('75%');
    await expect(modeCard(page, 'multi')).not.toContainText('正确率');
  });

  test('T2-018 [UF04] Pool smaller than 题量=30 clamps cleanly without padding undefined', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const ch1Analysis = pickQuestions({ chapter: 1, type: 'analysis' }, FIXTURE_BANK);
    const targetType = ch1Analysis.length > 0 ? 'analysis' : 'short';
    const pool = pickQuestions({ chapter: 1, type: targetType }, FIXTURE_BANK);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.length).toBeLessThan(30);

    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { chapters: [1], count: 30 });
    await modeCard(page, targetType).click();
    await expect(quizProgressText(page)).toContainText(`1 / ${pool.length}`);
    await expect(qStem(page)).not.toContainText('undefined');
  });

  test('T2-019 [UF04] Mobile 390x844 mode cards stack in single column with zero clipping', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await assertFullLayoutAudit(page);
    const b1 = await modeCard(page, 'all').boundingBox();
    const b2 = await modeCard(page, 'choice').boundingBox();
    expect(b1).not.toBeNull();
    expect(b2).not.toBeNull();
    expect(b2!.y).toBeGreaterThanOrEqual(b1!.y + b1!.height - 1);
  });

  test('T2-020 [UF04] Stale IDs are excluded from per-mode accuracy calculation', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const choiceQ = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    const store = makeStaleIdsStore(
      { validCorrectIds: [choiceQ.id], staleCount: 4 },
      FIXTURE_BANK,
    );
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/quiz' });
    await expect(modeCard(page, 'choice')).toContainText('100%');
  });

  test('T2-021 [UF05] Min-1 chapter constraint prevents unchecking the last active chapter', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectOnlyChapters(page, [9]);
    await expect(chapterChip(page, 9)).toHaveAttribute('aria-pressed', 'true');
    await chapterChip(page, 9).click();
    await expect(chapterChip(page, 9)).toHaveAttribute('aria-pressed', 'true');
  });

  test('T2-022 [UF05] Repeatedly clicking last active Chapter 9 keeps it active and non-empty', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const ch9Count = pickQuestions({ chapter: 9 }, FIXTURE_BANK).length;
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectOnlyChapters(page, [9]);
    for (let i = 0; i < 3; i++) {
      await chapterChip(page, 9).click();
    }
    await expect(chapterChip(page, 9)).toHaveAttribute('aria-pressed', 'true');
    await expect(modeCard(page, 'all')).toContainText(`${ch9Count}`);
  });

  test('T2-023 [UF05] Clicking 全部 twice keeps all 9 chapters active', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectOnlyChapters(page, [1]);
    await chapterChip(page, 'all').click();
    await chapterChip(page, 'all').click();
    for (const ch of FIXTURE_BANK.chapters) {
      await expect(chapterChip(page, ch.id)).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('T2-024 [UF05] Re-checking unchecked chapters reactivates 全部 chip state', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await chapterChip(page, 1).click();
    await chapterChip(page, 2).click();
    await expect(chapterChip(page, 'all')).toHaveAttribute('aria-pressed', 'false');
    await chapterChip(page, 1).click();
    await chapterChip(page, 2).click();
    await expect(chapterChip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
  });

  test('T2-025 [UF05] Mobile 390x844 chapter chips wrap without horizontal overflow', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await assertFullLayoutAudit(page);
    for (const ch of FIXTURE_BANK.chapters) {
      await expect(chapterChip(page, ch.id)).toBeVisible();
    }
  });

  test('T2-026 [UF06] Origin + type with 0 matches triggers empty-pool guard cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await filterOrigin(page).selectOption('comprehensive_bank');
    const compShorts = pickQuestions(
      { origin: 'comprehensive_bank', type: 'short' },
      FIXTURE_BANK,
    );
    if (compShorts.length === 0) {
      page.once('dialog', (d) => d.accept());
      await modeCard(page, 'short').click();
      await expect(modeCard(page, 'all')).toBeVisible();
      await expect(quizProgressText(page)).toBeHidden();
    } else {
      await filterOrigin(page).selectOption('video_popup');
      page.once('dialog', (d) => d.accept());
      await modeCard(page, 'analysis').click();
      await expect(modeCard(page, 'all')).toBeVisible();
    }
  });

  test('T2-027 [UF06] Single-question pool shows 1 / 1 and 看结果 immediately', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    let singleFound = false;
    for (const ch of FIXTURE_BANK.chapters) {
      for (const origin of [
        'comprehensive_bank',
        'video_popup',
        'review_notes_synthesized',
      ] as const) {
        for (const t of ['choice', 'multi', 'tf', 'short', 'analysis'] as const) {
          const matches = FIXTURE_BANK.questions.filter(
            (q) => q.chapter === ch.id && q.source.origin === origin && q.type === t,
          );
          if (matches.length === 1) {
            await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
              targetHashRoute: '#/quiz',
            });
            await selectQuizFilters(page, { chapters: [ch.id], origin, count: 10 });
            await modeCard(page, t).click();
            singleFound = true;
            break;
          }
        }
        if (singleFound) break;
      }
      if (singleFound) break;
    }
    if (!singleFound) {
      const q = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
      await seedFixtureBank(
        page,
        FIXTURE_BANK,
        makeSeededStore({ wrongIds: [q.id] }, FIXTURE_BANK),
        { targetHashRoute: '#/wrong' },
      );
      await page.getByTestId('list-redo-all').click();
    }
    await expect(quizProgressText(page)).toContainText('1 / 1');
    await expect(btnNext(page)).toContainText(/看结果|完成/);
  });

  test('T2-028 [UF06] 顺序=seq yields identical deterministic order across two starts', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { chapters: [2, 4], order: 'seq', count: 10 });
    await modeCard(page, 'all').click();
    const firstRun: string[] = [];
    for (let i = 0; i < 4; i++) {
      firstRun.push((await qStem(page).innerText()).trim());
      await btnNext(page).click();
    }
    await quizExit(page).click();

    await modeCard(page, 'all').click();
    const secondRun: string[] = [];
    for (let i = 0; i < 4; i++) {
      secondRun.push((await qStem(page).innerText()).trim());
      await btnNext(page).click();
    }
    expect(secondRun).toEqual(firstRun);
  });

  test('T2-029 [UF06] 顺序=random produces duplicate-free shuffled queue across sessions', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { chapters: 'all', order: 'random', count: 20 });
    await modeCard(page, 'all').click();
    const run1: string[] = [];
    for (let i = 0; i < 10; i++) {
      run1.push((await qStem(page).innerText()).trim());
      await btnNext(page).click();
    }
    expect(new Set(run1).size).toBe(10);
    await quizExit(page).click();

    await modeCard(page, 'all').click();
    const run2: string[] = [];
    for (let i = 0; i < 10; i++) {
      run2.push((await qStem(page).innerText()).trim());
      await btnNext(page).click();
    }
    expect(new Set(run2).size).toBe(10);
    expect(run2).not.toEqual(run1);
  });

  test('T2-030 [UF06] Switching origin back to 全部来源 restores exact full bank count', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await filterOrigin(page).selectOption('video_popup');
    await expect(modeCard(page, 'all')).toContainText(
      `${FIXTURE_BANK.meta.counts.byOrigin.video_popup}`,
    );
    await filterOrigin(page).selectOption('all');
    await expect(modeCard(page, 'all')).toContainText(`${FIXTURE_BANK.meta.counts.total}`);
  });

  test('T2-031 [UF07] 1-question session displays 1 / 1 and 100% progress bar', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const q = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ wrongIds: [q.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/wrong' },
    );
    await page.getByTestId('list-redo-all').click();
    await expect(quizProgressText(page)).toContainText('1 / 1');
    await expect(quizProgressBar(page)).toHaveAttribute('aria-valuenow', '1');
    await expect(quizProgressBar(page)).toHaveAttribute('aria-valuemax', '1');
  });

  test('T2-032 [UF07] Exiting mid-session resets timer to 0:00 on next session', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await page.waitForTimeout(2100);
    await quizExit(page).click();

    await modeCard(page, 'all').click();
    const t = (await quizTimer(page).innerText()).trim();
    expect(t).toMatch(/^0:0[01]$/);
  });

  test('T2-033 [UF07] Favorites 重做全部 displays accurate title 收藏重练', async ({
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
    await expect(quizModeTitle(page)).toContainText('收藏重练');
    await expect(quizModeTitle(page)).not.toContainText('错题重练');
  });

  test('T2-034 [UF07] Wrong Book 重做全部 displays accurate title 错题重练', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const q = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ wrongIds: [q.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/wrong' },
    );
    await page.getByTestId('list-redo-all').click();
    await expect(quizModeTitle(page)).toContainText('错题重练');
  });

  test('T2-035 [UF07] Mobile 390x844 quiz topbar fits without overlap or overflow', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    const q = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: [q.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await page.getByTestId('list-redo-all').click();
    await assertFullLayoutAudit(page);
    await expect(quizExit(page)).toBeVisible();
    await expect(quizProgressText(page)).toBeVisible();
  });

  test('T2-036 [UF08] Rapidly toggling favorite star 4 times ends unstarred in UI & storage', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    for (let i = 0; i < 4; i++) {
      await btnStar(page).click();
    }
    await expect(btnStar(page)).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () => Object.values((await readIdbProgress(page))?.fav ?? {}).filter(Boolean).length)
      .toBe(0);
  });

  test('T2-037 [UF08] Long question stem renders cleanly without horizontal overflow', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const longQ = [...FIXTURE_BANK.questions].sort((a, b) => b.stem.length - a.stem.length)[0]!;
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: [longQ.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await page.getByTestId('list-redo-all').click();
    await expect(qStem(page)).toContainText(longQ.stem.slice(0, 20));
    await assertNoHorizontalOverflow(page);
  });

  test('T2-038 [UF08] Question with missing optional sectionId/tags never shows "undefined"', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const target =
      FIXTURE_BANK.questions.find((q) => !q.sectionId || !q.tags || q.tags.length === 0) ??
      FIXTURE_BANK.questions[0]!;
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: [target.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await page.getByTestId('list-redo-all').click();
    await expect(page.locator('body')).not.toContainText('undefined');
    await expect(qChapterTag(page)).toBeVisible();
  });

  test('T2-039 [UF08] Starring Q1 and immediately exiting updates 收藏 stat to 1', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await btnStar(page).click();
    await quizExit(page).click();
    await expect(statCard(page, 'fav')).toContainText('1');
  });

  test('T2-040 [UF08] Mobile 390x844 question metadata badges wrap inside card width', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'all').click();
    await assertFullLayoutAudit(page);
    await expect(qChapterTag(page)).toBeVisible();
    await expect(page.getByTestId('q-type-tag')).toBeVisible();
    await expect(page.getByTestId('q-source-tag')).toBeVisible();
  });

  test('T2-041 [UF09] Clicking another choice option after grading is ignored', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();

    const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
    const correctIdx = getCorrectChoiceFor(q) as number;
    const wrongIdx = (correctIdx + 1) % 4;
    await quizOption(page, correctIdx).click();
    await expect(quizFeedback(page)).toContainText('回答正确');
    await expect(quizOption(page, wrongIdx)).toBeDisabled();
    await quizOption(page, wrongIdx).click({ force: true });
    await expect(quizFeedback(page)).toContainText('回答正确');
    await expect
      .poll(async () => (await readIdbProgress(page))?.records[q.id]?.ok)
      .toBe(1);
  });

  test('T2-042 [UF09] Pressing 1-4 or A-D after choice grading does not alter record', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    const q = await answerCurrentQuestion(page, stemMap, 'correct');
    for (const key of ['1', '2', '3', '4', 'a', 'b', 'c', 'd']) {
      await page.keyboard.press(key);
    }
    await expect
      .poll(async () => (await readIdbProgress(page))?.records[q.id]?.ok)
      .toBe(1);
  });

  test('T2-043 [UF09] Both lowercase a-d and uppercase A-D select choice options', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await page.keyboard.press('b');
    await expect(quizFeedback(page)).toContainText(/回答正确|回答错误/);
    await btnNext(page).click();
    await page.keyboard.press('C');
    await expect(quizFeedback(page)).toContainText(/回答正确|回答错误/);
  });

  test('T2-044 [UF09] Invalid keys 5/Z/X do not grade choice question', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await page.keyboard.press('5');
    await page.keyboard.press('z');
    await page.keyboard.press('X');
    await expect(quizFeedback(page)).toBeHidden();
    await expect(quizOption(page, 0)).toBeEnabled();
  });

  test('T2-045 [UF09] Mobile 390x844 choice options wrap cleanly without horizontal overflow', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'choice').click();
    await assertFullLayoutAudit(page);
    const options = page.getByRole('group', { name: '单选题选项' }).getByRole('button');
    expect(await options.count()).toBeGreaterThanOrEqual(2);
    for (const option of await options.all()) {
      const box = await option.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(390);
    }
  });

  test('T2-046 [UF10] Submitting multi-select with 0 selected options does not grade', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();

    const submit = btnSubmitMulti(page);
    if (await submit.isEnabled()) {
      await submit.click();
    }
    await expect(quizFeedback(page)).toBeHidden();
    await page.waitForTimeout(150);
    const store = await readIdbProgress(page);
    expect(Object.keys(store?.records ?? {})).toHaveLength(0);
  });

  test('T2-047 [UF10] Partial correct multi-select submission grades 回答错误', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    const multiQ = pickQuestion({ type: 'multi' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: [multiQ.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await page.getByTestId('list-redo-all').click();
    const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
    const partial = getPartialWrongChoiceFor(q);
    for (const idx of partial) {
      await quizOption(page, idx).click();
    }
    await btnSubmitMulti(page).click();
    await expect(quizFeedback(page)).toContainText('回答错误');
  });

  test('T2-048 [UF10] Superset multi-select submission (correct + extra wrong) grades 回答错误', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const multiQ =
      FIXTURE_BANK.questions.find(
        (q) =>
          q.type === 'multi' &&
          Array.isArray(q.answer) &&
          q.options &&
          q.answer.length < q.options.length,
      ) ?? pickQuestion({ type: 'multi' }, FIXTURE_BANK);
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: [multiQ.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await page.getByTestId('list-redo-all').click();

    const ans = multiQ.answer as number[];
    const optLen = multiQ.options?.length ?? 4;
    const extra = Array.from({ length: optLen }, (_, i) => i).find(
      (i) => !ans.includes(i),
    );
    const picks = extra !== undefined ? [...ans, extra] : ans.slice(0, 1);
    for (const idx of picks) {
      await quizOption(page, idx).click();
    }
    await btnSubmitMulti(page).click();
    await expect(quizFeedback(page)).toContainText('回答错误');
  });

  test('T2-049 [UF10] Completely wrong multi-select submission enters Wrong Book', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    const q = await answerCurrentQuestion(page, stemMap, 'wrong');
    await expect(quizFeedback(page)).toContainText('回答错误');
    await expect
      .poll(async () => (await readIdbProgress(page))?.records[q.id]?.ok)
      .toBe(0);
  });

  test('T2-050 [UF10] Multi-select options and submit button lock after submission', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await expect(quizOption(page, 0)).toBeDisabled();
    await expect(btnSubmitMulti(page)).toBeDisabled();
  });

  test('T2-051 [UF10] Selecting multi-select options in reverse order still grades 回答正确', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'multi').click();
    const q = findQuestionByStem(await qStem(page).innerText(), stemMap);
    const reversed = [...(getCorrectChoiceFor(q) as number[])].reverse();
    for (const idx of reversed) {
      await quizOption(page, idx).click();
    }
    await btnSubmitMulti(page).click();
    await expect(quizFeedback(page)).toContainText('回答正确');
  });

  test('T2-052 [UF11] Graded tf question ignores subsequent clicks or 1/0 keys', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    const q = await answerCurrentQuestion(page, stemMap, 'correct');
    await page.keyboard.press('1');
    await page.keyboard.press('0');
    await expect(tfBtn(page, true)).toBeDisabled();
    await expect(tfBtn(page, false)).toBeDisabled();
    await expect
      .poll(async () => (await readIdbProgress(page))?.records[q.id]?.ok)
      .toBe(1);
  });

  test('T2-053 [UF11] Deprecated T and F keys are ignored while 1 and 0 trigger 正确 / 错误 on tf questions', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await page.keyboard.press('t');
    await page.keyboard.press('f');
    await expect(quizFeedback(page)).toBeHidden();
    await page.keyboard.press('1');
    await expect(quizFeedback(page)).toContainText(/回答正确|回答错误/);
    await btnNext(page).click();
    await page.keyboard.press('0');
    await expect(quizFeedback(page)).toContainText(/回答正确|回答错误/);
  });

  test('T2-054 [UF11] Keys 3, A, D are ignored on tf questions', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await page.keyboard.press('3');
    await page.keyboard.press('a');
    await page.keyboard.press('D');
    await expect(quizFeedback(page)).toBeHidden();
    await expect(tfBtn(page, true)).toBeEnabled();
  });

  test('T2-055 [UF11] Clicking 错误 on a false tf statement grades 回答正确', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const falseTf = FIXTURE_BANK.questions.find(
      (q) => q.type === 'tf' && q.answer === false,
    );
    expect(falseTf).toBeDefined();
    await seedFixtureBank(
      page,
      FIXTURE_BANK,
      makeSeededStore({ favIds: [falseTf!.id] }, FIXTURE_BANK),
      { targetHashRoute: '#/fav' },
    );
    await page.getByTestId('list-redo-all').click();
    await tfBtn(page, false).click();
    await expect(quizFeedback(page)).toContainText('回答正确');
  });

  test('T2-056 [UF11] Mobile 390x844 tf buttons have >= 44px touch height and no overflow', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'tf').click();
    await assertFullLayoutAudit(page);
    const tBox = await tfBtn(page, true).boundingBox();
    const fBox = await tfBtn(page, false).boundingBox();
    expect(tBox!.height).toBeGreaterThanOrEqual(44);
    expect(fBox!.height).toBeGreaterThanOrEqual(44);
  });
});
