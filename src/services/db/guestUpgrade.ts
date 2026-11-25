import type { AccountIdentifier } from './account';
import { uploadGuestData } from './cloudData';
import type { AccountProfile, GuestImportBatch, GuestImportConflicts } from './cloudData';
import { readGuestData } from './guestData';
import type { GuestData } from './guestData';

const UPGRADE_KEY = 'quizhub-v2:guest-upgrade';

interface PendingUpgrade extends GuestImportBatch {
  account: AccountIdentifier;
  fingerprint?: string;
}

export type GuestUpgradeResult = { pending: boolean; synced?: true; conflicts?: GuestImportConflicts };

const inFlightGuestImports = new Map<string, Promise<GuestUpgradeResult>>();

export function readPendingUpgrade(): PendingUpgrade | null {
  try {
    const raw = localStorage.getItem(UPGRADE_KEY);
    const pending = raw ? JSON.parse(raw) as Partial<PendingUpgrade> | null : null;
    if (!pending || typeof pending.importId !== 'string' || typeof pending.account?.value !== 'string'
      || (pending.account.kind !== 'email' && pending.account.kind !== 'phone')) return null;
    // A saved attempt from before snapshot versioning starts its lineage with its original ID.
    return {
      account: pending.account, importId: pending.importId, sourceId: pending.sourceId ?? pending.importId,
      sourceVersion: pending.sourceVersion ?? 1, fingerprint: pending.fingerprint,
    };
  } catch { return null; }
}

function persistPending(pending: PendingUpgrade): PendingUpgrade {
  try { localStorage.setItem(UPGRADE_KEY, JSON.stringify(pending)); } catch {
    throw new Error('浏览器无法保存游客迁移状态。请启用站点存储后重试。');
  }
  return pending;
}

export function savePendingUpgrade(account: AccountIdentifier): PendingUpgrade {
  const pending = readPendingUpgrade();
  if (pending?.account.value === account.value && pending.account.kind === account.kind) return pending;
  const sourceId = crypto.randomUUID();
  return persistPending({ account, sourceId, importId: sourceId, sourceVersion: 1, fingerprint: undefined });
}

export function hasPendingGuestUpgrade(user: AccountProfile): boolean {
  const pending = readPendingUpgrade();
  return Boolean(pending && user[pending.account.kind] === pending.account.value);
}

async function snapshotFingerprint(data: GuestData): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function prepareAttempt(pending: PendingUpgrade, fingerprint: string): PendingUpgrade {
  if (readPendingUpgrade()?.importId !== pending.importId) throw new Error('游客迁移目标已变更。');
  if (pending.fingerprint === fingerprint) return pending;
  if (!pending.fingerprint) return persistPending({ ...pending, fingerprint });
  return persistPending({ ...pending, fingerprint, importId: crypto.randomUUID(), sourceVersion: pending.sourceVersion + 1 });
}

async function importPendingSnapshot(userId: string, pending: PendingUpgrade): Promise<GuestUpgradeResult> {
  try {
    const snapshot = await readGuestData();
    const fingerprint = await snapshotFingerprint(snapshot);
    const attempt = prepareAttempt(pending, fingerprint);
    const hasUpload = Boolean(attempt.sourceVersion > 1 || snapshot.banks.length || snapshot.progress.length || snapshot.apiConfig);
    if (hasUpload) {
      const result = await uploadGuestData(userId, attempt, snapshot);
      if ('supersededBy' in result) {
        if (readPendingUpgrade()?.importId === attempt.importId) {
          persistPending({ ...attempt, sourceVersion: result.supersededBy + 1, importId: crypto.randomUUID() });
        }
        return { pending: true };
      }
      if (result.skippedBankIds.length || result.skippedApiConfig) return { pending: true, conflicts: result };
    }
    if (await snapshotFingerprint(await readGuestData()) !== fingerprint) return { pending: true };
    if (readPendingUpgrade()?.importId === attempt.importId) localStorage.removeItem(UPGRADE_KEY);
    return { pending: false, ...(hasUpload && { synced: true }) };
  } catch {
    return { pending: true };
  }
}

export async function runGuestUpgrade(user: AccountProfile): Promise<GuestUpgradeResult> {
  const pending = readPendingUpgrade();
  if (!pending || user[pending.account.kind] !== pending.account.value) return { pending: false };
  const inFlight = inFlightGuestImports.get(user.id);
  if (inFlight) return inFlight;
  const attempt = importPendingSnapshot(user.id, pending);
  inFlightGuestImports.set(user.id, attempt);
  try { return await attempt; } finally { inFlightGuestImports.delete(user.id); }
}
