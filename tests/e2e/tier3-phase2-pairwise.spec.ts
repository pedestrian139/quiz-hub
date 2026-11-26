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
  SMART_WASH_RAW_TEXT,
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
  aiWashRetryChunk,
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
  importPasteTextarea,
  importTab,
  modeCard,
  navLink,
  previewDraft,
  qStem,
  quizExit,
  quizFeedback,
  quizImportDialog,
  quizOption,
  sheetFilter,
  sheetItem,
  statCard,
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

async function signInWithPassword(page: Page, email: string, password: string): Promise<void> {
  await page.getByTestId('auth-open-btn').click();
  await page.getByTestId('auth-account-input').fill(email);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-btn').click();
  await expect(page.getByTestId('auth-modal')).toBeHidden();
}

async function configureMockApiInModal(page: Page, apiKey = 'sk-e2e-p2-key'): Promise<void> {
  const modal = page.getByTestId('api-settings-modal');
  await expect(modal).toBeVisible();
  await page.getByTestId('api-preset-custom').click();
  await page.getByTestId('api-input-baseurl').fill(MOCK_API_BASE);
  await page.getByTestId('api-input-key').fill(apiKey);
  await page.getByTestId('api-input-model').fill('mock-quizhub-chat');
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

test.describe('Tier 3 Phase 2: Cross-Feature Pairwise & Cloud Sync (T3-P2-001..T3-P2-010)', () => {
  test('T3-P2-001 [F4×F5×F6×F7] Smart Wash -> inline edit AI inferred answer -> sticky import -> wrong answer -> AI explain & pill follow-up', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    const llm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await expect(quizImportDialog(page)).toBeVisible();

    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(SMART_WASH_RAW_TEXT);
    if (await washTargetBankName(page).isVisible().catch(() => false)) {
      await washTargetBankName(page).fill('AI智能洗题联动库');
    }
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 0)).toBeVisible();
    await expect(previewDraft(page, 1)).toBeVisible();
    await expect(draftAiInferred(page, 1)).toBeVisible();

    if (!(await page.getByTestId('draft-edit-stem-1').isVisible().catch(() => false))) {
      await draftEdit(page, 1).click();
    }
    await page.getByTestId('draft-edit-stem-1').fill('梯度下降算法中负梯度方向更新参数的直接作用是？');
    await page.getByTestId('draft-edit-ans-1-1').click();
    await expect(btnConfirmImportSticky(page)).toBeEnabled();

    await confirmImportAndClose(page, 'AI智能洗题联动库');

    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'all').click();
    await expect(qStem(page)).toBeVisible();

    // Pick a wrong option on the first choice question (HTTP port: A=21 is wrong)
    await quizOption(page, 0).click();
    await expect(quizFeedback(page)).toContainText('回答错误');

    await aiBtnExplain(page).click();
    const explainArea = explanationContainer(page);
    await expect(explainArea).toContainText('核心考点');
    await expect(explainArea).toContainText('解题思路');
    await expect(explainArea).toContainText('逐项排错');

    const countBeforePill = llm.requests.filter((r) => r.url.includes('/chat/completions')).length;
    await aiFollowupPill(page, 0).click();
    await expect
      .poll(() => llm.requests.filter((r) => r.url.includes('/chat/completions')).length)
      .toBeGreaterThan(countBeforePill);
    await expect(aiChatCard(page).or(explainArea).first()).toContainText(/针对追问|核心|前文/);

    await assertFullLayoutAudit(page);
  });

  test('T3-P2-002 [F1×F2×F3×F7] Signed-in custom bank AI explain debounce, cloud persistence, clean reload & 0-LLM cache hit', async ({
    page,
  }, testInfo) => {
    test.skip(authDisabled, 'Requires the test Supabase gateway');
    onlyDesktop(testInfo);

    const email = 'p2sync-custom@example.com';
    const gateway = await installAuthGateway(page);
    gateway.addAccount(email, 'pass123456', '云同步洗题员');
    const llm = await installMockLlm(page);
    const stemMap = buildQuestionStemMap(LEGACY_PHASE1_BANK);

    await gotoRoute(page, '#/quiz');
    await signInWithPassword(page, email, 'pass123456');

    await page.getByTestId('btn-api-settings').click();
    await configureMockApiInModal(page, 'sk-cloud-custom-bank');
    await expect.poll(() => gateway.apiSaveCalls.length).toBe(1);

    await btnOpenQuizImport(page).click();
    await importTab(page, 'file').click();
    await bankImportFileInput(page).setInputFiles(
      makeJsonUploadFile('cloud-sync-legacy.json', LEGACY_PHASE1_BANK_JSON),
    );
    await confirmImportAndClose(page, '云端解析防抖测试库');

    await expect.poll(() => gateway.getCloudBanks(email).length).toBe(1);
    const bankId = gateway.getCloudBanks(email)[0]!.bank_id;
    const callsAfterCreate = gateway.saveBankCalls.length;

    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'all').click();

    // Trigger AI explanations on two questions rapidly (< 1000ms debounce window)
    await answerCurrentQuestion(page, stemMap, 'correct');
    await aiBtnExplain(page).click();
    await expect(explanationContainer(page)).toContainText('逐项排错');

    await btnNext(page).click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await aiBtnExplain(page).click();
    await expect(explanationContainer(page)).toContainText('逐项排错');

    await expect
      .poll(
        () => {
          const cloudBank = gateway.getCloudBanks(email).find((b) => b.bank_id === bankId);
          const qs = (cloudBank?.data?.questions ?? []) as Array<{ aiAnalysis?: string }>;
          return qs.filter((q) => Boolean(q.aiAnalysis && q.aiAnalysis.includes('核心考点'))).length;
        },
        { timeout: 8_000 },
      )
      .toBe(2);

    const debouncedUpdateCalls = gateway.saveBankCalls.length - callsAfterCreate;
    expect(debouncedUpdateCalls).toBeGreaterThanOrEqual(1);
    expect(debouncedUpdateCalls).toBeLessThanOrEqual(2);

    // Clear IDB & localStorage (keeping auth session) and reload
    await wipeLocalCachesPreserveAuth(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('btn-api-settings')).toHaveAttribute('data-configured', 'true');

    llm.clear();
    await gotoRoute(page, '#/quiz');
    await switchActiveBank(page, bankId, /云端解析防抖测试库|Phase 1/);
    await modeCard(page, 'choice').click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await aiBtnExplain(page).click();
    await expect(explanationContainer(page)).toContainText('核心考点');

    const llmCompletionCallsAfterReload = llm.requests.filter((r) =>
      r.url.includes('/chat/completions'),
    );
    expect(llmCompletionCallsAfterReload).toHaveLength(0);
  });

  test('T3-P2-003 [F1×F3] Built-in bank aiExplanations cloud sync & 409 40001 conflict merge preserves custom aiAnalysis', async ({
    page,
    healthTrap,
  }, testInfo) => {
    test.skip(authDisabled, 'Requires the test Supabase gateway');
    onlyDesktop(testInfo);

    const email = 'p2conflict@example.com';
    const gateway = await installAuthGateway(page);
    gateway.addAccount(email, 'pass123456', '冲突合并学员');
    await installMockLlm(page);

    await gotoRoute(page, '#/quiz');
    await signInWithPassword(page, email, 'pass123456');

    await page.getByTestId('btn-api-settings').click();
    await configureMockApiInModal(page, 'sk-cloud-conflict-test');
    await expect.poll(() => gateway.apiSaveCalls.length).toBe(1);

    // 1) Built-in bank aiExplanations cloud sync
    await switchActiveBank(page, BUILTIN_AI_BANK_ID, /QuizHub/);
    await modeCard(page, 'choice').click();
    await quizOption(page, 0).click();
    await aiBtnExplain(page).click();
    await expect(explanationContainer(page)).toContainText('逐项排错');

    await expect
      .poll(
        () => {
          const entry = gateway.getCloudProgress(email, BUILTIN_AI_BANK_ID);
          const map = entry?.store.aiExplanations ?? {};
          return Object.values(map).some((v) => v.content.includes('核心考点'));
        },
        { timeout: 8_000 },
      )
      .toBe(true);

    // 2) Import custom bank & simulate 409 40001 conflict while saving AI analysis
    await quizExit(page).click();
    await btnOpenQuizImport(page).click();
    await importTab(page, 'file').click();
    await bankImportFileInput(page).setInputFiles(
      makeJsonUploadFile('conflict-merge-bank.json', LEGACY_PHASE1_BANK_JSON),
    );
    await confirmImportAndClose(page, '冲突合并自定义库');

    await expect.poll(() => gateway.getCloudBanks(email).length).toBe(1);
    const customBankId = gateway.getCloudBanks(email)[0]!.bank_id;

    gateway.mutateCloudBankExternally(email, customBankId, (prev) => {
      const qs = (prev.data.questions as Question[]).map((q, idx) =>
        idx === 1 ? { ...q, explanation: '其他设备同步的权威解析' } : q,
      );
      return {
        ...prev,
        updated_at_ms: prev.updated_at_ms + 1000,
        data: {
          ...prev.data,
          questions: qs,
        },
      };
    });

    healthTrap.expectHttpError('http://127.0.0.1:49391/rest/v1/rpc/quizhub_save_bank', 409);

    await gotoRoute(page, '#/quiz');
    await switchActiveBank(page, customBankId, /冲突合并自定义库|Phase 1/);
    await modeCard(page, 'choice').click();
    await quizOption(page, 0).click();
    await aiBtnExplain(page).click();
    await expect(explanationContainer(page)).toContainText('逐项排错');

    await expect
      .poll(
        () => {
          const b = gateway.getCloudBanks(email).find((x) => x.bank_id === customBankId);
          return b?.revision ?? 0;
        },
        { timeout: 8_000 },
      )
      .toBeGreaterThanOrEqual(3);

    const mergedBank = gateway.getCloudBanks(email).find((x) => x.bank_id === customBankId)!;
    const mergedQs = mergedBank.data.questions as Question[];
    expect(mergedQs[0]?.aiAnalysis).toContain('核心考点');
    expect(mergedQs[1]?.explanation).toBe('其他设备同步的权威解析');
  });

  test('T3-P2-004 [F6×F7] bank-switcher × sheet-filter-wrong × ai-auto-explain-toggle on partial multi answer', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await installMockLlm(page);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      targetHashRoute: '#/quiz',
      apiConfig: {},
    });

    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await switchActiveBank(page, FIXTURE_BANK_ID, /E2E 合成/);
    await modeCard(page, 'multi').click();
    await enableAutoExplain(page);

    // Partial wrong answer on first multi question auto-triggers streaming explanation
    await answerCurrentQuestion(page, stemMap, 'partial');
    await expect(quizFeedback(page)).toContainText('回答错误');
    await expect(explanationContainer(page)).toContainText('核心考点');
    await expect(explanationContainer(page)).toContainText('逐项排错');

    // Second multi question answered correctly
    await btnNext(page).click();
    await answerCurrentQuestion(page, stemMap, 'correct');
    await expect(quizFeedback(page)).toContainText('回答正确');

    await ensureAnswerSheetOpen(page);
    await sheetFilter(page, 'wrong').click();
    await expect(sheetItem(page, 0)).toBeVisible();
    await expect(sheetItem(page, 1)).toHaveCount(0);

    await quizExit(page).click();
    await expect(statCard(page, 'done')).toContainText('2');
    await expect(statCard(page, 'wrong')).toContainText('1');

    // Switch to built-in onboarding bank -> completely isolated progress
    await switchActiveBank(page, BUILTIN_AI_BANK_ID, /QuizHub/);
    await expect(statCard(page, 'done')).toContainText('0');
    await expect(statCard(page, 'wrong')).toContainText('0');

    // Switch back -> original counts preserved
    await switchActiveBank(page, FIXTURE_BANK_ID, /E2E 合成/);
    await expect(statCard(page, 'done')).toContainText('2');
    await expect(statCard(page, 'wrong')).toContainText('1');
    await assertFullLayoutAudit(page);
  });

  test('T3-P2-005 [F3×F6×F7] Mobile 390x844 Phase 1 legacy JSON import, solve & bottom-sheet AI explain with layout audit', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await importTab(page, 'file').click();
    await bankImportFileInput(page).setInputFiles(
      makeJsonUploadFile('mobile-legacy-p1.json', LEGACY_PHASE1_BANK_JSON),
    );
    await confirmImportAndClose(page);

    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'all').click();
    await expect(workspaceMobileBar(page)).toBeVisible();

    const stemMap = buildQuestionStemMap(LEGACY_PHASE1_BANK);
    await answerCurrentQuestion(page, stemMap, 'wrong');
    await aiBtnExplain(page).click();

    const explainArea = explanationContainer(page);
    await expect(explainArea).toContainText('核心考点');
    await expect(explainArea).toContainText('逐项排错');
    await expect(explainArea.locator('.katex').first()).toBeVisible();
    await assertFullLayoutAudit(page);

    // Advance to item 2 (which omitted `explain` completely in JSON)
    await btnNext(page).click();
    await expect(qStem(page)).toContainText('Phase 1 兼容测试题 2');
    await answerCurrentQuestion(page, stemMap, 'correct');
    await assertFullLayoutAudit(page);
  });

  test('T3-P2-006 [F2×F4×F5] Missing API key guard on Smart Wash -> jump CTA -> configure key -> immediate wash & import', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const llm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(SMART_WASH_RAW_TEXT);

    await aiWashBtn(page).click();
    expect(llm.requests).toHaveLength(0);

    const jumpBtn = settingsJumpCta(page);
    await expect(jumpBtn).toBeVisible();
    await jumpBtn.click();
    await configureMockApiInModal(page, 'sk-after-guard-jump');

    await aiWashBtn(page).click();
    await expect(previewDraft(page, 0)).toBeVisible();
    await expect(draftAiInferred(page, 1)).toBeVisible();

    await confirmImportAndClose(page, '拦截引导后洗题库');
    await gotoRoute(page, '#/quiz');
    await expect(page.getByText(/拦截引导后洗题库/).first()).toBeVisible();
  });

  test('T3-P2-007 [F4×F5×Mobile] Mobile 390x844 stacked Smart Wash workbench, draft deletion & sticky import audit', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await assertFullLayoutAudit(page);

    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(SMART_WASH_RAW_TEXT);
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 0)).toBeVisible();
    await expect(draftAiInferred(page, 1)).toBeVisible();
    await expect(previewDraft(page, 3)).toBeVisible();

    await draftDelete(page, 3).click();
    await expect(previewDraft(page, 3)).toHaveCount(0);
    await expect(btnConfirmImportSticky(page)).toContainText('3');
    await assertFullLayoutAudit(page);

    await confirmImportAndClose(page, '移动端洗题库');
    await gotoRoute(page, '#/quiz');
    await assertFullLayoutAudit(page);
  });

  test('T3-P2-008 [F3×F6×F7] Markdown/LaTeX/XSS RichContent × custom multi-turn follow-up × reload cache hit', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const llm = await installMockLlm(page);
    await seedFixtureBank(page, MARKDOWN_LATEX_BANK, makeEmptyStore(), {
      targetHashRoute: '#/quiz',
      apiConfig: {},
    });

    await modeCard(page, 'all').click();
    await expect(qStem(page).locator('table')).toBeVisible();
    await expect(qStem(page).locator('.katex').first()).toBeVisible();
    await assertFullLayoutAudit(page, { checkTables: true });

    await quizOption(page, 0).click();
    await aiBtnExplain(page).click();
    await expect(explanationContainer(page)).toContainText('核心考点');
    await expect(explanationContainer(page).locator('.katex').first()).toBeVisible();

    await aiFollowupPill(page, 0).click();
    await expect(aiChatCard(page).or(explanationContainer(page)).first()).toContainText('干扰项');

    if (!(await aiChatInput(page).isVisible().catch(() => false))) {
      await aiBtnChat(page).click();
    }
    await aiChatInput(page).fill('请给出二阶收敛的直观解释');
    await aiChatSend(page).click();
    await expect(aiChatCard(page).or(explanationContainer(page)).first()).toContainText('前文');

    // Advance to md-q2 (malformed LaTeX + XSS payload)
    await btnNext(page).click();
    await expect(qStem(page)).toContainText('容错与 XSS 安全测试题');
    const xssFired = await page.evaluate(
      () => (window as unknown as { __xssFired?: boolean }).__xssFired ?? false,
    );
    expect(xssFired).toBe(false);

    // Reload and confirm cached AI explanation hits with 0 new LLM calls
    llm.clear();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'choice').click();
    await aiBtnExplain(page).click();
    await expect(explanationContainer(page)).toContainText('核心考点');
    expect(llm.requests.filter((r) => r.url.includes('/chat/completions'))).toHaveLength(0);
  });

  test('T3-P2-009 [F2×F4×F5] Chunked Smart Wash HTTP 500 chunk failure -> per-chunk retry recovery -> import', async ({
    page,
    healthTrap,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page, {
      failOnMatch: '[CHUNK_RETRY_MARKER]',
      failCount: 1,
      failStatus: 500,
    });
    healthTrap.expectHttpError(`${MOCK_API_BASE}/chat/completions`, 500);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(SMART_WASH_CHUNKS.join('\n\n'));
    await aiWashBtn(page).click();

    const retryBtn = aiWashRetryChunk(page, 0)
      .or(page.locator('[data-testid^="ai-wash-retry-chunk-"]').first())
      .first();
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    await expect(page.locator('[data-testid^="ai-wash-retry-chunk-"]')).toHaveCount(0);
    await expect(previewDraft(page, 2)).toBeVisible();
    await confirmImportAndClose(page, '分段重试恢复题库');
  });

  test('T3-P2-010 [F6×F8] Mobile 390x844 QuizHub branding, 3-question onboarding bank, handbook & mobile workspace audit', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/');
    await expect(page).toHaveTitle(/QuizHub/);
    await expect(hubBadgeTotal(page)).toContainText('3');
    const homeText = await page.locator('body').innerText();
    expect(homeText).toContain('QuizHub');
    expect(homeText).not.toContain('人工智能导论');
    await assertFullLayoutAudit(page);

    await navLink(page, 'notes').click();
    await expect(page.locator('body')).toContainText('QuizHub');
    expect(await page.locator('body').innerText()).not.toContain('人工智能导论');
    await assertFullLayoutAudit(page, { checkTables: true });

    await navLink(page, 'quiz').click();
    await modeCard(page, 'all').click();
    await expect(workspaceMobileBar(page)).toBeVisible();
    await assertFullLayoutAudit(page);
  });
});
