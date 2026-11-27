import type { Locator, Page } from '@playwright/test';
import {
  expect,
  onlyDesktop,
  onlyMobile,
  test,
} from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import {
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
  clearGuestApiConfig,
  installMockLlm,
  seedGuestApiConfig,
} from './helpers/mockLlm.ts';
import {
  aiAutoExplainToggle,
  aiBtnExplain,
  aiExplainDrawer,
  aiOpenSettingsInline,
  aiWashBtn,
  aiWashCancel,
  aiWashProgress,
  aiWashRetryChunk,
  answerCurrentQuestion,
  answerSheet,
  bankImportFileInput,
  btnConfirmImportSticky,
  btnNext,
  btnOpenQuizImport,
  btnPrev,
  draftDelete,
  ensureAnswerSheetOpen,
  filterCount,
  filterOrder,
  gotoRoute,
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
  selectQuizFilters,
  washTargetBankMode,
  washTargetBankName,
  workspaceMobileBar,
} from './helpers/selectors.ts';
import {
  buildQuestionStemMap,
  loadBankCatalog,
  makeEmptyStore,
  makeSeededStore,
} from './helpers/storage.ts';

async function openSmartImportPasteTab(page: Page): Promise<void> {
  await btnOpenQuizImport(page).click();
  await expect(quizImportDialog(page)).toBeVisible();
  const pasteTab = importTab(page, 'paste');
  if (await pasteTab.isVisible()) {
    await pasteTab.click();
  }
}

async function setWashTargetNewBank(page: Page, bankName: string): Promise<void> {
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
    }
  }
  const nameInput = washTargetBankName(page);
  if (await nameInput.isVisible()) {
    await nameInput.fill(bankName);
  }
}

async function setToggleState(locator: Locator, desired: boolean): Promise<void> {
  await expect(locator).toBeVisible();
  const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'input') {
    const current = await locator.isChecked();
    if (current !== desired) {
      await locator.click();
    }
    expect(await locator.isChecked()).toBe(desired);
    return;
  }
  const attr =
    (await locator.getAttribute('aria-checked')) ??
    (await locator.getAttribute('aria-pressed'));
  const current = attr === 'true';
  if (current !== desired) {
    await locator.click();
  }
}

/**
 * Generates > 3,200 chars of structured blocks so default `chunkSizeChars = 2800`
 * deterministically splits the input into >= 2 chunks.
 */
