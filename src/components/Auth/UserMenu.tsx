import { useEffect, useRef, useState } from 'react';
import { isAuthConfigured, logout, resumeGuestUpgrade, syncLocalData } from '../../services/authService';
import { hydrateAccountFromCloud, retryCloudSync, useCloudSyncState } from '../../services/cloudSync';
import { AuthIcon } from './AuthIcons';
import { openAuthModal, refreshAuthIdentity, useAuthUiState } from './authState';
import './Auth.css';

export function UserMenu() {
  const { user, migrationStatus } = useAuthUiState();
  const cloudSync = useCloudSyncState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAccountError(null);
    if (!user || user.isGuest) {
      setMenuOpen(false);
    }
  }, [user?.id, user?.isGuest]);

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
    try {
      await logout();
      await refreshAuthIdentity();
      setMenuOpen(false);
    } catch {
      setAccountError('退出登录失败，请稍后重试。');
    }
  };

  const handleSync = async (includeGuest = false) => {
    setSyncing(true);
    setAccountError(null);
    try {
      if (migrationStatus === 'pending' || migrationStatus === 'conflict') {
        await resumeGuestUpgrade();
        if (user && !user.isGuest) await hydrateAccountFromCloud(user.id, { force: true });
      } else if (!includeGuest && user && !user.isGuest
        && cloudSync.accountId === user.id
        && (cloudSync.status === 'error' || cloudSync.status === 'conflict' || cloudSync.pendingCount > 0)) {
        await retryCloudSync(user.id);
      } else {
        await syncLocalData({ includeGuest });
        if (user && !user.isGuest) await hydrateAccountFromCloud(user.id, { force: true });
      }
    } catch {
      setAccountError('同步未完成，请稍后重试。');
    } finally {
      setSyncing(false);
    }
  };

  const handleRetryCloud = async () => {
    if (!user || user.isGuest) return;
    setSyncing(true);
    setAccountError(null);
    try {
      await retryCloudSync(user.id);
    } catch {
      setAccountError('云端同步重试失败，请稍后重试。');
    } finally {
      setSyncing(false);
    }
  };

  const configured = isAuthConfigured();
  const avatarInitial = user?.nickname ? user.nickname.slice(0, 1).toUpperCase() : 'U';
  const boundAccountValue = user?.email ?? '';
  const sameCloudAccount = Boolean(user && !user.isGuest && cloudSync.accountId === user.id);
  const showCloudBusy = sameCloudAccount && (cloudSync.status === 'hydrating' || cloudSync.status === 'syncing');
  const showCloudProblem = sameCloudAccount && (cloudSync.status === 'error' || cloudSync.status === 'conflict');
  const syncLabel = syncing ? '正在同步本机进度'
    : migrationStatus === 'pending' ? '同步待重试'
      : migrationStatus === 'conflict' ? '部分本机数据与云端冲突'
        : showCloudProblem ? (cloudSync.status === 'conflict' ? '云端数据冲突' : '云端同步失败')
          : showCloudBusy ? '正在同步云端数据…'
            : migrationStatus === 'synced' ? '游客数据已同步' : '账号已登录';

  return (
    <div className="auth-bar" role="region" aria-label="账户与云端同步状态">
      <div className="auth-bar__inner">
        {user === null && (
          <>
            <div className="auth-bar__status">
              <span className="auth-bar__dot" aria-hidden="true" />
              <span>本地刷题模式</span>
            </div>
            <div className="auth-bar__actions">
              <button
                type="button"
                className="auth-btn auth-btn--primary"
                data-testid="auth-open-btn"
                data-auth-dialog-trigger
                onClick={() => openAuthModal('login')}
              >
                <AuthIcon name="user" size={14} />
                <span>{configured ? '登录 / 注册' : '游客入口'}</span>
              </button>
            </div>
          </>
        )}

        {user !== null && user.isGuest && (
          <>
            <div className="auth-bar__status">
              <span className="auth-bar__dot auth-bar__dot--guest" aria-hidden="true" />
              <span>游客模式 · 数据保存在当前浏览器</span>
            </div>
            <div className="auth-bar__actions">
              <button
                type="button"
                className="auth-guest-pill"
                data-testid="auth-guest-mode-btn"
                data-auth-dialog-trigger
                onClick={() => openAuthModal('upgrade')}
              >
                <AuthIcon name="shield" size={14} />
                <span className="auth-guest-pill__tag">游客模式</span>
                {configured && <span className="auth-guest-pill__cta">绑定账号</span>}
              </button>
            </div>
          </>
        )}

        {user !== null && !user.isGuest && (
          <>
            <div className="auth-bar__status">
              <span
                className={`auth-bar__dot ${showCloudProblem ? 'auth-bar__dot--error' : showCloudBusy ? 'auth-bar__dot--guest' : 'auth-bar__dot--ready'}`}
                aria-hidden="true"
              />
              <span data-testid="auth-sync-status" role="status">{syncLabel}</span>
              {showCloudProblem && !migrationStatus?.match(/pending|conflict/) && (
                <button
                  type="button"
                  className="auth-inline-retry"
                  data-testid="auth-cloud-retry-btn"
                  disabled={syncing}
                  onClick={() => { void handleRetryCloud(); }}
                >
                  重试
                </button>
              )}
            </div>
            <div className="auth-bar__actions">
              <div className="auth-user-menu" ref={menuRef}>
                <button
                  type="button"
                  className="auth-user-trigger"
                  data-testid="user-menu-trigger"
                  data-auth-dialog-trigger
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
                        <span className="auth-dropdown__badge">已绑定</span>
                        <span data-testid="user-menu-bound-account">{boundAccountValue}</span>
                      </div>
                    </div>
                    {accountError && <p role="alert" className="auth-alert">{accountError}</p>}
                    <button type="button" role="menuitem" className="auth-dropdown__item" data-testid="auth-sync-btn"
                      onClick={() => { void handleSync(); }} disabled={syncing}>
                      {migrationStatus === 'pending' || migrationStatus === 'conflict' ? '重试同步' : '同步当前账号进度'}
                    </button>
                    {migrationStatus !== 'pending' && migrationStatus !== 'conflict' && (
                      <button type="button" role="menuitem" className="auth-dropdown__item" data-testid="auth-claim-guest-btn"
                        onClick={() => { void handleSync(true); }} disabled={syncing}>
                        导入此浏览器的游客数据
                      </button>
                    )}
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
