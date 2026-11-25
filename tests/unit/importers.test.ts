// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportBankSharePackage } from '../../src/utils/bankDb';
import {
  parseImportFile,
  parseJsonBank,
  parsePastedContent,
  parseTextQuestions,
  STANDARD_TXT_TEMPLATE,
} from '../../src/utils/importers';
import { parseDocxBuffer, parseDocxHtml } from '../../src/utils/importers/docxImporter';
import {
  generateExcelTemplateBuffer,
  parseExcelBuffer,
} from '../../src/utils/importers/excelImporter';
import {
  annotateDuplicateStems,
  finalizeDraftsToBank,
  validateDraftQuestion,
} from '../../src/utils/importers/normalize';
import {
  decodeTextBuffer,
  parseDelimitedText,
  parseTabularRows,
} from '../../src/utils/importers/tabularParser';
import type { BankRecord } from '../../src/utils/quizImportTypes';

/** Minimal pure-JS STORE ZIP builder for generating real valid .docx ArrayBuffers in tests. */
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

function buildStoredZip(files: { name: string; content: string }[]): ArrayBuffer {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.content);
    const crc = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
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
    cv.setUint16(10, 0, true);
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

  const total = new Uint8Array(offset + centralSize + 22);
  let pos = 0;
  for (const p of localParts) {
    total.set(p, pos);
    pos += p.length;
  }
  for (const c of centralParts) {
    total.set(c, pos);
    pos += c.length;
  }
  total.set(eocd, pos);
  return total.buffer;
}

