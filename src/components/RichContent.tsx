import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Marked } from 'marked';
import './RichContent.css';

export interface RichContentProps {
  content?: string | null;
  className?: string;
  inline?: boolean;
}

interface MathSegment {
  tex: string;
  displayMode: boolean;
}

const SAFE_LINK_RE = /^(?:https?:|mailto:|\/|#)/i;

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeHref(rawHref: string): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;
  if (SAFE_LINK_RE.test(trimmed)) return trimmed;
  return null;
}

const richMarked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    link(token) {
      const inner = this.parser.parseInline(token.tokens);
      const safeHref = sanitizeHref(token.href);
      if (!safeHref) {
        return inner;
      }
      const titleAttr = token.title ? ` title="${escapeHtmlAttr(token.title)}"` : '';
      return `<a href="${escapeHtmlAttr(safeHref)}"${titleAttr} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
  },
});

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findClosingDelimiter(text: string, startIndex: number, delimiter: string): number {
  let pos = startIndex;
  while (pos < text.length) {
    const idx = text.indexOf(delimiter, pos);
    if (idx === -1) return -1;
    if (!isEscaped(text, idx)) {
      return idx;
    }
    pos = idx + 1;
  }
  return -1;
}

function findClosingInlineDollar(text: string, startIndex: number): number {
  let pos = startIndex;
  while (pos < text.length) {
    const ch = text[pos]!;
    if (ch === '\n' || ch === '\r') {
      return -1;
    }
    if (ch === '$' && !isEscaped(text, pos)) {
      if (text[pos + 1] === '$') {
        return -1;
      }
      const prevChar = pos > startIndex ? text[pos - 1]! : '';
      const nextChar = pos + 1 < text.length ? text[pos + 1]! : '';
      if (prevChar && !/\s/.test(prevChar) && !/\d/.test(nextChar)) {
        return pos;
      }
      return -1;
    }
    pos += 1;
  }
  return -1;
}

const LIST_ITEM_START_RE = /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const INDENTED_CODE_LINE_RE = /^(?: {4}| {0,3}\t)/;
const BLANK_LINE_RE = /^[ \t]*$/;

function extractMathSegments(
  source: string,
  inline = false,
): { masked: string; segments: MathSegment[]; tokenPrefix: string } {
  let nonce = Math.random().toString(36).slice(2, 10);
  while (source.includes(`QHMT${nonce}IDX`)) {
    nonce = `${nonce}${Math.random().toString(36).slice(2, 6)}`;
  }
  const tokenPrefix = `QHMT${nonce}IDX`;

  const segments: MathSegment[] = [];
  let out = '';
  let i = 0;
  let prevLineBlank = true;
  let inListContext = false;

  const pushMath = (tex: string, displayMode: boolean) => {
    const token = `${tokenPrefix}${segments.length}END`;
    segments.push({ tex, displayMode });
    out += token;
  };

  while (i < source.length) {
    const atLineStart = i === 0 || source[i - 1] === '\n';

    if (atLineStart) {
      const lineEnd = source.indexOf('\n', i);
      const currentLine = source.slice(i, lineEnd === -1 ? source.length : lineEnd);
      const isBlankLine = BLANK_LINE_RE.test(currentLine);

      // Keep 4-space / tab-indented Markdown code blocks verbatim when not inside a list
      if (
        !inline &&
        prevLineBlank &&
        !inListContext &&
        !isBlankLine &&
        INDENTED_CODE_LINE_RE.test(currentLine)
      ) {
        let cursor = lineEnd === -1 ? source.length : lineEnd + 1;
        let endIdx = cursor;
        while (cursor < source.length) {
          const nextLineEnd = source.indexOf('\n', cursor);
          const nextCursor = nextLineEnd === -1 ? source.length : nextLineEnd + 1;
          const nextLine = source.slice(cursor, nextLineEnd === -1 ? source.length : nextLineEnd);
          if (BLANK_LINE_RE.test(nextLine)) {
            cursor = nextCursor;
            continue;
          }
          if (INDENTED_CODE_LINE_RE.test(nextLine)) {
            endIdx = nextCursor;
            cursor = nextCursor;
            continue;
          }
          break;
        }
        out += source.slice(i, endIdx);
        i = endIdx;
        prevLineBlank = endIdx < source.length && source[endIdx - 1] === '\n'
          ? false
          : prevLineBlank;
        continue;
      }

      // Keep fenced code blocks verbatim so $ inside code is untouched
      const fenceMatch = currentLine.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const fenceChar = fenceMatch[1]![0]!;
        const fenceLen = fenceMatch[1]!.length;
        if (lineEnd === -1) {
          out += source.slice(i);
          break;
        }
        let cursor = lineEnd + 1;
        let endIdx = source.length;
        while (cursor < source.length) {
          const nextLineEnd = source.indexOf('\n', cursor);
          const nextCursor = nextLineEnd === -1 ? source.length : nextLineEnd + 1;
          const line = source.slice(cursor, nextLineEnd === -1 ? source.length : nextLineEnd);
          const closeMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
          if (closeMatch && closeMatch[1]![0] === fenceChar && closeMatch[1]!.length >= fenceLen) {
            endIdx = nextCursor;
            break;
          }
          cursor = nextCursor;
        }
        out += source.slice(i, endIdx);
        i = endIdx;
        prevLineBlank = false;
        inListContext = false;
        continue;
      }

      if (isBlankLine) {
        prevLineBlank = true;
      } else {
        if (LIST_ITEM_START_RE.test(currentLine)) {
          inListContext = true;
        } else if (!/^(?: {2,}|\t)/.test(currentLine)) {
          inListContext = false;
        }
        prevLineBlank = false;
      }
    }

    // Keep inline code spans verbatim
    if (source[i] === '`') {
      let tickCount = 1;
      while (source[i + tickCount] === '`') tickCount += 1;
      const closingMarker = '`'.repeat(tickCount);
      let searchPos = i + tickCount;
      let closeIdx = -1;
      while (searchPos < source.length) {
        const idx = source.indexOf(closingMarker, searchPos);
        if (idx === -1) break;
        const beforeOk = source[idx - 1] !== '`';
        const afterOk = source[idx + tickCount] !== '`';
        if (beforeOk && afterOk) {
          closeIdx = idx + tickCount;
          break;
        }
        searchPos = idx + 1;
      }
      if (closeIdx !== -1) {
        out += source.slice(i, closeIdx);
        i = closeIdx;
        continue;
      }
      out += source.slice(i, i + tickCount);
      i += tickCount;
      continue;
    }

    // Display math: $$...$$
    if (source[i] === '$' && source[i + 1] === '$' && !isEscaped(source, i)) {
      const closeIdx = findClosingDelimiter(source, i + 2, '$$');
      if (closeIdx !== -1) {
        const tex = source.slice(i + 2, closeIdx).trim();
        if (tex.length > 0) {
          pushMath(tex, true);
          i = closeIdx + 2;
          continue;
        }
      }
    }

    // Display math: \[...\]
    if (source[i] === '\\' && source[i + 1] === '[' && !isEscaped(source, i)) {
      const closeIdx = findClosingDelimiter(source, i + 2, '\\]');
      if (closeIdx !== -1) {
        const tex = source.slice(i + 2, closeIdx).trim();
        if (tex.length > 0) {
          pushMath(tex, true);
          i = closeIdx + 2;
          continue;
        }
      }
    }

    // Inline math: \(...\)
    if (source[i] === '\\' && source[i + 1] === '(' && !isEscaped(source, i)) {
      const closeIdx = findClosingDelimiter(source, i + 2, '\\)');
      if (closeIdx !== -1) {
        const tex = source.slice(i + 2, closeIdx).trim();
        if (tex.length > 0) {
          pushMath(tex, false);
          i = closeIdx + 2;
          continue;
        }
      }
    }

    // Inline math: $...$
    if (source[i] === '$' && source[i + 1] !== '$' && !isEscaped(source, i)) {
      const nextChar = i + 1 < source.length ? source[i + 1]! : '';
      if (nextChar && !/\s/.test(nextChar)) {
        const closeIdx = findClosingInlineDollar(source, i + 1);
        if (closeIdx !== -1) {
          const tex = source.slice(i + 1, closeIdx).trim();
          if (tex.length > 0) {
            pushMath(tex, false);
            i = closeIdx + 1;
            continue;
          }
        }
      }
    }

    out += source[i]!;
    i += 1;
  }

  return { masked: out, segments, tokenPrefix };
}

