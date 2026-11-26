import { expect, test } from './helpers/fixtures';
import { assertFullLayoutAudit } from './helpers/audit';
import { installAuthGateway } from './helpers/authGateway';
import { gotoRoute, modeCard, navLink, quizProgressText, statCard } from './helpers/selectors';

const authDisabled = process.env.PW_AUTH_DISABLED === '1';
const progress = { records: { 'guest-question': { ok: 1, ts: 123 } }, fav: {}, mastery: {} };

test.describe('Tier 6: Auth UI with the Supabase client (Email + OTP)', () => {
  test.skip(authDisabled, 'Requires the test Supabase gateway');

  test('validates email-only accounts, password visibility and OTP format', async ({ page }) => {
    await gotoRoute(page, 'hub');
    await page.getByTestId('auth-open-btn').click();
    await expect(page.getByTestId('auth-tab-login')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('auth-tab-register').click();
    await expect(page.getByTestId('auth-tab-register')).toHaveAttribute('aria-selected', 'true');

    const account = page.getByTestId('auth-account-input');
    await account.fill('13800138000');
    await account.blur();
    await expect(page.getByTestId('auth-account-error')).toContainText('请输入有效的邮箱地址');
    await account.fill('broken@');
    await expect(page.getByTestId('auth-account-error')).toContainText('请输入有效的邮箱地址');
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
    await password.fill('pass123456');
    await expect(page.getByTestId('auth-password-error')).toHaveCount(0);

    await page.getByTestId('auth-tab-login').click();
    await page.getByTestId('auth-login-method-otp').click();
    const otp = page.getByTestId('auth-otp-input');
    await otp.fill('123');
    await otp.blur();
    await expect(page.getByTestId('auth-otp-error')).toContainText('6–8 位数字验证码');
    await otp.fill('123456');
    await expect(page.getByTestId('auth-otp-error')).toHaveCount(0);

    await assertFullLayoutAudit(page);
  });

  test('registers with email OTP, activates unconfirmed account, persists session and rejects duplicate signup', async ({ page, healthTrap }) => {
    await installAuthGateway(page);
    await gotoRoute(page, 'hub');
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-tab-register').click();
    await page.getByTestId('auth-account-input').fill('learner@example.com');
    await page.getByTestId('auth-nickname-input').fill('学习者');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();

    await expect(page.getByTestId('auth-notice')).toContainText('验证码已发送至 learner@example.com');
    await expect(page.getByTestId('auth-otp-input')).toBeVisible();
    await expect(page.getByTestId('auth-send-otp-btn')).toBeDisabled();
    await expect(page.getByTestId('user-menu-trigger')).toHaveCount(0);

    await page.getByTestId('auth-tab-login').click();
    await page.getByTestId('auth-account-input').fill('learner@example.com');
    await page.getByTestId('auth-password-input').fill('pass123456');
    healthTrap.expectHttpError('http://127.0.0.1:49391/auth/v1/token', 400);
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error')).toContainText('该邮箱尚未完成验证码激活');
    await page.getByTestId('auth-go-verify-btn').click();
    await expect(page.getByTestId('auth-notice')).toContainText('验证码已发送至 learner@example.com');
    await expect(page.getByTestId('auth-send-otp-btn')).toBeDisabled();

    healthTrap.expectHttpError('http://127.0.0.1:49391/auth/v1/verify', 400);
    await page.getByTestId('auth-otp-input').fill('000000');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error')).toContainText('验证码无效或已过期');

    await page.getByTestId('auth-otp-input').fill('123456');
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

    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-tab-register').click();
    await page.getByTestId('auth-account-input').fill('learner@example.com');
    await page.getByTestId('auth-nickname-input').fill('重复账号');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error')).toContainText('该邮箱已注册');
  });

  test('supports Email + OTP login and rejects unregistered emails cleanly', async ({ page, healthTrap }) => {
    const gateway = await installAuthGateway(page);
    gateway.addAccount('otpuser@example.com', 'secret123', '验证码用户');
    await gotoRoute(page, 'hub');
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-login-method-otp').click();

    await page.getByTestId('auth-account-input').fill('missing@example.com');
    healthTrap.expectHttpError('http://127.0.0.1:49391/auth/v1/otp', 400);
    await page.getByTestId('auth-send-otp-btn').click();
    await expect(page.getByTestId('auth-error')).toContainText('该邮箱尚未注册');

    await page.getByTestId('auth-account-input').fill('otpuser@example.com');
    await page.getByTestId('auth-send-otp-btn').click();
    await expect(page.getByTestId('auth-notice')).toContainText('验证码已发送至 otpuser@example.com');
    await expect(page.getByTestId('auth-send-otp-btn')).toBeDisabled();
    await assertFullLayoutAudit(page);

    healthTrap.expectHttpError('http://127.0.0.1:49391/auth/v1/verify', 400);
    await page.getByTestId('auth-otp-input').fill('999999');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error')).toContainText('验证码无效或已过期');

    await page.getByTestId('auth-otp-input').fill('246810');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeHidden();
    await expect(page.getByTestId('user-menu-trigger')).toContainText('验证码用户');
  });

  test('enforces 60s resend cooldown across modal reopen, resends after 60s, and shows 5-minute expiry', async ({ page }) => {
    await page.clock.install({ time: Date.now() });
    await installAuthGateway(page);
    await gotoRoute(page, 'hub');

    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-tab-register').click();
    await page.getByTestId('auth-account-input').fill('resend@example.com');
    await page.getByTestId('auth-nickname-input').fill('倒计时测试');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();

    await expect(page.getByTestId('auth-otp-expiry')).toContainText('5 分钟内有效');
    const sendBtn = page.getByTestId('auth-send-otp-btn');
    await expect(sendBtn).toBeDisabled();
    await expect(sendBtn).toContainText('后重发');

    // Reopen modal in OTP login for the same email: 60s cooldown persists and cannot be bypassed
    await page.getByTestId('auth-modal-close').click();
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-login-method-otp').click();
    await page.getByTestId('auth-account-input').fill('resend@example.com');
    await expect(sendBtn).toBeDisabled();
    await expect(page.getByTestId('auth-otp-expiry')).toContainText('5 分钟内有效');

    // Fast-forward 61s: resend button becomes active as "重发验证码"
    await page.clock.fastForward(61_000);
    await expect(sendBtn).toBeEnabled();
    await expect(sendBtn).toHaveText('重发验证码');

    // Return to register step and test clicking "重发验证码" + 654321 activation
    await page.getByTestId('auth-tab-register').click();
    await page.getByTestId('auth-account-input').fill('resend@example.com');
    await page.getByTestId('auth-nickname-input').fill('倒计时测试');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();

    await page.clock.fastForward(61_000);
    await expect(sendBtn).toBeEnabled();
    await expect(sendBtn).toHaveText('重发验证码');
    await sendBtn.click();
    await expect(page.getByTestId('auth-notice')).toContainText('验证码已重新发送至 resend@example.com');
    await expect(sendBtn).toBeDisabled();
    await assertFullLayoutAudit(page);

    await page.getByTestId('auth-otp-input').fill('654321');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeHidden();

    // Logout, request login OTP, fast-forward past 5 minutes -> displays expired warning + enabled "重发验证码"
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('auth-logout-btn').click();
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-login-method-otp').click();
    await page.getByTestId('auth-account-input').fill('resend@example.com');
    await sendBtn.click();
    await expect(page.getByTestId('auth-otp-expiry')).toContainText('5 分钟内有效');

    await page.clock.fastForward(301_000);
    await expect(page.getByTestId('auth-otp-expiry')).toContainText('验证码已过期');
    await expect(sendBtn).toBeEnabled();
    await expect(sendBtn).toHaveText('重发验证码');

    await sendBtn.click();
    await expect(page.getByTestId('auth-notice')).toContainText('验证码已重新发送至 resend@example.com');
    await expect(page.getByTestId('auth-otp-expiry')).toContainText('5 分钟内有效');
    await expect(sendBtn).toBeDisabled();
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
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`ai-intro-quiz-v1:account:${id}`) ?? 'null'), existing.user_id))
      .toEqual(progress);
  });

  test('keeps favorites and manual uploads isolated when switching accounts on the same browser', async ({ page }) => {
    const gateway = await installAuthGateway(page);
    const first = gateway.addAccount('first@example.com', 'first-password', '第一位学员');
    const second = gateway.addAccount('second@example.com', 'second-password', '第二位学员');
    const trigger = page.getByTestId('user-menu-trigger');
    async function signIn(account: ReturnType<typeof gateway.addAccount>) {
      await page.getByTestId('auth-account-input').fill(account.email!);
      await page.getByTestId('auth-password-input').fill(account.password);
      await page.getByTestId('auth-submit-btn').click();
      await expect(page.getByTestId('auth-modal')).toBeHidden();
      await expect(trigger).toHaveAccessibleName(account.nickname);
    }
    async function switchAccount(account: ReturnType<typeof gateway.addAccount>) {
      await trigger.click();
      await page.getByTestId('auth-switch-account-btn').click();
      await signIn(account);
    }
    await gotoRoute(page, 'quiz');
    await page.getByTestId('auth-open-btn').click();
    await signIn(first);
    await modeCard(page, 'choice').click();
    const star = page.getByTestId('btn-star');
    await star.click();
    await expect(star).toHaveClass(/is-starred/);

    await switchAccount(second);
    await expect(star).toHaveCount(0);
    await expect(statCard(page, 'fav')).toContainText('0');
    await trigger.click();
    const sync = page.getByTestId('auth-sync-btn');
    await sync.click();
    await expect(sync).toBeEnabled();
    expect(gateway.imports).toEqual([]);
    await trigger.click();
    await modeCard(page, 'choice').click();
    await expect(star).not.toHaveClass(/is-starred/);

    await switchAccount(first);
    await expect(statCard(page, 'fav')).toContainText('1');
    await trigger.click();
    await sync.click();
    await expect.poll(() => gateway.imports.length).toBe(1);
    expect(gateway.imports[0]).toMatchObject({ ownerId: first.user_id, progress: [expect.objectContaining({ bankId: 'builtin-ai-intro' })] });
  });

  test('syncs API config to cloud in memory only, respects tab-only session mode, clears cloud config, and purges on logout', async ({ page }) => {
    const gateway = await installAuthGateway(page);
    gateway.addAccount('apicloud@example.com', 'pass123456', '云端用户');
    await gotoRoute(page, 'hub');

    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-account-input').fill('apicloud@example.com');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeHidden();

    await page.getByTestId('btn-api-settings').click();
    await expect(page.getByTestId('api-storage-status')).toContainText('未配置');
    await expect(page.getByTestId('api-scope-cloud')).toBeChecked();
    await page.getByTestId('api-input-key').fill('sk-cloud-secret-7777');
    await assertFullLayoutAudit(page);
    await page.getByTestId('api-btn-save').click();

    await expect(page.getByTestId('api-settings-modal')).toBeHidden();
    await expect.poll(() => gateway.apiSaveCalls.length).toBe(1);
    await expect(page.getByTestId('btn-api-settings')).toHaveAttribute('data-configured', 'true');

    // Plaintext cloud API key must NEVER be written to localStorage or sessionStorage
    const leaked = await page.evaluate(() => ({
      localHasKey: Object.values(localStorage).some((v) => typeof v === 'string' && v.includes('sk-cloud-secret-7777')),
      sessionHasKey: Object.values(sessionStorage).some((v) => typeof v === 'string' && v.includes('sk-cloud-secret-7777')),
    }));
    expect(leaked).toEqual({ localHasKey: false, sessionHasKey: false });

    // Refresh restores decrypted config cleanly into memory
    await page.reload();
    await expect(page.getByTestId('btn-api-settings')).toHaveAttribute('data-configured', 'true');
    await page.getByTestId('btn-api-settings').click();
    await expect(page.getByTestId('api-storage-status')).toContainText('已加密同步至云端');
    await expect(page.getByTestId('api-input-key')).toHaveValue('sk-cloud-secret-7777');
    await page.getByTestId('api-settings-close').click();

    // Logout purges in-memory API config
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('auth-logout-btn').click();
    await expect(page.getByTestId('auth-open-btn')).toBeVisible();
    await expect(page.getByTestId('btn-api-settings')).toHaveAttribute('data-configured', 'false');

    // Re-login and switch explicitly to tab-only session mode (does not call cloud save)
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-account-input').fill('apicloud@example.com');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('btn-api-settings')).toHaveAttribute('data-configured', 'true');

    await page.getByTestId('btn-api-settings').click();
    await page.getByTestId('api-scope-session').click();
    await page.getByTestId('api-input-key').fill('sk-tab-session-9999');
    await page.getByTestId('api-btn-save').click();
    expect(gateway.apiSaveCalls).toHaveLength(1);

    await page.getByTestId('btn-api-settings').click();
    await expect(page.getByTestId('api-storage-status')).toContainText('仅当前标签页有效');
    await expect(page.getByTestId('api-input-key')).toHaveValue('sk-tab-session-9999');

    // Clear removes cloud API config and local session config permanently across reloads
    await page.getByTestId('api-btn-clear').click();
    await expect.poll(() => gateway.apiClearCalls.length).toBe(1);
    expect(gateway.getCloudApiConfig('apicloud@example.com')).toBeNull();
    await page.getByTestId('api-settings-close').click();

    await page.reload();
    await expect(page.getByTestId('btn-api-settings')).toHaveAttribute('data-configured', 'false');
  });

  test('syncs banks and progress in real time, restores after clearing local caches, and resolves 40001 conflicts', async ({ page, healthTrap }) => {
    const gateway = await installAuthGateway(page);
    gateway.addAccount('syncreader@example.com', 'pass123456', '同步同学');
    await gotoRoute(page, 'quiz');

    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-account-input').fill('syncreader@example.com');
    await page.getByTestId('auth-password-input').fill('pass123456');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-modal')).toBeHidden();

    // Create a custom bank -> immediately synced to cloud
    await page.getByTestId('btn-open-quiz-import').click();
    await page.getByTestId('qi-tab-banks').click();
    await page.getByTestId('btn-new-bank').click();
    await page.getByTestId('new-bank-name').fill('云端同步专练');
    await page.getByTestId('new-bank-starter-stem').fill('云端测试判断题');
    await page.getByTestId('btn-create-bank-submit').click();
    await expect.poll(() => gateway.getCloudBanks('syncreader@example.com').length).toBe(1);
    const createdBankId = gateway.getCloudBanks('syncreader@example.com')[0]!.bank_id;
    await page.getByTestId('btn-close-quiz-import').click();

    // Star a built-in question -> debounced sync to cloud
    await modeCard(page, 'choice').click();
    const star = page.getByTestId('btn-star');
    await star.click();
    await expect(star).toHaveClass(/is-starred/);
    await expect.poll(() => {
      const entry = gateway.getCloudProgress('syncreader@example.com', 'builtin-ai-intro');
      return entry ? Object.keys(entry.store.fav).length : 0;
    }).toBe(1);

    // Wipe app localStorage & IndexedDB (keep only Supabase auth session token) and reload
    await page.evaluate(async () => {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('sb-')) localStorage.removeItem(key);
      }
      sessionStorage.clear();
      const dbs = (await indexedDB.databases?.()) ?? [];
      await Promise.all(
        dbs.map((db) => (db.name ? new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(db.name!);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        }) : Promise.resolve())),
      );
    });

    await page.reload();
    await expect(statCard(page, 'fav')).toContainText('1');
    await page.getByTestId('btn-open-quiz-import').click();
    await page.getByTestId('qi-tab-banks').click();
    await expect(page.getByTestId(`bank-card-${createdBankId}`)).toBeVisible();
    await page.getByTestId('btn-close-quiz-import').click();

    // Simulate concurrent edit from another device bumping revision -> triggers 40001 and 3-way merge
    gateway.mutateCloudProgressExternally('syncreader@example.com', 'builtin-ai-intro', (prev) => ({
      ...prev,
      fav: { ...prev.fav, 'syn-c1-s1-04': true },
    }));

    await modeCard(page, 'tf').click();
    healthTrap.expectHttpError('http://127.0.0.1:49391/rest/v1/rpc/quizhub_save_progress', 409);
    await star.click();

    await expect.poll(() => {
      const entry = gateway.getCloudProgress('syncreader@example.com', 'builtin-ai-intro');
      return entry ? Object.keys(entry.store.fav).length : 0;
    }).toBe(3);

    await navLink(page, 'quiz').click();
    await expect(statCard(page, 'fav')).toContainText('3');

    // Delete custom bank and confirm deletion persists after reload
    await page.getByTestId('btn-open-quiz-import').click();
    await page.getByTestId('qi-tab-banks').click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`btn-delete-bank-${createdBankId}`).click();
    await expect.poll(() => gateway.getCloudBanks('syncreader@example.com').length).toBe(0);
    await page.getByTestId('btn-close-quiz-import').click();
  });

  test('upgrades a guest with email OTP verification and uploads progress to the formal account', async ({ page }) => {
    const gateway = await installAuthGateway(page);
    await gotoRoute(page, 'hub');
    await page.evaluate((store) => localStorage.setItem('ai-intro-quiz-v1', JSON.stringify(store)), progress);
    await page.getByTestId('auth-open-btn').click();
    await page.getByTestId('auth-guest-login-btn').click();
    await page.getByTestId('auth-guest-mode-btn').click();
    await page.getByTestId('auth-account-input').fill('upgraded@example.com');
    await page.getByTestId('auth-nickname-input').fill('升级学员');
    await page.getByTestId('auth-password-input').fill('upgrade888');
    await page.getByTestId('auth-submit-btn').click();

    await expect(page.getByTestId('auth-notice')).toContainText('验证码已发送至 upgraded@example.com');
    await expect(page.getByTestId('auth-otp-input')).toBeVisible();
    await page.getByTestId('auth-otp-input').fill('123456');
    await page.getByTestId('auth-submit-btn').click();

    await expect(page.getByTestId('auth-modal')).toBeHidden();
    await expect(page.getByTestId('auth-sync-status')).toHaveText('游客数据已同步');
    expect(gateway.imports[0]).toMatchObject({
      ownerId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      progress: [{ bankId: 'builtin-ai-intro', store: progress }],
    });
    await page.getByTestId('user-menu-trigger').click();
    await expect(page.getByTestId('user-menu-bound-account')).toHaveText('upgraded@example.com');
    await assertFullLayoutAudit(page);
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

  const otherTab = await page.context().newPage();
  await gotoRoute(otherTab, 'hub');
  await expect(otherTab.getByTestId('auth-guest-mode-btn')).toBeVisible();
  await otherTab.evaluate(() => localStorage.removeItem('quizhub-v2:guest'));
  await expect(page.getByTestId('auth-open-btn')).toBeVisible();
});