function buildMultiChunkWashText(includeRetryMarker = true): string {
  const chunk1Padding = Array.from({ length: 12 }, (_, idx) =>
    `${idx + 1}. 分布式系统第 ${idx + 1} 题：关于共识算法与幂等性设计的核心约束说明，请结合状态机复制、任期编号、日志匹配特性以及网络分区场景下的安全性保证进行准确辨析（批量分段长度填充文本 ${'#' .repeat(120)}）。\nA. 满足状态机安全性\nB. 允许任意脑裂提交\n答案：A`,
  ).join('\n\n');

  const chunk2Body = includeRetryMarker
    ? SMART_WASH_CHUNKS[1]!
    : SMART_WASH_CHUNKS[1]!.replace('[CHUNK_RETRY_MARKER]\n', '');

  const chunk2Padding = [
    chunk2Body,
    ...Array.from({ length: 8 }, (_, idx) =>
      `${idx + 20}. 算法分析第 ${idx + 20} 题：时间复杂度渐近上界、空间局部性与递归栈深度边界条件分析（分段二长度填充文本 ${'*'.repeat(110)}）。\nA. 复杂度可精确度量\nB. 无需任何终止条件\n答案：A`,
    ),
  ].join('\n\n');

  return [chunk1Padding, chunk2Padding, SMART_WASH_CHUNKS[2]!].join('\n\n');
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

test.describe('Tier 2 (Phase 2): Boundary Cases, Error Recovery, Legacy Compat & Mobile Layout Audits', () => {
  // =========================================================================
  // F2: Missing API Key Guards
  // =========================================================================
  test('T2-P2-001 [F2] Unconfigured API Key blocks Smart Wash with 0 LLM requests and jumps to api-settings-modal', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await clearGuestApiConfig(page);
    const mockLlm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);
    await importPasteTextarea(page).fill(SMART_WASH_RAW_TEXT);
    await aiWashBtn(page).click();

    expect(mockLlm.requests).toHaveLength(0);
    await expect(aiOpenSettingsInline(page)).toBeVisible();
    await aiOpenSettingsInline(page).click();
    await expect(page.getByTestId('api-settings-modal')).toBeVisible();
  });

  test('T2-P2-002 [F2] Unconfigured API Key blocks manual AI explain with 0 LLM requests and opens api-settings-modal', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await clearGuestApiConfig(page);
    const mockLlm = await installMockLlm(page);

    await gotoRoute(page, '#/quiz');
    await modeCard(page, 'choice').click();
    await quizOption(page, 0).click();

    await aiBtnExplain(page).click();
    expect(mockLlm.requests).toHaveLength(0);

    await expect(aiOpenSettingsInline(page)).toBeVisible();
    await aiOpenSettingsInline(page).click();
    await expect(page.getByTestId('api-settings-modal')).toBeVisible();
  });

  test('T2-P2-003 [F2] Unconfigured API Key with auto-explain ON intercepts wrong answer with 0 LLM requests & shows jump CTA', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await clearGuestApiConfig(page);
    const mockLlm = await installMockLlm(page);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);

    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      targetHashRoute: '#/quiz',
    });

    await filterCount(page).selectOption('10');
    await modeCard(page, 'choice').click();
    await setToggleState(aiAutoExplainToggle(page), true);

    await answerCurrentQuestion(page, stemMap, 'wrong');
    await page.waitForTimeout(300);

    expect(mockLlm.requests).toHaveLength(0);
    await expect(aiOpenSettingsInline(page)).toBeVisible();
  });

  // =========================================================================
  // F4 & F5: Smart Wash Boundaries (Progress, Cancel, Retry, JSON, Empty, Delete)
  // =========================================================================
  test('T2-P2-004 [F4] Multi-chunk Smart Wash displays ai-wash-progress batch status during delayed responses', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    const mockLlm = await installMockLlm(page, { delayMs: 350 });

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);
    await importPasteTextarea(page).fill(buildMultiChunkWashText(false));
    await setWashTargetNewBank(page, '多批洗题进度库');

    await aiWashBtn(page).click();
    const progress = aiWashProgress(page);
    await expect(progress).toBeVisible();
    await expect(progress).toContainText(/第\s*\d+\s*\/\s*[2-9]\d*\s*批|正在识别/);

    await expect(previewDraft(page, 0)).toBeVisible({ timeout: 15_000 });
    const washReqs = mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions'));
    expect(washReqs.length).toBeGreaterThanOrEqual(2);
  });

  test('T2-P2-005 [F4] Cancelling Smart Wash mid-flight via ai-wash-cancel aborts cleanly without errors', async ({
    page,
    healthTrap,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page, { delayMs: 900 });
    // Concurrency up to 2 may abort 1-2 in-flight requests
    healthTrap.allowUrlOnce(MOCK_API_BASE);
    healthTrap.allowUrlOnce(MOCK_API_BASE);
    healthTrap.allowUrlOnce(MOCK_API_BASE);

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);
    await importPasteTextarea(page).fill(buildMultiChunkWashText(false));

    await aiWashBtn(page).click();
    const cancelBtn = aiWashCancel(page);
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(cancelBtn).toBeHidden();
    await expect(aiWashBtn(page)).toBeEnabled();
  });

  test('T2-P2-006 [F4] Chunk HTTP 500 failure exposes ai-wash-retry-chunk-* and per-chunk retry recovers & merges drafts', async ({
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
    healthTrap.expectHttpError(MOCK_API_BASE, 500);

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);
    await importPasteTextarea(page).fill(buildMultiChunkWashText(true));
    await setWashTargetNewBank(page, '分片重试恢复库');

    await aiWashBtn(page).click();

    const retryBtn = aiWashRetryChunk(page, 1)
      .or(page.locator('[data-testid^="ai-wash-retry-chunk-"]').first())
      .first();
    await expect(retryBtn).toBeVisible({ timeout: 10_000 });

    const beforeRetryCount = await page.locator('[data-testid^="preview-draft-"]').count();
    expect(beforeRetryCount).toBeGreaterThanOrEqual(1);

    await retryBtn.click();
    await expect(page.locator('[data-testid^="ai-wash-retry-chunk-"]')).toHaveCount(0);

    const afterRetryCount = await page.locator('[data-testid^="preview-draft-"]').count();
    expect(afterRetryCount).toBeGreaterThan(beforeRetryCount);
    await expect(btnConfirmImportSticky(page)).toBeEnabled();
  });

  test('T2-P2-007 [F4/F5] Legacy .json file import in Smart Import workbench parses & imports cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await expect(quizImportDialog(page)).toBeVisible();

    await bankImportFileInput(page).setInputFiles(
      makeJsonUploadFile('legacy-phase1-bank.json', LEGACY_PHASE1_BANK_JSON),
    );
    await expect(previewDraft(page, 0)).toBeVisible();
    await expect(previewDraft(page, 3)).toBeVisible();

    const stickyBtn = btnConfirmImportSticky(page);
    await expect(stickyBtn).toContainText('4');
    await stickyBtn.click();
    await expect(quizImportDialog(page)).toBeHidden({ timeout: 10_000 });

    if (!/#\/quiz/.test(page.url())) {
      await gotoRoute(page, '#/quiz');
    }
    await expect(quizBadgeTotal(page)).toContainText('4');
  });

  test('T2-P2-008 [F4/F5] Empty and whitespace-only paste boundary guards AI wash with 0 LLM requests', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    const mockLlm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);
    await importPasteTextarea(page).fill('   \n\n\t  ');

    if (await aiWashBtn(page).isEnabled()) {
      await aiWashBtn(page).click();
    }
    expect(mockLlm.requests).toHaveLength(0);
    await expect(page.locator('[data-testid^="preview-draft-"]')).toHaveCount(0);
  });

  test('T2-P2-009 [F5] Deleting a preview draft via draft-delete-* updates sticky confirm count', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page);

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);
    await importPasteTextarea(page).fill(SMART_WASH_RAW_TEXT);
    await setWashTargetNewBank(page, '删题计数同步库');
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 3)).toBeVisible();
    const stickyBtn = btnConfirmImportSticky(page);
    await expect(stickyBtn).toContainText('4');

    await draftDelete(page, 0).click();
    await expect(stickyBtn).toContainText('3');
    await expect(page.locator('[data-testid^="preview-draft-"]')).toHaveCount(3);
  });

  // =========================================================================
  // F3 + F7: Auto-explain, Cache Hit, Legacy JSON & Malformed LaTeX / XSS
  // =========================================================================
  test('T2-P2-010 [F7] ai-auto-explain-toggle triggers auto-explain ONLY on wrong answer, NOT on correct answer', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const stemMap = buildQuestionStemMap(FIXTURE_BANK);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), {
      bankId: FIXTURE_BANK_ID,
      activate: true,
      apiConfig: {},
      targetHashRoute: '#/quiz',
    });
    const mockLlm = await installMockLlm(page);

    await selectQuizFilters(page, { count: 10, order: 'seq' });
    await modeCard(page, 'choice').click();
    await setToggleState(aiAutoExplainToggle(page), true);

    // Correct answer -> must NOT trigger auto-explain
    await answerCurrentQuestion(page, stemMap, 'correct');
    await expect(quizFeedback(page)).toContainText('回答正确');
    await page.waitForTimeout(350);
    expect(mockLlm.requests.filter((r) => r.body?.stream === true)).toHaveLength(0);

    // Next question, wrong answer -> MUST trigger auto-explain
    await btnNext(page).click();
    await answerCurrentQuestion(page, stemMap, 'wrong');
    await expect(quizFeedback(page)).toContainText('回答错误');

    await expect(aiExplainDrawer(page)).toBeVisible();
    await expect(aiExplainDrawer(page)).toContainText('核心考点');
    expect(mockLlm.requests.filter((r) => r.body?.stream === true)).toHaveLength(1);
  });

  test('T2-P2-011 [F3/F7] Saved AI explanation hits cache on revisit with 0 duplicate LLM requests', async ({
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

    await selectQuizFilters(page, { count: 10, order: 'seq' });
    await modeCard(page, 'choice').click();

    await quizOption(page, 0).click();
    await aiBtnExplain(page).click();
    await expect(aiExplainDrawer(page)).toContainText('逐项排错');

    const countAfterFirst = mockLlm.requests.filter((r) => r.body?.stream === true).length;
    expect(countAfterFirst).toBe(1);

    // Move away and come back to Q1
    await btnNext(page).click();
    await btnPrev(page).click();
    await expect(quizProgressText(page)).toContainText('1 / 10');

    if (!(await aiExplainDrawer(page).isVisible())) {
      await aiBtnExplain(page).click();
    }
    await expect(aiExplainDrawer(page)).toBeVisible();
    await expect(aiExplainDrawer(page)).toContainText('核心考点');
    expect(mockLlm.requests.filter((r) => r.body?.stream === true)).toHaveLength(countAfterFirst);
  });

  test('T2-P2-012 [F3] Seeded aiExplanations on built-in onboarding bank hits cache with 0 LLM calls', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const builtinBank = loadBankCatalog();
    const q0 = builtinBank.questions[0]!;
    const cachedText = '### 【核心考点】\n预设缓存命中解析，不应再次请求大模型。';
    const store = makeSeededStore(
      {
        aiExplanations: {
          [q0.id]: { content: cachedText, updatedAt: Date.now(), model: 'mock-cached' },
        },
      },
      builtinBank,
    );

    await seedGuestApiConfig(page);
    const mockLlm = await installMockLlm(page);
    await seedFixtureBank(page, builtinBank, store, {
      bankId: 'builtin-quizhub-guide',
      activate: true,
      targetHashRoute: '#/quiz',
    });

    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'choice').click();

    await quizOption(page, 0).click();
    await aiBtnExplain(page).click();
    await expect(aiExplainDrawer(page)).toContainText('预设缓存命中解析');
    expect(mockLlm.requests.filter((r) => r.body?.stream === true)).toHaveLength(0);
  });

  test('T2-P2-013 [F3] Phase 1 legacy JSON bank (missing/empty explain) quizzes & opens AI explain cleanly', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const parsedLegacy = JSON.parse(LEGACY_PHASE1_BANK_JSON) as typeof LEGACY_PHASE1_BANK;
    await seedFixtureBank(page, parsedLegacy, makeEmptyStore(), {
      bankId: 'legacy-phase1-compat',
      activate: true,
      apiConfig: {},
      targetHashRoute: '#/quiz',
    });
    await installMockLlm(page);

    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'all').click();
    await expect(quizProgressText(page)).toContainText('1 / 4');

    // Q1 has explain: ""
    await quizOption(page, 0).click();
    await expect(quizFeedback(page)).toBeVisible();

    // Q2 omits explain completely in JSON
    await btnNext(page).click();
    await quizOption(page, 0).click();
    await quizOption(page, 1).click();
    await page.getByTestId('btn-submit-multi').click();
    await expect(quizFeedback(page)).toBeVisible();

    await aiBtnExplain(page).click();
    await expect(aiExplainDrawer(page)).toContainText('核心考点');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await assertFullLayoutAudit(page);
  });

  test('T2-P2-014 [F6] Malformed LaTeX and XSS payload render safely with window.__xssFired === undefined', async ({
    page,
    healthTrap,
  }, testInfo) => {
    onlyDesktop(testInfo);
    healthTrap.allowUrlOnce(/\/x$/);
    await seedFixtureBank(page, MARKDOWN_LATEX_BANK, makeEmptyStore(), {
      bankId: 'e2e-xss-katex-guard',
      activate: true,
      targetHashRoute: '#/quiz',
    });

    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'all').click();

    // Navigate to md-q2 (malformed LaTeX $\broken{ + XSS payload)
    await btnNext(page).click();
    await expect(qStem(page)).toContainText('容错与 XSS 安全测试题');

    const xssBefore = await page.evaluate(
      () => (window as unknown as { __xssFired?: unknown }).__xssFired,
    );
    expect(xssBefore).toBeUndefined();

    await quizOption(page, 0).click();
    await expect(quizFeedback(page)).toBeVisible();

    const xssAfter = await page.evaluate(
      () => (window as unknown as { __xssFired?: unknown }).__xssFired,
    );
    expect(xssAfter).toBeUndefined();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await assertFullLayoutAudit(page);
  });

  // =========================================================================
  // F5 / F6 / F7: Mobile 390x844 Layout & Non-Occlusion Audits
  // =========================================================================
  test('T2-P2-015 [F5] Mobile 390x844 Smart Import stacked layout & inline draft editing pass layout audit', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedGuestApiConfig(page);
    await installMockLlm(page);

    await gotoRoute(page, '#/');
    await openSmartImportPasteTab(page);
    await importPasteTextarea(page).fill(SMART_WASH_RAW_TEXT);
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 0)).toBeVisible();
    const editor = page.getByTestId('draft-edit-stem-0');
    if (!(await editor.isVisible())) {
      await page.getByTestId('draft-edit-0').click();
    }
    await expect(editor).toBeVisible();
    await assertFullLayoutAudit(page);
  });

  test('T2-P2-016 [F6] Mobile 390x844 workspace-mobile-bar does not overlap or occlude quiz-option-0 or btn-next', async ({
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

    await assertFullLayoutAudit(page);

    const mobileBar = workspaceMobileBar(page);
    await expect(mobileBar).toBeVisible();
    const barBox = await mobileBar.boundingBox();
    const opt0Box = await quizOption(page, 0).boundingBox();
    expect(barBox).not.toBeNull();
    expect(opt0Box).not.toBeNull();
    expect(boxesOverlap(barBox!, opt0Box!)).toBe(false);

    // Ensure btnNext inside or outside mobile bar is clickable without occlusion
    await quizOption(page, 0).click();
    await btnNext(page).click();
    await expect(quizProgressText(page)).toContainText('2 / 10');
  });

  test('T2-P2-017 [F7] Mobile 390x844 open ai-explain-drawer and answer-sheet pass full layout audit', async ({
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
    await expect(aiExplainDrawer(page)).toBeVisible();
    await expect(aiExplainDrawer(page)).toContainText('核心考点');
    await assertFullLayoutAudit(page);

    await ensureAnswerSheetOpen(page);
    await expect(answerSheet(page)).toBeVisible();
    await assertFullLayoutAudit(page);
  });

  test('T2-P2-018 [F6/F8] Mobile 390x844 Markdown/LaTeX GFM table question stays contained with zero horizontal overflow', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await seedFixtureBank(page, MARKDOWN_LATEX_BANK, makeEmptyStore(), {
      bankId: 'e2e-mobile-md-table',
      activate: true,
      targetHashRoute: '#/quiz',
    });

    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'all').click();

    await expect(qStem(page).locator('table')).toBeVisible();
    expect(await qStem(page).locator('.katex').count()).toBeGreaterThanOrEqual(3);
    await assertFullLayoutAudit(page, { checkTables: true });
  });
});
