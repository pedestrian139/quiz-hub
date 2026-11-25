import type { DraftQuestion, ImportParseResult } from '../quizImportTypes';
import { annotateDuplicateStems, cleanText, suggestBankNameFromFile } from './normalize';
import { parseTabularRows } from './tabularParser';
import { parseTextQuestions } from './textImporter';

interface MammothModuleLike {
  convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{
    value: string;
    messages: { type: string; message: string }[];
  }>;
}

function readCellText(cell: Element): string {
  const paragraphs = cell.querySelectorAll('p, li');
  if (paragraphs.length > 1) {
    return Array.from(paragraphs)
      .map((p) => cleanText(p.textContent))
      .filter(Boolean)
      .join('\n');
  }
  return cleanText(cell.textContent);
}

function extractProseLinesOutsideTables(body: HTMLElement): string[] {
  const clone = body.cloneNode(true) as HTMLElement;
  for (const tbl of Array.from(clone.querySelectorAll('table'))) {
    tbl.remove();
  }
  for (const br of Array.from(clone.querySelectorAll('br'))) {
    br.replaceWith('\n');
  }

  const lines: string[] = [];
  const blocks = clone.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre');
  if (blocks.length > 0) {
    for (const el of Array.from(blocks)) {
      // Skip outer block elements that contain nested block elements already selected
      if (el.querySelector('p, li, h1, h2, h3, h4, h5, h6')) {
        continue;
      }
      const txt = cleanText(el.textContent);
      if (txt) {
        lines.push(txt);
      }
    }
  } else {
    const raw = cleanText(clone.textContent);
    if (raw) lines.push(raw);
  }
  return lines;
}

export function parseDocxHtml(html: string, fileName?: string): ImportParseResult {
  const suggestedName = suggestBankNameFromFile(fileName, 'Word 导入题库');
  if (!html || !html.trim()) {
    return {
      format: 'docx',
      suggestedName,
      drafts: [],
      notes: [],
      fatalError: 'Word 文档内容为空，未能提取到任何文字或表格',
    };
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const allDrafts: DraftQuestion[] = [];
  const notes: string[] = [];

  const tables = Array.from(doc.body.querySelectorAll('table'));
  tables.forEach((tbl, tIdx) => {
    const rows: string[][] = [];
    for (const tr of Array.from(tbl.querySelectorAll('tr'))) {
      const cells = Array.from(tr.children).filter(
        (c) => c.tagName === 'TD' || c.tagName === 'TH',
      );
      const row = cells.map((cell) => readCellText(cell));
      if (row.some((c) => c.length > 0)) {
        rows.push(row);
      }
    }
    if (rows.length > 0) {
      const res = parseTabularRows(rows, {
        sourceFormat: 'docx',
        defaultChapterId: 1,
        defaultChapterName: 'Word 表格题库',
        sheetName: tables.length > 1 ? `表格${tIdx + 1}` : 'Word表格',
      });
      allDrafts.push(...res.drafts);
      notes.push(...res.notes);
    }
  });

  const tableDraftCount = allDrafts.length;
  const proseLines = extractProseLinesOutsideTables(doc.body);
  if (proseLines.length > 0) {
    const textRes = parseTextQuestions(proseLines.join('\n'), {
      sourceFormat: 'docx',
      fileName,
    });
    if (textRes.drafts.length > 0) {
      allDrafts.push(...textRes.drafts);
    }
  }

  const proseDraftCount = allDrafts.length - tableDraftCount;
  const annotated = annotateDuplicateStems(allDrafts);

  if (tableDraftCount > 0 || proseDraftCount > 0) {
    const parts: string[] = [];
    if (tableDraftCount > 0) parts.push(`表格 ${tableDraftCount} 题`);
    if (proseDraftCount > 0) parts.push(`正文段落 ${proseDraftCount} 题`);
    notes.unshift(`Word 文档共识别 ${annotated.length} 题（${parts.join('，')}）`);
  }

  return {
    format: 'docx',
    suggestedName,
    drafts: annotated,
    notes,
    ...(annotated.length === 0
      ? {
          fatalError:
            '未能从 Word 文档中拆出题目，请确保文档包含标准题库表格或带题号/答案的正文段落',
        }
      : {}),
  };
}

export async function parseDocxBuffer(
  buffer: ArrayBuffer,
  fileName?: string,
): Promise<ImportParseResult> {
  const suggestedName = suggestBankNameFromFile(fileName, 'Word 导入题库');
  try {
    const mod = await import('mammoth/mammoth.browser.js');
    const mammoth =
      (mod as unknown as { default?: MammothModuleLike }).default ??
      (mod as unknown as MammothModuleLike);
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer });
    return parseDocxHtml(html, fileName);
  } catch (err) {
    return {
      format: 'docx',
      suggestedName,
      drafts: [],
      notes: [],
      fatalError: `Word (.docx) 解析失败：${err instanceof Error ? err.message : '请确认文件未加密且格式有效'}`,
    };
  }
}
