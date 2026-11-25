import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  detectAccountInput, isAuthConfigured, linkAccount, loginAsGuest, loginWithAccount,
  registerWithAccount, upgradeGuestToAccount, validatePassword,
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

const MODE_COPY: Record<AuthModalMode, { title: string; description: string; submit: string }> = {
  login: { title: '登录 QuizHub', description: '使用已注册的手机号或邮箱登录。', submit: '登录' },
  register: { title: '注册 QuizHub 账号', description: '使用手机号或邮箱注册。', submit: '注册' },
  upgrade: { title: '绑定账号保存云端进度', description: '注册后将此浏览器的游客数据同步到账号。', submit: '注册并同步' },
  'guest-login': { title: '登录已有账号并同步进度', description: '登录成功后同步此浏览器的游客数据。', submit: '登录并同步' },
};

function errorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'invalid_credentials') return '账号或密码不正确。';
  if (code === 'email_not_confirmed') return '请先通过邮件验证邮箱。';
  return error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '操作失败，请稍后再试。';
}

export function AuthModal({ open: controlledOpen, initialMode, onClose, onAuthSuccess }: AuthModalProps = {}) {
  const ui = useAuthUiState();
  const isOpen = controlledOpen ?? ui.isOpen;
  const [modeOverride, setModeOverride] = useState<AuthModalMode | null>(null);
  const mode = controlledOpen === undefined ? ui.mode : modeOverride ?? initialMode ?? 'login';
  const [account, setAccount] = useState('');
  const [nickname, setNickname] = useState('');
  const [secondaryAccount, setSecondaryAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accountTouched, setAccountTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [retryAccount, setRetryAccount] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const close = () => { if (!submitting) (onClose ?? closeAuthModal)(); };
  const dialogRef = useDialogFocus(isOpen, close);

  useEffect(() => {
    if (isOpen) return;
    setModeOverride(null);
    setAccount('');
    setNickname('');
    setSecondaryAccount('');
    setPassword('');
    setShowPassword(false);
    setAccountTouched(false);
    setPasswordTouched(false);
    setSubmitError(null);
    setNotice(null);
    setVerificationSent(false);
    setRetryAccount(null);
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  const configured = isAuthConfigured();
  const creating = !retryAccount && (mode === 'register' || mode === 'upgrade');
  const upgrading = mode === 'upgrade' || mode === 'guest-login';
  const detection = detectAccountInput(account);
  const passwordCheck = validatePassword(password, creating);
  const accountError = accountTouched && !detection.valid ? detection.message : undefined;
  const passwordError = passwordTouched && !passwordCheck.valid ? passwordCheck.message : undefined;
  const copy = MODE_COPY[mode];

  function changeMode(nextMode: AuthModalMode): void {
    if (controlledOpen === undefined) setAuthModalMode(nextMode);
    else setModeOverride(nextMode);
    setPassword('');
    setShowPassword(false);
    setPasswordTouched(false);
    setSubmitError(null);
    setNotice(null);
    setVerificationSent(false);
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting || !configured || verificationSent) return;
    setSubmitError(null);
    setAccountTouched(true);
    setPasswordTouched(true);
    if ((!retryAccount && !detection.valid) || !passwordCheck.valid) return;
    if (mode === 'register' && creating && !nickname.trim()) {
      setSubmitError('请输入昵称。');
      return;
    }

    const alternate = secondaryAccount.trim();
    if (creating && alternate) {
      const secondary = detectAccountInput(alternate);
      if (!secondary.valid || secondary.kind === detection.kind) {
        setSubmitError('同时绑定时，请提供一个手机号和一个邮箱。');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (retryAccount) {
        const link = await linkAccount({ account: retryAccount, password });
        await refreshAuthIdentity();
        setRetryAccount(null);
        setPassword('');
        setVerificationSent(true);
        setNotice(link.status === 'email_confirmation_required' ? '验证邮件已发送，请查收。' : '第二种登录方式已绑定。');
        return;
      }

      const credentials = { account, password, secondaryAccount: alternate || undefined };
      const result = mode === 'register' ? await registerWithAccount({ ...credentials, nickname })
        : mode === 'upgrade' ? await upgradeGuestToAccount(credentials)
          : await loginWithAccount({ account, password, importGuestData: mode === 'guest-login' });

      if (!result.user) {
        setVerificationSent(true);
        setNotice('验证邮件已发送。确认邮箱后可登录。');
        return;
      }
      await applyAuthResult(result);
      onAuthSuccess?.(result.user);
      if (result.failedSecondaryAccount) {
        setRetryAccount(result.failedSecondaryAccount);
        setNotice('账号已登录。第二种登录方式绑定失败，可在这里重试。');
        return;
      }
      if (result.pendingEmail) {
        setVerificationSent(true);
        setNotice('账号已登录。请查收验证邮件完成邮箱绑定。');
        return;
      }
      (onClose ?? closeAuthModal)();
    } catch (error) {
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

  return createPortal(
    <div className="auth-modal-backdrop" data-testid="auth-modal-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} tabIndex={-1} className="auth-modal" role="dialog" aria-modal="true"
        aria-labelledby="auth-modal-title" data-testid="auth-modal" onKeyDown={(event) => event.stopPropagation()}>
        <div className="auth-modal__header">
          <div className="auth-modal__title-wrap">
            <h2 id="auth-modal-title" className="auth-modal__title">
              <AuthIcon name={upgrading ? 'shield' : 'user'} size={19} />
              <span>{copy.title}</span>
            </h2>
            <p className="auth-modal__sub">{copy.description}</p>
          </div>
          <button type="button" className="auth-modal__close" data-testid="auth-modal-close"
            aria-label="关闭登录弹窗" onClick={close} disabled={submitting}>
            <AuthIcon name="x" size={18} />
          </button>
        </div>

        <div className="auth-modal__body" aria-busy={submitting}>
          {!configured && <p className="auth-alert" role="status" data-testid="auth-unavailable">账号服务尚未配置，仍可在本机刷题。</p>}
          {configured && !upgrading && !retryAccount && (
            <div className="auth-tabs" role="tablist" aria-label="登录或注册模式切换">
              {(['login', 'register'] as const).map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={mode === tab}
                  data-testid={`auth-tab-${tab}`} className={`auth-tab${mode === tab ? ' is-active' : ''}`}
                  onClick={() => changeMode(tab)} disabled={submitting}>
                  {tab === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>
          )}

          {notice && <p className="auth-notice" role="status" data-testid="auth-notice">{notice}</p>}
          {configured && !verificationSent && (
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              {retryAccount ? <p className="auth-modal__sub">待绑定账号 {retryAccount}</p> : (
                <div className="auth-field">
                  <div className="auth-field__head">
                    <label className="auth-field__label" htmlFor="auth-account-input">手机号或邮箱</label>
                    <span className={`auth-type-badge${detection.valid ? ' auth-type-badge--valid' : ''}`} data-testid="auth-account-type-badge">
                      {detection.kind === 'phone' ? '手机号' : detection.kind === 'email' ? '邮箱' : '手机号 / 邮箱'}
                    </span>
                  </div>
                  <input id="auth-account-input" data-testid="auth-account-input" data-dialog-initial-focus
                    className={`auth-input${accountError ? ' auth-input--error' : ''}`} autoComplete="username"
                    autoCapitalize="none" inputMode="email" value={account} disabled={submitting}
                    onChange={(event) => { setAccount(event.target.value); setSubmitError(null); }}
                    onBlur={() => setAccountTouched(true)} aria-invalid={Boolean(accountError)}
                    aria-describedby={accountError ? 'auth-account-error' : undefined} />
                  {accountError && <span id="auth-account-error" className="auth-field__error" role="alert" data-testid="auth-account-error">{accountError}</span>}
                </div>
              )}

              {creating && mode === 'register' && (
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="auth-nickname-input">昵称</label>
                  <input id="auth-nickname-input" data-testid="auth-nickname-input" className="auth-input"
                    autoComplete="nickname" maxLength={80} value={nickname} disabled={submitting}
                    onChange={(event) => setNickname(event.target.value)} />
                </div>
              )}
              {creating && (
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="auth-secondary-input">同时绑定另一个手机号或邮箱（选填）</label>
                  <input id="auth-secondary-input" data-testid="auth-secondary-input" className="auth-input" inputMode="email"
                    autoCapitalize="none" value={secondaryAccount} disabled={submitting}
                    onChange={(event) => setSecondaryAccount(event.target.value)} />
                </div>
              )}

              <div className="auth-field">
                <div className="auth-field__head">
                  <label className="auth-field__label" htmlFor="auth-password-input">密码</label>
                  {creating && <span className="auth-field__hint">至少 8 个字符</span>}
                </div>
                <div className="auth-password-group">
                  <input id="auth-password-input" data-testid="auth-password-input" type={showPassword ? 'text' : 'password'}
                    autoComplete={creating ? 'new-password' : 'current-password'}
                    className={`auth-input${passwordError ? ' auth-input--error' : ''}`} value={password} disabled={submitting}
                    onChange={(event) => { setPassword(event.target.value); setSubmitError(null); }}
                    onBlur={() => setPasswordTouched(true)} aria-invalid={Boolean(passwordError)}
                    aria-describedby={passwordError ? 'auth-password-error' : undefined} />
                  <button type="button" className="auth-password-toggle" data-testid="auth-toggle-password" disabled={submitting}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword}
                    onClick={() => setShowPassword((previous) => !previous)}>
                    <AuthIcon name={showPassword ? 'eyeOff' : 'eye'} size={15} />
                    <span>{showPassword ? '隐藏' : '显示'}</span>
                  </button>
                </div>
                {passwordError && <span id="auth-password-error" className="auth-field__error" role="alert" data-testid="auth-password-error">{passwordError}</span>}
              </div>
              {submitError && <div className="auth-alert" role="alert" data-testid="auth-error">{submitError}</div>}
              <button type="submit" className="auth-submit" data-testid="auth-submit-btn" disabled={submitting}>
                {submitting ? '处理中…' : retryAccount ? '重试绑定' : copy.submit}
              </button>
            </form>
          )}

          {!configured && submitError && <div className="auth-alert" role="alert" data-testid="auth-error">{submitError}</div>}
          {!upgrading && !retryAccount && !verificationSent && (
            <button type="button" className="auth-guest-cta" data-testid="auth-guest-login-btn"
              disabled={submitting} onClick={handleGuestLogin}>
              <span className="auth-guest-cta__title"><AuthIcon name="sparkles" size={15} />游客免注册体验</span>
              <span className="auth-guest-cta__sub">刷题进度保存在当前浏览器</span>
            </button>
          )}
          {configured && upgrading && !retryAccount && (
            <div className="auth-link-row">
              <button type="button" className="auth-link-btn" data-testid="auth-upgrade-to-login" disabled={submitting}
                onClick={() => changeMode(mode === 'upgrade' ? 'guest-login' : 'upgrade')}>
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
