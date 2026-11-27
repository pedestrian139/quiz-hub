import type { ImportParseResult } from '../quizImportTypes';
import { detectStandardQuizJson, parseJsonBank } from './jsonImporter';
import { appendDraftsToBank, suggestBankNameFromFile } from './normalize';
import { decodeTextBuffer, parseDelimitedText, parseTabularRows } from './tabularParser';
import { downloadTxtTemplate, parseTextQuestions, STANDARD_TXT_TEMPLATE } from './textImporter';

export {
  STANDARD_TXT_TEMPLATE,
  appendDraftsToBank,
  decodeTextBuffer,
  detectStandardQuizJson,
  downloadTxtTemplate,
  parseJsonBank,
  parseTextQuestions,
};

export async function downloadExcelTemplate(): Promise<void> {
  const mod = await import('./excelImporter');
  return mod.downloadExcelTemplate();
}

export async function parseImportFile(file: File): Promise<ImportParseResult> {
  const fileName = file.name || '未命名文件';
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const { parseExcelBuffer } = await import('./excelImporter');
    return parseExcelBuffer(buffer, fileName);
  }

  if (lower.endsWith('.docx')) {
    const buffer = await file.arrayBuffer();
    const { parseDocxBuffer } = await import('./docxImporter');
    return parseDocxBuffer(buffer, fileName);
  }

  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    const buffer = await file.arrayBuffer();
    const text = decodeTextBuffer(buffer);
    const rows = parseDelimitedText(text);
    const suggestedName = suggestBankNameFromFile(fileName, 'CSV 导入题库');
    const { drafts, notes } = parseTabularRows(rows, {
      sourceFormat: 'csv',
      defaultChapterId: 1,
      defaultChapterName: '第 1 章',
    });
    return {
      format: 'csv',
      suggestedName,
      drafts,
      notes,
      ...(drafts.length === 0 && notes.length === 0
        ? { fatalError: '未能从 CSV/TSV 文件中解析出题目，请检查分隔符和表头列名' }
        : {}),
    };
  }

  if (lower.endsWith('.json')) {
    const buffer = await file.arrayBuffer();
    const text = decodeTextBuffer(buffer);
    return parseJsonBank(text, fileName);
  }

  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.markdown')) {
    const buffer = await file.arrayBuffer();
    const text = decodeTextBuffer(buffer);
    return parseTextQuestions(text, { sourceFormat: 'txt', fileName });
  }

  return {
    format: 'txt',
    suggestedName: suggestBankNameFromFile(fileName, '导入失败'),
    drafts: [],
    notes: [],
    fatalError: `暂不支持该文件格式（${fileName}）。请上传 .xlsx / .xls / .csv / .tsv / .docx / .txt / .md / .json 文件。`,
  };
}

export function parsePastedContent(rawText: string): ImportParseResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      format: 'txt',
      suggestedName: '粘贴导入题库',
      drafts: [],
      notes: [],
      fatalError: '请输入或粘贴题库文本 / Markdown / JSON 内容',
    };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const jsonRes = parseJsonBank(trimmed, '粘贴导入题库.json');
    if (!jsonRes.fatalError || jsonRes.drafts.length > 0) {
      return jsonRes;
    }
  }

  return parseTextQuestions(trimmed, {
    sourceFormat: 'txt',
    fileName: '粘贴导入题库.txt',
  });
}
