import type { AccountIdentifier } from './account';
import { accountPracticeScope, isGuestPracticeScope, LEGACY_GUEST_SCOPE } from '../../core/practiceScope';
import type { PracticeScope } from '../../core/practiceScope';
import { uploadGuestData } from './cloudData';
import type { AccountProfile, GuestImportBatch, GuestImportConflicts } from './cloudData';
import { adoptGuestData, readGuestData } from './guestData';
import type { GuestData } from './guestData';
import { claimGuestPracticeScope } from './guestOwnership';

const LEGACY_UPGRADE_KEY = 'quizhub-v2:guest-upgrade';

interface PendingUpgrade extends GuestImportBatch {
  account: AccountIdentifier;
  practiceScope: PracticeScope;
  ownerId?: string;
  fingerprint?: string;
  conflicts?: GuestImportConflicts;
}

export type GuestUpgradeResult = { pending: boolean; synced?: true; conflicts?: GuestImportConflicts };

const inFlightGuestImports = new Map<string, Promise<GuestUpgradeResult>>();
const volatileUpgrades = new Map<string, PendingUpgrade>();

function upgradeKey(account: AccountIdentifier): string {
  return `${LEGACY_UPGRADE_KEY}:${account.kind}:${encodeURIComponent(account.value)}`;
}

function readUpgrade(key: string): PendingUpgrade | null {
  try {
    const raw = localStorage.getItem(key);
    const pending = raw ? JSON.parse(raw) as Partial<PendingUpgrade> | null : null;
    if (!pending || typeof pending.importId !== 'string' || typeof pending.account?.value !== 'string'
      || pending.account.kind !== 'email') return null;
    // A saved attempt from before snapshot versioning starts its lineage with its original ID.
    return {
      account: pending.account, importId: pending.importId, sourceId: pending.sourceId ?? pending.importId,
      sourceVersion: pending.sourceVersion ?? 1, fingerprint: pending.fingerprint,
      practiceScope: pending.practiceScope ?? LEGACY_GUEST_SCOPE, ownerId: pending.ownerId, conflicts: pending.conflicts,
    };
  } catch { return null; }
}

export function readPendingUpgrade(account?: AccountIdentifier): PendingUpgrade | null {
  if (account) {
    const key = upgradeKey(account);
    const pending = volatileUpgrades.get(key) ?? readUpgrade(key) ?? readUpgrade(LEGACY_UPGRADE_KEY);
    return pending?.account.kind === account.kind && pending.account.value === account.value ? pending : null;
  }
  const volatile = volatileUpgrades.values().next().value;
  if (volatile) return volatile;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(`${LEGACY_UPGRADE_KEY}:`)) continue;
      const pending = readUpgrade(key);
      if (pending) return pending;
    }
  } catch { /* The browser may block enumeration. */ }
  return readUpgrade(LEGACY_UPGRADE_KEY);
}

function findPendingUpgrade(user: AccountProfile): PendingUpgrade | null {
  if (!user.email) return null;
  const pending = readPendingUpgrade({ kind: 'email', value: user.email });
  return pending && (!pending.ownerId || pending.ownerId === user.id) ? pending : null;
}

function persistPending(pending: PendingUpgrade): PendingUpgrade {
  const key = upgradeKey(pending.account);
  try {
    localStorage.setItem(key, JSON.stringify(pending));
    volatileUpgrades.delete(key);
    const legacy = readUpgrade(LEGACY_UPGRADE_KEY);
    if (legacy?.account.kind === pending.account.kind && legacy.account.value === pending.account.value) {
      localStorage.removeItem(LEGACY_UPGRADE_KEY);
    }
  } catch {
    throw new Error('浏览器无法保存游客迁移状态。请启用站点存储后重试。');
  }
  return pending;
}

function finishPendingUpgrade(pending: PendingUpgrade): void {
  const accountKey = upgradeKey(pending.account);
  if (volatileUpgrades.get(accountKey)?.importId === pending.importId) volatileUpgrades.delete(accountKey);
  for (const key of [accountKey, LEGACY_UPGRADE_KEY]) {
    if (readUpgrade(key)?.importId === pending.importId) localStorage.removeItem(key);
  }
}

