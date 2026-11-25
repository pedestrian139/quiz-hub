import { useEffect, useRef, useState } from 'react';
import { logout } from '../../services/authService';
import { AuthIcon } from './AuthIcons';
import { openAuthModal, useAuthUiState } from './authState';
import './Auth.css';

export function UserMenu() {
  const { user } = useAuthUiState();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user || user.isGuest) {
      setMenuOpen(false);
    }
  }, [user]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const handleSwitchAccount = () => {
    setMenuOpen(false);
    openAuthModal('login');
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
  };

  const avatarInitial = user?.nickname ? user.nickname.slice(0, 1).toUpperCase() : 'U';
  const boundAccountLabel = user?.accountType === 'phone' ? '已绑手机' : '已绑邮箱';
  const boundAccountValue = user?.phone ?? user?.email ?? '';

  return (
    <div className="auth-bar" role="region" aria-label="账户与云端同步状态">
      <div className="auth-bar__inner">
        {user === null && (
          <>
            <div className="auth-bar__status">
              <span className="auth-bar__dot" aria-hidden="true" />
              <span>本地刷题模式 · 登录后可云端同步进度</span>
            </div>
            <div className="auth-bar__actions">
              <button
                type="button"
                className="auth-btn auth-btn--primary"
                data-testid="auth-open-btn"
                onClick={() => openAuthModal('login')}
              >
                <AuthIcon name="user" size={14} />
                <span>登录 / 注册</span>
              </button>
            </div>
          </>
        )}

        {user !== null && user.isGuest && (
          <>
            <div className="auth-bar__status">
              <span className="auth-bar__dot auth-bar__dot--guest" aria-hidden="true" />
              <span>游客试用中 · 可随时绑定账号保存进度</span>
            </div>
            <div className="auth-bar__actions">
              <button
                type="button"
                className="auth-guest-pill"
                data-testid="auth-guest-mode-btn"
                onClick={() => openAuthModal('upgrade')}
              >
                <AuthIcon name="shield" size={14} />
                <span className="auth-guest-pill__tag">游客模式</span>
                <span className="auth-guest-pill__cta">点击绑定账号保存云端进度</span>
              </button>
            </div>
          </>
        )}

        {user !== null && !user.isGuest && (
          <>
            <div className="auth-bar__status">
              <span className="auth-bar__dot auth-bar__dot--ready" aria-hidden="true" />
              <span>账号已登录 · 云端进度已关联</span>
            </div>
            <div className="auth-bar__actions">
              <div className="auth-user-menu" ref={menuRef}>
                <button
                  type="button"
                  className="auth-user-trigger"
                  data-testid="user-menu-trigger"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => setMenuOpen((prev) => !prev)}
                >
                  <span className="auth-avatar" aria-hidden="true">
                    {avatarInitial}
                  </span>
                  <span className="auth-user-trigger__name">{user.nickname}</span>
                  <AuthIcon name="chevronDown" size={15} />
                </button>

                {menuOpen && (
                  <div
                    className="auth-dropdown"
                    role="menu"
                    aria-label="个人账户菜单"
                    data-testid="user-menu-popover"
                  >
                    <div className="auth-dropdown__profile">
                      <div className="auth-dropdown__nick">{user.nickname}</div>
                      <div className="auth-dropdown__account-row">
                        <span className="auth-dropdown__badge">{boundAccountLabel}</span>
                        <span data-testid="user-menu-bound-account">{boundAccountValue}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      className="auth-dropdown__item"
                      data-testid="auth-switch-account-btn"
                      onClick={handleSwitchAccount}
                    >
                      <AuthIcon name="switchUser" size={15} />
                      <span>切换账号</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="auth-dropdown__item auth-dropdown__item--danger"
                      data-testid="auth-logout-btn"
                      onClick={handleLogout}
                    >
                      <AuthIcon name="logOut" size={15} />
                      <span>退出登录</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
