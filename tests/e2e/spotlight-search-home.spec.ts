import { assertNoHorizontalOverflow } from './helpers/audit';
import { FIXTURE_BANK, seedFixtureBank } from './helpers/fixtureBank';
import { expect, test } from './helpers/fixtures';
import { gotoRoute, quizProgressText } from './helpers/selectors';
import { makeEmptyStore } from './helpers/storage';

const questions = [
  {
    ...FIXTURE_BANK.questions[0]!,
    id: 'spotlight-turing',
    stem: '阿兰·图灵在1950年提出了著名的“图灵测试”以评估机器智能。',
    options: ['选项限定密语', '无关选项'],
    answer: 0,
    explain: '解析限定密语',
  },
  {
    ...FIXTURE_BANK.questions[1]!,
    id: 'spotlight-symbol',
    stem: '符号表示方法经过早期专家系统、规则推理引擎才形成学派体系。',
    options: ['无关内容一', '无关内容二'],
    answer: 1,
    explain: '解析限定密语',
  },
];
const bank = { ...FIXTURE_BANK, questions };

test('opens Spotlight globally, highlights fuzzy matches, and practices selected questions without spoilers', async ({ page }) => {
  await seedFixtureBank(page, bank, makeEmptyStore(), { targetHashRoute: '#/notes' });
  await page.getByTestId('global-search-trigger').click();
  const dialog = page.getByRole('dialog', { name: '搜索题目', exact: true });
  const input = dialog.getByRole('searchbox');
  await expect(input).toBeFocused();

  await input.fill('图灵测验');
  const turing = dialog.getByTestId('spotlight-result-spotlight-turing');
  await expect(turing.locator('mark').first()).toHaveText('图灵测');
  await expect(turing).toContainText('图灵测试');
  await expect(turing).not.toContainText('选项限定密语');
  await expect(turing).not.toContainText('解析限定密语');
  await turing.getByRole('checkbox').check();

  await input.fill('符号学派');
  const symbol = dialog.getByTestId('spotlight-result-spotlight-symbol');
  await expect(symbol.locator('mark')).toHaveText(['符号', '学派']);

  await input.fill('选项限定密语');
  await expect(turing).toContainText('命中选项');
  await expect(turing).not.toContainText('选项限定密语');
  await expect(turing.locator('mark')).toHaveCount(0);

  await input.fill('解析限定密语');
  await expect(dialog.getByTestId('spotlight-results-count')).toHaveText('匹配 2 题');
  await expect(symbol).toContainText('命中解析');
  await expect(symbol).not.toContainText('解析限定密语');
  await dialog.getByRole('button', { name: '全选当前结果' }).click();
  await expect(dialog.getByRole('button', { name: '开始专项刷题（已选 2 题）' })).toBeVisible();
  await dialog.getByRole('button', { name: '清空已选' }).click();
  await expect(dialog.getByTestId('spotlight-start')).toHaveCount(0);
  await dialog.getByRole('button', { name: '全选当前结果' }).click();
  await dialog.getByRole('button', { name: '开始专项刷题（已选 2 题）' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/quiz$/);
  await expect(quizProgressText(page)).toContainText('1 / 2');

  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await input.fill('符号学派');
  await symbol.getByRole('button', { name: '刷这题' }).click();
  await expect(quizProgressText(page)).toContainText('1 / 1');
  await expect(page.getByTestId('q-stem')).toContainText('符号表示方法');

  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await gotoRoute(page, '#/notes');
  await page.getByTestId('notes-search').focus();
  await page.keyboard.press('Control+k');
  await expect(dialog).toHaveCount(0);
});

test('contains the condensed controls, overflow menu and Spotlight in both themes', async ({ page }, testInfo) => {
  await gotoRoute(page, '#/quiz');
  const menuButton = page.getByTestId('progress-menu-trigger');
  const trigger = page.getByTestId('global-search-trigger');
  if (testInfo.project.name === 'mobile') {
    await expect(trigger.locator('kbd')).toBeHidden();
  } else {
    await expect(trigger.locator('kbd')).toBeVisible();
  }
  for (const theme of ['light', 'dark']) {
    await page.getByTestId(`theme-option-${theme}`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByTestId('filter-search')).toHaveCount(0);
    await expect(page.getByTestId('btn-export-json')).toBeHidden();
    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('btn-export-json')).toBeVisible();
    await expect(page.getByTestId('btn-import-json')).toBeVisible();
    await expect(page.getByTestId('btn-reset-store')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(menuButton).toBeFocused();

    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '搜索题目', exact: true });
    await expect(dialog.getByRole('searchbox')).toBeFocused();
    await dialog.getByRole('searchbox').fill('不存在的专用关键词XYZ12345');
    await expect(dialog).toContainText('没有找到匹配的题目');
    await assertNoHorizontalOverflow(page);
    await dialog.getByRole('button', { name: '关闭搜题' }).click();
    await expect(trigger).toBeFocused();
  }
});
