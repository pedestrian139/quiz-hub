import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  detectAccountInput,
  isAuthConfigured,
  loginAsGuest,
  loginWithAccount,
  registerWithAccount,
  resendSignupOtp,
  sendLoginOtp,
  upgradeGuestToAccount,
  validateEmailOtp,
  validatePassword,
  verifyEmailOtp,
} from '../../services/authService';
import type { CurrentUser } from '../../services/authService';
import { AuthIcon } from './AuthIcons';
import { applyAuthResult, closeAuthModal, refreshAuthIdentity, setAuthModalMode, useAuthUiState } from './authState';
import type { AuthModalMode } from './authState';
import { useDialogFocus } from './useDialogFocus';
import './Auth.css';

export interface AuthModalProps {
  open?: boolean;
  initialMode?: AuthModalMode;
  onClose?: () => void;
  onAuthSuccess?: (user: CurrentUser) => void;
}

type LoginMethod = 'password' | 'otp';

const OTP_COOLDOWN_SECONDS = 60;

const MODE_COPY: Record<AuthModalMode, { title: string; description: string; submit: string }> = {
  login: { title: '登录 QuizHub', description: '支持邮箱密码登录或邮箱验证码登录。', submit: '登录' },
  register: { title: '注册 QuizHub 账号', description: '使用邮箱与密码注册，并通过邮箱验证码完成激活。', submit: '发送验证码' },
  upgrade: { title: '绑定邮箱保存云端进度', description: '使用邮箱验证码注册后，将此浏览器的游客数据同步到账号。', submit: '发送验证码并绑定' },
  'guest-login': { title: '登录已有账号并同步进度', description: '登录成功后将同步此浏览器的游客数据。', submit: '登录并同步' },
};

function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(error: unknown): string {
  const code = errorCodeOf(error);
  const rawMessage = error instanceof Error ? error.message : '';
  if (code === 'invalid_credentials') return '邮箱或密码不正确。';
  if (code === 'email_not_confirmed') return '该邮箱尚未完成验证码激活，请先验证邮箱。';
  if (code === 'otp_expired' || /token.*(expired|invalid)/i.test(rawMessage)) {
    return '验证码无效或已过期，请核对或重新获取。';
  }
  if (code === 'otp_disabled' || code === 'signup_disabled') {
    return '该邮箱尚未注册，请先切换到「注册」创建账号。';
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return '验证码发送过于频繁，请稍后再试。';
  }
  if (code === 'user_already_exists' || code === 'email_exists') {
    return '该邮箱已注册，请直接登录。';
  }
  return error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '操作失败，请稍后再试。';
}

