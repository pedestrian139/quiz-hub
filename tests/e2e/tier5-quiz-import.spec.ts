import fs from 'node:fs';
import {
  expect,
  onlyDesktop,
  onlyMobile,
  test,
} from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import { gotoRoute, statCard } from './helpers/selectors.ts';
import {
  STORAGE_KEY,
  captureJsonExport,
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

test.describe('Tier 5: Offline Multi-Format Quiz Import & Multi-Bank Isolation', () => {
  test('T5-001 Paste TXT/Markdown import with proofreading fix, dynamic UI & IDB persistence across reload', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await page.getByTestId('btn-open-quiz-import').click();
    await expect(page.getByTestId('quiz-import-dialog')).toBeVisible();

    await page.getByTestId('import-tab-paste').click();
    await page.getByTestId('import-paste-textarea').fill(`
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
    await expect(page.getByTestId('btn-confirm-import')).toBeDisabled();

    // Fix Q2 inline from OOB D -> A
    await page.getByTestId('draft-edit-1').click();
    await page.getByTestId('draft-edit-ans-1-0').click();
    await expect(page.getByTestId('preview-draft-1')).toHaveAttribute('data-severity', 'ok');
    await expect(page.getByTestId('btn-confirm-import')).toBeEnabled();

    await page.getByTestId('import-bank-name').fill('计算机网络与系统');
    await page.getByTestId('btn-confirm-import').click();

    // Automatically switches to custom bank practice home
    await expect(page.getByTestId('qi-practice-home')).toBeVisible();
    await expect(page.getByTestId('qi-practice-home')).toContainText('计算机网络与系统');
    await expect(page.getByTestId('qi-chapter-chip-1')).toBeVisible();
    await expect(page.getByTestId('qi-chapter-chip-2')).toBeVisible();
    // Single-origin imported bank automatically hides origin filter
    await expect(page.getByTestId('qi-filter-origin')).toBeHidden();

    // Reload page and confirm persistence in IndexedDB
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('btn-open-quiz-import').click();
    await page.getByTestId('qi-tab-banks').click();
    await expect(page.getByTestId('bank-list')).toContainText('计算机网络与系统');
    await expect(page.getByTestId('bank-list')).toContainText('共 3 题');
  });

  test('T5-002 Custom bank progress, wrong book & favorites are isolated from built-in AI bank', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await page.getByTestId('btn-open-quiz-import').click();
    await page.getByTestId('import-tab-paste').click();
    await page.getByTestId('import-paste-textarea').fill(`
# 第一章 隔离测试
1. 隔离测试第一题？
A. 正确选项
B. 错误选项
答案：A
`);
    await page.getByTestId('btn-parse-paste').click();
    await page.getByTestId('import-bank-name').fill('隔离测试题库');
    await page.getByTestId('btn-confirm-import').click();

    await expect(page.getByTestId('qi-practice-home')).toBeVisible();
    await page.getByTestId('qi-mode-all').click();
    await expect(page.getByTestId('qi-q-stem')).toContainText('隔离测试第一题');

    // Star & answer wrong
    await page.getByTestId('qi-btn-star').click();
    await page.getByTestId('qi-option-1').click();
    await expect(page.getByTestId('qi-quiz-feedback')).toContainText('回答错误');
    await page.getByTestId('qi-btn-next').click();
    await expect(page.getByTestId('qi-result-score')).toContainText('0%');

    // Return to custom bank home and verify stats
    await page.getByRole('button', { name: '返回刷题首页' }).click();
    await expect(page.getByTestId('qi-stat-done')).toContainText('1');
    await expect(page.getByTestId('qi-stat-wrong')).toContainText('1');
    await expect(page.getByTestId('qi-stat-fav')).toContainText('1');

    // Verify wrong book in custom bank
    await page.getByTestId('qi-open-wrong').click();
    await expect(page.getByTestId('qi-list-item')).toHaveCount(1);

    // Close modal and check V1 built-in Quiz Home is completely untouched
    await page.getByTestId('btn-close-quiz-import').click();
    await gotoRoute(page, '#/quiz');
    await expect(statCard(page, 'done')).toContainText('0');
    await expect(statCard(page, 'wrong')).toContainText('0');
    await expect(statCard(page, 'fav')).toContainText('0');
  });

  test('T5-003 Lazy Excel (.xlsx) & Word (.docx) import, template downloads, and .quizhub.json share roundtrip', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await gotoRoute(page, '#/');
    await page.getByTestId('btn-open-quiz-import').click();

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
    await page.getByTestId('bank-import-file-input').setInputFiles({
      name: '后端架构模板.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuf,
    });
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('preview-summary')).toContainText('可入库 5 题');
    await page.getByTestId('btn-confirm-import').click();
    await expect(page.getByTestId('qi-practice-home')).toContainText('后端架构模板');

    // 3. Export .quizhub.json share package, delete bank, then re-import share package
    await page.getByTestId('qi-tab-banks').click();
    const customCard = page.locator('[data-testid^="bank-card-bank-"]').first();
    const cardTestId = await customCard.getAttribute('data-testid');
    const bankId = cardTestId!.replace('bank-card-', '');

    const exported = await captureJsonExport(page, () =>
      page.getByTestId(`btn-export-bank-${bankId}`).click(),
    );
    expect(exported.filename).toContain('.quizhub.json');

    page.once('dialog', (d) => d.accept());
    await page.getByTestId(`btn-delete-bank-${bankId}`).click();
    await expect(page.getByTestId(`bank-card-${bankId}`)).toHaveCount(0);

    // 4. Import .docx file (exercises lazy importer-docx mammoth chunk)
    await page.getByTestId('qi-tab-import').click();
    const docxBuf = buildMinimalDocxBuffer(`
      <w:p><w:r><w:t>1. Word 文档导入测试题：TCP 三次握手用于建立可靠连接。</w:t></w:r></w:p>
      <w:p><w:r><w:t>答案：对</w:t></w:r></w:p>
    `);
    await page.getByTestId('bank-import-file-input').setInputFiles({
      name: 'Word导入测试.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBuf,
    });
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('preview-summary')).toContainText('可入库 1 题');
    await page.getByTestId('btn-cancel-import').click();

    // 5. Re-import exported .quizhub.json share package losslessly
    await page.getByTestId('bank-import-file-input').setInputFiles({
      name: exported.filename,
      mimeType: 'application/json',
      buffer: Buffer.from(exported.raw, 'utf-8'),
    });
    await expect(page.getByTestId('import-bank-name')).toHaveValue('后端架构模板');
    await expect(page.getByTestId('preview-summary')).toContainText('可入库 5 题');
    await page.getByTestId('btn-confirm-import').click();
    await expect(page.getByTestId('qi-practice-home')).toContainText('后端架构模板');
  });

  test('T5-004 Create custom bank manually, rename bank, clear progress & V1 localStorage auto-migration', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    const qs = pickQuestions({ type: 'choice', limit: 2 });
    const v1Seed = makeSeededStore({
      correctIds: [qs[0]!.id],
      wrongIds: [qs[1]!.id],
      favIds: [qs[0]!.id],
    });

    await gotoRoute(page, '#/');
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k, v),
      [STORAGE_KEY, JSON.stringify(v1Seed)] as const,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.getByTestId('btn-open-quiz-import').click();
    await page.getByTestId('qi-tab-banks').click();

    // Built-in card reflects lossless V1 migration
    const builtinCard = page.getByTestId('bank-card-builtin-ai-intro');
    await expect(builtinCard).toContainText('已练 2');
    await expect(builtinCard).toContainText('错题 1');
    await expect(builtinCard).toContainText('收藏 1');
    await expect(page.getByTestId('btn-delete-bank-builtin-ai-intro')).toHaveCount(0);

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
    await expect(page.getByTestId(`bank-card-${createdId}`)).toContainText('手动测试库（已重命名）');

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

    await page.getByTestId('btn-open-quiz-import').click();
    await expect(page.getByTestId('quiz-import-dialog')).toBeVisible();
    await assertFullLayoutAudit(page);

    await page.getByTestId('import-tab-paste').click();
    await page.getByTestId('import-paste-textarea').fill(`
1. 移动端布局测试单选？
A. 第一项
B. 第二项
答案：C
`);
    await page.getByTestId('btn-parse-paste').click();
    await page.getByTestId('draft-edit-0').click();
    await assertFullLayoutAudit(page);

    await page.getByTestId('btn-exclude-errors').click();
    await page.getByTestId('qi-tab-banks').click();
    await assertFullLayoutAudit(page);
  });
});
