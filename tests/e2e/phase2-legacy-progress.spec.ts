import { expect, test } from './helpers/fixtures';
import { installAuthGateway } from './helpers/authGateway';
import { installMockLlm, MOCK_API_BASE } from './helpers/mockLlm';
import { aiBtnExplain, filterOrder, gotoRoute, modeCard, navLink, quizOption } from './helpers/selectors';
import type { Page } from '@playwright/test';

async function signIn(page: Page, email: string) {
  await page.getByTestId('auth-account-input').fill(email);
  await page.getByTestId('auth-password-input').fill('pass123456');
  await page.getByTestId('auth-submit-btn').click();
  await expect(page.getByTestId('user-menu-trigger')).toBeVisible();
}

test('restores the original built-in bank only for an account with its Phase 1 history', async ({ page }) => {
  test.skip(process.env.PW_AUTH_DISABLED === '1', 'Requires the test Supabase gateway');
  const gateway = await installAuthGateway(page);
  const returning = 'legacy-returning@example.com';
  const newAccount = 'legacy-new@example.com';
  gateway.addAccount(returning, 'pass123456', '历史进度用户');
  gateway.addAccount(newAccount, 'pass123456', '新用户');
  gateway.mutateCloudProgressExternally(returning, 'builtin-ai-intro', () => ({
    records: {
      'qb-c1-ch01': { ok: 1, choice: 0, ts: 100 },
      'syn-c1-s1-04': { ok: 0, ts: 101 },
    },
    fav: { 'qb-c1-ch01': true, 'syn-c1-s1-04': true },
    mastery: { 'syn-c1-s1-04': 1 },
  }));

  const switcher = page.getByTestId('bank-switcher');
  const legacy = switcher.locator('option[value="builtin-ai-intro"]');
  await gotoRoute(page, '#/');
  await expect(legacy).toHaveCount(0);
  await expect(switcher).toHaveValue('builtin-quizhub-guide');
  await page.getByTestId('auth-open-btn').click();
  await signIn(page, returning);
  await expect(legacy).toContainText('335 题');
  await expect(switcher).toHaveValue('builtin-quizhub-guide');
  await switcher.selectOption('builtin-ai-intro');
  await navLink(page, 'wrong').click();
  await expect(page.getByTestId('list-item')).toHaveCount(1);
  await expect(page.getByTestId('list-item')).toContainText('有点模糊');
  await navLink(page, 'fav').click();
  await expect(page.getByTestId('list-item')).toHaveCount(2);
  await navLink(page, 'quiz').click();
  await expect(page.getByTestId('stat-done')).toContainText('2');

  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('auth-logout-btn').click();
  await expect(switcher).toHaveValue('builtin-quizhub-guide');
  await expect(legacy).toHaveCount(0);
  await page.getByTestId('auth-open-btn').click();
  await signIn(page, newAccount);
  await expect(switcher).toHaveValue('builtin-quizhub-guide');
  await expect(legacy).toHaveCount(0);
});

test('clears the AI drawer, cached analysis and BYOK when switching accounts and logging out', async ({ page }) => {
  test.skip(process.env.PW_AUTH_DISABLED === '1', 'Requires the test Supabase gateway');
  const gateway = await installAuthGateway(page);
  const firstEmail = 'tutor-owner@example.com';
  gateway.addAccount(firstEmail, 'pass123456', '解析用户');
  gateway.addAccount('tutor-other@example.com', 'pass123456', '另一位用户');
  const llm = await installMockLlm(page);

  await gotoRoute(page, '#/quiz');
  await page.getByTestId('auth-open-btn').click();
  await signIn(page, firstEmail);
  const settings = page.getByTestId('btn-api-settings');
  await settings.click();
  await page.getByTestId('api-preset-custom').click();
  await page.getByTestId('api-input-baseurl').fill(MOCK_API_BASE);
  await page.getByTestId('api-input-key').fill('test-tutor-owner-key');
  await page.getByTestId('api-input-model').fill('mock-quizhub-chat');
  await page.getByTestId('api-btn-save').click();
  await expect(settings).toHaveAttribute('data-configured', 'true');

  await filterOrder(page).selectOption('seq');
  await modeCard(page, 'choice').click();
  await quizOption(page, 0).click();
  await aiBtnExplain(page).click();
  const drawer = page.getByTestId('ai-explain-drawer');
  await expect(drawer).toContainText('核心考点');
  await expect.poll(() => gateway.getCloudProgress(firstEmail, 'builtin-quizhub-guide')?.store.aiExplanations?.['qh-guide-choice-01']?.content).toContain('核心考点');
  llm.clear();
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('auth-switch-account-btn').click();
  await signIn(page, 'tutor-other@example.com');
  await expect(page.getByTestId('user-menu-trigger')).toHaveAccessibleName('另一位用户');
  await expect(drawer).toHaveCount(0);
  await expect(settings).toHaveAttribute('data-configured', 'false');
  await filterOrder(page).selectOption('seq');
  await modeCard(page, 'choice').click();
  await aiBtnExplain(page).click();
  await expect(drawer).toContainText('尚未配置大模型 API');
  await expect(drawer).not.toContainText('核心考点');
  expect(llm.requests).toHaveLength(0);

  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('auth-logout-btn').click();
  await expect(drawer).toHaveCount(0);
  await expect(settings).toHaveAttribute('data-configured', 'false');
  await expect(page.getByTestId('auth-open-btn')).toBeVisible();
});