export function AuthModal({ open: controlledOpen, initialMode, onClose, onAuthSuccess }: AuthModalProps = {}) {
  const ui = useAuthUiState();
  const isOpen = controlledOpen ?? ui.isOpen;
  const [modeOverride, setModeOverride] = useState<AuthModalMode | null>(null);
  const mode = controlledOpen === undefined ? ui.mode : modeOverride ?? initialMode ?? 'login';
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [account, setAccount] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [accountTouched, setAccountTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [otpTouched, setOtpTouched] = useState(false);
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const otpInputRef = useRef<HTMLInputElement | null>(null);

  const busy = submitting || sendingOtp;
  const close = () => { if (!busy) (onClose ?? closeAuthModal)(); };
  const dialogRef = useDialogFocus(isOpen, close);

  useEffect(() => {
    if (isOpen) return;
    setModeOverride(null);
    setLoginMethod('password');
    setAccount('');
    setNickname('');
    setPassword('');
    setShowPassword(false);
    setOtpCode('');
    setAccountTouched(false);
    setPasswordTouched(false);
    setOtpTouched(false);
    setPendingVerifyEmail(null);
    setUnconfirmedEmail(null);
    setOtpCooldown(0);
    setSendingOtp(false);
    setSubmitError(null);
    setNotice(null);
  }, [isOpen]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setOtpCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [otpCooldown]);

  useEffect(() => {
    if (pendingVerifyEmail) {
      otpInputRef.current?.focus();
    }
  }, [pendingVerifyEmail]);

  if (!isOpen || typeof document === 'undefined') return null;

  const configured = isAuthConfigured();
  const isLoginFlow = mode === 'login' || mode === 'guest-login';
  const creating = !pendingVerifyEmail && (mode === 'register' || mode === 'upgrade');
  const upgrading = mode === 'upgrade' || mode === 'guest-login';
  const showOtpField = Boolean(pendingVerifyEmail) || (isLoginFlow && loginMethod === 'otp');
  const showPasswordField = !pendingVerifyEmail && (creating || (isLoginFlow && loginMethod === 'password'));

  const detection = detectAccountInput(account);
  const passwordCheck = validatePassword(password, creating);
  const otpCheck = validateEmailOtp(otpCode);
  const accountError = accountTouched && !detection.valid ? detection.message : undefined;
  const passwordError = passwordTouched && !passwordCheck.valid ? passwordCheck.message : undefined;
  const otpError = otpTouched && !otpCheck.valid ? otpCheck.message : undefined;
  const copy = MODE_COPY[mode];

  function changeMode(nextMode: AuthModalMode): void {
    if (controlledOpen === undefined) setAuthModalMode(nextMode);
    else setModeOverride(nextMode);
    setPassword('');
    setShowPassword(false);
    setPasswordTouched(false);
    setOtpCode('');
    setOtpTouched(false);
    setPendingVerifyEmail(null);
    setUnconfirmedEmail(null);
    setOtpCooldown(0);
    setSubmitError(null);
    setNotice(null);
  }

  function changeLoginMethod(nextMethod: LoginMethod): void {
    if (loginMethod === nextMethod) return;
    setLoginMethod(nextMethod);
    setPassword('');
    setShowPassword(false);
    setPasswordTouched(false);
    setOtpCode('');
    setOtpTouched(false);
    setUnconfirmedEmail(null);
    setSubmitError(null);
    setNotice(null);
  }

  async function handleSendOtp(): Promise<void> {
    if (busy || !configured || otpCooldown > 0) return;
    setSubmitError(null);
    setNotice(null);

    if (pendingVerifyEmail) {
      setSendingOtp(true);
      try {
        await resendSignupOtp({ account: pendingVerifyEmail });
        setOtpCooldown(OTP_COOLDOWN_SECONDS);
        setNotice(`验证码已重新发送至 ${pendingVerifyEmail}，请查收邮件。`);
        otpInputRef.current?.focus();
      } catch (error) {
        setSubmitError(errorMessage(error));
      } finally {
        setSendingOtp(false);
      }
      return;
    }

    setAccountTouched(true);
    if (!detection.valid) return;
    setSendingOtp(true);
    try {
      await sendLoginOtp({ account });
      setOtpCooldown(OTP_COOLDOWN_SECONDS);
      setNotice(`验证码已发送至 ${detection.normalized}，请查收邮件。`);
      otpInputRef.current?.focus();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleGoActivateUnconfirmed(): Promise<void> {
    if (busy || !configured || !unconfirmedEmail) return;
    setSubmitError(null);
    setNotice(null);
    setSendingOtp(true);
    try {
      await resendSignupOtp({ account: unconfirmedEmail });
      const targetEmail = unconfirmedEmail;
      setPendingVerifyEmail(targetEmail);
      setUnconfirmedEmail(null);
      setPassword('');
      setPasswordTouched(false);
      setOtpCode('');
      setOtpTouched(false);
      setOtpCooldown(OTP_COOLDOWN_SECONDS);
      setNotice(`激活验证码已发送至 ${targetEmail}，请输入邮件中的 6–8 位验证码。`);
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !configured) return;
    setSubmitError(null);
    setUnconfirmedEmail(null);

    if (pendingVerifyEmail) {
      setOtpTouched(true);
      if (!otpCheck.valid) return;
      setSubmitting(true);
      try {
        const result = await verifyEmailOtp({
          account: pendingVerifyEmail,
          code: otpCode,
          importGuestData: mode === 'guest-login',
        });
        await applyAuthResult(result);
        onAuthSuccess?.(result.user);
        (onClose ?? closeAuthModal)();
      } catch (error) {
        setSubmitError(errorMessage(error));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (isLoginFlow && loginMethod === 'otp') {
      setAccountTouched(true);
      setOtpTouched(true);
      if (!detection.valid || !otpCheck.valid) return;
      setSubmitting(true);
      try {
        const result = await verifyEmailOtp({
          account,
          code: otpCode,
          importGuestData: mode === 'guest-login',
        });
        await applyAuthResult(result);
        onAuthSuccess?.(result.user);
        (onClose ?? closeAuthModal)();
      } catch (error) {
        setSubmitError(errorMessage(error));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setAccountTouched(true);
    setPasswordTouched(true);
    if (!detection.valid || !passwordCheck.valid) return;
    if (mode === 'register' && !nickname.trim()) {
      setSubmitError('请输入昵称。');
      return;
    }

    setSubmitting(true);
    try {
      const result = mode === 'register'
        ? await registerWithAccount({ account, password, nickname })
        : mode === 'upgrade'
          ? await upgradeGuestToAccount({ account, password, nickname })
          : await loginWithAccount({ account, password, importGuestData: mode === 'guest-login' });

      if (!result.user) {
        setPendingVerifyEmail(detection.normalized);
        setOtpCode('');
        setOtpTouched(false);
        setOtpCooldown(OTP_COOLDOWN_SECONDS);
        setNotice(`验证码已发送至 ${detection.normalized}，请输入邮件中的 6–8 位验证码完成${mode === 'upgrade' ? '绑定' : '注册'}。`);
        return;
      }
      await applyAuthResult(result);
      onAuthSuccess?.(result.user);
      (onClose ?? closeAuthModal)();
    } catch (error) {
      if (isLoginFlow && errorCodeOf(error) === 'email_not_confirmed' && detection.valid) {
        setUnconfirmedEmail(detection.normalized);
      }
      setSubmitError(errorMessage(error));
    } finally {
      setPassword('');
      setShowPassword(false);
      setPasswordTouched(false);
      setSubmitting(false);
    }
  }

  async function handleGuestLogin(): Promise<void> {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const user = await loginAsGuest();
      await refreshAuthIdentity();
      onAuthSuccess?.(user);
      (onClose ?? closeAuthModal)();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = pendingVerifyEmail
    ? (mode === 'upgrade' ? '验证并同步进度' : isLoginFlow ? '验证并登录' : '验证并完成注册')
    : isLoginFlow && loginMethod === 'otp'
      ? (mode === 'guest-login' ? '验证并同步' : '验证码登录')
      : copy.submit;

  return createPortal(
    <div
      className="auth-modal-backdrop"
      data-testid="auth-modal-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        data-testid="auth-modal"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="auth-modal__header">
          <div className="auth-modal__title-wrap">
            <h2 id="auth-modal-title" className="auth-modal__title">
              <AuthIcon name={upgrading ? 'shield' : 'user'} size={19} />
              <span>{copy.title}</span>
            </h2>
            <p className="auth-modal__sub">{copy.description}</p>
          </div>
          <button
            type="button"
            className="auth-modal__close"
            data-testid="auth-modal-close"
            aria-label="关闭登录弹窗"
            onClick={close}
            disabled={busy}
          >
            <AuthIcon name="x" size={18} />
          </button>
        </div>

        <div className="auth-modal__body" aria-busy={busy}>
          {!configured && (
            <p className="auth-alert" role="status" data-testid="auth-unavailable">
              账号服务尚未配置，仍可在本机刷题。
            </p>
          )}
          {configured && !upgrading && (
            <div className="auth-tabs" role="tablist" aria-label="登录或注册模式切换">
              {(['login', 'register'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={mode === tab}
                  data-testid={`auth-tab-${tab}`}
                  className={`auth-tab${mode === tab ? ' is-active' : ''}`}
                  onClick={() => changeMode(tab)}
                  disabled={busy}
                >
                  {tab === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>
          )}

          {notice && <p className="auth-notice" role="status" data-testid="auth-notice">{notice}</p>}

          {configured && (
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              {!pendingVerifyEmail && isLoginFlow && (
                <div className="auth-method-switch" role="group" aria-label="登录方式切换">
                  <button
                    type="button"
                    data-testid="auth-login-method-password"
                    className={`auth-method-btn${loginMethod === 'password' ? ' is-active' : ''}`}
                    onClick={() => changeLoginMethod('password')}
                    disabled={busy}
                    aria-pressed={loginMethod === 'password'}
                  >
                    密码登录
                  </button>
                  <button
                    type="button"
                    data-testid="auth-login-method-otp"
                    className={`auth-method-btn${loginMethod === 'otp' ? ' is-active' : ''}`}
                    onClick={() => changeLoginMethod('otp')}
                    disabled={busy}
                    aria-pressed={loginMethod === 'otp'}
                  >
                    验证码登录
                  </button>
                </div>
              )}

              {pendingVerifyEmail ? (
                <div className="auth-verify-banner" data-testid="auth-verify-banner">
                  <div className="auth-verify-banner__info">
                    <span className="auth-verify-banner__label">待验证邮箱</span>
                    <span className="auth-verify-banner__email">{pendingVerifyEmail}</span>
                  </div>
                  <button
                    type="button"
                    className="auth-link-btn"
                    data-testid="auth-back-to-form-btn"
                    disabled={busy}
                    onClick={() => {
                      setPendingVerifyEmail(null);
                      setOtpCode('');
                      setOtpTouched(false);
                      setSubmitError(null);
                      setNotice(null);
                    }}
                  >
                    修改邮箱或信息
                  </button>
                </div>
              ) : (
                <div className="auth-field">
                  <div className="auth-field__head">
                    <label className="auth-field__label" htmlFor="auth-account-input">邮箱</label>
                    <span
                      className={`auth-type-badge${detection.valid ? ' auth-type-badge--valid' : ''}`}
                      data-testid="auth-account-type-badge"
                    >
                      邮箱
                    </span>
                  </div>
                  <input
                    id="auth-account-input"
                    data-testid="auth-account-input"
                    data-dialog-initial-focus
                    type="email"
                    className={`auth-input${accountError ? ' auth-input--error' : ''}`}
                    autoComplete="email"
                    autoCapitalize="none"
                    inputMode="email"
                    placeholder="name@example.com"
                    value={account}
                    disabled={busy}
                    onChange={(event) => {
                      setAccount(event.target.value);
                      setUnconfirmedEmail(null);
                      setSubmitError(null);
                    }}
                    onBlur={() => setAccountTouched(true)}
                    aria-invalid={Boolean(accountError)}
                    aria-describedby={accountError ? 'auth-account-error' : undefined}
                  />
                  {accountError && (
                    <span id="auth-account-error" className="auth-field__error" role="alert" data-testid="auth-account-error">
                      {accountError}
                    </span>
                  )}
                </div>
              )}

              {creating && (
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="auth-nickname-input">
                    {mode === 'upgrade' ? '昵称（选填）' : '昵称'}
                  </label>
                  <input
                    id="auth-nickname-input"
                    data-testid="auth-nickname-input"
                    className="auth-input"
                    autoComplete="nickname"
                    maxLength={80}
                    placeholder={mode === 'upgrade' ? '默认：刷题用户' : '怎么称呼你'}
                    value={nickname}
                    disabled={busy}
                    onChange={(event) => setNickname(event.target.value)}
                  />
                </div>
              )}

              {showPasswordField && (
                <div className="auth-field">
                  <div className="auth-field__head">
                    <label className="auth-field__label" htmlFor="auth-password-input">密码</label>
                    {creating && <span className="auth-field__hint">至少 8 个字符</span>}
                  </div>
                  <div className="auth-password-group">
                    <input
                      id="auth-password-input"
                      data-testid="auth-password-input"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={creating ? 'new-password' : 'current-password'}
                      className={`auth-input${passwordError ? ' auth-input--error' : ''}`}
                      value={password}
                      disabled={busy}
                      onChange={(event) => { setPassword(event.target.value); setSubmitError(null); }}
                      onBlur={() => setPasswordTouched(true)}
                      aria-invalid={Boolean(passwordError)}
                      aria-describedby={passwordError ? 'auth-password-error' : undefined}
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      data-testid="auth-toggle-password"
                      disabled={busy}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((previous) => !previous)}
                    >
                      <AuthIcon name={showPassword ? 'eyeOff' : 'eye'} size={15} />
                      <span>{showPassword ? '隐藏' : '显示'}</span>
                    </button>
                  </div>
                  {passwordError && (
                    <span id="auth-password-error" className="auth-field__error" role="alert" data-testid="auth-password-error">
                      {passwordError}
                    </span>
                  )}
                </div>
              )}

              {showOtpField && (
                <div className="auth-field">
                  <div className="auth-field__head">
                    <label className="auth-field__label" htmlFor="auth-otp-input">邮箱验证码</label>
                    <span className="auth-field__hint">查收邮件中的 6–8 位数字验证码</span>
                  </div>
                  <div className="auth-otp-group">
                    <input
                      ref={otpInputRef}
                      id="auth-otp-input"
                      data-testid="auth-otp-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                      placeholder="输入 6–8 位验证码"
                      className={`auth-input auth-otp-input${otpError ? ' auth-input--error' : ''}`}
                      value={otpCode}
                      disabled={busy}
                      onChange={(event) => { setOtpCode(event.target.value); setSubmitError(null); }}
                      onBlur={() => setOtpTouched(true)}
                      aria-invalid={Boolean(otpError)}
                      aria-describedby={otpError ? 'auth-otp-error' : undefined}
                    />
                    <button
                      type="button"
                      className="auth-otp-send-btn"
                      data-testid="auth-send-otp-btn"
                      disabled={busy || otpCooldown > 0}
                      onClick={() => { void handleSendOtp(); }}
                    >
                      {sendingOtp ? '发送中…' : otpCooldown > 0 ? `${otpCooldown}s 后重发` : pendingVerifyEmail ? '重新发送' : '获取验证码'}
                    </button>
                  </div>
                  {otpError && (
                    <span id="auth-otp-error" className="auth-field__error" role="alert" data-testid="auth-otp-error">
                      {otpError}
                    </span>
                  )}
                </div>
              )}

              {submitError && (
                <div className="auth-alert" role="alert" data-testid="auth-error">
                  <span>{submitError}</span>
                </div>
              )}

              {unconfirmedEmail && !pendingVerifyEmail && (
                <div className="auth-link-row">
                  <button
                    type="button"
                    className="auth-link-btn"
                    data-testid="auth-go-verify-btn"
                    disabled={busy}
                    onClick={() => { void handleGoActivateUnconfirmed(); }}
                  >
                    发送验证码激活此邮箱
                  </button>
                </div>
              )}

              <button type="submit" className="auth-submit" data-testid="auth-submit-btn" disabled={busy}>
                {submitting ? '处理中…' : submitLabel}
              </button>
            </form>
          )}

          {!configured && submitError && <div className="auth-alert" role="alert" data-testid="auth-error">{submitError}</div>}
          {!upgrading && !pendingVerifyEmail && (
            <button
              type="button"
              className="auth-guest-cta"
              data-testid="auth-guest-login-btn"
              disabled={busy}
              onClick={handleGuestLogin}
            >
              <span className="auth-guest-cta__title"><AuthIcon name="sparkles" size={15} />游客免注册体验</span>
              <span className="auth-guest-cta__sub">刷题进度保存在当前浏览器</span>
            </button>
          )}
          {configured && upgrading && !pendingVerifyEmail && (
            <div className="auth-link-row">
              <button
                type="button"
                className="auth-link-btn"
                data-testid="auth-upgrade-to-login"
                disabled={busy}
                onClick={() => changeMode(mode === 'upgrade' ? 'guest-login' : 'upgrade')}
              >
                {mode === 'upgrade' ? '已有正式账号？登录并同步' : '注册新账号并同步'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