export function savePendingUpgrade(account: AccountIdentifier, practiceScope: PracticeScope = LEGACY_GUEST_SCOPE, ownerId?: string): PendingUpgrade {
  const pending = readPendingUpgrade(account);
  if (pending && (!ownerId || !pending.ownerId || pending.ownerId === ownerId)) return pending;
  const sourceId = crypto.randomUUID();
  const draft = { account, practiceScope, ownerId, sourceId, importId: sourceId, sourceVersion: 1 };
  try { return persistPending(draft); } catch (error) {
    if (!ownerId) throw error;
    // A verified login can still succeed. Wait for a durable journal before claiming or uploading data.
    volatileUpgrades.set(upgradeKey(account), draft);
    return draft;
  }
}

export function hasPendingGuestUpgrade(user: AccountProfile): boolean {
  return findPendingUpgrade(user) !== null;
}

async function snapshotFingerprint(data: GuestData): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function prepareAttempt(pending: PendingUpgrade, fingerprint: string, retryConflicts: boolean): PendingUpgrade {
  if (readPendingUpgrade(pending.account)?.importId !== pending.importId) throw new Error('游客迁移目标已变更。');
  if (pending.fingerprint === fingerprint && !(retryConflicts && pending.conflicts)) return pending;
  if (!pending.fingerprint) return persistPending({ ...pending, fingerprint });
  return persistPending({ ...pending, fingerprint, importId: crypto.randomUUID(), sourceVersion: pending.sourceVersion + 1, conflicts: undefined });
}

async function importPendingSnapshot(userId: string, pending: PendingUpgrade, retryConflicts: boolean): Promise<GuestUpgradeResult> {
  try {
    const key = upgradeKey(pending.account);
    if (volatileUpgrades.has(key) || !pending.ownerId) pending = persistPending({ ...pending, ownerId: userId });
    const target = accountPracticeScope(userId);
    const source = pending.practiceScope;
    const guestSource = isGuestPracticeScope(source) ? source : null;
    if (source !== target) {
      if (!guestSource) return { pending: true };
      if (!await claimGuestPracticeScope(guestSource, userId)) {
        finishPendingUpgrade(pending);
        return { pending: false };
      }
    }
    const snapshot = await readGuestData(source);
    if (guestSource) await adoptGuestData(snapshot, guestSource, target);
    const fingerprint = await snapshotFingerprint(snapshot);
    const attempt = prepareAttempt(pending, fingerprint, retryConflicts);
    if (attempt.conflicts) return { pending: true, conflicts: attempt.conflicts };
    const hasUpload = Boolean(attempt.sourceVersion > 1 || snapshot.banks.length || snapshot.progress.length || snapshot.apiConfig);
    if (hasUpload) {
      const result = await uploadGuestData(userId, attempt, snapshot);
      if ('supersededBy' in result) {
        if (readPendingUpgrade(attempt.account)?.importId === attempt.importId) {
          persistPending({ ...attempt, sourceVersion: result.supersededBy + 1, importId: crypto.randomUUID() });
        }
        return { pending: true };
      }
      if (result.skippedBankIds.length || result.skippedApiConfig) {
        if (readPendingUpgrade(attempt.account)?.importId === attempt.importId) {
          const conflicted = { ...attempt, conflicts: result };
          try { persistPending(conflicted); } catch { volatileUpgrades.set(key, conflicted); }
          // An older journal or a lost response may only reveal its committed conflict on replay.
          if (retryConflicts && pending.fingerprint && attempt.importId === pending.importId) {
            return importPendingSnapshot(userId, conflicted, true);
          }
        }
        return { pending: true, conflicts: result };
      }
    }
    if (await snapshotFingerprint(await readGuestData(source)) !== fingerprint) return { pending: true };
    finishPendingUpgrade(attempt);
    return { pending: false, ...(hasUpload && { synced: true }) };
  } catch {
    return { pending: true };
  }
}

export async function runGuestUpgrade(user: AccountProfile, { retryConflicts = false }: { retryConflicts?: boolean } = {}): Promise<GuestUpgradeResult> {
  const pending = findPendingUpgrade(user);
  if (!pending) return { pending: false };
  const inFlight = inFlightGuestImports.get(user.id);
  if (inFlight) return inFlight;
  const attempt = importPendingSnapshot(user.id, pending, retryConflicts);
  inFlightGuestImports.set(user.id, attempt);
  try { return await attempt; } finally { inFlightGuestImports.delete(user.id); }
}
