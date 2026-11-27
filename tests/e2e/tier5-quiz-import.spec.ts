import fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import {
  expect,
  onlyDesktop,
  onlyMobile,
  test,
} from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import {
  BUILTIN_AI_BANK_ID,
  BUILTIN_GUIDE_BANK_ID,
  QUIZ_DB_NAME,
  QUIZ_DB_VERSION,
} from './helpers/fixtureBank.ts';
import {
  bankCard,
  bankImportFileInput,
  bankSwitcher,
  btnConfirmImport,
  btnConfirmImportSticky,
  btnDeleteBank,
  btnNext,
  btnOpenQuizImport,
  btnResultHome,
  btnStar,
  chapterChip,
  draftEdit,
  gotoRoute,
  importPasteTextarea,
  importTab,
  listItems,
  modeCard,
  navLink,
  previewDraft,
  qStem,
  qiTab,
  quizBadgeTotal,
  quizFeedback,
  quizImportDialog,
  quizOption,
  resultScore,
  statCard,
} from './helpers/selectors.ts';
import {
  STORAGE_KEY,
  captureJsonExport,
  loadBankCatalog,
  makeSeededStore,
  pickQuestions,
} from './helpers/storage.ts';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildMinimalDocxBuffer(bodyXml: string): Buffer {
  const files = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`,
    },
  ];

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = Buffer.from(f.name, 'utf-8');
    const dataBytes = Buffer.from(f.content, 'utf-8');
    const crc = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

async function readDownloadBuffer(download: import('@playwright/test').Download): Promise<Buffer> {
  const filePath = await download.path();
  if (filePath) {
    return fs.readFileSync(filePath);
  }
  const stream = await download.createReadStream();
  if (!stream) {
    throw new Error('Download produced no readable stream');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function confirmImportCta(page: Page): Locator {
  return btnConfirmImportSticky(page).or(btnConfirmImport(page)).first();
}

async function closeImportModalAndOpenQuiz(page: Page): Promise<void> {
  await expect(quizImportDialog(page)).toBeHidden({ timeout: 10_000 });
  await expect(page).toHaveURL(/#\/quiz/);
  if (!page.url().includes('#/quiz')) {
    await navLink(page, 'quiz').click();
  }
  await expect(modeCard(page, 'all')).toBeVisible();
}

async function getSelectedBankIdFromSwitcher(page: Page): Promise<string | null> {
  const switcher = bankSwitcher(page);
  await expect(switcher).toBeVisible();
  const tagName = await switcher.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    return switcher.inputValue();
  }
  return switcher.getAttribute('data-active-bank-id');
}

async function switchBankViaSwitcher(
  page: Page,
  targetBankId: string,
  targetLabel?: RegExp,
): Promise<void> {
  const switcher = bankSwitcher(page);
  await expect(switcher).toBeVisible();
  const tagName = await switcher.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    await switcher.selectOption(targetBankId);
    return;
  }
  await switcher.click();
  const byOptionId = page.getByTestId(`bank-switch-option-${targetBankId}`);
  if (await byOptionId.isVisible().catch(() => false)) {
    await byOptionId.click();
  } else if (targetLabel) {
    await page
      .getByRole('option', { name: targetLabel })
      .or(page.getByRole('menuitem', { name: targetLabel }))
      .or(page.getByRole('button', { name: targetLabel }))
      .first()
      .click();
  }
}

test.describe('Tier 5: Multi-Format Quiz Import & Unified Workspace Isolation', () => {
  test('T5-001 Paste TXT/Markdown import with proofreading fix, unified workspace & IDB persistence across reload', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await expect(quizImportDialog(page)).toBeVisible();

    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(`
# 第一章 网络协议
1. HTTP 协议工作在 OSI 模型的应用层。
答案：正确

2. 以下属于传输层协议的是（ ）。
A. TCP
B. HTTP
答案：D

# 第二章 操作系统
3. 进程是操作系统资源分配的基本单位。
答案：对
`);
    await page.getByTestId('btn-parse-paste').click();

    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('preview-summary')).toContainText('共识别 3 题');
    await expect(page.getByTestId('preview-summary')).toContainText('异常 1 题');
    await expect(confirmImportCta(page)).toBeDisabled();

    // Fix Q2 inline from OOB D -> A
    await draftEdit(page, 1).click();
    await page.getByTestId('draft-edit-ans-1-0').click();
    await expect(previewDraft(page, 1)).toHaveAttribute('data-severity', 'ok');
    await expect(confirmImportCta(page)).toBeEnabled();

    await page.getByTestId('import-bank-name').fill('计算机网络与系统');
    await confirmImportCta(page).click();

    // Automatically activates imported bank in unified main #/quiz workspace
    await closeImportModalAndOpenQuiz(page);
    await expect(bankSwitcher(page)).toBeVisible();
    await expect(bankSwitcher(page)).toContainText('计算机网络与系统');
    await expect(quizBadgeTotal(page)).toContainText('3');
    await expect(modeCard(page, 'all')).toContainText('3');
    await expect(chapterChip(page, 1)).toBeVisible();
    await expect(chapterChip(page, 2)).toBeVisible();

    // Reload page and confirm persistence in IndexedDB
    await page.reload({ waitUntil: 'domcontentloaded' });
    await btnOpenQuizImport(page).click();
    await qiTab(page, 'banks').click();
    await expect(page.getByTestId('bank-list')).toContainText('计算机网络与系统');
    await expect(page.getByTestId('bank-list')).toContainText('共 3 题');
  });

  test('T5-002 Custom bank progress, wrong book & favorites are isolated from built-in QuizHub bank', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();
    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(`
# 第一章 隔离测试
1. 隔离测试第一题？
A. 正确选项
B. 错误选项
答案：A
`);
    await page.getByTestId('btn-parse-paste').click();
    await page.getByTestId('import-bank-name').fill('隔离测试题库');
    await confirmImportCta(page).click();

    await closeImportModalAndOpenQuiz(page);
    await expect(bankSwitcher(page)).toContainText('隔离测试题库');
    const customBankId = await getSelectedBankIdFromSwitcher(page);

    await modeCard(page, 'all').click();
    await expect(qStem(page)).toContainText('隔离测试第一题');

    // Star & answer wrong
    await btnStar(page).click();
    await quizOption(page, 1).click();
    await expect(quizFeedback(page)).toContainText('回答错误');
    await btnNext(page).click();
    await expect(resultScore(page)).toContainText('0%');

    // Return to unified workspace quiz home and verify custom bank stats
    await btnResultHome(page).click();
    await expect(statCard(page, 'done')).toContainText('1');
    await expect(statCard(page, 'wrong')).toContainText('1');
    await expect(statCard(page, 'fav')).toContainText('1');

    // Verify wrong book in custom bank
    await navLink(page, 'wrong').click();
    await expect(listItems(page)).toHaveCount(1);

    // Switch to built-in onboarding bank via bankSwitcher and confirm isolated stats
    await navLink(page, 'quiz').click();
    await switchBankViaSwitcher(page, BUILTIN_GUIDE_BANK_ID, /QuizHub 使用引导示例题库/);
    await expect(statCard(page, 'done')).toContainText('0');
    await expect(statCard(page, 'wrong')).toContainText('0');
    await expect(statCard(page, 'fav')).toContainText('0');

    // Switch back to custom bank and verify progress is preserved
    if (customBankId) {
      await switchBankViaSwitcher(page, customBankId, /隔离测试题库/);
      await expect(statCard(page, 'done')).toContainText('1');
      await expect(statCard(page, 'wrong')).toContainText('1');
      await expect(statCard(page, 'fav')).toContainText('1');
    }
  });

  test('T5-003 Lazy Excel (.xlsx) & Word (.docx) import, template downloads, and .quizhub.json share roundtrip', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await btnOpenQuizImport(page).click();

    // 1. Download TXT & XLSX templates
    const [txtDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('btn-download-txt-tpl').click(),
    ]);
    expect(txtDownload.suggestedFilename()).toBe('quizhub-template.txt');

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('btn-download-xlsx-tpl').click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toBe('quizhub-template.xlsx');
    const xlsxBuf = await readDownloadBuffer(xlsxDownload);

    // 2. Upload downloaded Excel template (exercises lazy importer-xlsx chunk)
    await bankImportFileInput(page).setInputFiles({
      name: '后端架构模板.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuf,
    });
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('preview-summary')).toContainText('可入库 5 题');
    await confirmImportCta(page).click();

    await closeImportModalAndOpenQuiz(page);
    await expect(bankSwitcher(page)).toContainText('后端架构模板');
    await expect(quizBadgeTotal(page)).toContainText('5');

    // 3. Export .quizhub.json share package, delete bank, then re-import share package
    await btnOpenQuizImport(page).click();
    await qiTab(page, 'banks').click();
    const customCard = page.locator('[data-testid^="bank-card-bank-"]').first();
    const cardTestId = await customCard.getAttribute('data-testid');
    const bankId = cardTestId!.replace('bank-card-', '');

    const exported = await captureJsonExport(page, () =>
      page.getByTestId(`btn-export-bank-${bankId}`).click(),
    );
    expect(exported.filename).toContain('.quizhub.json');

    page.once('dialog', (d) => d.accept());
    await btnDeleteBank(page, bankId).click();
    await expect(bankCard(page, bankId)).toHaveCount(0);

    // 4. Import .docx file (exercises lazy importer-docx mammoth chunk)
    await qiTab(page, 'import').click();
    const docxBuf = buildMinimalDocxBuffer(`
      <w:p><w:r><w:t>1. Word 文档导入测试题：TCP 三次握手用于建立可靠连接。</w:t></w:r></w:p>
      <w:p><w:r><w:t>答案：对</w:t></w:r></w:p>
    `);
    await bankImportFileInput(page).setInputFiles({
      name: 'Word导入测试.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBuf,
    });
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('preview-summary')).toContainText('可入库 1 题');
    await page.getByTestId('btn-cancel-import').click();

    // 5. Re-import exported .quizhub.json share package losslessly
    await bankImportFileInput(page).setInputFiles({
      name: exported.filename,
      mimeType: 'application/json',
      buffer: Buffer.from(exported.raw, 'utf-8'),
    });
    await expect(page.getByTestId('import-bank-name')).toHaveValue('后端架构模板');
    await expect(page.getByTestId('preview-summary')).toContainText('可入库 5 题');
    await confirmImportCta(page).click();

    await closeImportModalAndOpenQuiz(page);
    await expect(bankSwitcher(page)).toContainText('后端架构模板');
    await expect(modeCard(page, 'all')).toContainText('5');
  });

  test('T5-004 Create custom bank manually, rename bank, clear progress & V1 localStorage auto-migration', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const onboardingBank = loadBankCatalog();
    const qs = pickQuestions({ type: 'choice', limit: 2 }, onboardingBank);
    const v1Seed = makeSeededStore(
      {
        correctIds: [qs[0]!.id],
        wrongIds: [qs[1]!.id],
        favIds: [qs[0]!.id],
      },
      onboardingBank,
    );

    await gotoRoute(page, '#/');
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k, v),
      [STORAGE_KEY, JSON.stringify(v1Seed)] as const,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });

    await btnOpenQuizImport(page).click();
    await qiTab(page, 'banks').click();

    // Built-in guide card reflects QuizHub onboarding title & is non-deletable
    const builtinCard = bankCard(page, BUILTIN_GUIDE_BANK_ID);
    await expect(builtinCard).toContainText('QuizHub 使用引导示例题库');
    await expect(btnDeleteBank(page, BUILTIN_GUIDE_BANK_ID)).toHaveCount(0);

    // V1 localStorage progress auto-migrates losslessly into IndexedDB under hidden BUILTIN_AI_BANK_ID
    const migratedV1Progress = await page.evaluate(
      ({ dbName, dbVersion, bankId }) =>
        new Promise<{ records: Record<string, { ok: number }>; fav: Record<string, boolean> } | null>(
          (resolve) => {
            const req = indexedDB.open(dbName, dbVersion);
            req.onerror = () => resolve(null);
            req.onsuccess = () => {
              const db = req.result;
              try {
                const tx = db.transaction('progress', 'readonly');
                const getReq = tx.objectStore('progress').get(bankId);
                getReq.onerror = () => {
                  db.close();
                  resolve(null);
                };
                getReq.onsuccess = () => {
                  const entry = getReq.result as
                    | { store?: { records: Record<string, { ok: number }>; fav: Record<string, boolean> } }
                    | undefined;
                  db.close();
                  resolve(entry?.store ?? null);
                };
              } catch {
                db.close();
                resolve(null);
              }
            };
          },
        ),
      { dbName: QUIZ_DB_NAME, dbVersion: QUIZ_DB_VERSION, bankId: BUILTIN_AI_BANK_ID },
    );
    expect(migratedV1Progress).not.toBeNull();
    expect(Object.keys(migratedV1Progress!.records)).toHaveLength(2);
    expect(Object.values(migratedV1Progress!.records).filter((r) => r.ok === 0)).toHaveLength(1);
    expect(Object.values(migratedV1Progress!.fav).filter(Boolean)).toHaveLength(1);

    // Create manual custom bank & rename it
    await page.getByTestId('btn-new-bank').click();
    await page.getByTestId('new-bank-name').fill('手动测试库');
    await page.getByTestId('new-bank-starter-stem').fill('手写示例判断题');
    await page.getByTestId('btn-create-bank-submit').click();

    const createdCard = page.locator('[data-testid^="bank-card-bank-"]').first();
    const createdId = (await createdCard.getAttribute('data-testid'))!.replace('bank-card-', '');
    await page.getByTestId(`btn-rename-bank-${createdId}`).click();
    await page.getByTestId('rename-bank-input').fill('手动测试库（已重命名）');
    await page.getByTestId('btn-rename-save').click();
    await expect(bankCard(page, createdId)).toContainText('手动测试库（已重命名）');

    // V1 localStorage untouched
    const v1After = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
    expect(v1After).not.toBeNull();
  });

  test('T5-005 Mobile 390x844 passes zero horizontal overflow & zero overlapping controls across QuizImport views', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    await gotoRoute(page, '#/');
    await assertFullLayoutAudit(page);

    await btnOpenQuizImport(page).click();
    await expect(quizImportDialog(page)).toBeVisible();
    await assertFullLayoutAudit(page);

    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(`
1. 移动端布局测试单选？
A. 第一项
B. 第二项
答案：C
`);
    await page.getByTestId('btn-parse-paste').click();
    await draftEdit(page, 0).click();
    await assertFullLayoutAudit(page);

    await page.getByTestId('btn-exclude-errors').click();
    await qiTab(page, 'banks').click();
    await assertFullLayoutAudit(page);
  });
});
