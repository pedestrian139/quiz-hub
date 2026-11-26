import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { accountPracticeScope, PRACTICE_DATA_CHANGED_EVENT } from '../../core/practiceScope';
import type { GuestPracticeScope, PracticeScope } from '../../core/practiceScope';
import { PracticeScopeContext } from '../../hooks/practiceScope';
import { isAuthConfigured, subscribeAuthChange } from '../../services/authService';
import { clearCloudSyncSession, hydrateAccountFromCloud } from '../../services/cloudSync';
import { getActiveGuestPracticeScope, subscribeGuestScopeChanges } from '../../services/db/guestOwnership';
import { refreshAuthIdentity, useAuthUiState } from './authState';
import { AuthModal } from './AuthModal';

export function AuthPracticeRoot({ children }: { children: ReactNode }) {
  const { user, identityStatus } = useAuthUiState();
  const [guestScope, setGuestScope] = useState<GuestPracticeScope | null>(null);
  const [guestScopeError, setGuestScopeError] = useState(false);
  const [reload, setReload] = useState(0);
  const [revisions, setRevisions] = useState<Partial<Record<PracticeScope, number>>>({});
  const prevAccountIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let version = 0;
    const refreshGuest = () => {
      const request = ++version;
      setGuestScope(null);
      setGuestScopeError(false);
      void getActiveGuestPracticeScope().then((scope) => {
        if (active && version === request) setGuestScope(scope);
      }).catch(() => {
        if (active && version === request) setGuestScopeError(true);
      });
    };
    const onPracticeDataChanged = (event: Event) => {
      const scope = (event as CustomEvent<PracticeScope>).detail;
      setRevisions((current) => ({ ...current, [scope]: (current[scope] ?? 0) + 1 }));
    };
    const unsubscribeGuest = subscribeGuestScopeChanges(refreshGuest);
    const unsubscribeAuth = subscribeAuthChange((event) => {
      if (event.type === 'guest_migration' && event.result.guestDataSynced
        && event.result.user.id === prevAccountIdRef.current && isAuthConfigured()) {
        void hydrateAccountFromCloud(event.result.user.id, { force: true });
      }
    });
    window.addEventListener(PRACTICE_DATA_CHANGED_EVENT, onPracticeDataChanged);
    refreshGuest();
    return () => {
      active = false;
      unsubscribeGuest();
      unsubscribeAuth();
      window.removeEventListener(PRACTICE_DATA_CHANGED_EVENT, onPracticeDataChanged);
    };
  }, [reload]);

  useEffect(() => {
    if (identityStatus !== 'ready') return;
    if (user && !user.isGuest && isAuthConfigured()) {
      if (prevAccountIdRef.current && prevAccountIdRef.current !== user.id) {
        clearCloudSyncSession(prevAccountIdRef.current);
      }
      prevAccountIdRef.current = user.id;
      void hydrateAccountFromCloud(user.id);
    } else if (prevAccountIdRef.current) {
      clearCloudSyncSession(prevAccountIdRef.current);
      prevAccountIdRef.current = null;
    }
  }, [identityStatus, user?.id, user?.isGuest]);

  const scope = identityStatus !== 'ready' ? null : user && !user.isGuest ? accountPracticeScope(user.id) : guestScope;
  const unavailable = identityStatus === 'error' || (identityStatus === 'ready' && !scope && guestScopeError);
  return <>
    {scope ? <PracticeScopeContext.Provider value={scope} key={`${scope}:${revisions[scope] ?? 0}`}>
      {children}
    </PracticeScopeContext.Provider> : (
      <main className="container" aria-busy={!unavailable}>
        <p role="status">{unavailable ? '暂时无法确认当前账号或读取本机数据。' : '正在读取刷题数据…'}</p>
        {unavailable && <button type="button" onClick={() => { void refreshAuthIdentity(); setReload((value) => value + 1); }}>重试</button>}
      </main>
    )}
    <AuthModal />
  </>;
}
