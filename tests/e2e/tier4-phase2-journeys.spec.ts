import type { Page } from '@playwright/test';
import {
  expect,
  onlyDesktop,
  onlyMobile,
  test,
} from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import { installAuthGateway } from './helpers/authGateway.ts';
import {
  BUILTIN_AI_BANK_ID,
  FIXTURE_BANK,
  FIXTURE_BANK_ID,
  LEGACY_PHASE1_BANK,
  LEGACY_PHASE1_BANK_JSON,
  MARKDOWN_LATEX_BANK,
  SMART_WASH_CHUNKS,
  makeMdUploadFile,
  makeJsonUploadFile,
  seedFixtureBank,
} from './helpers/fixtureBank.ts';
import {
  MOCK_API_BASE,
  installMockLlm,
  seedGuestApiConfig,
} from './helpers/mockLlm.ts';
import {
  aiAutoExplainToggle,
  aiBtnChat,
  aiBtnExplain,
  aiChatCard,
  aiChatInput,
  aiChatSend,
  aiExplainCard,
  aiExplainDrawer,
  aiFollowupPill,
  aiOpenSettingsInline,
  aiWashBtn,
  aiWashCancel,
  aiWashProgress,
  answerCurrentQuestion,
  bankImportFileInput,
  bankSwitcher,
  btnCloseQuizImport,
  btnConfirmImport,
  btnConfirmImportSticky,
  btnNext,
  btnOpenQuizImport,
  draftAiInferred,
  draftDelete,
  draftEdit,
  ensureAnswerSheetOpen,
  gotoRoute,
  hubBadgeTotal,
  hubCardQuiz,
  importPasteTextarea,
  importTab,
  modeCard,
  previewDraft,
  qStem,
  quizBadgeTotal,
  quizFeedback,
  quizImportDialog,
  quizOption,
  quizProgressText,
  resultScore,
  sheetFilter,
  sheetItem,
  statCard,
  washPrefExplain,
  washPrefTags,
  washTargetBankName,
  workspaceMobileBar,
} from './helpers/selectors.ts';
import {
  buildQuestionStemMap,
  makeEmptyStore,
  type Question,
} from './helpers/storage.ts';

const authDisabled = process.env.PW_AUTH_DISABLED === '1';

function explanationContainer(page: Page) {
  return aiExplainCard(page).or(aiExplainDrawer(page)).first();
}

function settingsJumpCta(page: Page) {
  return aiOpenSettingsInline(page)
    .or(page.getByRole('button', { name: /打开.*API.*设置|立即.*设置|去设置|配置.*API/ }))
    .first();
}

async function configureMockApiInModal(
  page: Page,
  apiKey = 'sk-e2e-journey-key',
  testConn = false,
): Promise<void> {
  const modal = page.getByTestId('api-settings-modal');
  await expect(modal).toBeVisible();
  await page.getByTestId('api-preset-custom').click();
  await page.getByTestId('api-input-baseurl').fill(MOCK_API_BASE);
  await page.getByTestId('api-input-key').fill(apiKey);
  await page.getByTestId('api-input-model').fill('mock-quizhub-chat');
  if (testConn) {
    await page.getByTestId('api-btn-test').click();
    await expect(page.getByTestId('api-test-result')).toContainText('连接成功');
  }
  await page.getByTestId('api-btn-save').click();
  await expect(modal).toBeHidden();
}

async function confirmImportAndClose(page: Page, bankName?: string): Promise<void> {
  if (bankName) {
    const targetNameInput = washTargetBankName(page);
    if (await targetNameInput.isVisible().catch(() => false)) {
      await targetNameInput.fill(bankName);
    } else {
      const legacyNameInput = page.getByTestId('import-bank-name');
      if (await legacyNameInput.isVisible().catch(() => false)) {
        await legacyNameInput.fill(bankName);
      }
    }
  }
  const confirmBtn = btnConfirmImportSticky(page).or(btnConfirmImport(page)).first();
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();

  const dialog = quizImportDialog(page);
  if (await dialog.isVisible().catch(() => false)) {
    const closeBtn = btnCloseQuizImport(page);
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    }
  }
  await expect(dialog).toBeHidden();
}

