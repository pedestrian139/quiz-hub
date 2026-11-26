// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportBankSharePackage } from '../../src/utils/bankDb';
import {
  detectStandardQuizJson,
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
  appendDraftsToBank,
  finalizeDraftsToBank,
  validateDraftQuestion,
} from '../../src/utils/importers/normalize';
import {
  decodeTextBuffer,
  parseDelimitedText,
  parseTabularRows,
} from '../../src/utils/importers/tabularParser';
import type { BankRecord, DraftQuestion } from '../../src/utils/quizImportTypes';

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

  it('IMP-09: .md and .markdown routing parses Markdown headings/lists/bold options & answers, while messy prose yields 0 drafts with no fatalError', async () => {
    const mdContent = [
      '\uFEFF# 第一章 计算机网络',
      '',
      '1. **以下哪个协议工作在传输层？**',
      '- **A.** HTTP',
      '- **B.** TCP',
      '- **C.** ARP',
      '- **D.** DNS',
      '**答案：** B',
      '> **解析：** TCP 是面向连接的传输层协议。',
      '',
      '2. UDP 提供无连接的不可靠传输服务。',
      '- 答案：正确',
    ].join('\n');

    const mdFile = new File([mdContent], 'network-notes.md', { type: 'text/markdown' });
    const mdRes = await parseImportFile(mdFile);
    expect(mdRes.fatalError).toBeUndefined();
    expect(mdRes.suggestedName).toBe('network-notes');
    expect(mdRes.drafts).toHaveLength(2);
    expect(mdRes.drafts[0]!.options).toEqual(['HTTP', 'TCP', 'ARP', 'DNS']);
    expect(mdRes.drafts[0]!.answer).toBe(1);
    expect(mdRes.drafts[0]!.explain).toContain('TCP 是面向连接的传输层协议');
    expect(mdRes.drafts[1]!.type).toBe('tf');
    expect(mdRes.drafts[1]!.answer).toBe(true);

    const messyProse = [
      '# 课堂随笔',
      '今天老师主要梳理了机器学习中的正则化方法，包括 L1 稀疏约束与 L2 权重衰减。',
      '课后需要结合实验数据对比不同超参数在验证集上的收敛表现。',
    ].join('\n\n');
    const markdownFile = new File([messyProse], 'lecture.markdown', { type: 'text/markdown' });
    const messyRes = await parseImportFile(markdownFile);
    expect(messyRes.fatalError).toBeUndefined();
    expect(messyRes.drafts).toEqual([]);
  });

  it('IMP-10: Phase 1 legacy JSON missing explain/explanation/aiAnalysis defaults explain to "" with zero errors', () => {
    const legacyBankJson = JSON.stringify({
      meta: {
        title: 'Phase 1 旧版题库',
        version: '1.0.0',
        generatedAt: '2025-12-01T00:00:00Z',
        counts: {
          total: 2,
          byType: { choice: 1, multi: 0, tf: 1, short: 0, analysis: 0 },
          byOrigin: { comprehensive_bank: 2, video_popup: 0, review_notes_synthesized: 0 },
        },
      },
      chapters: [{ id: 1, short: '算法基础', title: '第一章 算法基础' }],
      questions: [
        {
          id: 'p1-q1',
          type: 'choice',
          chapter: 1,
          stem: '二分查找要求线性表具有什么存储特性？',
          options: ['顺序存储且有序', '链式存储', '哈希存储', '任意无序存储'],
          answer: 0,
          explain: '',
          source: { origin: 'comprehensive_bank', file: 'legacy.json', ref: '#1' },
        },
        {
          id: 'p1-q2',
          type: 'tf',
          chapter: 1,
          stem: '栈是一种先进后出（FILO）的线性表。',
          answer: true,
          source: { origin: 'comprehensive_bank', file: 'legacy.json', ref: '#2' },
        },
      ],
    });

    const parsed = parseJsonBank(legacyBankJson, 'legacy.json');
    expect(parsed.fatalError).toBeUndefined();
    expect(parsed.drafts).toHaveLength(2);
    expect(parsed.drafts[0]!.explain).toBe('');
    expect(parsed.drafts[1]!.explain).toBe('');
    expect(parsed.drafts[0]!.aiInferredAnswer).toBeUndefined();

    const finalized = finalizeDraftsToBank(parsed.drafts, { name: parsed.suggestedName });
    expect(finalized.questions).toHaveLength(2);
    expect(finalized.questions[0]!.explain).toBe('');
    expect(finalized.questions[1]!.explain).toBe('');
  });

  it('IMP-11: jsonImporter separates explain, explanation, and aiAnalysis independently and preserves aiInferredAnswer', () => {
    const jsonText = JSON.stringify([
      {
        type: 'choice',
        stem: 'AI 洗题导入题 1',
        options: ['选项A', '选项B'],
        answer: 0,
        explain: '',
        explanation: '来自 explanation 字段的解析',
        aiInferredAnswer: true,
        tags: ['算法', 'AI洗题'],
      },
      {
        type: 'choice',
        stem: 'AI 洗题导入题 2',
        options: ['选项A', '选项B'],
        answer: 1,
        aiAnalysis: '来自 aiAnalysis 字段的解析',
        aiInferredAnswer: false,
      },
      {
        type: 'choice',
        stem: 'AI 洗题导入题 3',
        options: ['选项A', '选项B'],
        answer: 0,
        analysis: '来自 analysis 字段的解析',
        explanation: '独立 explanation 字段',
        aiAnalysis: '独立 aiAnalysis 字段',
      },
    ]);

    const res = parseJsonBank(jsonText, 'ai-washed.json');
    expect(res.fatalError).toBeUndefined();
    expect(res.drafts).toHaveLength(3);
    expect(res.drafts[0]!.explain).toBe('');
    expect(res.drafts[0]!.explanation).toBe('来自 explanation 字段的解析');
    expect(res.drafts[0]!.aiAnalysis).toBeUndefined();
    expect(res.drafts[0]!.aiInferredAnswer).toBe(true);
    expect(res.drafts[0]!.tags).toEqual(['算法', 'AI洗题']);

    expect(res.drafts[1]!.explain).toBe('');
    expect(res.drafts[1]!.explanation).toBeUndefined();
    expect(res.drafts[1]!.aiAnalysis).toBe('来自 aiAnalysis 字段的解析');
    expect(res.drafts[1]!.aiInferredAnswer).toBeUndefined();

    expect(res.drafts[2]!.explain).toBe('来自 analysis 字段的解析');
    expect(res.drafts[2]!.explanation).toBe('独立 explanation 字段');
    expect(res.drafts[2]!.aiAnalysis).toBe('独立 aiAnalysis 字段');
  });

  it('IMP-12: finalizeDraftsToBank preserves aiInferredAnswer, tags, keyPoints, explain, and source', () => {
    const res = parseJsonBank(
      JSON.stringify([
        {
          type: 'choice',
          chapter: 2,
          chapterName: '神经网络',
          stem: '反向传播算法主要基于微积分中的哪一定律？',
          options: ['链式法则', '罗尔定理', '中值定理', '泰勒展开'],
          answer: 0,
          explain: '通过链式法则逐层计算梯度。',
          aiInferredAnswer: true,
          tags: ['深度学习', '梯度'],
          keyPoints: ['链式法则', '梯度反向传播'],
          source: { origin: 'video_popup', ref: 'wash-1', note: 'AI 洗题' },
        },
      ]),
      'deep-learning.json',
    );

    const finalized = finalizeDraftsToBank(res.drafts, { name: '深度学习题库' });
    expect(finalized.questions).toHaveLength(1);
    const q = finalized.questions[0]!;
    expect(q.aiInferredAnswer).toBe(true);
    expect(q.tags).toEqual(['深度学习', '梯度']);
    expect(q.keyPoints).toEqual(['链式法则', '梯度反向传播']);
    expect(q.explain).toBe('通过链式法则逐层计算梯度。');
    expect(q.source).toEqual({
      origin: 'video_popup',
      file: '深度学习题库',
      ref: 'wash-1',
      note: 'AI 洗题',
    });
  });

  it('IMP-13: appendDraftsToBank reconciles chapters, avoids Question.id collisions, recomputes counts, and does not mutate existingBank', () => {
    const existingBank: BankRecord = {
      id: 'bank-existing-1',
      name: '计算机基础综合库',
      description: '已有题库',
      builtin: false,
      createdAt: 1000,
      updatedAt: 2000,
      sourceFormat: 'txt',
      data: {
        meta: {
          title: '计算机基础综合库',
          version: '2.0.0',
          generatedAt: '2026-11-25T00:00:00Z',
          counts: {
            total: 2,
            byType: { choice: 1, multi: 0, tf: 1, short: 0, analysis: 0 },
            byOrigin: { comprehensive_bank: 2, video_popup: 0, review_notes_synthesized: 0 },
          },
        },
        chapters: [{ id: 1, short: '网络基础', title: '第 1 章 网络基础' }],
        questions: [
          {
            id: 'imp-c1-choice-003',
            type: 'choice',
            chapter: 1,
            stem: 'HTTP 默认端口？',
            options: ['21', '80'],
            answer: 1,
            explain: '80 端口',
            source: { origin: 'comprehensive_bank', file: '计算机基础综合库', ref: '#1' },
          },
          {
            id: 'imp-c1-tf-004',
            type: 'tf',
            chapter: 1,
            stem: 'TCP 面向连接。',
            answer: true,
            explain: '',
            source: { origin: 'comprehensive_bank', file: '计算机基础综合库', ref: '#2' },
          },
        ],
      },
    };

    const existingSnapshot = JSON.stringify(existingBank);

    const parsed = parseJsonBank(
      JSON.stringify([
        {
          // Matches existing chapter by title even with chapter: 0
          chapter: 0,
          chapterName: '网络基础',
          type: 'choice',
          stem: 'HTTPS 默认端口？',
          options: ['80', '443'],
          answer: 1,
          explain: '443 端口',
          aiInferredAnswer: true,
          tags: ['网络'],
          source: { origin: 'video_popup', ref: 'AI #1' },
        },
        {
          // Conflicting custom chapter name on chapter 1 -> allocates new chapter id 2
          chapter: 1,
          chapterName: '操作系统',
          type: 'multi',
          stem: '以下属于进程调度算法的有？',
          options: ['FCFS', 'SJF', '冒泡排序'],
          answer: [0, 1],
          explain: '冒泡排序不是调度算法',
          keyPoints: ['先来先服务', '短作业优先'],
        },
      ]),
    );

    const merged = appendDraftsToBank(existingBank, parsed.drafts, { sourceFormat: 'txt' });

    // Non-mutation of original object
    expect(JSON.stringify(existingBank)).toBe(existingSnapshot);

    expect(merged.data.questions).toHaveLength(4);
    // Unique Question IDs
    const ids = merged.data.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toContain('imp-c1-choice-003');
    expect(ids).toContain('imp-c1-tf-004');

    // Reconciled chapters
    expect(merged.data.chapters).toHaveLength(2);
    expect(merged.data.chapters[0]!.id).toBe(1);
    expect(merged.data.chapters[0]!.short).toBe('网络基础');
    expect(merged.data.chapters[1]!.id).toBe(2);
    expect(merged.data.chapters[1]!.short).toBe('操作系统');

    const appendedQ1 = merged.data.questions[2]!;
    expect(appendedQ1.chapter).toBe(1);
    expect(appendedQ1.aiInferredAnswer).toBe(true);
    expect(appendedQ1.tags).toEqual(['网络']);
    expect(appendedQ1.source.origin).toBe('video_popup');

    const appendedQ2 = merged.data.questions[3]!;
    expect(appendedQ2.chapter).toBe(2);
    expect(appendedQ2.keyPoints).toEqual(['先来先服务', '短作业优先']);

    // Recomputed counts & updatedAt
    expect(merged.data.meta.counts).toEqual({
      total: 4,
      byType: { choice: 2, multi: 1, tf: 1, short: 0, analysis: 0 },
      byOrigin: { comprehensive_bank: 3, video_popup: 1, review_notes_synthesized: 0 },
    });
    expect(merged.updatedAt).toBeGreaterThan(existingBank.updatedAt);
  });

  it('IMP-14: Empty option validation catches answers pointing to empty slots and remaps surviving option indices in finalize & append', () => {
    const baseDraft = (overrides: Partial<DraftQuestion>): DraftQuestion => ({
      tempId: 'd-opt',
      sourceLoc: '第 1 项',
      sourceFormat: 'json',
      type: 'choice',
      chapter: 1,
      chapterName: '第 1 章',
      stem: '空选项测试题干',
      options: ['', 'Opt B', 'Opt C'],
      answer: 0,
      rawAnswer: 'A',
      explain: '',
      keyPoints: [],
      tags: [],
      sourceRef: '#1',
      issues: [],
      included: true,
      ...overrides,
    });

    // 1. Choice answer pointing to empty option -> error + excluded from finalize
    const badChoice = validateDraftQuestion(baseDraft({ answer: 0, rawAnswer: 'A' }));
    expect(badChoice.issues.some((i) => i.severity === 'error')).toBe(true);
    expect(finalizeDraftsToBank([badChoice], { name: '空选项校验库' }).questions).toHaveLength(0);

    // 2. Choice answer pointing to non-empty option after empty slot -> valid + remapped 2 -> 1
    const shiftedChoice = validateDraftQuestion(baseDraft({ answer: 2, rawAnswer: 'C' }));
    expect(shiftedChoice.issues.some((i) => i.severity === 'error')).toBe(false);
    const finalizedChoice = finalizeDraftsToBank([shiftedChoice], { name: '重映射库' });
    expect(finalizedChoice.questions).toHaveLength(1);
    expect(finalizedChoice.questions[0]!.options).toEqual(['Opt B', 'Opt C']);
    expect(finalizedChoice.questions[0]!.answer).toBe(1);

    // 3. Multi answer containing empty option -> error
    const badMulti = validateDraftQuestion(
      baseDraft({
        type: 'multi',
        options: ['', 'Opt B', '', 'Opt D'],
        answer: [0, 1],
        rawAnswer: 'AB',
      }),
    );
    expect(badMulti.issues.some((i) => i.severity === 'error')).toBe(true);

    // 4. Multi answer pointing to surviving non-empty options [1, 3] -> remapped to [0, 1] in both finalize and append
    const shiftedMulti = validateDraftQuestion(
      baseDraft({
        type: 'multi',
        options: ['', 'Opt B', '', 'Opt D'],
        answer: [1, 3],
        rawAnswer: 'BD',
      }),
    );
    expect(shiftedMulti.issues.some((i) => i.severity === 'error')).toBe(false);
    const finalizedMulti = finalizeDraftsToBank([shiftedMulti], { name: '多选重映射' });
    expect(finalizedMulti.questions[0]!.options).toEqual(['Opt B', 'Opt D']);
    expect(finalizedMulti.questions[0]!.answer).toEqual([0, 1]);

    const existingBank: BankRecord = {
      id: 'bank-remap',
      name: '重映射目标库',
      builtin: false,
      createdAt: 1000,
      updatedAt: 1000,
      data: {
        meta: {
          title: '重映射目标库',
          version: '2.0.0',
          generatedAt: '2026-11-26T00:00:00Z',
          counts: {
            total: 0,
            byType: { choice: 0, multi: 0, tf: 0, short: 0, analysis: 0 },
            byOrigin: { comprehensive_bank: 0, video_popup: 0, review_notes_synthesized: 0 },
          },
        },
        chapters: [{ id: 1, short: '第一章', title: '第一章' }],
        questions: [],
      },
    };
    const appended = appendDraftsToBank(existingBank, [shiftedChoice, shiftedMulti]);
    expect(appended.data.questions).toHaveLength(2);
    expect(appended.data.questions[0]!.options).toEqual(['Opt B', 'Opt C']);
    expect(appended.data.questions[0]!.answer).toBe(1);
    expect(appended.data.questions[1]!.options).toEqual(['Opt B', 'Opt D']);
    expect(appended.data.questions[1]!.answer).toEqual([0, 1]);
  });

  it('IMP-15: validateDraftQuestion preserves raw trailing spaces/newlines while finalize & append trim cleanly', () => {
    const draft = validateDraftQuestion({
      tempId: 'd-space',
      sourceLoc: '第 1 项',
      sourceFormat: 'txt',
      type: 'choice',
      chapter: 1,
      chapterName: '第 1 章',
      stem: 'Hello ',
      options: ['Opt A ', 'Opt B\n'],
      answer: 0,
      rawAnswer: 'A',
      explain: 'line1\n',
      keyPoints: [],
      tags: [],
      sourceRef: '#1',
      issues: [],
      included: true,
    });

    expect(draft.stem).toBe('Hello ');
    expect(draft.options).toEqual(['Opt A ', 'Opt B\n']);
    expect(draft.explain).toBe('line1\n');
    expect(draft.issues.some((i) => i.severity === 'error')).toBe(false);

    const finalized = finalizeDraftsToBank([draft], { name: '空格清理库' });
    expect(finalized.questions[0]!.stem).toBe('Hello');
    expect(finalized.questions[0]!.options).toEqual(['Opt A', 'Opt B']);
    expect(finalized.questions[0]!.explain).toBe('line1');
  });

  it('IMP-16: textImporter does not fabricate ghost drafts from prose with 分析/要点/标签 lines, while keeping real unnumbered questions with 答案：', () => {
    const lectureProse = [
      '# 课堂笔记',
      '今天讨论了排序算法的时间复杂度与稳定性。',
      '分析：在最坏情况下快速排序退化为 O(n^2)。',
      '要点：分治思想；基准选择',
      '标签：排序, 算法',
    ].join('\n');

    const proseRes = parseTextQuestions(lectureProse);
    expect(proseRes.fatalError).toBeUndefined();
    expect(proseRes.drafts).toEqual([]);

    const unnumberedWithAnswer = [
      'TCP 是面向连接的可靠传输层协议。',
      '答案：正确',
      '分析：TCP 通过三次握手建立连接。',
    ].join('\n');
    const qRes = parseTextQuestions(unnumberedWithAnswer);
    expect(qRes.drafts).toHaveLength(1);
    expect(qRes.drafts[0]!.type).toBe('tf');
    expect(qRes.drafts[0]!.answer).toBe(true);
    expect(qRes.drafts[0]!.explain).toBe('TCP 通过三次握手建立连接。');
  });

  it('IMP-17: jsonImporter ignores non-string/non-finite explain, explanation, and aiAnalysis values instead of coercing to [object Object]', () => {
    const jsonText = JSON.stringify([
      {
        type: 'choice',
        stem: '非字符串字段过滤测试 1',
        options: ['A项', 'B项'],
        answer: 0,
        explain: { bad: 1 },
        explanation: 'valid fallback',
      },
      {
        type: 'choice',
        stem: '非字符串字段过滤测试 2',
        options: ['A项', 'B项'],
        answer: 1,
        explain: ['array-val'],
        explanation: true,
        aiAnalysis: 'ai fallback',
      },
      {
        type: 'choice',
        stem: '非字符串字段过滤测试 3',
        options: ['A项', 'B项'],
        answer: 0,
        explain: { bad: 1 },
        analysis: 'analysis fallback',
        explanation: ['bad-arr'],
        aiAnalysis: { bad: 2 },
      },
      {
        type: 'choice',
        stem: '有限数字与 null 过滤测试 4',
        options: ['A项', 'B项'],
        answer: 1,
        explain: 100,
        explanation: null,
        aiAnalysis: 42,
      },
    ]);

    const res = parseJsonBank(jsonText, 'bad-explain.json');
    expect(res.fatalError).toBeUndefined();
    expect(res.drafts).toHaveLength(4);
    expect(res.drafts[0]!.explain).toBe('');
    expect(res.drafts[0]!.explanation).toBe('valid fallback');
    expect(res.drafts[0]!.aiAnalysis).toBeUndefined();

    expect(res.drafts[1]!.explain).toBe('');
    expect(res.drafts[1]!.explanation).toBeUndefined();
    expect(res.drafts[1]!.aiAnalysis).toBe('ai fallback');

    expect(res.drafts[2]!.explain).toBe('analysis fallback');
    expect(res.drafts[2]!.explanation).toBeUndefined();
    expect(res.drafts[2]!.aiAnalysis).toBeUndefined();

    expect(res.drafts[3]!.explain).toBe('100');
    expect(res.drafts[3]!.explanation).toBeUndefined();
    expect(res.drafts[3]!.aiAnalysis).toBe('42');
  });

  it('IMP-18: appendDraftsToBank recognizes Chinese numeral generic chapter labels like 第一章/第十二章 and upgrades them', () => {
    const existingBank: BankRecord = {
      id: 'bank-cn-ch',
      name: '中文章节库',
      builtin: false,
      createdAt: 1000,
      updatedAt: 1000,
      data: {
        meta: {
          title: '中文章节库',
          version: '2.0.0',
          generatedAt: '2026-11-26T00:00:00Z',
          counts: {
            total: 1,
            byType: { choice: 0, multi: 0, tf: 1, short: 0, analysis: 0 },
            byOrigin: { comprehensive_bank: 1, video_popup: 0, review_notes_synthesized: 0 },
          },
        },
        chapters: [{ id: 1, short: '第一章', title: '第一章' }],
        questions: [
          {
            id: 'imp-c1-tf-001',
            type: 'tf',
            chapter: 1,
            stem: '旧题',
            answer: true,
            explain: '',
            source: { origin: 'comprehensive_bank', file: '中文章节库', ref: '#1' },
          },
        ],
      },
    };

    const parsed = parseJsonBank(
      JSON.stringify([
        {
          chapter: 1,
          chapterName: '操作系统基础',
          type: 'tf',
          stem: '新题',
          answer: true,
        },
      ]),
    );

    const merged = appendDraftsToBank(existingBank, parsed.drafts);
    expect(merged.data.chapters).toHaveLength(1);
    expect(merged.data.chapters[0]).toEqual({
      id: 1,
      short: '操作系统基础',
      title: '第 1 章 操作系统基础',
    });
  });

  it('IMP-19: exportBankSharePackage -> parseJsonBank -> finalizeDraftsToBank & appendDraftsToBank roundtrip preserves explain, explanation, and aiAnalysis losslessly', () => {
    const sourceBank: BankRecord = {
      id: 'bank-lossless-rt',
      name: '解析保真往返题库',
      description: '验证 explain / explanation / aiAnalysis 互不覆盖',
      builtin: false,
      createdAt: 1000,
      updatedAt: 2000,
      data: {
        meta: {
          title: '解析保真往返题库',
          version: '2.0.0',
          generatedAt: '2026-11-26T00:00:00Z',
          counts: {
            total: 4,
            byType: { choice: 2, multi: 0, tf: 1, short: 1, analysis: 0 },
            byOrigin: { comprehensive_bank: 4, video_popup: 0, review_notes_synthesized: 0 },
          },
        },
        chapters: [{ id: 1, short: '深度学习', title: '第 1 章 深度学习' }],
        questions: [
          {
            id: 'rt-q1',
            type: 'choice',
            chapter: 1,
            stem: '同时包含 explain 与 aiAnalysis 的题目？',
            options: ['选项A', '选项B'],
            answer: 0,
            explain: '原题官方解析 Q1',
            aiAnalysis: 'AI 深度解析 Q1',
            source: { origin: 'comprehensive_bank', file: 'rt', ref: '#1' },
          },
          {
            id: 'rt-q2',
            type: 'tf',
            chapter: 1,
            stem: '同时包含 explain、explanation 与 aiAnalysis 的题目。',
            answer: false,
            explain: '原题官方解析 Q2',
            explanation: '补充 explanation Q2',
            aiAnalysis: 'AI 深度解析 Q2',
            source: { origin: 'comprehensive_bank', file: 'rt', ref: '#2' },
          },
          {
            id: 'rt-q3',
            type: 'choice',
            chapter: 1,
            stem: '仅包含 explain 的题目？',
            options: ['甲', '乙'],
            answer: 1,
            explain: '仅原题解析 Q3',
            source: { origin: 'comprehensive_bank', file: 'rt', ref: '#3' },
          },
          {
            id: 'rt-q4',
            type: 'short',
            chapter: 1,
            stem: 'explain 为空但包含 explanation 与 aiAnalysis 的题目？',
            answer: '参考答案 Q4',
            explain: '',
            explanation: '外部 explanation Q4',
            aiAnalysis: 'AI 深度解析 Q4',
            source: { origin: 'comprehensive_bank', file: 'rt', ref: '#4' },
          },
        ],
      },
    };

    const exported1 = exportBankSharePackage(sourceBank);
    const parsed1 = parseJsonBank(exported1, 'roundtrip.quizhub.json');
    expect(parsed1.fatalError).toBeUndefined();
    expect(parsed1.drafts).toHaveLength(4);

    expect(parsed1.drafts[0]!.explain).toBe('原题官方解析 Q1');
    expect(parsed1.drafts[0]!.explanation).toBeUndefined();
    expect(parsed1.drafts[0]!.aiAnalysis).toBe('AI 深度解析 Q1');

    expect(parsed1.drafts[1]!.explain).toBe('原题官方解析 Q2');
    expect(parsed1.drafts[1]!.explanation).toBe('补充 explanation Q2');
    expect(parsed1.drafts[1]!.aiAnalysis).toBe('AI 深度解析 Q2');

    expect(parsed1.drafts[2]!.explain).toBe('仅原题解析 Q3');
    expect(parsed1.drafts[2]!.explanation).toBeUndefined();
    expect(parsed1.drafts[2]!.aiAnalysis).toBeUndefined();

    expect(parsed1.drafts[3]!.explain).toBe('');
    expect(parsed1.drafts[3]!.explanation).toBe('外部 explanation Q4');
    expect(parsed1.drafts[3]!.aiAnalysis).toBe('AI 深度解析 Q4');

    const finalized1 = finalizeDraftsToBank(parsed1.drafts, {
      name: parsed1.suggestedName,
      description: parsed1.suggestedDescription,
      sourceFormat: 'json',
    });
    expect(finalized1.questions).toHaveLength(4);

    expect(finalized1.questions[0]!.explain).toBe('原题官方解析 Q1');
    expect(finalized1.questions[0]!).not.toHaveProperty('explanation');
    expect(finalized1.questions[0]!.aiAnalysis).toBe('AI 深度解析 Q1');

    expect(finalized1.questions[1]!.explain).toBe('原题官方解析 Q2');
    expect(finalized1.questions[1]!.explanation).toBe('补充 explanation Q2');
    expect(finalized1.questions[1]!.aiAnalysis).toBe('AI 深度解析 Q2');

    expect(finalized1.questions[2]!.explain).toBe('仅原题解析 Q3');
    expect(finalized1.questions[2]!).not.toHaveProperty('explanation');
    expect(finalized1.questions[2]!).not.toHaveProperty('aiAnalysis');

    expect(finalized1.questions[3]!.explain).toBe('');
    expect(finalized1.questions[3]!.explanation).toBe('外部 explanation Q4');
    expect(finalized1.questions[3]!.aiAnalysis).toBe('AI 深度解析 Q4');

    // Second re-export -> re-import -> finalize roundtrip
    const reExported = exportBankSharePackage({
      id: 'bank-lossless-rt-2',
      name: finalized1.name,
      description: finalized1.description,
      builtin: false,
      createdAt: 3000,
      updatedAt: 4000,
      sourceFormat: 'json',
      data: {
        meta: sourceBank.data.meta,
        chapters: finalized1.chapters,
        questions: finalized1.questions,
      },
    });
    const parsed2 = parseJsonBank(reExported, 'roundtrip-2.quizhub.json');
    const finalized2 = finalizeDraftsToBank(parsed2.drafts, { name: parsed2.suggestedName });
    expect(finalized2.questions.map((q) => ({
      explain: q.explain,
      explanation: q.explanation,
      aiAnalysis: q.aiAnalysis,
    }))).toEqual(
      finalized1.questions.map((q) => ({
        explain: q.explain,
        explanation: q.explanation,
        aiAnalysis: q.aiAnalysis,
      })),
    );

    // appendDraftsToBank lossless preservation
    const existingBank: BankRecord = {
      id: 'bank-existing-rt',
      name: '已有题库',
      builtin: false,
      createdAt: 1000,
      updatedAt: 1000,
      data: {
        meta: {
          title: '已有题库',
          version: '2.0.0',
          generatedAt: '2026-11-26T00:00:00Z',
          counts: {
            total: 1,
            byType: { choice: 0, multi: 0, tf: 1, short: 0, analysis: 0 },
            byOrigin: { comprehensive_bank: 1, video_popup: 0, review_notes_synthesized: 0 },
          },
        },
        chapters: [{ id: 1, short: '深度学习', title: '第 1 章 深度学习' }],
        questions: [
          {
            id: 'existing-1',
            type: 'tf',
            chapter: 1,
            stem: '原有题目',
            answer: true,
            explain: '原有解析',
            source: { origin: 'comprehensive_bank', file: '已有题库', ref: '#1' },
          },
        ],
      },
    };
    const appended = appendDraftsToBank(existingBank, parsed1.drafts);
    expect(appended.data.questions).toHaveLength(5);
    const appendedSlice = appended.data.questions.slice(1);
    expect(appendedSlice[0]!.explain).toBe('原题官方解析 Q1');
    expect(appendedSlice[0]!).not.toHaveProperty('explanation');
    expect(appendedSlice[0]!.aiAnalysis).toBe('AI 深度解析 Q1');

    expect(appendedSlice[1]!.explain).toBe('原题官方解析 Q2');
    expect(appendedSlice[1]!.explanation).toBe('补充 explanation Q2');
    expect(appendedSlice[1]!.aiAnalysis).toBe('AI 深度解析 Q2');

    expect(appendedSlice[2]!.explain).toBe('仅原题解析 Q3');
    expect(appendedSlice[2]!).not.toHaveProperty('explanation');
    expect(appendedSlice[2]!).not.toHaveProperty('aiAnalysis');

    expect(appendedSlice[3]!.explain).toBe('');
    expect(appendedSlice[3]!.explanation).toBe('外部 explanation Q4');
    expect(appendedSlice[3]!.aiAnalysis).toBe('AI 深度解析 Q4');
  });

  it('IMP-20: detectStandardQuizJson silently detects valid QuizHub JSON formats and rejects non-standard inputs', () => {
    const shareBank: BankRecord = {
      id: 'bank-detect-1',
      name: '自动识货测试包',
      description: '含三种解析字段',
      builtin: false,
      createdAt: 1000,
      updatedAt: 2000,
      data: {
        meta: {
          title: '自动识货测试包',
          version: '2.0.0',
          generatedAt: '2026-11-26T00:00:00Z',
          counts: {
            total: 1,
            byType: { choice: 1, multi: 0, tf: 0, short: 0, analysis: 0 },
            byOrigin: { comprehensive_bank: 1, video_popup: 0, review_notes_synthesized: 0 },
          },
        },
        chapters: [{ id: 1, short: '第一章', title: '第 1 章 基础' }],
        questions: [
          {
            id: 'dq-1',
            type: 'choice',
            chapter: 1,
            stem: '以下哪项属于监督学习？',
            options: ['线性回归', 'K-Means 聚类', 'PCA 降维', 'Apriori'],
            answer: 0,
            explain: '线性回归使用带标签样本训练。',
            explanation: '补充说明',
            aiAnalysis: 'AI 深度拆解',
            source: { origin: 'comprehensive_bank', file: 'test', ref: '#1' },
          },
        ],
      },
    };
    const shareJson = exportBankSharePackage(shareBank);

    // Positive 1: .quizhub.json with and without fileName, plus BOM/whitespace
    const detectedShareWithFile = detectStandardQuizJson(shareJson, 'my-bank.quizhub.json');
    expect(detectedShareWithFile).not.toBeNull();
    expect(detectedShareWithFile!.suggestedName).toBe('自动识货测试包');
    expect(detectedShareWithFile!.drafts).toHaveLength(1);
    expect(detectedShareWithFile!.drafts[0]!.explain).toBe('线性回归使用带标签样本训练。');
    expect(detectedShareWithFile!.drafts[0]!.explanation).toBe('补充说明');
    expect(detectedShareWithFile!.drafts[0]!.aiAnalysis).toBe('AI 深度拆解');

    const detectedShareBom = detectStandardQuizJson(`\uFEFF  \n${shareJson}\n  `);
    expect(detectedShareBom).not.toBeNull();
    expect(detectedShareBom!.drafts).toHaveLength(1);

    // Positive 2: Legacy/native BankData { meta, chapters, questions } and minimal { questions }
    const bankDataJson = JSON.stringify({
      meta: { title: '旧版导库格式' },
      chapters: [{ id: 2, short: '图论', title: '第 2 章 图论' }],
      questions: [
        {
          type: 'tf',
          chapter: 2,
          stem: '任意无向连通图都存在生成树。',
          answer: false,
          explain: '测试 false 答案保留',
        },
      ],
    });
    const detectedBankData = detectStandardQuizJson(bankDataJson);
    expect(detectedBankData).not.toBeNull();
    expect(detectedBankData!.suggestedName).toBe('旧版导库格式');
    expect(detectedBankData!.drafts[0]!.answer).toBe(false);

    const minimalQuestionsJson = JSON.stringify({
      questions: [
        {
          question: 'HTTP 默认端口号是？',
          options: ['80', '443'],
          correctAnswer: 'A',
        },
      ],
    });
    const detectedMinimal = detectStandardQuizJson(minimalQuestionsJson, 'net.json');
    expect(detectedMinimal).not.toBeNull();
    expect(detectedMinimal!.suggestedName).toBe('net');
    expect(detectedMinimal!.drafts[0]!.answer).toBe(0);

    // Positive 3: Standard question array (with and without fileName, plus explicit choice with options)
    const arrayJson = JSON.stringify([
      {
        type: 'choice',
        stem: '时间复杂度为 O(1) 的操作是？',
        options: ['数组按索引访问', '链表顺序查找'],
        answer: 0,
      },
      {
        type: '单选题',
        stem: '无答案但显式声明单选题且带选项的草稿题？',
        options: ['选项 1', '选项 2'],
      },
    ]);
    const detectedArrayNoName = detectStandardQuizJson(arrayJson);
    expect(detectedArrayNoName).not.toBeNull();
    expect(detectedArrayNoName!.suggestedName).toBe('JSON 导入题库');
    expect(detectedArrayNoName!.drafts).toHaveLength(2);

    const detectedArrayWithName = detectStandardQuizJson(arrayJson, 'algo.json');
    expect(detectedArrayWithName).not.toBeNull();
    expect(detectedArrayWithName!.suggestedName).toBe('algo');

    // Negative cases: must return null and never throw
    const negatives = [
      '',
      '   \n\t  ',
      '1. 什么是操作系统？\nA. 系统软件\nB. 应用软件\n答案：A',
      '# 复习笔记\n\n- 重点一：TCP 三次握手',
      '{"questions": [',
      '[{stem: 1}]',
      '{"foo": "bar"}',
      '{"questions": []}',
      '[]',
      '{"questions": ["str"]}',
      '[1, 2, 3]',
      '{"questions": [{"name": "Alice"}]}',
      '[{"name": "Alice"}]',
      '[{"title": "Doc", "content": "..."}]',
      '[{"question": "How are you?"}]',
      '{"data": [{"type": "choice", "stem": "Q", "options": ["A", "B"], "answer": 0}]}',
      '{"items": [{"type": "tf", "stem": "Q", "answer": true}]}',
      '[{"stem": "Q", "type": "invalid_type", "answer": "x"}]',
      '[{"stem": "Q", "type": "user", "answer": "x"}]',
      '{"__proto__": {"polluted": true}, "questions": [{"type": "tf", "stem": "Q", "answer": true}]}',
    ];

    for (const input of negatives) {
      expect(() => detectStandardQuizJson(input)).not.toThrow();
      expect(detectStandardQuizJson(input)).toBeNull();
    }
  });
});
