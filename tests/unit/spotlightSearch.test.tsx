import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotlightSearchModal } from '../../src/components/Search/SpotlightSearchModal';
import { useSpotlightShortcut } from '../../src/components/Search/useSpotlightShortcut';
import type { Question } from '../../src/types/quiz';

const firstQuestion: Question = {
  id: 'first',
  type: 'choice',
  chapter: 1,
  stem: '阿兰·图灵在1950年提出了著名的“图灵测试”以评估机器智能。',
  options: ['选项专用密语', '普通选项'],
  answer: 0,
  explain: '解法专用密语',
  source: { origin: 'comprehensive_bank', file: 'fixture', ref: '1' },
};
const questions: Question[] = [
  firstQuestion,
  { ...firstQuestion, id: 'second', type: 'short', stem: '符号表示方法经过专家系统才形成学派。', answer: '独立参考答案', options: undefined },
];
const chapterById = new Map([[1, { id: 1, short: '基础理论', title: '基础理论' }]]);

function press(target: EventTarget, key: string, options: KeyboardEventInit = {}) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })));
}

describe('Spotlight search', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onStart = vi.fn();
  const dialogPrototype = HTMLDialogElement.prototype;
  const needsDialogStub = typeof dialogPrototype.showModal !== 'function';

  beforeAll(() => {
    if (!needsDialogStub) return;
    Object.defineProperties(dialogPrototype, {
      showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
    });
  });

  afterAll(() => {
    if (!needsDialogStub) return;
    Reflect.deleteProperty(dialogPrototype, 'showModal');
    Reflect.deleteProperty(dialogPrototype, 'close');
  });

  function Harness() {
    const [open, setOpen] = useState(false);
    useSpotlightShortcut(open, () => setOpen(true), () => setOpen(false));
    return <>
      <input aria-label="普通输入" />
      {open && <SpotlightSearchModal
        questions={questions}
        chapterById={chapterById}
        bankName="示例题库"
        onClose={() => setOpen(false)}
        onStart={onStart}
      />}
    </>;
  }

  function enterQuery(value: string) {
    const input = container.querySelector('input[type=search]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function clickButton(name: string) {
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === name)!;
    act(() => button.click());
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onStart.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens with Ctrl or Cmd, preserves shortcuts in editable inputs, and closes on Escape', () => {
    const otherInput = container.querySelector('input')!;
    otherInput.focus();
    press(otherInput, 'k', { ctrlKey: true });
    expect(container.querySelector('dialog')).toBeNull();
    otherInput.blur();

    press(window, 'k', { metaKey: true });
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('input[type=search]'));
    press(document.activeElement!, 'Escape');
    expect(container.querySelector('dialog')).toBeNull();

    press(window, 'k', { ctrlKey: true });
    expect(container.querySelector('dialog')?.open).toBe(true);
  });

  it('highlights fuzzy stem hits, and reports option and explanation hits without rendering their text', () => {
    press(window, 'k', { ctrlKey: true });
    enterQuery('图灵测验');
    expect(container.querySelector('mark')?.textContent).toBe('图灵测');
    expect(container.querySelector('.spotlight__stem')?.textContent).toContain('图灵测试');

    enterQuery('选项专用密语');
    const result = container.querySelector('[data-testid="spotlight-result-first"]');
    expect(result?.textContent).toContain('命中选项');
    expect(result?.textContent).not.toContain('选项专用密语');
    expect(result?.querySelector('mark')).toBeNull();

    enterQuery('解法专用密语');
    expect(container.querySelector('[data-testid="spotlight-result-second"]')?.textContent).toContain('命中解析');
    expect(container.querySelector('[data-testid="spotlight-result-second"]')?.textContent).not.toMatch(/解法专用密语|独立参考答案/);
  });

  it('retains checked questions across queries and starts just the selected IDs', () => {
    press(window, 'k', { ctrlKey: true });
    enterQuery('图灵测验');
    act(() => container.querySelector<HTMLInputElement>('[data-testid="spotlight-result-first"] input')!.click());
    enterQuery('符号学派');
    clickButton('全选当前结果');
    clickButton('开始专项刷题（已选 2 题）');
    expect(onStart).toHaveBeenCalledWith(['first', 'second']);
  });
});
