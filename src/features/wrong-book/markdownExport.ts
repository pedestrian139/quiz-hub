import { formatAnswerText, getOptionLabel, getTypeLabel, isObjectiveQuestion } from '../../core/questionUtils';
import type { WrongBookItem } from './types';

export function formatWrongTimestamp(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) {
    return '暂无记录';
  }
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return '暂无记录';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sanitizeSingleLine(text: string | null | undefined): string {
  return (text ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

function formatBlockText(text: string): string {
  const trimmed = text.replace(/\r\n?/g, '\n').trim();
  if (!trimmed) return '暂无';
  if (!trimmed.includes('\n')) return trimmed;
  return trimmed
    .split('\n')
    .map((line) => `  > ${line}`)
    .join('\n');
}

export function buildWrongBookMarkdown(
  items: readonly WrongBookItem[],
  options: { bankFilterLabel?: string; exportedAt?: Date | number } = {},
): string {
  const candidateDate =
    options.exportedAt instanceof Date
      ? options.exportedAt
      : new Date(options.exportedAt ?? Date.now());
  const exportedDate = Number.isNaN(candidateDate.getTime()) ? new Date() : candidateDate;
  const pad = (n: number) => String(n).padStart(2, '0');
  const exportTimeStr = `${exportedDate.getFullYear()}-${pad(exportedDate.getMonth() + 1)}-${pad(exportedDate.getDate())} ${pad(exportedDate.getHours())}:${pad(exportedDate.getMinutes())}`;
  const scopeLabel = sanitizeSingleLine(options.bankFilterLabel) || '全部题库';

  const lines: string[] = [
    '# QuizHub 智能错题本复习文档',
    '',
    `- 导出时间：${exportTimeStr}`,
    `- 筛选范围：${scopeLabel}（共 ${items.length} 题）`,
    '',
    '---',
  ];

  if (items.length === 0) {
    lines.push('', '当前筛选范围内暂无错题。', '');
    return lines.join('\n');
  }

  items.forEach((item, index) => {
    const q = item.question;
    const typeLabel = getTypeLabel(q.type);
    const stem = sanitizeSingleLine(q.stem) || '（题干为空）';
    const answerRaw = formatAnswerText(q).replace(/\r\n?/g, '\n').trim();
    const answerText = answerRaw.length > 0 ? answerRaw : '暂无参考答案';
    const wrongChoiceLabels = item.wrongChoices
      .map((c) => sanitizeSingleLine(c.label))
      .filter(Boolean);
    const wrongChoicesText = isObjectiveQuestion(q.type)
      ? wrongChoiceLabels.length > 0
        ? wrongChoiceLabels.join('、')
        : '暂无历史错选记录'
      : item.mastery === 1
        ? '自评有点模糊（待巩固）'
        : '自评不会（待巩固）';
    const explainText = q.explain?.replace(/\r\n?/g, '\n').trim() || '暂无解析';
    const bankName = sanitizeSingleLine(item.bankName);
    const chapterLabel = sanitizeSingleLine(item.chapterLabel);

    lines.push(
      '',
      `## ${index + 1}. [${typeLabel}] ${stem}`,
      '',
      `- **所属题库**：${bankName}${chapterLabel ? ` · ${chapterLabel}` : ''}`,
      `- **错误次数**：${item.wrongCount} 次`,
      `- **最近做错**：${formatWrongTimestamp(item.lastWrongTs)}`,
    );

    if (Array.isArray(q.options) && q.options.length > 0) {
      lines.push('- **选项**：');
      q.options.forEach((opt, optIdx) => {
        lines.push(`  - ${getOptionLabel(optIdx)}. ${sanitizeSingleLine(opt)}`);
      });
    }

    if (answerText.includes('\n')) {
      lines.push('- **正确答案**：', formatBlockText(answerText));
    } else {
      lines.push(`- **正确答案**：${answerText}`);
    }

    lines.push(`- **你的历史错选**：${wrongChoicesText}`);

    if (explainText.includes('\n')) {
      lines.push('- **解析**：', formatBlockText(explainText));
    } else {
      lines.push(`- **解析**：${explainText}`);
    }

    if (Array.isArray(q.keyPoints) && q.keyPoints.length > 0) {
      const cleanPoints = q.keyPoints
        .map((kp) => sanitizeSingleLine(kp))
        .filter(Boolean);
      if (cleanPoints.length > 0) {
        lines.push('- **核心要点**：');
        cleanPoints.forEach((kp) => {
          lines.push(`  - ${kp}`);
        });
      }
    }

    lines.push('', '---');
  });

  lines.push('');
  return lines.join('\n');
}

export function downloadWrongBookMarkdown(
  items: readonly WrongBookItem[],
  options: { bankFilterLabel?: string; filename?: string; exportedAt?: Date | number } = {},
): string {
  const markdown = buildWrongBookMarkdown(items, options);
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return markdown;
  }

  const candidateNow =
    options.exportedAt instanceof Date
      ? options.exportedAt
      : new Date(options.exportedAt ?? Date.now());
  const now = Number.isNaN(candidateNow.getTime()) ? new Date() : candidateNow;
  const pad = (n: number) => String(n).padStart(2, '0');
  const defaultName = `quizhub-wrong-book-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
  const safeName =
    (options.filename?.trim() || defaultName).replace(/[\\/:*?"<>|]/g, '_');

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName.endsWith('.md') ? safeName : `${safeName}.md`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  globalThis.window?.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return markdown;
}
