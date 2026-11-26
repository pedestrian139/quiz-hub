import type { Page } from '@playwright/test';

export interface TestProfile { user_id: string; email: string | null; phone: string | null; nickname: string }
export interface TestAccount extends TestProfile { password: string; verified: boolean }

export interface CloudBankEntry {
  user_id: string;
  bank_id: string;
  name: string;
  description: string | null;
  source_format: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  data: Record<string, unknown>;
  revision: number;
  deleted_at: string | null;
}

export interface CloudProgressEntry {
  user_id: string;
  bank_id: string;
  store: {
    records: Record<string, unknown>;
    fav: Record<string, boolean>;
    mastery: Record<string, number>;
    aiExplanations?: Record<string, { content: string; updatedAt: number; model?: string }>;
  };
  revision: number;
  reset_at: string | null;
}

export interface CloudApiEntry {
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  apiKey: string;
}

function accessToken(id: string): string {
  const claims = { sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' };
  return `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test`;
}

export async function installAuthGateway(page: Page) {
  const accounts = new Map<string, TestAccount>();
  const otpByEmail = new Map<string, string>();
  const banksByUser = new Map<string, Map<string, CloudBankEntry>>();
  const progressByUser = new Map<string, Map<string, CloudProgressEntry>>();
  const apiConfigByUser = new Map<string, CloudApiEntry>();

  const imports: Record<string, unknown>[] = [];
  const apiSaveCalls: Array<{ userId: string; config: Record<string, unknown> }> = [];
  const apiClearCalls: string[] = [];
  const saveBankCalls: Array<{
    bankId: string;
    revision: number;
    updatedAt: number;
    payload: CloudBankEntry;
  }> = [];
  const saveProgressCalls: Array<{
    bankId: string;
    revision: number;
    reset: boolean;
    store: CloudProgressEntry['store'];
  }> = [];
  let acceptImports = true;
  let acceptApiSaves = true;
  let nextUser = 1;

  function userBanks(userId: string): Map<string, CloudBankEntry> {
    let map = banksByUser.get(userId);
    if (!map) {
      map = new Map();
      banksByUser.set(userId, map);
    }
    return map;
  }

  function userProgress(userId: string): Map<string, CloudProgressEntry> {
    let map = progressByUser.get(userId);
    if (!map) {
      map = new Map();
      progressByUser.set(userId, map);
    }
    return map;
  }

  function addAccount(email: string, password: string, nickname: string, verified = true): TestAccount {
    const normalized = email.trim().toLowerCase();
    const existing = accounts.get(normalized);
    if (existing) {
      existing.password = password;
      existing.nickname = nickname;
      existing.verified = verified;
      return existing;
    }
    const profile: TestAccount = {
      user_id: `5df790d6-0140-4194-a699-${String(nextUser++).padStart(12, '0')}`,
      email: normalized,
      phone: null,
      nickname,
      password,
      verified,
    };
    accounts.set(normalized, profile);
    return profile;
  }

  function authUser(account: TestAccount, includeIdentities = true) {
    return {
      id: account.user_id,
      aud: 'authenticated',
      role: 'authenticated',
      created_at: '2026-01-01T00:00:00Z',
      email: account.email ?? '',
      is_anonymous: false,
      email_confirmed_at: account.verified ? '2026-01-01T00:00:00Z' : null,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { nickname: account.nickname },
      identities: includeIdentities
        ? [{ identity_id: account.user_id, id: account.user_id, user_id: account.user_id, provider: 'email' }]
        : [],
    };
  }

  function authTokens(account: TestAccount) {
    return {
      access_token: accessToken(account.user_id),
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: `test-refresh-${account.user_id}`,
      user: authUser(account),
    };
  }

  function toApiRow(entry: CloudApiEntry) {
    return {
      provider: entry.provider,
      base_url: entry.baseUrl,
      model: entry.model,
      temperature: entry.temperature,
      max_tokens: entry.maxTokens,
      timeout_ms: entry.timeoutMs,
      has_key: Boolean(entry.apiKey),
    };
  }

  await page.route('http://127.0.0.1:49391/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
      'content-type': 'application/json',
      'x-supabase-api-version': '2024-01-01',
      'access-control-expose-headers': 'x-supabase-api-version',
    };
    const respond = (json: unknown, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(json) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const signedIn = accountFromToken(request.headers().authorization);

    function accountFromToken(token: string | undefined): TestAccount | undefined {
      const payload = token?.split('.')[1];
      if (!payload) return undefined;
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string };
        return [...accounts.values()].find(({ user_id }) => user_id === claims.sub);
      } catch {
        return undefined;
      }
    }

    switch (url.pathname) {
      case '/auth/v1/signup': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const password = String(body.password ?? '');
        const existing = accounts.get(email);
        if (existing?.verified) {
          return respond(authUser(existing, false));
        }
        const options = (body.data ?? {}) as { nickname?: string };
        const account = addAccount(email, password, options.nickname ?? '刷题用户', false);
        otpByEmail.set(email, '123456');
        return respond(authUser(account));
      }
      case '/auth/v1/resend': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const existing = accounts.get(email);
        if (!existing || existing.verified) {
          return respond({ code: 'validation_failed', msg: 'Email already confirmed or missing' }, 400);
        }
        otpByEmail.set(email, '654321');
        return respond({});
      }
      case '/auth/v1/otp': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const existing = accounts.get(email);
        if (body.create_user === false && (!existing || !existing.verified)) {
          return respond({ code: 'otp_disabled', msg: 'Signups not allowed for otp' }, 400);
        }
        if (!existing) addAccount(email, '', '刷题用户', false);
        otpByEmail.set(email, '246810');
        return respond({});
      }
      case '/auth/v1/verify': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const token = String(body.token ?? '');
        const verifyType = String(body.type ?? '');
        const account = accounts.get(email);
        if (verifyType !== 'email' || !account || otpByEmail.get(email) !== token) {
          return respond({ code: 'otp_expired', msg: 'Token has expired or is invalid' }, 400);
        }
        account.verified = true;
        otpByEmail.delete(email);
        return respond(authTokens(account));
      }
      case '/auth/v1/token': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const account = accounts.get(email);
        if (!account || account.password !== body.password) {
          return respond({ code: 'invalid_credentials', msg: 'Invalid credentials' }, 400);
        }
        if (!account.verified) {
          return respond({ code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400);
        }
        return respond(authTokens(account));
      }
      case '/auth/v1/user':
        if (!signedIn) return respond({ code: 'session_not_found', msg: 'Missing session' }, 401);
        return respond(authUser(signedIn));
      case '/auth/v1/logout':
        return route.fulfill({ status: 204, headers });
      case '/rest/v1/profiles': {
        if (!signedIn) return respond({ code: '42501', message: 'Forbidden' }, 403);
        const { user_id, email, phone, nickname } = signedIn;
        return respond({ user_id, email, phone, nickname });
      }
      case '/rest/v1/quiz_banks': {
        if (!signedIn) return respond({ code: '42501', message: 'Forbidden' }, 403);
        const rows = [...userBanks(signedIn.user_id).values()]
          .filter((row) => !row.deleted_at)
          .sort((a, b) => b.updated_at_ms - a.updated_at_ms)
          .map(({ deleted_at: _deleted, user_id: _uid, ...row }) => row);
        return respond(rows);
      }
      case '/rest/v1/quiz_progress': {
        if (!signedIn) return respond({ code: '42501', message: 'Forbidden' }, 403);
        const bankFilter = url.searchParams.get('bank_id');
        const map = userProgress(signedIn.user_id);
        if (bankFilter?.startsWith('eq.')) {
          const targetId = bankFilter.slice(3);
          const entry = map.get(targetId);
          return respond(entry ? [{ store: entry.store, revision: entry.revision, reset_at: entry.reset_at }] : []);
        }
        return respond([...map.values()].map(({ bank_id, store, revision, reset_at }) => ({ bank_id, store, revision, reset_at })));
      }
      case '/rest/v1/user_api_configs': {
        if (!signedIn) return respond({ code: '42501', message: 'Forbidden' }, 403);
        const entry = apiConfigByUser.get(signedIn.user_id);
        return respond(entry ? [toApiRow(entry)] : []);
      }
      case '/rest/v1/rpc/quizhub_save_bank': {
        if (!signedIn) return respond({ code: '42501', message: 'Authentication required' }, 401);
        const pBank = body.p_bank as {
          id: string;
          name: string;
          description?: string;
          sourceFormat?: string;
          createdAt: number;
          updatedAt: number;
          data: Record<string, unknown>;
        };
        const pRevision = Number(body.p_revision ?? 0);
        const map = userBanks(signedIn.user_id);
        const existing = map.get(pBank.id);

        if (pRevision === 0) {
          if (existing && !existing.deleted_at) {
            return respond({ code: '40001', message: 'Bank changed or was deleted' }, 409);
          }
          const created: CloudBankEntry = {
            user_id: signedIn.user_id,
            bank_id: pBank.id,
            name: pBank.name,
            description: pBank.description ?? null,
            source_format: pBank.sourceFormat ?? null,
            created_at_ms: pBank.createdAt,
            updated_at_ms: pBank.updatedAt,
            data: pBank.data,
            revision: (existing?.revision ?? 0) + 1,
            deleted_at: null,
          };
          map.set(pBank.id, created);
          saveBankCalls.push({
            bankId: created.bank_id,
            revision: created.revision,
            updatedAt: created.updated_at_ms,
            payload: structuredClone(created),
          });
          const { deleted_at: _deleted, user_id: _uid, ...row } = created;
          return respond(row);
        }

        if (!existing || existing.deleted_at || existing.revision !== pRevision) {
          return respond({ code: '40001', message: 'Bank changed or was deleted' }, 409);
        }
        const updated: CloudBankEntry = {
          ...existing,
          name: pBank.name,
          description: pBank.description ?? null,
          source_format: pBank.sourceFormat ?? existing.source_format,
          updated_at_ms: pBank.updatedAt,
          data: pBank.data,
          revision: existing.revision + 1,
        };
        map.set(pBank.id, updated);
        saveBankCalls.push({
          bankId: updated.bank_id,
          revision: updated.revision,
          updatedAt: updated.updated_at_ms,
          payload: structuredClone(updated),
        });
        const { deleted_at: _deleted, user_id: _uid, ...row } = updated;
        return respond(row);
      }
      case '/rest/v1/rpc/quizhub_delete_bank': {
        if (!signedIn) return respond({ code: '42501', message: 'Authentication required' }, 401);
        const bankId = String(body.p_bank_id ?? '');
        const pRevision = Number(body.p_revision ?? 0);
        const map = userBanks(signedIn.user_id);
        const existing = map.get(bankId);
        if (!existing || existing.deleted_at || existing.revision !== pRevision) {
          return respond({ code: '40001', message: 'Bank changed or was deleted' }, 409);
        }
        existing.deleted_at = new Date().toISOString();
        existing.revision += 1;
        userProgress(signedIn.user_id).delete(bankId);
        return route.fulfill({ status: 204, headers });
      }
      case '/rest/v1/rpc/quizhub_save_progress': {
        if (!signedIn) return respond({ code: '42501', message: 'Authentication required' }, 401);
        const bankId = String(body.p_bank_id ?? '');
        if (bankId !== 'builtin-ai-intro') {
          const bank = userBanks(signedIn.user_id).get(bankId);
          if (!bank || bank.deleted_at) {
            return respond({ code: '42501', message: 'Bank not found' }, 403);
          }
        }
        const pRevision = Number(body.p_revision ?? 0);
        const pReset = Boolean(body.p_reset);
        const nextStore = pReset
          ? { records: {}, fav: {}, mastery: {} }
          : (body.p_store as CloudProgressEntry['store']);
        const map = userProgress(signedIn.user_id);
        const existing = map.get(bankId);

        if (pRevision === 0) {
          if (existing) {
            return respond({ code: '40001', message: 'Progress changed' }, 409);
          }
          const created: CloudProgressEntry = {
            user_id: signedIn.user_id,
            bank_id: bankId,
            store: nextStore,
            revision: 1,
            reset_at: pReset ? new Date().toISOString() : null,
          };
          map.set(bankId, created);
          saveProgressCalls.push({
            bankId,
            revision: created.revision,
            reset: pReset,
            store: structuredClone(created.store),
          });
          return respond({ store: created.store, revision: created.revision, reset_at: created.reset_at });
        }

        if (!existing || existing.revision !== pRevision) {
          return respond({ code: '40001', message: 'Progress changed' }, 409);
        }
        const updated: CloudProgressEntry = {
          ...existing,
          store: nextStore,
          revision: existing.revision + 1,
          reset_at: pReset ? new Date().toISOString() : existing.reset_at,
        };
        map.set(bankId, updated);
        saveProgressCalls.push({
          bankId,
          revision: updated.revision,
          reset: pReset,
          store: structuredClone(updated.store),
        });
        return respond({ store: updated.store, revision: updated.revision, reset_at: updated.reset_at });
      }
      case '/functions/v1/user-data': {
        if (!signedIn || signedIn.user_id !== body.ownerId) return respond({ error: '登录账号已变更。' }, 403);
        switch (body.action) {
          case 'save_api_config': {
            if (!acceptApiSaves) return respond({ error: '云端保存暂不可用。' }, 503);
            const cfg = body.config as CloudApiEntry & { storageScope?: string };
            if (cfg?.storageScope !== 'local') return respond({ error: 'API 配置字段无效。' }, 400);
            apiConfigByUser.set(signedIn.user_id, { ...cfg });
            apiSaveCalls.push({ userId: signedIn.user_id, config: cfg as unknown as Record<string, unknown> });
            return respond(toApiRow(cfg));
          }
          case 'restore_api_config': {
            const existing = apiConfigByUser.get(signedIn.user_id);
            return respond(existing ? { config: toApiRow(existing), apiKey: existing.apiKey } : { config: null, apiKey: '' });
          }
          case 'clear_api_config': {
            apiConfigByUser.delete(signedIn.user_id);
            apiClearCalls.push(signedIn.user_id);
            return respond({ ok: true });
          }
          case 'import_guest': {
            imports.push(body);
            if (!acceptImports) return respond({ error: '同步暂不可用。' }, 503);
            const incomingBanks = (Array.isArray(body.banks) ? body.banks : []) as Array<{
              id: string; name: string; description?: string; sourceFormat?: string; createdAt: number; updatedAt: number; data: Record<string, unknown>;
            }>;
            const bankMap = userBanks(signedIn.user_id);
            for (const bank of incomingBanks) {
              if (!bankMap.has(bank.id)) {
                bankMap.set(bank.id, {
                  user_id: signedIn.user_id,
                  bank_id: bank.id,
                  name: bank.name,
                  description: bank.description ?? null,
                  source_format: bank.sourceFormat ?? null,
                  created_at_ms: bank.createdAt,
                  updated_at_ms: bank.updatedAt,
                  data: bank.data,
                  revision: 1,
                  deleted_at: null,
                });
              }
            }
            const incomingProgress = (Array.isArray(body.progress) ? body.progress : []) as Array<{
              bankId: string; store: CloudProgressEntry['store'];
            }>;
            const progMap = userProgress(signedIn.user_id);
            for (const item of incomingProgress) {
              const prev = progMap.get(item.bankId);
              progMap.set(item.bankId, {
                user_id: signedIn.user_id,
                bank_id: item.bankId,
                store: item.store,
                revision: (prev?.revision ?? 0) + 1,
                reset_at: prev?.reset_at ?? null,
              });
            }
            if (body.apiConfig && !apiConfigByUser.has(signedIn.user_id)) {
              apiConfigByUser.set(signedIn.user_id, { ...(body.apiConfig as CloudApiEntry) });
            }
            return respond({ skippedBankIds: [], skippedApiConfig: false });
          }
          default:
            throw new Error(`Unexpected user-data action ${String(body.action)}`);
        }
      }
      default:
        throw new Error(`Unexpected auth gateway request ${request.method()} ${url.pathname}`);
    }
  });

  return {
    addAccount,
    imports,
    apiSaveCalls,
    apiClearCalls,
    saveBankCalls,
    saveProgressCalls,
    allowImports: (allowed: boolean) => { acceptImports = allowed; },
    allowApiSaves: (allowed: boolean) => { acceptApiSaves = allowed; },
    getCloudBanks: (email: string) => {
      const account = accounts.get(email.trim().toLowerCase());
      return account ? [...userBanks(account.user_id).values()].filter((b) => !b.deleted_at) : [];
    },
    getCloudProgress: (email: string, bankId: string) => {
      const account = accounts.get(email.trim().toLowerCase());
      return account ? userProgress(account.user_id).get(bankId) ?? null : null;
    },
    getCloudApiConfig: (email: string) => {
      const account = accounts.get(email.trim().toLowerCase());
      return account ? apiConfigByUser.get(account.user_id) ?? null : null;
    },
    mutateCloudProgressExternally: (
      email: string,
      bankId: string,
      mutator: (prev: CloudProgressEntry['store']) => CloudProgressEntry['store'],
    ) => {
      const account = accounts.get(email.trim().toLowerCase());
      if (!account) throw new Error(`Account ${email} not found`);
      const map = userProgress(account.user_id);
      const prev = map.get(bankId) ?? {
        user_id: account.user_id,
        bank_id: bankId,
        store: { records: {}, fav: {}, mastery: {} },
        revision: 0,
        reset_at: null,
      };
      const updated: CloudProgressEntry = {
        ...prev,
        store: mutator(prev.store),
        revision: prev.revision + 1,
      };
      map.set(bankId, updated);
      return updated;
    },
    mutateCloudBankExternally: (
      email: string,
      bankId: string,
      mutator: (prev: CloudBankEntry) => CloudBankEntry,
    ) => {
      const account = accounts.get(email.trim().toLowerCase());
      if (!account) throw new Error(`Account ${email} not found`);
      const map = userBanks(account.user_id);
      const prev = map.get(bankId);
      if (!prev || prev.deleted_at) {
        throw new Error(`Cloud bank ${bankId} not found for ${email}`);
      }
      const mutated = mutator(structuredClone(prev));
      const updated: CloudBankEntry = {
        ...mutated,
        user_id: account.user_id,
        bank_id: bankId,
        revision: prev.revision + 1,
      };
      map.set(bankId, updated);
      return updated;
    },
  };
}
