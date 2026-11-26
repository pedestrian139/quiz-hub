-- Idempotent cleanup of obsolete phone-auth database objects.
-- Preserves public.profiles (including the legacy nullable phone column still selected
-- by src/services/db/cloudData.ts), public.user_api_configs, private.user_api_secrets,
-- public.quiz_banks, public.quiz_progress, and public.guest_imports.
begin;

drop trigger if exists quizhub_guard_email_link on auth.users;
drop function if exists private.guard_email_link();

drop trigger if exists quizhub_check_reserved_auth_alias on auth.users;
drop function if exists private.check_reserved_auth_alias();

drop function if exists public.quizhub_before_user_created(jsonb);
drop function if exists public.quizhub_authorize_first_email(uuid, text);
drop function if exists public.quizhub_take_phone_attempt(text, text);

drop table if exists private.first_email_links;
drop table if exists private.phone_auth_rate_limits;

revoke update (phone) on public.profiles from service_role;

-- Simplify auth.users -> public.profiles sync to the pure email + OTP registration flow.
create or replace function private.sync_auth_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  real_email text;
  display_name text;
begin
  if new.is_anonymous then return new; end if;
  if new.email_confirmed_at is not null and new.email is not null then
    real_email := lower(new.email);
  end if;
  display_name := coalesce(nullif(left(btrim(new.raw_user_meta_data->>'nickname'), 80), ''), '刷题用户');
  insert into public.profiles(user_id, email, nickname)
    values (new.id, real_email, display_name)
    on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;
revoke all on function private.sync_auth_profile() from public, anon, authenticated;

commit;