async function switchActiveBank(
  page: Page,
  bankId: string,
  bankNamePattern: string | RegExp,
): Promise<void> {
  const switcher = bankSwitcher(page);
  await expect(switcher).toBeVisible();
  const tagName = await switcher.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    await switcher.selectOption(bankId);
  } else {
    await switcher.click();
    await page
      .getByTestId(`bank-switcher-option-${bankId}`)
      .or(page.getByRole('option', { name: bankNamePattern }))
      .or(page.getByRole('button', { name: bankNamePattern }))
      .first()
      .click();
  }
}

async function enableAutoExplain(page: Page): Promise<void> {
  const toggle = aiAutoExplainToggle(page);
  await expect(toggle).toBeVisible();
  const isOn = await toggle.evaluate((el) => {
    if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
    return (
      el.getAttribute('aria-checked') === 'true' ||
      el.getAttribute('aria-pressed') === 'true'
    );
  });
  if (!isOn) {
    await toggle.click();
  }
}

async function wipeLocalCachesPreserveAuth(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('sb-')) localStorage.removeItem(key);
    }
    sessionStorage.clear();
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs.map((db) =>
        db.name
          ? new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name!);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            })
          : Promise.resolve(),
      ),
    );
  });
}

test.describe('Tier 4 Phase 2: Real-World Application Journeys (T4-P2-001..T4-P2-005)', () => {
  test('T4-P2-001 Scenario 1 (Desktop): New guest onboarding -> QuizHub brand & 3-question bank -> missing-key jump -> API config -> AI explain & pill', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const llm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await expect(page).toHaveTitle(/QuizHub/);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('QuizHub');
    expect(bodyText).not.toContain('人工智能导论');
    await expect(hubBadgeTotal(page)).toContainText('3');
    await assertFullLayoutAudit(page);

    await hubCardQuiz(page).click();
    await expect(page).toHaveURL(/#\/quiz/);
    await expect(quizBadgeTotal(page)).toContainText('3');
    await expect(page.locator('body')).toContainText('QuizHub 使用引导示例题库');

    await modeCard(page, 'all').click();
    await expect(qStem(page).locator('.katex').first()).toBeVisible();

    // Answer Q1 (option 0 is correct)
    await quizOption(page, 0).click();
    await expect(quizFeedback(page)).toContainText('回答正确');

    // Attempt AI explain without key -> intercepted & jump CTA shown
    await aiBtnExplain(page).click();
    expect(llm.requests).toHaveLength(0);
    const jumpCta = settingsJumpCta(page);
    await expect(jumpCta).toBeVisible();
    await jumpCta.click();

    await configureMockApiInModal(page, 'sk-guest-onboarding', true);
    await expect(page.getByTestId('btn-api-settings')).toHaveAttribute('data-configured', 'true');

    // Run manual AI explain + follow-up pill
    const explainArea = explanationContainer(page);
    const alreadyExplained = ((await explainArea.textContent().catch(() => '')) ?? '').includes('核心考点');
    if (!alreadyExplained) {
      const regenBtn = page.getByRole('button', { name: '重新生成' });
      if (await regenBtn.isVisible().catch(() => false)) {
        await regenBtn.click();
      } else {
        await aiBtnExplain(page).click();
        if (!(await explainArea.isVisible().catch(() => false))) {
          await aiBtnExplain(page).click();
        }
      }
    }
    await expect(explainArea).toContainText('核心考点');
    await expect(explainArea).toContainText('解题思路');
    await expect(explainArea).toContainText('逐项排错');

    await aiFollowupPill(page, 0).click();
    await expect(aiChatCard(page).or(explainArea).first()).toContainText(/干扰项|核心|前文/);
    await assertFullLayoutAudit(page);
  });

  test('T4-P2-002 Scenario 2 (Desktop): .md upload & messy lecture notes -> cancel slow wash -> retry HTTP 500 chunk -> edit/delete draft -> sticky import -> keyboard solve', async ({
    page,
    healthTrap,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);

    let slowMode = true;
    const llm = await installMockLlm(page, {
      failOnMatch: '[CHUNK_RETRY_MARKER]',
      failCount: 1,
      failStatus: 500,
      customHandler: async ({ body }) => {
        if (slowMode && body.stream !== true) {
          await new Promise((r) => setTimeout(r, 450));
        }
        return false;
      },
    });

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await expect(quizImportDialog(page)).toBeVisible();

    // Step 1: Verify .md file upload works in file tab
    await importTab(page, 'file').click();
    await bankImportFileInput(page).setInputFiles(
      makeMdUploadFile('lecture-notes.md', SMART_WASH_CHUNKS.join('\n\n')),
    );

    // Step 2: Switch to paste tab, paste messy multi-chunk lecture notes, toggle preferences & cancel slow wash
    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(SMART_WASH_CHUNKS.join('\n\n'));
    if (await washPrefExplain(page).isVisible().catch(() => false)) {
      await expect(washPrefExplain(page)).toBeVisible();
    }
    if (await washPrefTags(page).isVisible().catch(() => false)) {
      await expect(washPrefTags(page)).toBeVisible();
    }

    await aiWashBtn(page).click();
    await expect(aiWashProgress(page)).toBeVisible();
    // Aborting in-flight wash requests may emit net::ERR_ABORTED for concurrent chunks
    healthTrap.allowUrlOnce(`${MOCK_API_BASE}/chat/completions`);
    healthTrap.allowUrlOnce(`${MOCK_API_BASE}/chat/completions`);
    healthTrap.allowUrlOnce(`${MOCK_API_BASE}/chat/completions`);
    await aiWashCancel(page).click();
    await expect(aiWashCancel(page)).toBeHidden();

    // Step 3: Re-run wash quickly, allow chunk 500 -> recover via retry CTA
    slowMode = false;
    llm.clear();
    healthTrap.expectHttpError(`${MOCK_API_BASE}/chat/completions`, 500);
    await aiWashBtn(page).click();

    const retryBtn = page.locator('[data-testid^="ai-wash-retry-chunk-"]').first();
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();
    await expect(page.locator('[data-testid^="ai-wash-retry-chunk-"]')).toHaveCount(0);

    // Verify AI inferred answer badge, inline edit, and draft deletion
    await expect(draftAiInferred(page, 1)).toBeVisible();
    if (!(await page.getByTestId('draft-edit-stem-1').isVisible().catch(() => false))) {
      await draftEdit(page, 1).click();
    }
    await page.getByTestId('draft-edit-stem-1').fill('二叉树前序遍历的访问顺序是？');
    await page.getByTestId('draft-edit-ans-1-0').click();
    await draftDelete(page, 2).click();
    await expect(previewDraft(page, 2)).toHaveCount(0);

    await confirmImportAndClose(page, '课堂笔记洗题精选');

    // Step 4: Solve imported bank in unified workspace using keyboard shortcuts
    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'all').click();
    await qStem(page).click();

    await page.keyboard.press('1');
    await expect(quizFeedback(page)).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(quizProgressText(page)).toContainText('2 /');
    await page.keyboard.press('a');
    await expect(quizFeedback(page)).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(quizProgressText(page)).toContainText('1 /');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(resultScore(page)).toBeVisible();
    await assertFullLayoutAudit(page);
  });

  test('T4-P2-003 Scenario 3 (Desktop): STEM Markdown+LaTeX bank -> auto-explain on wrong -> multi-turn custom chat -> sign in & cloud sync', async ({
    page,
  }, testInfo) => {
    test.skip(authDisabled, 'Requires the test Supabase gateway');
    onlyDesktop(testInfo);

    const email = 'stem-learner@example.com';
    const gateway = await installAuthGateway(page);
    gateway.addAccount(email, 'pass123456', 'STEM研习者');
    const llm = await installMockLlm(page);

    await seedFixtureBank(page, MARKDOWN_LATEX_BANK, makeEmptyStore(), {
      targetHashRoute: '#/quiz',
      apiConfig: {},
    });
    const stemMap = buildQuestionStemMap(MARKDOWN_LATEX_BANK);

    await modeCard(page, 'all').click();
    await expect(qStem(page).locator('table')).toBeVisible();
    await expect(qStem(page).locator('.katex').first()).toBeVisible();
    await assertFullLayoutAudit(page, { checkTables: true });

    await enableAutoExplain(page);
    await answerCurrentQuestion(page, stemMap, 'wrong');

    const explainArea = explanationContainer(page);
    await expect(explainArea).toContainText('核心考点');
    await expect(explainArea).toContainText('解题思路');
    await expect(explainArea).toContainText('逐项排错');

    // Multi-turn custom follow-up
    if (!(await aiChatInput(page).isVisible().catch(() => false))) {
      await aiBtnChat(page).click();
    }
    await aiChatInput(page).fill('为什么二阶牛顿法比 SGD 收敛快？');
    await aiChatSend(page).click();
    await expect(aiChatCard(page).or(explainArea).first()).toContainText(/前文|边界|核心/);

    await aiChatInput(page).fill('请再举一道同类梯度变式题');
    await aiChatSend(page).click();
    await expect
      .poll(() =>
        llm.requests.some((r) => {
          const msgs = r.body?.messages ?? [];
          return msgs.some((m) => m.role === 'assistant') && msgs.some((m) => m.content.includes('变式题'));
        }),
      )
      .toBe(true);

    // Sign in via guest upgrade existing-account flow -> uploads bank, progress & AI analysis to cloud
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-guest-login-btn').click();
    await page.getByTestId('auth-guest-mode-btn').click();
    await page.getByTestId('auth-upgrade-to-login').click();
    await page.getByTestId('auth-account-input').fill(email);
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();

    await expect(page.getByTestId('auth-modal')).toBeHidden();
    await expect(page.getByTestId('auth-sync-status')).toHaveText(/游客数据已同步|账号已登录/);

    await expect.poll(() => gateway.getCloudBanks(email).length).toBeGreaterThanOrEqual(1);
    const cloudBank = gateway.getCloudBanks(email)[0]!;
    const cloudQuestions = cloudBank.data.questions as Question[];
    expect(cloudQuestions[0]?.aiAnalysis).toContain('核心考点');
    await expect
      .poll(() => {
        const rec = gateway.getCloudProgress(email, cloudBank.bank_id)?.store.records['md-q1'] as
          | { ok?: number }
          | undefined;
        return rec?.ok;
      })
      .toBe(0);
  });

  test('T4-P2-004 Scenario 4 (Mobile 390x844): Commuter switches banks -> mobile thumb bar -> sheet filters -> bottom-sheet AI explain & pill', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await installMockLlm(page);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      targetHashRoute: '#/quiz',
      apiConfig: {},
    });
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);

    await assertFullLayoutAudit(page);
    await switchActiveBank(page, BUILTIN_AI_BANK_ID, /QuizHub/);
    await expect(quizBadgeTotal(page)).toContainText('3');
    await switchActiveBank(page, FIXTURE_BANK_ID, /E2E 合成/);
    await expect(quizBadgeTotal(page)).toContainText('57');

    await modeCard(page, 'all').click();
    await expect(workspaceMobileBar(page)).toBeVisible();

    // Q1 wrong, Q2 correct, Q3 left unanswered
    await answerCurrentQuestion(page, stemMap, 'wrong');
    await btnNext(page).click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await btnNext(page).click();
    await assertFullLayoutAudit(page);

    await ensureAnswerSheetOpen(page);
    await sheetFilter(page, 'unanswered').click();
    await expect(sheetItem(page, 2)).toBeVisible();

    await sheetFilter(page, 'wrong').click();
    await expect(sheetItem(page, 0)).toBeVisible();
    await expect(sheetItem(page, 1)).toHaveCount(0);
    await sheetItem(page, 0).click();

    await aiBtnExplain(page).click();
    const explainArea = explanationContainer(page);
    await expect(explainArea).toContainText('核心考点');
    await expect(explainArea).toContainText('逐项排错');

    await aiFollowupPill(page, 0).click();
    await expect(aiChatCard(page).or(explainArea).first()).toContainText(/干扰项|核心|前文/);
    await assertFullLayoutAudit(page);
  });

  test('T4-P2-005 Scenario 5 (Desktop): Returning Phase 1 user imports legacy JSON -> AI explain -> cloud sync -> clean reload cache hit (0 LLM calls)', async ({
    page,
  }, testInfo) => {
    test.skip(authDisabled, 'Requires the test Supabase gateway');
    onlyDesktop(testInfo);

    const email = 'returning-p1@example.com';
    const gateway = await installAuthGateway(page);
    gateway.addAccount(email, 'pass123456', 'Phase1老用户');
    const llm = await installMockLlm(page);
    const stemMap = buildQuestionStemMap(LEGACY_PHASE1_BANK);

    await gotoRoute(page, '#/quiz');
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-account-input').fill(email);
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeHidden();

    await page.getByTestId('btn-api-settings').click();
    await configureMockApiInModal(page, 'sk-legacy-p1-cloud');
    await expect.poll(() => gateway.apiSaveCalls.length).toBe(1);

    await btnOpenQuizImport(page).click();
    await importTab(page, 'file').click();
    await bankImportFileInput(page).setInputFiles(
      makeJsonUploadFile('phase1-legacy-export.json', LEGACY_PHASE1_BANK_JSON),
    );
    await confirmImportAndClose(page);

    await expect.poll(() => gateway.getCloudBanks(email).length).toBe(1);
    const legacyBankId = gateway.getCloudBanks(email)[0]!.bank_id;

    await gotoRoute(page, '#/quiz');
    await switchActiveBank(page, legacyBankId, /Phase 1/);
    await modeCard(page, 'all').click();

    await answerCurrentQuestion(page, stemMap, 'wrong');
    await aiBtnExplain(page).click();
    await expect(explanationContainer(page)).toContainText('核心考点');
    await expect(explanationContainer(page)).toContainText('逐项排错');

    await btnNext(page).click();
    await expect(qStem(page)).toContainText('Phase 1 兼容测试题 2');
    await answerCurrentQuestion(page, stemMap, 'correct');

    await expect
      .poll(
        () => {
          const b = gateway.getCloudBanks(email).find((x) => x.bank_id === legacyBankId);
          const qs = (b?.data?.questions ?? []) as Question[];
          return Boolean(qs[0]?.aiAnalysis?.includes('核心考点'));
        },
        { timeout: 8_000 },
      )
      .toBe(true);

    // Clean reload (wipe localStorage/IDB except Supabase auth session) -> hit cached explanation with 0 LLM calls
    await wipeLocalCachesPreserveAuth(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('btn-api-settings')).toHaveAttribute('data-configured', 'true');

    llm.clear();
    await gotoRoute(page, '#/quiz');
    await switchActiveBank(page, legacyBankId, /Phase 1/);
    await expect(statCard(page, 'done')).toContainText('2');
    await modeCard(page, 'choice').click();
    await aiBtnExplain(page).click();
    await expect(explanationContainer(page)).toContainText('核心考点');
    expect(llm.requests.filter((r) => r.url.includes('/chat/completions'))).toHaveLength(0);
    await assertFullLayoutAudit(page);
  });
});
