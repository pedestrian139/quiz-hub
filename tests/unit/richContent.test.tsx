import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RichContent, renderRichContentHtml } from '../../src/components/RichContent';

describe('RichContent (Markdown + KaTeX + DOMPurify)', () => {
  it('renders Markdown headings, lists, tables, blockquotes, code blocks, and safe links', () => {
    const md = `### 【核心考点】
- 第一点 **加粗** 与 \`inline_code\`
- [QuizHub](https://acequiz.xyz)

> 重点提示

| 列1 | 列2 |
| --- | --- |
| A | B |

\`\`\`ts
const price = "$100";
\`\`\``;

    const html = renderRichContentHtml(md);
    expect(html).toContain('<h3>【核心考点】</h3>');
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<code>inline_code</code>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<table>');
    expect(html).toContain('const price = "$100";');
    // Code block dollar sign must NOT be converted to KaTeX
    expect(html).not.toContain('katex');
  });

  it('renders inline and block LaTeX math via KaTeX without mangling underscores/asterisks', () => {
    const tex = '公式 $x_1^2 + y_2^2 = z^2$ 与 \\(\\alpha + \\beta\\)\n\n$$\n\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$\n\n\\[\nE = mc^2\n\\]';
    const html = renderRichContentHtml(tex);
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain('QUIZHUBMATHTOKEN');
    // Must not contain unrendered <em> tags from _1 / _2 inside math
    expect(html).not.toContain('<em>');
  });

  it('renders inline mode with <span> and handles empty/null/undefined and malformed LaTeX safely', () => {
    expect(renderToStaticMarkup(<RichContent content={null} />)).toBe('');
    expect(renderToStaticMarkup(<RichContent content={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<RichContent content="   " />)).toBe('');

    const inlineMarkup = renderToStaticMarkup(
      <RichContent inline content="选项 **$a_1 + b_2$**" className="opt-rich" />,
    );
    expect(inlineMarkup.startsWith('<span class="rich-content rich-content--inline opt-rich">')).toBe(true);
    expect(inlineMarkup).toContain('katex');

    expect(() =>
      renderToStaticMarkup(<RichContent content="错误公式 $\\nonexistentcommand{abc$ 和未闭合 $$x+1" />),
    ).not.toThrow();
  });

  it('strips XSS payloads (<script>, <iframe>, <object>, on* handlers, javascript: URLs, unsafe SVG)', () => {
    const malicious = [
      '<script>window.__xss=1</script>',
      '<img src="x" onerror="alert(1)" />',
      '<iframe src="https://evil.example"></iframe>',
      '<object data="data:text/html,<script>alert(1)</script>"></object>',
      '[点击](javascript:alert(1))',
      '<a href="javascript:alert(2)">bad link</a>',
      '<svg onload="alert(3)"><script>alert(4)</script><foreignObject><div>hi</div></foreignObject></svg>',
    ].join('\n\n');

    const html = renderRichContentHtml(malicious);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onload');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('foreignObject');
    expect(html).toContain('点击');
    expect(html).toContain('bad link');
  });

  it('keeps 4-space and tab-indented code blocks verbatim without rendering KaTeX inside <pre><code>', () => {
    const md = [
      '    const cost = "$x_1 + x_2$";',
      '',
      'Normal math $z^2$.',
      '',
      'Code section:',
      '',
      '\tconst y = "$a_1 + b_2$";',
    ].join('\n');

    const html = renderRichContentHtml(md);
    expect(html).toContain('<pre><code>const cost = "$x_1 + x_2$";');
    expect(html).toContain('const y = "$a_1 + b_2$";');
    const codeBlocks = html.match(/<pre><code>[\s\S]*?<\/code><\/pre>/g) ?? [];
    expect(codeBlocks).toHaveLength(2);
    for (const block of codeBlocks) {
      expect(block).not.toContain('katex');
    }
    expect(html).toContain('class="katex"');
  });

  it('prevents math placeholder collisions with literal tokens or \\text{...} content', () => {
    const html1 = renderRichContentHtml('$\\text{QUIZHUBMATHTOKEN1END}$ and $y^2$');
    expect(html1).toContain('QUIZHUBMATHTOKEN1END');
    expect(html1).toContain('class="katex"');

    const html2 = renderRichContentHtml('Literal token QUIZHUBMATHTOKEN0END and math $x^2$');
    expect(html2).toContain('Literal token QUIZHUBMATHTOKEN0END');
    expect(html2).toContain('class="katex"');
  });
});
