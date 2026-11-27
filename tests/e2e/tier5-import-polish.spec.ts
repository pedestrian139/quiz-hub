import type { Page } from '@playwright/test';
import { expect, test } from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import {
  LEGACY_PHASE1_BANK_JSON,
  QUIZ_DB_NAME,
  QUIZ_DB_VERSION,
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
  aiBtnExplain,
  aiExplainCard,
  aiExplainDrawer,
  aiWashBtn,
  aiWashCancel,
  bankCard,
  bankImportFileInput,
  bankSwitcher,
  btnDeleteBank,
  btnExportBank,
  btnNext,
  btnOpenQuizImport,
  btnConfirmImportSticky,
  filterOrder,
  gotoRoute,
  importBankName,
  importPasteTextarea,
  importTab,
  jsonInterceptAiBtn,
  jsonInterceptBanner,
  jsonInterceptDirectBtn,
  modeCard,
  previewDraft,
  qiTab,
  qStem,
  quizBadgeTotal,
  quizFeedback,
  quizImportDialog,
  quizOption,
  tfBtn,
  washTargetBankMode,
  washTargetBankName,
  washTargetExistingBank,
  washTypeCheckbox,
  washTypeGuardHint,
  washTypeObjectiveBtn,
} from './helpers/selectors.ts';
import {
  captureJsonExport,
  makeEmptyStore,
  type BankData,
  type Question,
} from './helpers/storage.ts';

const ROUNDTRIP_BANK_ID = 'e2e-roundtrip-fidelity';
const APPEND_TARGET_ID = 'e2e-append-target';

interface StoredBankRecord {
  id: string;
  name: string;
  data: BankData;
}

const ROUNDTRIP_BANK: BankData = {
  meta: {
    title: '解析保真往返测试库',
    version: '2.0.0',
    generatedAt: '2026-11-26T00:00:00.000Z',
    counts: {
      total: 2,
      byType: { choice: 1, multi: 0, tf: 1, short: 0, analysis: 0 },
      byOrigin: { comprehensive_bank: 2, video_popup: 0, review_notes_synthesized: 0 },
    },
  },
  chapters: [{ id: 1, short: '网络协议', title: '第一章 传输层与解析保真' }],
  questions: [
    {
      id: 'rt-q1',
      type: 'choice',
      chapter: 1,
      stem: '往返保真测试题1：TCP 建立连接的三次握手中，首次发送的报文标志位是？',
      options: ['SYN', 'FIN', 'RST', 'URG'],
      answer: 0,
      explain: '原题解析-Q1：三次握手首先由客户端发送 SYN 报文确认序列号。',
      tags: ['TCP', '保真'],
      source: { origin: 'comprehensive_bank', file: 'roundtrip.json', ref: 'rt-1' },
    },
    {
      id: 'rt-q2',
      type: 'tf',
      chapter: 1,
      stem: '往返保真测试题2：UDP 协议在发送数据前无需建立面向连接的会话。',
      answer: true,
      explain: '原题解析-Q2：主解析内容。',
      explanation: '原题补充解析-Q2：独立explanation字段。',
      aiAnalysis: '预置AI深度解析-Q2：不应覆盖原题解析。',
      tags: ['UDP', '保真'],
      source: { origin: 'comprehensive_bank', file: 'roundtrip.json', ref: 'rt-2' },
    },
  ],
};

const APPEND_TARGET_BANK: BankData = {
  meta: {
    title: '已有目标题库',
    version: '2.0.0',
    generatedAt: '2026-11-26T00:00:00.000Z',
    counts: {
      total: 2,
      byType: { choice: 1, multi: 0, tf: 1, short: 0, analysis: 0 },
      byOrigin: { comprehensive_bank: 2, video_popup: 0, review_notes_synthesized: 0 },
    },
  },
  chapters: [{ id: 1, short: '基础', title: '第一章 原有题目' }],
  questions: [
    {
      id: 'app-old-1',
      type: 'choice',
      chapter: 1,
      stem: '已有题库原始题1：进程与线程的主要区别在于？',
      options: ['进程是资源分配的基本单位', '线程不能共享地址空间', '进程比线程切换开销小', '线程拥有独立页表'],
      answer: 0,
      explain: '原始题目1解析：进程拥有独立地址空间，线程共享所属进程资源。',
      tags: ['操作系统'],
      source: { origin: 'comprehensive_bank', file: 'append-base.json', ref: 'app-1' },
    },
    {
      id: 'app-old-2',
      type: 'tf',
      chapter: 1,
      stem: '已有题库原始题2：死锁发生的四个必要条件缺一不可。',
      answer: true,
      explain: '原始题目2解析：互斥、占有且等待、不可剥夺、循环等待。',
      tags: ['操作系统'],
      source: { origin: 'comprehensive_bank', file: 'append-base.json', ref: 'app-2' },
    },
  ],
};

