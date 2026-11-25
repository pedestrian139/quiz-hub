import { isGuestPracticeScope, LEGACY_GUEST_SCOPE } from '../../core/practiceScope';
import type { GuestPracticeScope } from '../../core/practiceScope';
import { getBankDb } from '../../utils/bankDb';

const GUEST_OWNERSHIP = 'guestPracticeOwnership';
export const GUEST_SCOPE_STORAGE_KEY = 'quizhub-v2:active-guest-practice';
export const GUEST_SCOPE_CHANGED_EVENT = 'quizhub:guest-practice-changed';

interface GuestOwnership {
  active: GuestPracticeScope;
  owners: Partial<Record<GuestPracticeScope, string>>;
}

function openGuestScopeChannel(): BroadcastChannel | null {
  try { return new BroadcastChannel(GUEST_SCOPE_CHANGED_EVENT); } catch { return null; }
}

export function subscribeGuestScopeChanges(listener: () => void): () => void {
  const channel = openGuestScopeChannel();
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === GUEST_SCOPE_STORAGE_KEY) listener();
  };
  channel?.addEventListener('message', listener);
  window.addEventListener('storage', onStorage);
  window.addEventListener(GUEST_SCOPE_CHANGED_EVENT, listener);
  return () => {
    channel?.close();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(GUEST_SCOPE_CHANGED_EVENT, listener);
  };
}

async function accessOwnership<T>(operation: (ownership: GuestOwnership) => { result: T; next?: GuestOwnership }): Promise<T> {
  const metadataDb = getBankDb(LEGACY_GUEST_SCOPE);
  const db = await metadataDb.openQuizHubDb();
  if (!db) {
    metadataDb.closeQuizHubDb();
    throw new Error('无法确认本机游客数据归属。');
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    const meta = tx.objectStore('meta');
    const request = meta.get(GUEST_OWNERSHIP);
    let result: T;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const saved = request.result?.value as GuestOwnership | undefined;
        if (saved && (!isGuestPracticeScope(saved.active) || !saved.owners || typeof saved.owners !== 'object')) {
          throw new Error('本机游客数据归属无效。');
        }
        const change = operation(saved ?? { active: LEGACY_GUEST_SCOPE, owners: {} });
        result = change.result;
        if (change.next) meta.put({ key: GUEST_OWNERSHIP, value: change.next });
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('无法确认本机游客数据归属。'));
  });
}

export async function getActiveGuestPracticeScope(): Promise<GuestPracticeScope> {
  if (!globalThis.indexedDB) {
    const mirrored = globalThis.localStorage?.getItem(GUEST_SCOPE_STORAGE_KEY);
    return isGuestPracticeScope(mirrored) ? mirrored : LEGACY_GUEST_SCOPE;
  }
  return accessOwnership((ownership) => ({ result: ownership.active }));
}

/** Only a verified account may be provided. The transaction prevents a second tab from claiming these data. */
export async function claimGuestPracticeScope(scope: GuestPracticeScope, userId: string): Promise<boolean> {
  const claim = await accessOwnership<{ owned: boolean; nextScope?: GuestPracticeScope }>((ownership) => {
    const owner = ownership.owners[scope];
    if (owner) return { result: { owned: owner === userId } };
    if (ownership.active !== scope) return { result: { owned: false } };
    const nextScope: GuestPracticeScope = `guest:${crypto.randomUUID()}`;
    return { result: { owned: true, nextScope }, next: { active: nextScope, owners: { ...ownership.owners, [scope]: userId } } };
  });
  if (claim.nextScope) {
    try {
      localStorage.setItem(GUEST_SCOPE_STORAGE_KEY, claim.nextScope);
    } catch {
      // Notify other tabs even if localStorage is full; IndexedDB remains authoritative.
      const channel = openGuestScopeChannel();
      channel?.postMessage(null);
      channel?.close();
    }
    globalThis.window?.dispatchEvent(new Event(GUEST_SCOPE_CHANGED_EVENT));
  }
  return claim.owned;
}
