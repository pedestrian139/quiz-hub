import { expect, test } from './helpers/fixtures';
import { assertFullLayoutAudit } from './helpers/audit';
import { gotoRoute, modeCard, quizProgressText } from './helpers/selectors';

test.describe('Tier 6: Auth UI (Login, Register, Guest & Profile)', () => {
  test('T6-001: Login/Register tab switch, unified phone/email validation & password visibility toggle', async ({
    page,
  }) => {
    await gotoRoute(page, 'hub');
    await assertFullLayoutAudit(page);

    await page.getByTestId('auth-open-btn').click();
    const modal = page.getByTestId('auth-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('auth-tab-login')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('auth-tab-register')).toHaveAttribute('aria-selected', 'false');
    await assertFullLayoutAudit(page);

    // Switch to Register tab
    await page.getByTestId('auth-tab-register').click();
    await expect(page.getByTestId('auth-tab-register')).toHaveAttribute('aria-selected', 'true');
    await expect(modal).toContainText('注册 QuizHub 账号');

    const accountInput = page.getByTestId('auth-account-input');
    const badge = page.getByTestId('auth-account-type-badge');
    const passwordInput = page.getByTestId('auth-password-input');
    const toggleBtn = page.getByTestId('auth-toggle-password');

    // Invalid phone (not 11 digits)
    await accountInput.fill('13800138');
    await expect(badge).toContainText('手机号');
    await accountInput.blur();
    await expect(page.getByTestId('auth-account-error')).toContainText('手机号需为 11 位数字');

    // Valid 11-digit phone clears error
    await accountInput.fill('13800138000');
    await expect(badge).toContainText('手机号');
    await expect(page.getByTestId('auth-account-error')).toHaveCount(0);

    // Invalid email
    await accountInput.fill('invalid@');
    await expect(badge).toContainText('邮箱');
    await expect(page.getByTestId('auth-account-error')).toContainText('邮箱格式不正确');

    // Valid email clears error
    await accountInput.fill('student@university.edu');
    await expect(badge).toContainText('邮箱');
    await expect(page.getByTestId('auth-account-error')).toHaveCount(0);

    // Password toggle & >= 6 char validation
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    await passwordInput.fill('12345');
    await passwordInput.blur();
    await expect(page.getByTestId('auth-password-error')).toContainText('密码长度不能少于 6 位');

    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(passwordInput).toHaveValue('12345');

    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');

    await assertFullLayoutAudit(page);
  });

  test('T6-002: Register -> reload persistence -> profile popover -> switch account -> logout -> login', async ({
    page,
  }) => {
    await gotoRoute(page, 'hub');
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-tab-register').click();

    await page.getByTestId('auth-account-input').fill('learner@example.com');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();

    await expect(page.getByTestId('auth-modal')).toBeHidden();
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText('learner');

    // Reload persistence & zero leakage into V1 store
    await page.reload();
    await expect(page.getByTestId('user-menu-trigger')).toContainText('learner');
    const v1Store = await page.evaluate(() => localStorage.getItem('ai-intro-quiz-v1'));
    expect(v1Store).toBeNull();

    // Open profile popover to inspect bound email
    await page.getByTestId('user-menu-trigger').click();
    const popover = page.getByTestId('user-menu-popover');
    await expect(popover).toBeVisible();
    await expect(page.getByTestId('user-menu-bound-account')).toHaveText('learner@example.com');
    await assertFullLayoutAudit(page);

    // Switch account opens modal in login tab; closing preserves current login
    await page.getByTestId('auth-switch-account-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeVisible();
    await expect(page.getByTestId('auth-tab-login')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('auth-modal-close').click();
    await expect(page.getByTestId('user-menu-trigger')).toContainText('learner');

    // Logout
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('auth-logout-btn').click();
    await expect(page.getByTestId('auth-open-btn')).toBeVisible();

    // Login back with wrong password then correct password
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-account-input').fill('learner@example.com');
    await page.getByTestId('auth-password-input').fill('wrongpass');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error')).toContainText('密码错误');

    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeHidden();
    await expect(page.getByTestId('user-menu-trigger')).toContainText('learner');
  });

  test('T6-003: Guest entry -> top bar 游客模式 -> click to open 绑定账号保存云端进度 -> upgrade account', async ({
    page,
  }) => {
    await gotoRoute(page, 'hub');
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-guest-login-btn').click();

    await expect(page.getByTestId('auth-modal')).toBeHidden();
    const guestBtn = page.getByTestId('auth-guest-mode-btn');
    await expect(guestBtn).toBeVisible();
    await expect(guestBtn).toContainText('游客模式');
    await assertFullLayoutAudit(page);

    const guestIdBefore = await page.evaluate(() => {
      const raw = localStorage.getItem('ai-intro-quiz-auth-session-v1');
      return raw ? (JSON.parse(raw) as { id?: string }).id : null;
    });
    expect(guestIdBefore).toBeTruthy();

    // Click top bar 游客模式 to open upgrade modal
    await guestBtn.click();
    const modal = page.getByTestId('auth-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('绑定账号保存云端进度');
    await assertFullLayoutAudit(page);

    await page.getByTestId('auth-account-input').fill('13987654321');
    await page.getByTestId('auth-password-input').fill('upgrade888');
    await page.getByTestId('auth-submit-btn').click();

    await expect(modal).toBeHidden();
    await expect(page.getByTestId('user-menu-trigger')).toContainText('手机用户_4321');

    // Verify guest ID preserved on upgraded account
    const sessionAfter = await page.evaluate(() => {
      const raw = localStorage.getItem('ai-intro-quiz-auth-session-v1');
      return raw
        ? (JSON.parse(raw) as { id?: string; upgradedFromGuestId?: string; phone?: string })
        : null;
    });
    expect(sessionAfter?.id).toBe(guestIdBefore);
    expect(sessionAfter?.upgradedFromGuestId).toBe(guestIdBefore);
    expect(sessionAfter?.phone).toBe('13987654321');

    await page.getByTestId('user-menu-trigger').click();
    await expect(page.getByTestId('user-menu-bound-account')).toHaveText('13987654321');
    await assertFullLayoutAudit(page);
  });

  test('T6-004: AuthModal isolates QuizSession keyboard shortcuts and closes on Escape', async ({
    page,
  }) => {
    await gotoRoute(page, 'quiz');
    await modeCard(page, 'choice').click();
    await expect(quizProgressText(page)).toContainText('1 /');

    await page.getByTestId('auth-open-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeVisible();

    // Typing option keys / Space inside modal must not trigger quiz answer/navigation
    await page.getByTestId('auth-account-input').fill('a1b2@test.com');
    await page.keyboard.press('ArrowRight');
    await expect(quizProgressText(page)).toContainText('1 /');

    // Escape closes modal cleanly
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('auth-modal')).toBeHidden();
  });
});
