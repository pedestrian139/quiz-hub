/// <reference types="node" />

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveStore } from '../../src/core/storage';
import { accountPracticeScope, LEGACY_GUEST_SCOPE } from '../../src/core/practiceScope';
import { getBankDb } from '../../src/utils/bankDb';
import type { AccountProfile } from '../../src/services/db/cloudData';

const mock = vi.hoisted(() => ({
  auth: { getUser: vi.fn(), getSession: vi.fn(), signUp: vi.fn(), signInWithPassword: vi.fn(), setSession: vi.fn(), updateUser: vi.fn(), onAuthStateChange: vi.fn() },
  invoke: vi.fn(),
  loadProfile: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../../src/services/db/client', () => ({
  getDatabaseClient: () => ({ auth: mock.auth }), isDatabaseConfigured: () => true, invokeDatabaseFunction: mock.invoke,
}));
vi.mock('../../src/services/db/cloudData', () => ({ loadProfile: mock.loadProfile, uploadGuestData: mock.upload }));

import { getCurrentUser, loginAsGuest, loginWithAccount, registerWithAccount, resumeGuestUpgrade, syncLocalData, upgradeGuestToAccount } from '../../src/services/authService';
import { endGuest, GUEST_KEY } from '../../src/services/db/guestData';
import { readPendingUpgrade } from '../../src/services/db/guestUpgrade';

const emailUser: AccountProfile = { id: 'email-owner', email: 'target@example.com', phone: null, nickname: '邮箱', isGuest: false };
const phoneUser: AccountProfile = { id: 'phone-owner', email: null, phone: '00123456789', nickname: '手机号', isGuest: false };
const emailScope = accountPracticeScope(emailUser.id);

function signInAs(user: AccountProfile) {
  mock.auth.getUser.mockResolvedValue({ data: { user: { id: user.id } }, error: null });
  mock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: user.id }, access_token: 'test-token' } }, error: null });
  mock.loadProfile.mockResolvedValue(user);
}