function renderKatexSafe(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'htmlAndMathml',
    });
  } catch {
    const escaped = escapeHtmlText(tex);
    return displayMode ? `<code>$$${escaped}$$</code>` : `<code>$${escaped}$</code>`;
  }
}

export function renderRichContentHtml(content: string, inline = false): string {
  const normalized = content.replace(/\r\n?/g, '\n');
  const { masked, segments, tokenPrefix } = extractMathSegments(normalized, inline);

  let html: string;
  try {
    html = inline
      ? richMarked.parseInline(masked, { async: false })
      : richMarked.parse(masked, { async: false });
  } catch {
    html = escapeHtmlText(masked);
  }

  if (segments.length > 0) {
    const renderedSegments = segments.map((seg) => renderKatexSafe(seg.tex, seg.displayMode));
    const tokenRegex = new RegExp(`${tokenPrefix}(\\d+)END`, 'g');
    html = html.replace(tokenRegex, (_, idx: string) => renderedSegments[Number(idx)] ?? '');
  }

  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'form', 'foreignObject'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

export function RichContent({ content, className, inline = false }: RichContentProps) {
  const trimmed = typeof content === 'string' ? content.trim() : '';

  const sanitizedHtml = useMemo(() => {
    if (!trimmed) return '';
    return renderRichContentHtml(content ?? '', inline);
  }, [content, inline, trimmed]);

  if (!trimmed) {
    return null;
  }

  const classes = [
    'rich-content',
    inline ? 'rich-content--inline' : 'rich-content--block',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  if (inline) {
    return (
      <span
        className={classes}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    );
  }

  return (
    <div
      className={classes}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}
