import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  detectAccountInput,
  loginAsGuest,
  loginWithAccount,
  registerWithAccount,
  upgradeGuestToAccount,
  validatePassword,
  type AuthUser,
} from '../../services/authService';
import { AuthIcon } from './AuthIcons';
import {
  closeAuthModal,
  setAuthModalMode,
  useAuthUiState,
  type AuthModalMode,
} from './authState';
import './Auth.css';

export interface AuthModalProps {
  open?: boolean;
  initialMode?: AuthModalMode;
  onClose?: () => void;
  onAuthSuccess?: (user: AuthUser) => void;
}

export function AuthModal({
  open: controlledOpen,
  initialMode,
  onClose: controlledOnClose,
  onAuthSuccess,
}: AuthModalProps = {}) {
  const uiState = useAuthUiState();
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uiState.isOpen;

  const [localMode, setLocalMode] = useState<AuthModalMode>(initialMode ?? 'login');
  const mode = isControlled ? localMode : uiState.mode;

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accountTouched, setAccountTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleClose = useCallback(() => {
    if (controlledOnClose) {
      controlledOnClose();
      return;
    }
    closeAuthModal();
  }, [controlledOnClose]);

  const handleModeChange = useCallback(
    (nextMode: AuthModalMode) => {
      if (isControlled) {
        setLocalMode(nextMode);
      } else {
        setAuthModalMode(nextMode);
      }
      setPassword('');
      setShowPassword(false);
      setPasswordTouched(false);
      setSubmitError(null);
    },
    [isControlled],
  );

  useEffect(() => {
    if (!isOpen) return;
    if (isControlled && initialMode) {
      setLocalMode(initialMode);
    }
    setPassword('');
    setShowPassword(false);
    setAccountTouched(false);
    setPasswordTouched(false);
    setSubmitError(null);
    setSubmitting(false);
  }, [initialMode, isControlled, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (!target || !target.closest('input, textarea, select')) {
        if (
          ['ArrowLeft', 'ArrowRight', ' ', 't', 'T', 'f', 'F'].includes(e.key) ||
          /^[1-9a-iA-I]$/.test(e.key)
        ) {
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => window.removeEventListener('keydown', onKeyDownCapture, true);
  }, [handleClose, isOpen]);

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  const detection = detectAccountInput(account);
  const requireMinPwdLength = mode === 'register' || mode === 'upgrade';
  const passwordCheck = validatePassword(password, requireMinPwdLength);

  const accountError = accountTouched && !detection.valid ? detection.message ?? null : null;
  const passwordError = passwordTouched && !passwordCheck.valid ? passwordCheck.message ?? null : null;

  const badgeText = !account.trim()
    ? '支持手机号 / 邮箱'
    : detection.kind === 'phone'
      ? '手机号'
      : detection.kind === 'email'
        ? '邮箱'
        : '格式待确认';

  const badgeClassName = !account.trim()
    ? 'auth-type-badge'
    : detection.valid
      ? 'auth-type-badge auth-type-badge--valid'
      : accountTouched
        ? 'auth-type-badge auth-type-badge--invalid'
        : 'auth-type-badge';

  const modalTitle =
    mode === 'upgrade'
      ? '绑定账号保存云端进度'
      : mode === 'register'
        ? '注册 QuizHub 账号'
        : '登录 QuizHub';

  const modalSub =
    mode === 'upgrade'
      ? '绑定 11 位手机号或邮箱后，当前游客刷题进度将关联至正式账号'
      : mode === 'register'
        ? '使用手机号或邮箱注册，开启多端刷题进度同步'
        : '使用已注册的手机号或邮箱登录你的学习空间';

  const submitLabel = submitting
    ? '处理中...'
    : mode === 'upgrade'
      ? '确认绑定并保存进度'
      : mode === 'register'
        ? '注册并登录'
        : '登录';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAccountTouched(true);
    setPasswordTouched(true);
    setSubmitError(null);

    if (!detection.valid || !passwordCheck.valid) {
      return;
    }

    setSubmitting(true);
    try {
      const result =
        mode === 'register'
          ? await registerWithAccount({ account, password })
          : mode === 'upgrade'
            ? await upgradeGuestToAccount({ account, password })
            : await loginWithAccount({ account, password });

      if (!result.ok) {
        setSubmitError(result.message);
        return;
      }

      onAuthSuccess?.(result.user);
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuestLogin = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await loginAsGuest();
      if (!result.ok) {
        setSubmitError(result.message);
        return;
      }
      onAuthSuccess?.(result.user);
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="auth-modal-backdrop"
      data-testid="auth-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        data-testid="auth-modal"
      >
        <div className="auth-modal__header">
          <div className="auth-modal__title-wrap">
            <h2 id="auth-modal-title" className="auth-modal__title">
              <AuthIcon name={mode === 'upgrade' ? 'shield' : 'user'} size={19} />
              <span>{modalTitle}</span>
            </h2>
            <p className="auth-modal__sub">{modalSub}</p>
          </div>
          <button
            type="button"
            className="auth-modal__close"
            data-testid="auth-modal-close"
            aria-label="关闭登录弹窗"
            onClick={handleClose}
          >
            <AuthIcon name="x" size={18} />
          </button>
        </div>

        <div className="auth-modal__body">
          {mode !== 'upgrade' && (
            <div className="auth-tabs" role="tablist" aria-label="登录或注册模式切换">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                data-testid="auth-tab-login"
                className={`auth-tab${mode === 'login' ? ' is-active' : ''}`}
                onClick={() => handleModeChange('login')}
              >
                登录
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                data-testid="auth-tab-register"
                className={`auth-tab${mode === 'register' ? ' is-active' : ''}`}
                onClick={() => handleModeChange('register')}
              >
                注册
              </button>
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <div className="auth-field__head">
                <label className="auth-field__label" htmlFor="auth-account-input">
                  手机号或邮箱
                </label>
                <span className={badgeClassName} data-testid="auth-account-type-badge">
                  {detection.kind === 'phone' && <AuthIcon name="phone" size={12} />}
                  {detection.kind === 'email' && <AuthIcon name="mail" size={12} />}
                  <span>{badgeText}</span>
                </span>
              </div>
              <input
                id="auth-account-input"
                data-testid="auth-account-input"
                type="text"
                inputMode="email"
                autoComplete="username"
                className={`auth-input${accountError ? ' auth-input--error' : ''}`}
                placeholder="请输入 11 位手机号或邮箱地址"
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                  setSubmitError(null);
                }}
                onBlur={() => setAccountTouched(true)}
                onKeyDown={(e) => e.stopPropagation()}
                aria-invalid={accountError ? 'true' : 'false'}
              />
              {accountError && (
                <span className="auth-field__error" role="alert" data-testid="auth-account-error">
                  {accountError}
                </span>
              )}
            </div>

            <div className="auth-field">
              <div className="auth-field__head">
                <label className="auth-field__label" htmlFor="auth-password-input">
                  密码
                </label>
                {requireMinPwdLength && (
                  <span className="auth-field__hint">至少 6 位字符</span>
                )}
              </div>
              <div className="auth-password-group">
                <input
                  id="auth-password-input"
                  data-testid="auth-password-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className={`auth-input${passwordError ? ' auth-input--error' : ''}`}
                  placeholder={mode === 'login' ? '请输入密码' : '请设置至少 6 位密码'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setSubmitError(null);
                  }}
                  onBlur={() => setPasswordTouched(true)}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-invalid={passwordError ? 'true' : 'false'}
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  data-testid="auth-toggle-password"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  <AuthIcon name={showPassword ? 'eyeOff' : 'eye'} size={15} />
                  <span>{showPassword ? '隐藏' : '显示'}</span>
                </button>
              </div>
              {passwordError && (
                <span className="auth-field__error" role="alert" data-testid="auth-password-error">
                  {passwordError}
                </span>
              )}
            </div>

            {submitError && (
              <div className="auth-alert" role="alert" data-testid="auth-error">
                <AuthIcon name="alertCircle" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}

            <button
              type="submit"
              className="auth-submit"
              data-testid="auth-submit-btn"
              disabled={submitting}
            >
              {submitLabel}
            </button>
          </form>

          {mode !== 'upgrade' ? (
            <>
              <div className="auth-divider">或</div>
              <button
                type="button"
                className="auth-guest-cta"
                data-testid="auth-guest-login-btn"
                disabled={submitting}
                onClick={handleGuestLogin}
              >
                <span className="auth-guest-cta__title">
                  <AuthIcon name="sparkles" size={15} />
                  <span>游客免注册体验</span>
                </span>
                <span className="auth-guest-cta__sub">
                  无需账号立即刷题，后续可随时绑定保存进度
                </span>
              </button>
            </>
          ) : (
            <div className="auth-link-row">
              <button
                type="button"
                className="auth-link-btn"
                data-testid="auth-upgrade-to-login"
                onClick={() => handleModeChange('login')}
              >
                已有正式账号？直接登录切换
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