describe('auth service and account-bound guest upgrades', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
    endGuest();
    mock.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mock.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError' } });
    mock.upload.mockResolvedValue({ skippedBankIds: [], skippedApiConfig: false });
  });

  afterEach(() => {
    getBankDb(LEGACY_GUEST_SCOPE).closeQuizHubDb();
    getBankDb(emailScope).closeQuizHubDb();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps an email upgrade pending until the matching account signs in', async () => {
    const guest = await loginAsGuest();
    const progress = { records: { q1: { ok: 1 as const, ts: 123 } }, fav: {}, mastery: {} };
    saveStore(progress);
    mock.auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    expect(await upgradeGuestToAccount({ account: emailUser.email!, password: 'secret-password' }))
      .toEqual({ status: 'email_confirmation_required', user: null });
    expect(await getCurrentUser()).toEqual(guest);

    signInAs(phoneUser);
    expect(await getCurrentUser()).toEqual(phoneUser);
    expect(mock.upload).not.toHaveBeenCalled();
    expect(readPendingUpgrade()?.account.value).toBe(emailUser.email);

    signInAs(emailUser);
    expect(await getCurrentUser()).toEqual(emailUser);
    expect(mock.upload).not.toHaveBeenCalled();
    const callback = mock.auth.onAuthStateChange.mock.calls[0][0];
    callback('SIGNED_IN', { user: { id: emailUser.id } });
    await vi.waitFor(() => expect(readPendingUpgrade()).toBeNull());
    expect(mock.upload).toHaveBeenCalledWith(emailUser.id, expect.objectContaining({ importId: expect.any(String) }), expect.objectContaining({
      progress: [{ bankId: 'builtin-ai-intro', store: progress }],
    }));
  });

  it('reuses the same import ID when a transfer is retried', async () => {
    signInAs(emailUser);
    saveStore({ records: {}, fav: { q3: true }, mastery: {} }, emailScope);
    mock.upload.mockRejectedValueOnce(new Error('offline'));
    expect((await syncLocalData()).status).toBe('migration_pending');
    const pending = readPendingUpgrade();
    expect(pending?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await syncLocalData()).status).toBe('authenticated');
    expect(mock.upload.mock.calls.map((args) => args[1].importId)).toEqual([pending?.importId, pending?.importId]);
  });

  it('imports guest data into an existing account only after its password login succeeds', async () => {
    await loginAsGuest();
    saveStore({ records: {}, fav: { localQuestion: true }, mastery: {} });
    mock.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: new Error('invalid credentials') });
    await expect(loginWithAccount({ account: emailUser.email!, password: 'wrong-password', importGuestData: true })).rejects.toThrow();
    expect(readPendingUpgrade()).toBeNull();
    expect(mock.upload).not.toHaveBeenCalled();

    signInAs(emailUser);
    mock.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: emailUser.id } }, error: null });
    expect(await loginWithAccount({ account: emailUser.email!, password: 'secret-password', importGuestData: true })).toMatchObject({
      status: 'authenticated', user: emailUser, guestDataSynced: true,
    });
    expect(mock.upload).toHaveBeenCalledWith(emailUser.id, expect.any(Object), expect.any(Object));
  });

  it('resumes with a newer snapshot of the same import and exposes cloud conflicts', async () => {
    signInAs(emailUser);
    saveStore({ records: {}, fav: { initial: true }, mastery: {} }, emailScope);
    mock.upload.mockImplementationOnce(async () => {
      saveStore({ records: {}, fav: { changed: true }, mastery: {} }, emailScope);
      return { skippedBankIds: [], skippedApiConfig: false };
    });
    expect((await syncLocalData()).status).toBe('migration_pending');
    const first = readPendingUpgrade();
    mock.upload.mockResolvedValueOnce({ skippedBankIds: ['cloud-edited-bank'], skippedApiConfig: true });
    expect(await resumeGuestUpgrade()).toEqual({ status: 'migration_pending', user: emailUser,
      migrationConflicts: { skippedBankIds: ['cloud-edited-bank'], skippedApiConfig: true },
    });
    expect(readPendingUpgrade()).toMatchObject({ sourceVersion: 2, sourceId: first?.sourceId });
    expect(readPendingUpgrade()?.importId).not.toBe(first?.importId);
  });

  it('evaluates a committed conflict again on explicit retry with an unchanged local snapshot', async () => {
    signInAs(emailUser);
    saveStore({ records: {}, fav: { q1: true }, mastery: {} }, emailScope);
    mock.upload.mockResolvedValueOnce({ skippedBankIds: ['edited-in-cloud'], skippedApiConfig: true });
    expect((await syncLocalData()).status).toBe('migration_pending');
    expect((await resumeGuestUpgrade())?.status).toBe('authenticated');
    const [initial, retry] = mock.upload.mock.calls.map(([, batch]) => batch);
    expect(retry).toMatchObject({ sourceId: initial.sourceId, sourceVersion: initial.sourceVersion + 1 });
    expect(retry.importId).not.toBe(initial.importId);
  });

  it('can renew a committed conflict after the previous response was lost', async () => {
    signInAs(emailUser);
    saveStore({ records: {}, fav: { q1: true }, mastery: {} }, emailScope);
    mock.upload.mockRejectedValueOnce(new Error('response lost'));
    expect((await syncLocalData()).status).toBe('migration_pending');
    mock.upload.mockResolvedValueOnce({ skippedBankIds: ['edited-in-cloud'], skippedApiConfig: false });
    expect(await resumeGuestUpgrade()).toMatchObject({ status: 'authenticated', guestDataSynced: true });
    const [initial, replay, retry] = mock.upload.mock.calls.map(([, batch]) => batch);
    expect(replay.importId).toBe(initial.importId);
    expect(retry).toMatchObject({ sourceId: initial.sourceId, sourceVersion: initial.sourceVersion + 1 });
    expect(retry.importId).not.toBe(initial.importId);
  });

  it('keeps a successful login when the migration journal exceeds storage quota and retries without losing intent', async () => {
    await loginAsGuest();
    saveStore({ records: {}, fav: { localQuestion: true }, mastery: {} });
    signInAs(emailUser);
    mock.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: emailUser.id } }, error: null });
    const setItem = Storage.prototype.setItem;
    const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('quizhub-v2:guest-upgrade:')) throw new DOMException('Full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    expect(await loginWithAccount({ account: emailUser.email!, password: 'secret-password', importGuestData: true }))
      .toMatchObject({ status: 'migration_pending', user: emailUser });
    expect(await getCurrentUser()).toEqual(emailUser);
    expect(mock.upload).not.toHaveBeenCalled();

    quota.mockRestore();
    expect(await resumeGuestUpgrade()).toMatchObject({ status: 'authenticated', guestDataSynced: true });
    expect(mock.upload).toHaveBeenCalledWith(emailUser.id, expect.any(Object), expect.objectContaining({
      progress: [{ bankId: 'builtin-ai-intro', store: { records: {}, fav: { localQuestion: true }, mastery: {} } }],
    }));
  });

  it('does not resurrect a persisted guest session removed in another tab', async () => {
    const guest = await loginAsGuest();
    expect(await getCurrentUser()).toEqual(guest);
    localStorage.removeItem(GUEST_KEY);
    expect(await getCurrentUser()).toBeNull();
    expect((await loginAsGuest()).id).not.toBe(guest.id);
  });

  it('still allows a same-page guest session when storage writes are blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    const guest = await loginAsGuest();
    expect(await getCurrentUser()).toEqual(guest);
    endGuest();
    expect(await getCurrentUser()).toBeNull();
  });

  it('starts dual registration with one phone account and requests email verification for that same account', async () => {
    signInAs(phoneUser);
    mock.invoke.mockImplementation(async (_service, body: { action: string }) => body.action === 'login'
      ? { access_token: 'access', refresh_token: 'refresh' } : { ok: true });
    mock.auth.setSession.mockResolvedValue({ data: { user: { id: phoneUser.id } }, error: null });
    mock.auth.updateUser.mockResolvedValue({ data: { user: { id: phoneUser.id } }, error: null });

    expect(await registerWithAccount({ account: 'real@example.com', secondaryAccount: phoneUser.phone!,
      password: 'secret-password', nickname: phoneUser.nickname })).toEqual({
      status: 'authenticated', user: phoneUser, pendingEmail: 'real@example.com',
    });
    expect(mock.auth.signUp).not.toHaveBeenCalled();
    expect(mock.auth.updateUser).toHaveBeenCalledWith({ email: 'real@example.com' }, { emailRedirectTo: expect.any(String) });
    expect(mock.invoke).toHaveBeenCalledWith('phone-auth', expect.objectContaining({
      action: 'authorize_email_link', ownerId: phoneUser.id, email: 'real@example.com',
    }), 'test-token');
  });

  it('preserves the successful phone registration when email verification cannot start', async () => {
    signInAs(phoneUser);
    mock.invoke.mockImplementation(async (_service, body: { action: string }) => body.action === 'login'
      ? { access_token: 'access', refresh_token: 'refresh' } : { ok: true });
    mock.auth.setSession.mockResolvedValue({ data: { user: { id: phoneUser.id } }, error: null });
    mock.auth.updateUser.mockResolvedValue({ data: { user: null }, error: new Error('SMTP unavailable') });

    await expect(registerWithAccount({ account: 'real@example.com', secondaryAccount: phoneUser.phone!,
      password: 'secret-password', nickname: phoneUser.nickname })).resolves.toEqual({
      status: 'authenticated', user: phoneUser, failedSecondaryAccount: 'real@example.com',
    });
  });
});