const FOUR_TYPE_WASH_RAW_TEXT = [
  SMART_WASH_RAW_TEXT,
  '',
  '5. 请简述哈希冲突的常见解决方法。',
  '答案：链地址法与开放定址法。',
].join('\n');

function buildMultiChunkWashText(includeRetryMarker = true): string {
  const chunk1Padding = Array.from({ length: 12 }, (_, idx) =>
    `${idx + 1}. 分布式系统第 ${idx + 1} 题：关于共识算法与幂等性设计的核心约束说明，请结合状态机复制、任期编号、日志匹配特性以及网络分区场景下的安全性保证进行准确辨析（批量分段长度填充文本 ${'#'.repeat(120)}）。\nA. 满足状态机安全性\nB. 允许任意脑裂提交\n答案：A`,
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

async function confirmAndWaitAutoClose(page: Page): Promise<void> {
  const stickyBtn = btnConfirmImportSticky(page);
  await expect(stickyBtn).toBeEnabled();
  await stickyBtn.click();
  await expect(quizImportDialog(page)).toBeHidden({ timeout: 10_000 });
  await expect(page).toHaveURL(/#\/quiz/);
  await expect(modeCard(page, 'all')).toBeVisible();
}

async function maybeMobileAudit(
  page: Page,
  viewportKind: 'desktop' | 'mobile',
): Promise<void> {
  if (viewportKind === 'mobile') {
    await assertFullLayoutAudit(page);
  }
}

async function triggerPasteIntercept(page: Page, rawText: string): Promise<void> {
  const textarea = importPasteTextarea(page);
  await textarea.evaluate((el) => {
    el.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
  });
  await textarea.fill(rawText);
}

async function triggerDropIntercept(page: Page, rawText: string, fileName?: string): Promise<void> {
  await page.locator('.qi-paste-dropwrap').evaluate(
    (el, payload: { text: string; name?: string }) => {
      const dt = new DataTransfer();
      if (payload.name) {
        const file = new File([payload.text], payload.name, { type: 'application/json' });
        dt.items.add(file);
      } else {
        dt.setData('text/plain', payload.text);
      }
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { text: rawText, name: fileName },
  );
}

async function readIdbBanks(page: Page): Promise<StoredBankRecord[]> {
  return page.evaluate(
    async ({ dbName, dbVersion }) => {
      return new Promise<StoredBankRecord[]>((resolve, reject) => {
        const req = window.indexedDB.open(dbName, dbVersion);
        req.onerror = () => reject(req.error ?? new Error('Failed to open quizhub-v2 IDB'));
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['banks'], 'readonly');
          const getAll = tx.objectStore('banks').getAll();
          getAll.onsuccess = () => {
            db.close();
            resolve((getAll.result ?? []) as StoredBankRecord[]);
          };
          getAll.onerror = () => {
            db.close();
            reject(getAll.error ?? new Error('Failed to read banks from IDB'));
          };
        };
      });
    },
    { dbName: QUIZ_DB_NAME, dbVersion: QUIZ_DB_VERSION },
  );
}

test.describe('Tier 5: Import Polish Regression & New Features (Desktop & Mobile)', () => {
  test('T5-POL-001 Legacy JSON direct import ({ meta, chapters, questions }) & mobile layout audit', async ({
    page,
    viewportKind,
  }) => {
    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await expect(quizImportDialog(page)).toBeVisible();

    await bankImportFileInput(page).setInputFiles(
      makeJsonUploadFile('legacy-phase1-bank.json', LEGACY_PHASE1_BANK_JSON),
    );
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('preview-summary')).toContainText('可入库 4 题');
    await expect(importBankName(page)).toHaveValue('Phase 1 旧版兼容题库');
    await maybeMobileAudit(page, viewportKind);

    await confirmAndWaitAutoClose(page);
    await expect(bankSwitcher(page)).toContainText('Phase 1 旧版兼容题库');
    await expect(quizBadgeTotal(page)).toContainText('4');
    await maybeMobileAudit(page, viewportKind);
  });

  test('T5-POL-002 .quizhub.json roundtrip fidelity preserves explain, explanation & cached aiAnalysis with 0 LLM calls', async ({
    page,
    viewportKind,
  }) => {
    await seedFixtureBank(page, ROUNDTRIP_BANK, makeEmptyStore(), {
      bankId: ROUNDTRIP_BANK_ID,
      activate: true,
      apiConfig: {},
      targetHashRoute: '#/quiz',
    });

    const mockLlm = await installMockLlm(page, {
      explainContent: '### 【核心考点】\n缓存AI深度解析-Q1：SYN与ACK标志位握手确认。',
    });

    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'all').click();

    await expect(qStem(page)).toContainText('往返保真测试题1');
    await quizOption(page, 0).click();
    await expect(quizFeedback(page)).toContainText('原题解析-Q1');

    await aiBtnExplain(page).click();
    await expect(aiExplainCard(page)).toContainText('缓存AI深度解析-Q1');
    await expect(aiExplainDrawer(page)).toContainText('重新生成');

    // Wait for saveQuestionAiAnalysis to flush Q1 aiAnalysis into IndexedDB before exporting
    await expect
      .poll(async () => {
        const banks = await readIdbBanks(page);
        const target = banks.find((b) => b.id === ROUNDTRIP_BANK_ID);
        return target?.data.questions.find((q) => q.id === 'rt-q1')?.aiAnalysis ?? '';
      })
      .toContain('缓存AI深度解析-Q1');

    await btnOpenQuizImport(page).click();
    await qiTab(page, 'banks').click();
    await expect(bankCard(page, ROUNDTRIP_BANK_ID)).toBeVisible();

    const exported = await captureJsonExport(page, () =>
      btnExportBank(page, ROUNDTRIP_BANK_ID).click(),
    );
    expect(exported.filename).toContain('.quizhub.json');

    page.once('dialog', (d) => d.accept());
    await btnDeleteBank(page, ROUNDTRIP_BANK_ID).click();
    await expect(bankCard(page, ROUNDTRIP_BANK_ID)).toHaveCount(0);

    mockLlm.clear();
    await qiTab(page, 'import').click();
    await bankImportFileInput(page).setInputFiles(
      makeJsonUploadFile(exported.filename, exported.raw),
    );
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('preview-summary')).toContainText('可入库 2 题');
    await maybeMobileAudit(page, viewportKind);

    await confirmAndWaitAutoClose(page);
    await expect(bankSwitcher(page)).toContainText('解析保真往返测试库');
    await expect(quizBadgeTotal(page)).toContainText('2');

    // Verify re-imported bank keeps explain, explanation & aiAnalysis separate in IDB
    const reimportedBanks = await readIdbBanks(page);
    const reimportedBank = reimportedBanks.find((b) => b.name === '解析保真往返测试库');
    expect(reimportedBank).toBeDefined();
    const reimportedQ2 = reimportedBank!.data.questions.find((q) =>
      q.stem.includes('往返保真测试题2'),
    );
    expect(reimportedQ2).toBeDefined();
    expect(reimportedQ2!.explain).toBe('原题解析-Q2：主解析内容。');
    expect(reimportedQ2!.explanation).toBe('原题补充解析-Q2：独立explanation字段。');
    expect(reimportedQ2!.aiAnalysis).toBe('预置AI深度解析-Q2：不应覆盖原题解析。');

    // Verify in #/quiz UI that original explain & cached aiAnalysis both render with 0 LLM calls
    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'all').click();

    await expect(qStem(page)).toContainText('往返保真测试题1');
    await quizOption(page, 0).click();
    await expect(quizFeedback(page)).toContainText('原题解析-Q1');
    await aiBtnExplain(page).click();
    await expect(aiExplainDrawer(page)).toContainText('已命中缓存');
    await expect(aiExplainCard(page)).toContainText('缓存AI深度解析-Q1');
    await maybeMobileAudit(page, viewportKind);

    await btnNext(page).click();
    await expect(qStem(page)).toContainText('往返保真测试题2');
    await tfBtn(page, true).click();
    await expect(quizFeedback(page)).toContainText('原题解析-Q2：主解析内容。');
    await aiBtnExplain(page).click();
    await expect(aiExplainDrawer(page)).toContainText('已命中缓存');
    await expect(aiExplainCard(page)).toContainText('预置AI深度解析-Q2');

    const llmCallsAfterImport = mockLlm.requests.filter((r) =>
      r.url.endsWith('/chat/completions'),
    );
    expect(llmCallsAfterImport).toHaveLength(0);
  });

  test('T5-POL-003 4-type checkboxes, empty guard, objective preset, System Prompt & #/quiz filtering', async ({
    page,
    viewportKind,
  }) => {
    await seedGuestApiConfig(page);
    const mockLlm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await importTab(page, 'paste').click();

    for (const type of ['choice', 'multi', 'tf', 'short'] as const) {
      await expect(washTypeCheckbox(page, type)).toBeChecked();
    }
    await expect(washTypeGuardHint(page)).toBeHidden();
    await expect(aiWashBtn(page)).toBeEnabled();

    for (const type of ['choice', 'multi', 'tf', 'short'] as const) {
      await washTypeCheckbox(page, type).uncheck();
    }
    await expect(aiWashBtn(page)).toBeDisabled();
    await expect(washTypeGuardHint(page)).toBeVisible();
    await expect(washTypeGuardHint(page)).toContainText('请至少选择 1 种题型');
    await maybeMobileAudit(page, viewportKind);

    await washTypeObjectiveBtn(page).click();
    await expect(washTypeCheckbox(page, 'choice')).toBeChecked();
    await expect(washTypeCheckbox(page, 'multi')).toBeChecked();
    await expect(washTypeCheckbox(page, 'tf')).toBeChecked();
    await expect(washTypeCheckbox(page, 'short')).not.toBeChecked();
    await expect(washTypeGuardHint(page)).toBeHidden();
    await expect(aiWashBtn(page)).toBeEnabled();

    await importPasteTextarea(page).fill(FOUR_TYPE_WASH_RAW_TEXT);
    await washTargetBankName(page).fill('仅客观题洗题库');
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 0)).toBeVisible();
    const washReqs = mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions'));
    expect(washReqs.length).toBeGreaterThanOrEqual(1);
    const systemPrompt =
      washReqs[0]!.body?.messages?.find((m) => m.role === 'system')?.content ?? '';
    expect(systemPrompt).toContain('"choice"');
    expect(systemPrompt).toContain('"multi"');
    expect(systemPrompt).toContain('"tf"');
    expect(systemPrompt).not.toContain('"short"');

    // Raw text had 5 questions (choice x2, multi x1, tf x1, short x1); short must be excluded
    await expect(page.locator('[data-testid^="preview-draft-"]')).toHaveCount(4);
    await expect(page.getByTestId('draft-list-container')).not.toContainText('简答题');
    await maybeMobileAudit(page, viewportKind);

    await confirmAndWaitAutoClose(page);
    await expect(bankSwitcher(page)).toContainText('仅客观题洗题库');
    await expect(quizBadgeTotal(page)).toContainText('4');
    await expect(modeCard(page, 'short')).toContainText('0 题');
    await expect(modeCard(page, 'short')).toHaveClass(/is-empty/);
  });

  test('T5-POL-004 Standard JSON auto-intercept skips AI on direct import and runs AI on override', async ({
    page,
    viewportKind,
  }) => {
    // Part A: 0 API config + paste intercept -> Direct import with 0 LLM requests
    await clearGuestApiConfig(page);
    const mockLlm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await importTab(page, 'paste').click();

    await triggerPasteIntercept(page, LEGACY_PHASE1_BANK_JSON);
    const banner = jsonInterceptBanner(page);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('检测到这已经是标准题库格式，是否跳过 AI 消耗直接秒导？');
    await maybeMobileAudit(page, viewportKind);

    await jsonInterceptDirectBtn(page).click();
    await expect(banner).toBeHidden();
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('preview-summary')).toContainText('可入库 4 题');
    expect(mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(0);

    await confirmAndWaitAutoClose(page);
    await expect(quizBadgeTotal(page)).toContainText('4');
    expect(mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(0);

    // Part B: Seeded API config + drop intercept -> click "仍用 AI 洗题" -> AI wash runs
    await seedGuestApiConfig(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await importTab(page, 'paste').click();

    await triggerDropIntercept(page, LEGACY_PHASE1_BANK_JSON, 'dropped-standard.json');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('检测到这已经是标准题库格式，是否跳过 AI 消耗直接秒导？');
    expect(mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(0);

    await jsonInterceptAiBtn(page).click();
    await expect(banner).toBeHidden();
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 0)).toBeVisible();
    expect(
      mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions')).length,
    ).toBeGreaterThanOrEqual(1);
    await maybeMobileAudit(page, viewportKind);
  });

  test('T5-POL-005 Append washed drafts to existing custom bank without overwriting original questions', async ({
    page,
    viewportKind,
  }) => {
    await seedFixtureBank(page, APPEND_TARGET_BANK, makeEmptyStore(), {
      bankId: APPEND_TARGET_ID,
      activate: true,
      apiConfig: {},
      targetHashRoute: '#/',
    });
    await installMockLlm(page);

    await btnOpenQuizImport(page).click();
    await importTab(page, 'paste').click();

    await washTargetBankMode(page).selectOption('existing');
    await expect(washTargetExistingBank(page)).toBeVisible();
    await washTargetExistingBank(page).selectOption(APPEND_TARGET_ID);

    const newQuestionsRaw = [
      '1. 新追加题目1：以下哪项协议工作在应用层？',
      'A. HTTP',
      'B. IP',
      'C. ARP',
      'D. ICMP',
      '答案：A',
      '',
      '2. 新追加题目2：HTTPS 默认使用 443 端口提供加密传输。',
      '答案：正确',
    ].join('\n');
    await importPasteTextarea(page).fill(newQuestionsRaw);
    await aiWashBtn(page).click();

    await expect(previewDraft(page, 1)).toBeVisible();
    await expect(page.getByTestId('import-preview')).toContainText('将追加 2 道有效题目到已有题库');
    await expect(btnConfirmImportSticky(page)).toContainText('确认追加到题库（共 2 题）');
    await maybeMobileAudit(page, viewportKind);

    await confirmAndWaitAutoClose(page);
    await expect(bankSwitcher(page)).toContainText('已有目标题库');
    await expect(quizBadgeTotal(page)).toContainText('4');

    const banks = await readIdbBanks(page);
    const updated = banks.find((b) => b.id === APPEND_TARGET_ID);
    expect(updated).toBeDefined();
    expect(updated!.data.questions).toHaveLength(4);
    const stems = updated!.data.questions.map((q: Question) => q.stem);
    expect(stems.some((s) => s.includes('已有题库原始题1'))).toBe(true);
    expect(stems.some((s) => s.includes('已有题库原始题2'))).toBe(true);
    expect(stems.some((s) => s.includes('新追加题目1'))).toBe(true);
    expect(stems.some((s) => s.includes('新追加题目2'))).toBe(true);

    await filterOrder(page).selectOption('seq');
    await modeCard(page, 'all').click();
    await expect(qStem(page)).toContainText('已有题库原始题1');
  });

  test('T5-POL-006 Chunked AI wash cancel & single-batch HTTP 500 retry recovery with desktop & mobile audit', async ({
    page,
    healthTrap,
  }) => {
    await seedGuestApiConfig(page);
    const cancelLlm = await installMockLlm(page, { delayMs: 900 });
    healthTrap.allowUrlOnce(MOCK_API_BASE);
    healthTrap.allowUrlOnce(MOCK_API_BASE);
    healthTrap.allowUrlOnce(MOCK_API_BASE);

    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(buildMultiChunkWashText(false));

    await aiWashBtn(page).click();
    const cancelBtn = aiWashCancel(page);
    await expect(cancelBtn).toBeVisible();
    await assertFullLayoutAudit(page);
    await cancelBtn.click();

    await expect(cancelBtn).toBeHidden();
    await expect(aiWashBtn(page)).toBeEnabled();

    await cancelLlm.unroute();
    await installMockLlm(page, {
      failOnMatch: '[CHUNK_RETRY_MARKER]',
      failCount: 1,
      failStatus: 500,
    });
    healthTrap.expectHttpError(MOCK_API_BASE, 500);

    await importPasteTextarea(page).fill(buildMultiChunkWashText(true));
    await washTargetBankName(page).fill('分片重试恢复库');
    await aiWashBtn(page).click();

    const retryBtn = page.locator('[data-testid^="ai-wash-retry-chunk-"]').first();
    await expect(retryBtn).toBeVisible({ timeout: 10_000 });
    const beforeRetryCount = await page.locator('[data-testid^="preview-draft-"]').count();
    expect(beforeRetryCount).toBeGreaterThanOrEqual(1);
    await assertFullLayoutAudit(page);

    await retryBtn.click();
    await expect(page.locator('[data-testid^="ai-wash-retry-chunk-"]')).toHaveCount(0);

    const afterRetryCount = await page.locator('[data-testid^="preview-draft-"]').count();
    expect(afterRetryCount).toBeGreaterThan(beforeRetryCount);
    await assertFullLayoutAudit(page);

    await confirmAndWaitAutoClose(page);
    await expect(bankSwitcher(page)).toContainText('分片重试恢复库');
    await expect(quizBadgeTotal(page)).toContainText(String(afterRetryCount));
    await assertFullLayoutAudit(page);
  });
});
