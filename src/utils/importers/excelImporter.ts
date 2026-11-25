import type { DraftQuestion, ImportParseResult } from '../quizImportTypes';
import { annotateDuplicateStems, extractChapterInfo, suggestBankNameFromFile } from './normalize';
import { parseTabularRows } from './tabularParser';

const INSTRUCTION_SHEET_RE = /^(?:填写说明|导入说明|说明|使用说明|readme|instructions)$/i;

export async function parseExcelBuffer(
  buffer: ArrayBuffer,
  fileName?: string,
): Promise<ImportParseResult> {
  const suggestedName = suggestBankNameFromFile(fileName, 'Excel 导入题库');
  const XLSX = await import('xlsx');

  let wb: ReturnType<typeof XLSX.read>;
  try {
    wb = XLSX.read(buffer, { type: 'array' });
  } catch (err) {
    return {
      format: 'xlsx',
      suggestedName,
      drafts: [],
      notes: [],
      fatalError: `Excel 文件读取失败：${err instanceof Error ? err.message : '文件格式损坏'}`,
    };
  }

  const sheetNames = wb.SheetNames ?? [];
  if (sheetNames.length === 0) {
    return {
      format: 'xlsx',
      suggestedName,
      drafts: [],
      notes: [],
      fatalError: 'Excel 工作簿中没有可用的工作表',
    };
  }

  const nonInstructionSheets = sheetNames.filter((n) => !INSTRUCTION_SHEET_RE.test(n.trim()));
  const targetSheets = nonInstructionSheets.length > 0 ? nonInstructionSheets : sheetNames;

  const allDrafts: DraftQuestion[] = [];
  const allNotes: string[] = [];

  targetSheets.forEach((sheetName, idx) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    const stringRows = rawRows.map((row) =>
      Array.isArray(row) ? row.map((cell) => (cell == null ? '' : String(cell))) : [],
    );

    const chInfo =
      targetSheets.length > 1
        ? extractChapterInfo(sheetName, idx + 1)
        : { chapter: 1, chapterName: '第 1 章' };
    const defaultChapterId = chInfo.chapter > 0 ? chInfo.chapter : idx + 1;
    const defaultChapterName = chInfo.chapterName || sheetName;

    const { drafts, notes } = parseTabularRows(stringRows, {
      sourceFormat: 'xlsx',
      defaultChapterId,
      defaultChapterName,
      sheetName: targetSheets.length > 1 ? sheetName : undefined,
    });

    allDrafts.push(...drafts);
    allNotes.push(...notes);
  });

  const annotated = annotateDuplicateStems(allDrafts);
  if (annotated.length > 0 && allNotes.length === 0) {
    allNotes.push(`已从 ${targetSheets.length} 个工作表解析 ${annotated.length} 道题目`);
  }

  return {
    format: 'xlsx',
    suggestedName,
    drafts: annotated,
    notes: allNotes,
    ...(annotated.length === 0 && allNotes.length === 0
      ? { fatalError: '未能从 Excel 表格中识别到有效题目，请使用标准模板或检查表头列名' }
      : {}),
  };
}

export async function generateExcelTemplateBuffer(): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx');

  const sampleRows: string[][] = [
    [
      '题型',
      '章节',
      '题干（必填）',
      '选项A',
      '选项B',
      '选项C',
      '选项D',
      '正确答案（必填）',
      '解析',
      '要点',
      '标签',
    ],
    [
      '单选题',
      '第1章 基础概念',
      '在关系型数据库中，用于唯一标识表中每一行记录的字段组合称为？',
      '外键',
      '主键',
      '索引',
      '视图',
      'B',
      '主键（Primary Key）保证记录的实体完整性与唯一性。',
      '',
      '数据库,主键',
    ],
    [
      '多选题',
      '第1章 基础概念',
      '以下哪些属于 HTTP 协议常见的幂等请求方法？',
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'ACD',
      'GET、PUT 与 DELETE 语义上均具备幂等性；POST 多次提交可能创建多条资源。',
      '',
      '计算机网络,HTTP',
    ],
    [
      '判断题',
      '第2章 进阶实践',
      '栈（Stack）是一种遵循先进先出（FIFO）原则的线性数据结构。',
      '',
      '',
      '',
      '',
      '错误',
      '栈遵循后进先出（LIFO），队列才遵循先进先出（FIFO）。',
      '',
      '数据结构',
    ],
    [
      '简答题',
      '第2章 进阶实践',
      '简述进程与线程的核心区别。',
      '',
      '',
      '',
      '',
      '进程是操作系统资源分配的基本单位，拥有独立地址空间；线程是 CPU 调度的基本单位，共享所属进程的内存与文件资源，上下文切换开销更小。',
      '从资源分配、调度单位、地址空间与切换开销四个维度对比。',
      '资源分配基本单位;CPU调度基本单位;共享地址空间;切换开销更小',
      '操作系统',
    ],
    [
      '综合分析题',
      '第2章 进阶实践',
      '某在线平台高并发读多写少场景出现数据库瓶颈，请分析常见的缓存架构选型与一致性保障思路。',
      '',
      '',
      '',
      '',
      '可引入 Redis 旁路缓存（Cache-Aside）：读请求先查缓存未命中再回源并回填；写请求更新数据库后删除缓存，并辅以随机过期时间、互斥锁/布隆过滤器分别防范雪崩、击穿与穿透。',
      '综合考察缓存读写策略及三大缓存异常防护。',
      'Cache-Aside;更新DB后删缓存;防雪崩/击穿/穿透',
      '系统架构,缓存',
    ],
  ];

  const guideRows: string[][] = [
    ['字段名称', '填写说明', '示例'],
    ['题型', '支持：单选题 / 多选题 / 判断题 / 简答题 / 综合分析题（留空时会自动推断）', '单选题'],
    ['章节', '支持“第1章 章节名”或任意章节分类名；多 Sheet 时也可按 Sheet 名分章', '第1章 基础概念'],
    ['题干（必填）', '题目正文内容', 'HTTP 默认端口号是？'],
    ['选项A ~ 选项H', '选择题填写选项文本；判断题与主观题留空即可', '80'],
    ['正确答案（必填）', '单选填 A/B/C/D 或选项全文；多选填 ABD 或 A,B,D；判断填 正确/错误/对/错/√/×；主观题填参考答案', 'B'],
    ['解析 / 要点 / 标签', '选填；要点和标签可用分号或逗号分隔多个关键词', 'TLS加密;端口443'],
  ];

  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.aoa_to_sheet(sampleRows);
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  XLSX.utils.book_append_sheet(wb, wsData, '题库导入模板');
  XLSX.utils.book_append_sheet(wb, wsGuide, '填写说明');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  if (out instanceof ArrayBuffer) return out;
  const copy = new Uint8Array(out.byteLength);
  copy.set(out);
  return copy.buffer;
}

export async function downloadExcelTemplate(): Promise<void> {
  const buf = await generateExcelTemplateBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quizhub-template.xlsx';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
