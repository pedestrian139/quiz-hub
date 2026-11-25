import { expect, test } from './helpers/fixtures';
import { assertFullLayoutAudit } from './helpers/audit';
import { installAuthGateway } from './helpers/authGateway';
import { gotoRoute, modeCard, quizProgressText } from './helpers/selectors';

const authDisabled = process.env.PW_AUTH_DISABLED === '1';
const progress = { records: { 'guest-question': { ok: 1, ts: 123 } }, fav: {}, mastery: {} };

test.describe('Tier 6: Auth UI with the Supabase client', () => {
  test.skip(authDisabled, 'Requires the test Supabase gateway');

  test('uses the service validation rules and supports password visibility', async ({ page }) => {
    await gotoRoute(page, 'hub');
    await page.getByTestId('auth-open-btn').click();
    await expect(page.getByTestId('auth-tab-login')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('auth-tab-register').click();
    await expect(page.getByTestId('auth-tab-register')).toHaveAttribute('aria-selected', 'true');
    const account = page.getByTestId('auth-account-input');
    await account.fill('123456');
    await account.blur();
    await expect(page.getByTestId('auth-account-error')).toContainText('7–15 位数字');
    await account.fill('001234567');
    await expect(page.getByTestId('auth-account-error')).toHaveCount(0);
    await account.fill('broken@');
    await expect(page.getByTestId('auth-account-error')).toContainText('邮箱格式不正确');
    await account.fill('learner@example.com');
    await expect(page.getByTestId('auth-account-error')).toHaveCount(0);

    const password = page.getByTestId('auth-password-input');
    const toggle = page.getByTestId('auth-toggle-password');
    await password.fill('1234567');
    await password.blur();
    await expect(page.getByTestId('auth-password-error')).toContainText('至少需要 8 个字符');
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('1234567');
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'password');
    await assertFullLayoutAudit(page);
  });

  test('registers through Supabase, waits for email verification and restores the real session', async ({ page, healthTrap }) => {
    const gateway = await installAuthGateway(page);
    await gotoRoute(page, 'hub');
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-tab-register').click();
    await page.getByTestId('auth-account-input').fill('learner@example.com');
    await page.getByTestId('auth-nickname-input').fill('学习者');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-notice')).toContainText('验证邮件已发送');
    await expect(page.getByTestId('user-menu-trigger')).toHaveCount(0);

    await page.getByTestId('auth-tab-login').click();
    healthTrap.expectHttpError('http://127.0.0.1:49391/auth/v1/token', 400);
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error')).toContainText('请先通过邮件验证邮箱');

    gateway.verifyEmail('learner@example.com');
    healthTrap.expectHttpError('http://127.0.0.1:49391/auth/v1/token', 400);
    await page.getByTestId('auth-password-input').fill('wrong-password');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error')).toContainText('账号或密码不正确');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeHidden();
    await expect(page.getByTestId('auth-sync-status')).toHaveText('账号已登录');

    await page.reload();
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toContainText('学习者');
    const credentialStorage = await page.evaluate(() => ({
      mockSession: localStorage.getItem('ai-intro-quiz-auth-session-v1'),
      mockUsers: localStorage.getItem('ai-intro-quiz-auth-users-v1'),
      containsPassword: Object.values(localStorage).some((value) => typeof value === 'string' && value.includes('pass123456')),
    }));
    expect(credentialStorage).toEqual({ mockSession: null, mockUsers: null, containsPassword: false });

    await trigger.click();
    await expect(page.getByTestId('user-menu-bound-account')).toHaveText('learner@example.com');
    await assertFullLayoutAudit(page);
    await page.getByTestId('auth-switch-account-btn').click();
    await page.getByTestId('auth-modal-close').click();
    await expect(trigger).toContainText('学习者');
    await trigger.click();
    await page.getByTestId('auth-logout-btn').click();
    await expect(page.getByTestId('auth-open-btn')).toBeVisible();
  });

  test('preserves guest intent through existing-account login and reports upload failure until retry succeeds', async ({ page, healthTrap }) => {
    const gateway = await installAuthGateway(page);
    const existing = gateway.addAccount('existing@example.com', 'existing-password', '老学员');
    gateway.allowImports(false);
    await gotoRoute(page, 'hub');
    await page.evaluate((store) => localStorage.setItem('ai-intro-quiz-v1', JSON.stringify(store)), progress);
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-guest-login-btn').click();
    await page.getByTestId('auth-guest-mode-btn').click();
    await page.getByTestId('auth-upgrade-to-login').click();
    await expect(page.getByRole('heading', { name: '登录已有账号并同步进度' })).toBeVisible();
    await page.getByTestId('auth-account-input').fill('existing@example.com');
    await page.getByTestId('auth-password-input').fill('existing-password');
    healthTrap.expectHttpError('http://127.0.0.1:49391/functions/v1/user-data', 503);
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('user-menu-trigger')).toHaveAccessibleName('老学员');
    await expect(page.getByTestId('auth-sync-status')).toHaveText('同步待重试');
    expect(gateway.imports[0]).toMatchObject({ ownerId: existing.user_id, progress: [{ bankId: 'builtin-ai-intro', store: progress }] });

    gateway.allowImports(true);
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('auth-sync-btn').click();
    await expect(page.getByTestId('auth-sync-status')).toHaveText('游客数据已同步');
    expect(gateway.imports.at(-1)?.importId).toBe(gateway.imports[0].importId);
  });

  test('upgrades a guest through the phone Edge Function and uploads to the formal account', async ({ page }) => {
    const gateway = await installAuthGateway(page);
    await gotoRoute(page, 'hub');
    await page.evaluate((store) => localStorage.setItem('ai-intro-quiz-v1', JSON.stringify(store)), progress);
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-guest-login-btn').click();
    await page.getByTestId('auth-guest-mode-btn').click();
    await page.getByTestId('auth-account-input').fill('13987654321');
    await page.getByTestId('auth-password-input').fill('upgrade888');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeHidden();
    await expect(page.getByTestId('auth-sync-status')).toHaveText('游客数据已同步');
    expect(gateway.imports[0]?.ownerId).toMatch(/^[a-f0-9-]{36}$/);
    await page.getByTestId('user-menu-trigger').click();
    await expect(page.getByTestId('user-menu-bound-account')).toHaveText('13987654321');
    await assertFullLayoutAudit(page);
  });

  test('accepts both identifiers at registration and leaves email verification pending', async ({ page }) => {
    await installAuthGateway(page);
    await gotoRoute(page, 'hub');
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-tab-register').click();
    await page.getByTestId('auth-account-input').fill('learner@example.com');
    await page.getByTestId('auth-secondary-input').fill('13987654321');
    await page.getByTestId('auth-nickname-input').fill('学习者');
    await page.getByTestId('auth-password-input').fill('password123');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-notice')).toContainText('请查收验证邮件完成邮箱绑定');
    await page.getByTestId('auth-modal-close').click();
    await page.getByTestId('user-menu-trigger').click();
    await expect(page.getByTestId('user-menu-bound-account')).toHaveText('13987654321');
  });

  test('moves and traps focus, isolates quiz shortcuts and restores focus on Escape', async ({ page }) => {
    await gotoRoute(page, 'quiz');
    await modeCard(page, 'choice').click();
    await expect(quizProgressText(page)).toContainText('1 /');
    await page.getByTestId('auth-open-btn').click();
    const modal = page.getByTestId('auth-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('auth-account-input')).toBeFocused();
    const close = page.getByTestId('auth-modal-close');
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('auth-guest-login-btn')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(quizProgressText(page)).toContainText('1 /');
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('auth-open-btn')).toBeFocused();
  });
});

test('without Supabase configuration shows a local guest option and no credential form', async ({ page }) => {
  test.skip(!authDisabled, 'Run with PW_AUTH_DISABLED=1');
  await gotoRoute(page, 'hub');
  await page.getByTestId('auth-open-btn').click();
  await expect(page.getByTestId('auth-unavailable')).toContainText('尚未配置');
  await expect(page.getByTestId('auth-account-input')).toHaveCount(0);
  await page.getByTestId('auth-guest-login-btn').click();
  await expect(page.getByTestId('auth-guest-mode-btn')).toBeVisible();
  await expect(page.getByTestId('auth-sync-status')).toHaveCount(0);
});