function buildMinimalDocx(bodyXml: string): ArrayBuffer {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`;

  return buildStoredZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rels },
    { name: 'word/document.xml', content: docXml },
  ]);
}

describe('importers', () => {
  it('IMP-01: Excel template roundtrip parses all 5 question types with 0 errors', async () => {
    const buf = await generateExcelTemplateBuffer();
    const res = await parseExcelBuffer(buf, '计算机基础模板.xlsx');

    expect(res.fatalError).toBeUndefined();
    expect(res.format).toBe('xlsx');
    expect(res.suggestedName).toBe('计算机基础模板');
    expect(res.drafts).toHaveLength(5);
    expect(res.drafts.map((d) => d.type)).toEqual([
      'choice',
      'multi',
      'tf',
      'short',
      'analysis',
    ]);
    expect(res.drafts.every((d) => d.issues.length === 0)).toBe(true);

    const finalized = finalizeDraftsToBank(res.drafts, { name: res.suggestedName });
    expect(finalized.questions).toHaveLength(5);
    expect(finalized.chapters.length).toBe(2);
    expect(finalized.questions[0]!.answer).toBe(1);
    expect(finalized.questions[1]!.answer).toEqual([0, 2, 3]);
    expect(finalized.questions[2]!.answer).toBe(false);
    expect(finalized.questions[3]!.keyPoints).toHaveLength(4);
  });

  it('IMP-02: Tabular parser supports 考试宝/超星/问卷星 headers, banner row, and option-text answers', () => {
    const rows = [
      ['考试宝题库导入模板（请勿修改表头行）'],
      ['题目类型*', '题干（必填）', '选项A', '选项B', '选项C', '选项D', '正确答案（必填）', '解析'],
      ['单选题', 'HTTP 协议默认端口为？', '21', '80', '443', '8080', '80', 'HTTP 默认 80 端口'],
      ['多选题', '以下属于传输层协议的是？', 'TCP', 'UDP', 'ICMP', 'ARP', 'A,B', ''],
      ['判断题', 'UDP 提供无连接的不可靠传输。', '', '', '', '', '√', ''],
    ];

    const { drafts } = parseTabularRows(rows, {
      sourceFormat: 'xlsx',
      defaultChapterId: 1,
      defaultChapterName: '网络协议',
    });

    expect(drafts).toHaveLength(3);
    expect(drafts[0]!.answer).toBe(1); // matched option B by exact text "80"
    expect(drafts[1]!.answer).toEqual([0, 1]);
    expect(drafts[2]!.answer).toBe(true);
    expect(drafts.every((d) => d.issues.every((i) => i.severity !== 'error'))).toBe(true);
  });

  it('IMP-03: Multi-sheet Excel maps separate sheets into separate chapters when chapter column omitted', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['题干', '选项A', '选项B', '答案'],
        ['第一张表问题', '甲', '乙', 'A'],
      ]),
      '第1章 绪论',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['题干', '选项A', '选项B', '答案'],
        ['第二张表问题', '丙', '丁', 'B'],
      ]),
      '第2章 进阶',
    );
    const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
    const ab = raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).slice().buffer;

    const res = await parseExcelBuffer(ab, '分章题库.xlsx');
    expect(res.drafts).toHaveLength(2);
    expect(res.drafts[0]!.chapter).toBe(1);
    expect(res.drafts[1]!.chapter).toBe(2);
  });

  it('IMP-04: CSV/TSV parser handles UTF-8 BOM, quoted multiline cells, Quizlet 2-col TSV, and GBK decoding', () => {
    const csvWithBom =
      '\uFEFF"题干","选项A","选项B","正确答案","解析"\n' +
      '"包含,逗号和\n换行的题干","选项一","选项二","A","解析,说明"';
    const csvRows = parseDelimitedText(csvWithBom);
    expect(csvRows).toHaveLength(2);
    expect(csvRows[1]![0]).toContain('\n');
    const csvParsed = parseTabularRows(csvRows, { sourceFormat: 'csv' });
    expect(csvParsed.drafts).toHaveLength(1);
    expect(csvParsed.drafts[0]!.answer).toBe(0);

    // Headerless Quizlet 2-column TSV
    const tsv = 'Polymorphism\tAbility of different objects to respond to the same message\nStack\tLIFO linear structure';
    const tsvParsed = parseTabularRows(parseDelimitedText(tsv), { sourceFormat: 'csv' });
    expect(tsvParsed.drafts).toHaveLength(2);
    expect(tsvParsed.drafts[0]!.type).toBe('short');
    expect(tsvParsed.drafts[1]!.stem).toBe('Stack');

    // GBK bytes for "题干,答案\n测试,正确"
    const gbkBytes = new Uint8Array([
      0xcc, 0xe2, 0xb8, 0xc9, 0x2c, 0xb4, 0xf0, 0xb0, 0xb8, 0x0a,
      0xb2, 0xe2, 0xca, 0xd4, 0x2c, 0xd5, 0xfd, 0xc8, 0xb7,
    ]);
    const decoded = decodeTextBuffer(gbkBytes.buffer);
    expect(decoded).toContain('题干');
    expect(decoded).toContain('正确');
  });

  it('IMP-05: Word (.docx) parses real docx ZIP via mammoth with both table and prose questions', async () => {
    const bodyXml = `
      <w:p><w:r><w:t># 第一章 数据结构</w:t></w:r></w:p>
      <w:p><w:r><w:t>1. 队列遵循的出入队原则是（ B ）。</w:t></w:r></w:p>
      <w:p><w:r><w:t>A. 后进先出</w:t></w:r></w:p>
      <w:p><w:r><w:t>B. 先进先出</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>题型</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>题干</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>答案</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>判断</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>二叉树每个节点至多有两个子节点。</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>对</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `;
    const docxBuf = buildMinimalDocx(bodyXml);
    const res = await parseDocxBuffer(docxBuf, '数据结构复习.docx');

    expect(res.fatalError).toBeUndefined();
    expect(res.format).toBe('docx');
    expect(res.suggestedName).toBe('数据结构复习');
    expect(res.drafts).toHaveLength(2);
    expect(res.drafts.some((d) => d.type === 'tf' && d.answer === true)).toBe(true);
    expect(
      res.drafts.some(
        (d) =>
          d.type === 'choice' &&
          d.answer === 1 &&
          !d.stem.includes('B') &&
          d.stem.includes('（ ）'),
      ),
    ).toBe(true);

    const emptyHtml = parseDocxHtml('', 'empty.docx');
    expect(emptyHtml.fatalError).toBeTruthy();
  });

  it('IMP-06: TXT/Markdown parser handles STANDARD_TXT_TEMPLATE and Markdown syntax', () => {
    const res = parseTextQuestions(STANDARD_TXT_TEMPLATE, { fileName: '标准模板.txt' });
    expect(res.fatalError).toBeUndefined();
    expect(res.drafts).toHaveLength(5);
    expect(res.drafts.every((d) => d.issues.length === 0)).toBe(true);
    // Inline answer in Q2 was extracted & sanitized from stem
    expect(res.drafts[1]!.answer).toBe(1);
    expect(res.drafts[1]!.stem).not.toContain('B');
    // Multi-line subjective numbered answer kept intact in Q5
    expect(String(res.drafts[4]!.answer)).toContain('2. HTTPS 需要配置数字证书');
    expect(res.drafts[4]!.keyPoints).toEqual(['TLS/SSL 加密', '身份认证', '默认端口差异']);

    const md = `
## 第3章 操作系统
### 1. **死锁的四个必要条件不包括哪项？**
A. 互斥条件
B. 不可剥夺
C. 抢占式调度
D. 循环等待
**答案**：C
> 解析：循环等待而非抢占式调度是死锁必要条件之一。
`;
    const mdRes = parsePastedContent(md);
    expect(mdRes.drafts).toHaveLength(1);
    expect(mdRes.drafts[0]!.chapter).toBe(3);
    expect(mdRes.drafts[0]!.answer).toBe(2);
  });

  it('IMP-07: JSON importer supports lossless .quizhub.json share packages, external formats, and rejects prototype pollution', () => {
    const sampleBank: BankRecord = {
      id: 'bank-test-1',
      name: '信号与系统分享包',
      description: '期末冲刺精选',
      builtin: false,
      createdAt: 1000,
      updatedAt: 2000,
      data: {
        meta: {
          title: '信号与系统分享包',
          version: '2.0.0',
          generatedAt: '2026-11-25T00:00:00Z',
          counts: {
            total: 1,
            byType: { choice: 1, multi: 0, tf: 0, short: 0, analysis: 0 },
            byOrigin: { comprehensive_bank: 1, video_popup: 0, review_notes_synthesized: 0 },
          },
        },
        chapters: [{ id: 2, short: '拉普拉斯变换', title: '第二章 拉普拉斯变换' }],
        questions: [
          {
            id: 'q1',
            type: 'choice',
            chapter: 2,
            stem: '单位冲激信号的拉普拉斯变换为？',
            options: ['0', '1', '1/s', 's'],
            answer: 1,
            explain: 'δ(t) 的双边/单边拉氏变换恒为 1。',
            tags: ['拉氏变换'],
            source: { origin: 'comprehensive_bank', file: 'test', ref: '#1' },
          },
        ],
      },
    };

    const exported = exportBankSharePackage(sampleBank);
    const roundtrip = parseJsonBank(exported, 'share.quizhub.json');
    expect(roundtrip.fatalError).toBeUndefined();
    expect(roundtrip.suggestedName).toBe('信号与系统分享包');
    expect(roundtrip.suggestedDescription).toBe('期末冲刺精选');
    expect(roundtrip.drafts[0]!.chapter).toBe(2);
    expect(roundtrip.drafts[0]!.answer).toBe(1);

    // External JSON wrapper with object options {A, B, C, D}
    const externalJson = JSON.stringify({
      title: '外部题库',
      data: [
        {
          question: 'CPU 的中文全称是？',
          choices: { A: '中央处理器', B: '图形处理器', C: '内存控制器' },
          correctAnswer: 'A',
          explanation: 'Central Processing Unit',
        },
      ],
    });
    const extRes = parseJsonBank(externalJson);
    expect(extRes.suggestedName).toBe('外部题库');
    expect(extRes.drafts[0]!.options).toHaveLength(3);
    expect(extRes.drafts[0]!.answer).toBe(0);

    // Prototype pollution blocked
    const evil = '{"__proto__": {"polluted": true}, "questions": []}';
    const evilRes = parseJsonBank(evil);
    expect(evilRes.fatalError).toBeTruthy();
  });

  it('IMP-08: Proofreading detects errors/duplicates and file router rejects unsupported formats', async () => {
    const pasted = parsePastedContent(`
1. 正常单选题？
A. 选项A
B. 选项B
答案：A

2. 异常越界选择题？
A. 只有两个选项
B. 第二个选项
答案：D

3. 正常单选题？
A. 选项A
B. 选项B
答案：A
`);

    expect(pasted.drafts).toHaveLength(3);
    // Draft 1 has error (D out of bounds for 2 options)
    expect(pasted.drafts[1]!.issues.some((i) => i.severity === 'error')).toBe(true);
    // Draft 2 has duplicate warning
    expect(pasted.drafts[2]!.issues.some((i) => i.severity === 'warning')).toBe(true);

    // Fix Draft 1 answer inline
    const fixed = annotateDuplicateStems(
      pasted.drafts.map((d, i) =>
        i === 1 ? validateDraftQuestion({ ...d, answer: 1, rawAnswer: 'B' }) : d,
      ),
    );
    expect(fixed[1]!.issues.some((i) => i.severity === 'error')).toBe(false);

    // Exclude duplicate Draft 2
    fixed[2]!.included = false;
    const finalized = finalizeDraftsToBank(fixed, { name: '校对后题库' });
    expect(finalized.questions).toHaveLength(2);

    // Unsupported extension check
    const badFile = new File(['hello'], 'notes.pdf', { type: 'application/pdf' });
    const badRes = await parseImportFile(badFile);
    expect(badRes.fatalError).toContain('暂不支持该文件格式');
  });
});
