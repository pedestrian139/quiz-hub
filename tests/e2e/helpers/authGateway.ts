import type { Page } from '@playwright/test';

interface TestProfile { user_id: string; email: string | null; phone: string | null; nickname: string }
interface TestAccount extends TestProfile { password: string; verified: boolean; authorizedEmail?: string }

function accessToken(id: string): string {
  const claims = { sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' };
  return `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test`;
}

export async function installAuthGateway(page: Page) {
  const accounts = new Map<string, TestAccount>();
  const imports: Record<string, unknown>[] = [];
  let acceptImports = true;
  let nextUser = 1;

  function addAccount(account: string, password: string, nickname: string, verified = true): TestAccount {
    const email = account.includes('@') ? account : null;
    const profile = { user_id: `5df790d6-0140-4194-a699-${String(nextUser++).padStart(12, '0')}`,
      email, phone: email ? null : account, nickname, password, verified };
    accounts.set(account, profile);
    return profile;
  }

  function authUser(account: TestAccount) {
    return { id: account.user_id, aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z',
      email: account.email ?? `${account.phone}@phone.quizhub.local`, is_anonymous: false,
      email_confirmed_at: account.verified ? '2026-01-01T00:00:00Z' : null,
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
    };
  }

  function authTokens(account: TestAccount) {
    return { access_token: accessToken(account.user_id), token_type: 'bearer', expires_in: 3600,
      refresh_token: `test-refresh-${account.user_id}`, user: authUser(account) };
  }

  await page.route('http://127.0.0.1:49391/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS', 'content-type': 'application/json',
      'x-supabase-api-version': '2024-01-01', 'access-control-expose-headers': 'x-supabase-api-version',
    };
    const respond = (json: unknown, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(json) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = (request.postDataJSON() ?? {}) as Record<string, string>;
    const signedIn = accountFromToken(request.headers().authorization);

    function accountFromToken(token: string | undefined): TestAccount | undefined {
      const payload = token?.split('.')[1];
      if (!payload) return;
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string };
        return [...accounts.values()].find(({ user_id }) => user_id === claims.sub);
      } catch { return undefined; }
    }

    switch (url.pathname) {
      case '/auth/v1/signup': {
        const options = (body as unknown as { data?: { nickname?: string } }).data;
        return respond(authUser(addAccount(body.email, body.password, options?.nickname ?? '刷题用户', false)));
      }
      case '/auth/v1/token': {
        const account = accounts.get(body.email);
        if (!account || account.password !== body.password) return respond({ code: 'invalid_credentials', msg: 'Invalid credentials' }, 400);
        if (!account.verified) return respond({ code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400);
        return respond(authTokens(account));
      }
      case '/auth/v1/user':
        if (!signedIn) return respond({ code: 'session_not_found', msg: 'Missing session' }, 401);
        if (request.method() === 'PUT' && signedIn.authorizedEmail !== body.email) {
          return respond({ code: 'validation_failed', msg: 'Email binding not authorized' }, 400);
        }
        return respond(authUser(signedIn));
      case '/auth/v1/logout':
        return route.fulfill({ status: 204, headers });
      case '/rest/v1/profiles': {
        if (!signedIn) return respond({ code: '42501', message: 'Forbidden' }, 403);
        const { user_id, email, phone, nickname } = signedIn;
        return respond({ user_id, email, phone, nickname });
      }
      case '/functions/v1/phone-auth': {
        if (body.action === 'register') {
          addAccount(body.phone, body.password, body.nickname);
          return respond({ ok: true });
        }
        if (body.action === 'authorize_email_link') {
          if (!signedIn || signedIn.user_id !== body.ownerId || signedIn.password !== body.password) {
            return respond({ error: '账号或密码不正确。' }, 401);
          }
          signedIn.authorizedEmail = body.email;
          return respond({ ok: true });
        }
        const account = accounts.get(body.phone);
        return account?.password === body.password ? respond(authTokens(account)) : respond({ error: '账号或密码不正确。' }, 401);
      }
      case '/functions/v1/user-data':
        if (!signedIn || signedIn.user_id !== body.ownerId) return respond({ error: '登录账号已变更。' }, 403);
        imports.push(body);
        return acceptImports ? respond({ skippedBankIds: [], skippedApiConfig: false }) : respond({ error: '同步暂不可用。' }, 503);
      default:
        throw new Error(`Unexpected auth gateway request ${request.method()} ${url.pathname}`);
    }
  });

  return {
    addAccount, imports,
    verifyEmail: (email: string) => { accounts.get(email)!.verified = true; },
    allowImports: (allowed: boolean) => { acceptImports = allowed; },
  };
}
