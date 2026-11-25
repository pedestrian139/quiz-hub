import { backendClient, HttpError, publicAuthClient, requiredString, requireOwner, serve } from '../_shared/edge.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';

const PHONE_DOMAIN = 'phone.quizhub.local';
const INVALID_LOGIN = '账号或密码不正确。';

function readPhone(value: unknown): string {
  const phone = requiredString(value, 15);
  if (!/^[0-9]{7,15}$/.test(phone)) throw new HttpError(400, '请输入 7–15 位数字手机号。');
  return phone;
}

async function consumeAttempt(admin: SupabaseClient, action: string, account: string): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(account));
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  const { data, error } = await admin.rpc('quizhub_take_phone_attempt', { p_action: action, p_account_hash: hash });
  if (error) throw error;
  if (!data) throw new HttpError(429, '尝试次数过多，请稍后再试。');
}

async function verifyPassword(email: string, password: string, userId: string): Promise<void> {
  const auth = publicAuthClient().auth;
  const { data, error } = await auth.signInWithPassword({ email, password });
  if (error || data.user?.id !== userId) throw new HttpError(401, INVALID_LOGIN);
  await auth.signOut({ scope: 'local' });
}

serve(async (req, body) => {
  const admin = backendClient();
  const password = requiredString(body.password, 1024);
  if (body.action === 'register') {
    const phone = readPhone(body.phone);
    const nickname = requiredString(body.nickname, 160).trim();
    if (!nickname || Array.from(nickname).length > 80) throw new HttpError(400, '昵称须为 1–80 个字符。');
    if (Array.from(password).length < 8 || new TextEncoder().encode(password).length > 72) {
      throw new HttpError(400, '密码至少需要 8 个字符，UTF-8 长度最多 72 字节。');
    }
    await consumeAttempt(admin, 'register', phone);
    const { error } = await admin.auth.admin.createUser({
      email: `${phone}@${PHONE_DOMAIN}`, password, email_confirm: true,
      app_metadata: { quizhub_phone_account: true }, user_metadata: { nickname },
    });
    if (error) throw new HttpError(400, '手机号注册失败。若已注册，请直接登录。');
    return { ok: true };
  }

  if (body.action === 'login') {
    const phone = readPhone(body.phone);
    await consumeAttempt(admin, 'login', phone);
    const { data: profile, error } = await admin.from('profiles').select('user_id,email').eq('phone', phone).maybeSingle();
    if (error) throw error;
    const email = profile?.email ?? `${phone}@${PHONE_DOMAIN}`;
    const { data, error: loginError } = await publicAuthClient().auth.signInWithPassword({ email, password });
    if (loginError || !data.session || data.user?.id !== profile?.user_id) throw new HttpError(401, INVALID_LOGIN);
    return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
  }

  if (body.action === 'link' || body.action === 'authorize_email_link') {
    const user = await requireOwner(req, body, admin);
    if (!user.email) throw new HttpError(401, '当前账号缺少登录标识。');
    await consumeAttempt(admin, 'link', user.id);
    await verifyPassword(user.email, password, user.id);
    if (body.action === 'authorize_email_link') {
      const email = requiredString(body.email, 254);
      const { error } = await admin.rpc('quizhub_authorize_first_email', { p_user_id: user.id, p_email: email });
      if (error) throw new HttpError(400, '无法授权绑定此邮箱。');
      return { ok: true };
    }

    const phone = readPhone(body.phone);
    const { data, error } = await admin.from('profiles').update({ phone }).eq('user_id', user.id)
      .or(`phone.is.null,phone.eq.${phone}`).select('user_id').maybeSingle();
    if (error?.code === '23505' || (!error && !data)) throw new HttpError(409, '无法绑定此手机号。');
    if (error) throw error;
    return { ok: true };
  }

  throw new HttpError(400, '未知鉴权操作。');
});
