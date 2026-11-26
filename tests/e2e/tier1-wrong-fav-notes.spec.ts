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
  btnExportJson,
  btnQuizChapter,
  btnResetStore,
  chapterChip,
  gotoRoute,
  inputImportFile,
  listClearWrong,
  listEmpty,
  listItemAnswer,
  listItemToggle,
  listItems,
  listRedoAll,
  modeCard,
  notesChapter,
  notesSearch,
  notesToc,
  qStem,
  quizModeTitle,
  statCard,
} from './helpers/selectors.ts';
import {
  captureJsonExport,
  importJsonFile,
  loadNotesCatalog,
  makeEmptyStore,
  makeSeededStore,
  pickQuestion,
  pickQuestions,
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

test.describe('Tier 1: Wrong Book, Favorites, Storage, Handbook & Layout (UF16-UF19)', () => {
  test('T1-077 [UF16] Wrong Book lists wrong items sorted ascending by chapter', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const ch1Q = pickQuestion({ chapter: 1, type: 'choice' }, FIXTURE_BANK);
    const ch4Q = pickQuestion({ chapter: 4, type: 'choice' }, FIXTURE_BANK);
    const store = makeSeededStore({ wrongIds: [ch4Q.id, ch1Q.id] }, FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/wrong' });

    await expect(listItems(page)).toHaveCount(2);
    await expect(listItems(page).nth(0)).toContainText(ch1Q.stem.slice(0, 15));
    await expect(listItems(page).nth(1)).toContainText(ch4Q.stem.slice(0, 15));
  });

  test('T1-078 [UF16] Clicking 查看答案与解析 expands Wrong Book accordion', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const q = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    const store = makeSeededStore({ wrongIds: [q.id] }, FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/wrong' });

    const first = listItems(page).first();
    await listItemToggle(first).click();
    await expect(listItemAnswer(first)).toBeVisible();
    await expect(listItemAnswer(first)).toContainText(q.explain.slice(0, 10));
  });

  test('T1-079 [UF16] Clicking 重做全部 in Wrong Book launches 错题重练 session', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 2 }, FIXTURE_BANK);
    const store = makeSeededStore({ wrongIds: qs.map((q) => q.id) }, FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/wrong' });

    await listRedoAll(page).click();
    await expect(quizModeTitle(page)).toContainText('错题重练');
    await expect(page.getByTestId('quiz-progress-text')).toContainText('1 / 2');
  });

  test('T1-080 [UF16] Clicking 清空 in Wrong Book clears wrong items and updates stats', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 2 }, FIXTURE_BANK);
    const store = makeSeededStore({ wrongIds: qs.map((q) => q.id) }, FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/wrong' });

    page.once('dialog', (d) => d.accept());
    await listClearWrong(page).click();
    const dialogBtn = page
      .getByRole('dialog')
      .getByRole('button', { name: /确认|确定|清空/ });
    if (await dialogBtn.isVisible().catch(() => false)) {
      await dialogBtn.click();
    }

    await expect(listEmpty(page)).toBeVisible();
    await gotoRoute(page, '#/quiz');
    await expect(statCard(page, 'wrong')).toContainText('0');
  });

  test('T1-081 [UF16] Favorites lists starred items, hides 清空, and shows 重做全部', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 2 }, FIXTURE_BANK);
    const store = makeSeededStore({ favIds: qs.map((q) => q.id) }, FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/fav' });

    await expect(listItems(page)).toHaveCount(2);
    await expect(listClearWrong(page)).toBeHidden();
    await expect(listRedoAll(page)).toBeVisible();
  });

  test('T1-082 [UF17] Progress and favorites persist across hard reload in quizhub-v2', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'tf', limit: 3 }, FIXTURE_BANK);
    const store = makeSeededStore(
      {
        correctIds: [qs[0]!.id, qs[1]!.id],
        wrongIds: [qs[2]!.id],
        favIds: [qs[0]!.id],
      },
      FIXTURE_BANK,
    );
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/quiz' });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(statCard(page, 'done')).toContainText('3');
    await expect(statCard(page, 'fav')).toContainText('1');
    const persisted = await readIdbProgress(page);
    expect(Object.keys(persisted?.records ?? {})).toHaveLength(3);
  });

  test('T1-083 [UF17] Accepting 清空记录 wipes persisted progress and resets stats to 0', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 2 }, FIXTURE_BANK);
    const store = makeSeededStore(
      {
        correctIds: [qs[0]!.id],
        wrongIds: [qs[1]!.id],
        favIds: [qs[0]!.id],
      },
      FIXTURE_BANK,
    );
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/quiz' });

    page.once('dialog', (d) => d.accept());
    await btnResetStore(page).click();
    const dialogBtn = page
      .getByRole('dialog')
      .getByRole('button', { name: /确认|确定|清空/ });
    if (await dialogBtn.isVisible().catch(() => false)) {
      await dialogBtn.click();
    }

    await expect(statCard(page, 'done')).toContainText('0');
    await expect(statCard(page, 'wrong')).toContainText('0');
    await expect(statCard(page, 'fav')).toContainText('0');
    await expect
      .poll(async () => Object.keys((await readIdbProgress(page))?.records ?? {}).length)
      .toBe(0);
  });

  test('T1-084 [UF17] Exporting JSON produces valid backup matching current UserStore', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 2 }, FIXTURE_BANK);
    const store = makeSeededStore(
      {
        correctIds: [qs[0]!.id],
        favIds: [qs[1]!.id],
      },
      FIXTURE_BANK,
    );
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/quiz' });

    const exported = await captureJsonExport(page, () => btnExportJson(page).click());
    expect(exported.filename).toMatch(/quiz.*backup\.json$/i);
    const parsed = exported.parsed as {
      records: Record<string, unknown>;
      fav: Record<string, boolean>;
      mastery: Record<string, number>;
    };
    expect(parsed.records[qs[0]!.id]).toBeTruthy();
    expect(parsed.fav[qs[1]!.id]).toBe(true);
    expect(exported.parsed).toHaveProperty('mastery');
  });

  test('T1-085 [UF17] Importing valid JSON restores stats and mastery without reload loss', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const choiceQ = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    const shortQ = pickQuestion({ type: 'short' }, FIXTURE_BANK);
    const backup = makeSeededStore(
      {
        correctIds: [choiceQ.id],
        favIds: [choiceQ.id],
        mastery: { [shortQ.id]: 1 },
      },
      FIXTURE_BANK,
    );

    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await importJsonFile(inputImportFile(page), backup);
    await expect(statCard(page, 'done')).toContainText('2');
    await expect(statCard(page, 'acc')).toContainText('50%');
    await expect(statCard(page, 'wrong')).toContainText('1');
    await expect(statCard(page, 'fav')).toContainText('1');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(statCard(page, 'done')).toContainText('2');
  });

  test('T1-086 [UF17] Dismissing 清空记录 confirm dialog keeps progress intact', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const q = pickQuestion({ type: 'choice' }, FIXTURE_BANK);
    const store = makeSeededStore({ correctIds: [q.id] }, FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, store, { targetHashRoute: '#/quiz' });

    page.once('dialog', (d) => d.dismiss());
    await btnResetStore(page).click();
    const cancelBtn = page
      .getByRole('dialog')
      .getByRole('button', { name: /取消|关闭/ });
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }

    await expect(statCard(page, 'done')).toContainText('1');
  });

  test('T1-087 [UF18] Knowledge Handbook renders overview, all chapters, and appendices dynamically', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    expect(notes.chapters.length).toBeGreaterThanOrEqual(2);
    await gotoRoute(page, '#/notes');
    await expect(page.getByText(notes.meta.title).first()).toBeVisible();
    await expect(page.getByText(notes.overview.title).first()).toBeVisible();
    for (const ch of notes.chapters) {
      await expect(notesChapter(page, ch.id)).toBeVisible();
    }
    for (const app of notes.appendices) {
      await expect(page.getByText(app.title).first()).toBeVisible();
    }
  });

  test('T1-088 [UF18] Clicking target chapter in TOC scrolls/focuses that chapter', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    const targetCh = notes.chapters[notes.chapters.length - 1]!;
    await gotoRoute(page, '#/notes');
    await notesToc(page)
      .getByText(new RegExp(`第\\s*${targetCh.id}\\s*章|${targetCh.short}`))
      .first()
      .click();
    await expect(notesChapter(page, targetCh.id)).toBeInViewport();
  });

  test('T1-089 [UF18] Handbook keyword search filters matching sections cleanly', async ({
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
    await expect(page.getByText(keyword).first()).toBeVisible();
  });

  test('T1-090 [UF18] Clicking 刷本章题 on a chapter navigates to Quiz pre-filtered to that chapter', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    const targetCh = notes.chapters[notes.chapters.length - 1] ?? notes.chapters[0]!;
    const otherCh = notes.chapters.find((c) => c.id !== targetCh.id);
    await gotoRoute(page, '#/notes');
    await btnQuizChapter(page, targetCh.id).click();
    await expect(page).toHaveURL(/#\/quiz/);
    await expect(chapterChip(page, targetCh.id)).toHaveAttribute('aria-pressed', 'true');
    if (otherCh) {
      await expect(chapterChip(page, otherCh.id)).toHaveAttribute('aria-pressed', 'false');
    }
    await expect(modeCard(page, 'all')).toBeVisible();
  });

  test('T1-091 [UF18] Handbook tables and callouts render cleanly with normalized text', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/notes');
    expect(await page.locator('table').count()).toBeGreaterThan(0);
    await expect(page.locator('body')).not.toContainText('undefined');
    await expect(page.locator('body')).not.toContainText('人工智能导论');
  });

  test('T1-092 [UF19] Desktop 1440x900 passes full layout audit across all routes', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    for (const route of ['#/', '#/quiz', '#/wrong', '#/fav', '#/notes']) {
      await gotoRoute(page, route);
      await assertFullLayoutAudit(page);
    }
  });

  test('T1-093 [UF19] Mobile 390x844 passes horizontal overflow & overlap audit across all routes', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    for (const route of ['#/', '#/quiz', '#/wrong', '#/fav', '#/notes']) {
      await gotoRoute(page, route);
      await assertNoHorizontalOverflow(page);
    }
  });

  test('T1-094 [UF19] Mobile 390x844 Handbook wide tables scroll inside bounded wrappers', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/notes');
    await assertHandbookTablesContained(page);
  });

  test('T1-095 [UF19] Handbook @media print hides interactive nav/search/action chrome', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const notes = loadNotesCatalog();
    const firstChId = notes.chapters[0]?.id ?? 1;
    await gotoRoute(page, '#/notes');
    await page.emulateMedia({ media: 'print' });
    await expect(notesSearch(page)).toBeHidden();
    await expect(btnQuizChapter(page, firstChId)).toBeHidden();
    await expect(notesChapter(page, firstChId)).toBeVisible();
  });

  test('T1-096 [UF19] Full route crawl and quiz interaction produces zero console/page/HTTP errors', async ({
    page,
    healthTrap,
  }, testInfo) => {
    onlyDesktop(testInfo);
    for (const route of ['#/', '#/quiz', '#/wrong', '#/fav', '#/notes']) {
      await gotoRoute(page, route);
    }
    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'all').click();
    await expect(qStem(page)).toBeVisible();
    expect(healthTrap.consoleErrors).toEqual([]);
    expect(healthTrap.pageErrors).toEqual([]);
    expect(healthTrap.httpErrors).toEqual([]);
  });
});
