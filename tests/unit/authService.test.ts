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
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    resend: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
  invoke: vi.fn(),
  loadProfile: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../../src/services/db/client', () => ({
  getDatabaseClient: () => ({ auth: mock.auth }), isDatabaseConfigured: () => true, invokeDatabaseFunction: mock.invoke,
}));
vi.mock('../../src/services/db/cloudData', () => ({ loadProfile: mock.loadProfile, uploadGuestData: mock.upload }));

import {
  getCurrentUser,
  loginAsGuest,
  loginWithAccount,
  registerWithAccount,
  resendSignupOtp,
  resumeGuestUpgrade,
  sendLoginOtp,
  syncLocalData,
  upgradeGuestToAccount,
  verifyEmailOtp,
} from '../../src/services/authService';
import { endGuest, GUEST_KEY } from '../../src/services/db/guestData';
import { readPendingUpgrade } from '../../src/services/db/guestUpgrade';

const emailUser: AccountProfile = { id: 'email-owner', email: 'target@example.com', phone: null, nickname: '邮箱', isGuest: false };
const otherEmailUser: AccountProfile = { id: 'other-owner', email: 'other@example.com', phone: null, nickname: '另一位', isGuest: false };
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
    mock.auth.signOut.mockResolvedValue({ error: null });
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
    mock.auth.signUp.mockResolvedValue({ data: { user: { id: emailUser.id, identities: [{ id: '1' }] }, session: null }, error: null });
    expect(await upgradeGuestToAccount({ account: emailUser.email!, password: 'secret-password' }))
      .toEqual({ status: 'email_confirmation_required', user: null });
    expect(await getCurrentUser()).toEqual(guest);

    signInAs(otherEmailUser);
    expect(await getCurrentUser()).toEqual(otherEmailUser);
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

  it('registers with email + password and activates via verifyOtp with type email', async () => {
    mock.auth.signUp.mockResolvedValue({ data: { user: { id: emailUser.id, identities: [{ id: '1' }] }, session: null }, error: null });
    expect(await registerWithAccount({ account: ' Target@Example.com ', password: 'secret-password', nickname: '邮箱' })).toEqual({
      status: 'email_confirmation_required', user: null,
    });
    expect(mock.auth.signUp).toHaveBeenCalledWith({
      email: emailUser.email, password: 'secret-password', options: { data: { nickname: '邮箱' }, emailRedirectTo: expect.any(String) },
    });

    await expect(verifyEmailOtp({ account: emailUser.email!, code: '123' })).rejects.toThrow('6–8 位');
    expect(mock.auth.verifyOtp).not.toHaveBeenCalled();

    signInAs(emailUser);
    mock.auth.verifyOtp.mockResolvedValue({ data: { user: { id: emailUser.id }, session: { user: { id: emailUser.id } } }, error: null });
    expect(await verifyEmailOtp({ account: emailUser.email!, code: ' 123456 ' })).toEqual({
      status: 'authenticated', user: emailUser,
    });
    expect(mock.auth.verifyOtp).toHaveBeenCalledWith({ email: emailUser.email, token: '123456', type: 'email' });
  });

  it('rejects duplicate email signup when Supabase returns empty identities', async () => {
    mock.auth.signUp.mockResolvedValue({ data: { user: { id: emailUser.id, identities: [] }, session: null }, error: null });
    await expect(registerWithAccount({ account: emailUser.email!, password: 'secret-password', nickname: '邮箱' }))
      .rejects.toThrow('该邮箱已注册');
  });

  it('resends signup OTP via auth.resend with type signup', async () => {
    mock.auth.resend.mockResolvedValue({ data: { user: null, session: null }, error: null });
    await resendSignupOtp({ account: ' Target@Example.com ' });
    expect(mock.auth.resend).toHaveBeenCalledWith({
      type: 'signup', email: emailUser.email, options: { emailRedirectTo: expect.any(String) },
    });
  });

  it('sends login OTP with shouldCreateUser false and imports guest data only after OTP verifies', async () => {
    await loginAsGuest();
    saveStore({ records: {}, fav: { localQuestion: true }, mastery: {} });
    mock.auth.signInWithOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    await sendLoginOtp({ account: emailUser.email! });
    expect(mock.auth.signInWithOtp).toHaveBeenCalledWith({
      email: emailUser.email, options: { shouldCreateUser: false, emailRedirectTo: expect.any(String) },
    });

    mock.auth.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: new Error('otp_expired') });
    await expect(verifyEmailOtp({ account: emailUser.email!, code: '000000', importGuestData: true })).rejects.toThrow();
    expect(readPendingUpgrade()).toBeNull();
    expect(mock.upload).not.toHaveBeenCalled();

    signInAs(emailUser);
    mock.auth.verifyOtp.mockResolvedValueOnce({ data: { user: { id: emailUser.id }, session: { user: { id: emailUser.id } } }, error: null });
    expect(await verifyEmailOtp({ account: emailUser.email!, code: '246810', importGuestData: true })).toMatchObject({
      status: 'authenticated', user: emailUser, guestDataSynced: true,
    });
    expect(mock.upload).toHaveBeenCalledWith(emailUser.id, expect.any(Object), expect.objectContaining({
      progress: [{ bankId: 'builtin-ai-intro', store: { records: {}, fav: { localQuestion: true }, mastery: {} } }],
    }));
  });

  it('completes guest-to-account upgrade migration after verifying signup OTP', async () => {
    await loginAsGuest();
    const progress = { records: { q2: { ok: 1 as const, ts: 456 } }, fav: {}, mastery: {} };
    saveStore(progress);
    mock.auth.signUp.mockResolvedValue({ data: { user: { id: emailUser.id, identities: [{ id: '1' }] }, session: null }, error: null });
    expect(await upgradeGuestToAccount({ account: emailUser.email!, password: 'secret-password', nickname: '新同学' }))
      .toEqual({ status: 'email_confirmation_required', user: null });

    signInAs(emailUser);
    mock.auth.verifyOtp.mockResolvedValue({ data: { user: { id: emailUser.id }, session: { user: { id: emailUser.id } } }, error: null });
    expect(await verifyEmailOtp({ account: emailUser.email!, code: '123456' })).toMatchObject({
      status: 'authenticated', user: emailUser, guestDataSynced: true,
    });
    expect(mock.upload).toHaveBeenCalledWith(emailUser.id, expect.any(Object), expect.objectContaining({
      progress: [{ bankId: 'builtin-ai-intro', store: progress }],
    }));
  });
});
