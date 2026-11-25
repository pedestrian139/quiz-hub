begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text check (email = lower(email) and split_part(email, '@', 2) <> 'phone.quizhub.local'),
  phone text unique check (phone ~ '^[0-9]{7,15}$'),
  nickname text not null check (char_length(btrim(nickname)) between 1 and 80),
  is_guest boolean not null default false check (not is_guest),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_unique on public.profiles(email) where email is not null;

create table public.user_api_configs (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  provider text not null check (provider in ('deepseek', 'openai', 'siliconflow', 'zhipu', 'dashscope', 'moonshot', 'gemini', 'custom')),
  base_url text not null check (base_url = '' or base_url ~ '^https?://'),
  model text not null,
  temperature numeric(3,2) not null check (temperature between 0 and 2),
  max_tokens integer not null check (max_tokens between 64 and 16384),
  timeout_ms integer not null check (timeout_ms between 5000 and 180000),
  storage_scope text not null default 'local' check (storage_scope = 'local'),
  has_key boolean not null default false,
  import_source_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table private.user_api_secrets (
  user_id uuid primary key references public.user_api_configs(user_id) on delete cascade,
  ciphertext bytea not null check (octet_length(ciphertext) > 16),
  nonce bytea not null check (octet_length(nonce) = 12),
  key_version smallint not null check (key_version > 0),
  updated_at timestamptz not null default now()
);

create table public.quiz_banks (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  bank_id text not null check (char_length(bank_id) between 1 and 512),
  name text not null check (btrim(name) <> ''),
  description text,
  builtin boolean not null default false,
  source_format text check (source_format in ('xlsx', 'csv', 'docx', 'txt', 'json', 'manual')),
  created_at_ms bigint not null check (created_at_ms >= 0),
  updated_at_ms bigint not null check (updated_at_ms >= 0),
  data jsonb,
  revision bigint not null default 1 check (revision > 0),
  import_source_id uuid,
  deleted_at timestamptz,
  primary key (user_id, bank_id),
  check ((builtin and bank_id = 'builtin-ai-intro' and data is null and deleted_at is null)
    or (not builtin and bank_id <> 'builtin-ai-intro' and data is not null
      and coalesce(jsonb_typeof(data->'meta') = 'object'
        and jsonb_typeof(data->'chapters') = 'array'
        and jsonb_typeof(data->'questions') = 'array', false)))
);

create table public.quiz_progress (
  user_id uuid not null,
  bank_id text not null,
  store jsonb not null check (coalesce(jsonb_typeof(store->'records') = 'object'
    and jsonb_typeof(store->'fav') = 'object' and jsonb_typeof(store->'mastery') = 'object', false)),
  revision bigint not null default 1 check (revision > 0),
  reset_at timestamptz,
  import_source_id uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, bank_id),
  foreign key (user_id, bank_id) references public.quiz_banks(user_id, bank_id) on delete cascade
);

create table public.guest_imports (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  import_id uuid not null,
  source_id uuid not null,
  source_version bigint not null check (source_version > 0),
  result jsonb not null,
  committed_at timestamptz not null default now(),
  primary key (user_id, import_id),
  unique (user_id, source_id, source_version)
);

create table private.phone_auth_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  primary key (bucket, window_start)
);

create table private.first_email_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  expires_at timestamptz not null
);

alter table public.profiles enable row level security;
alter table public.user_api_configs enable row level security;
alter table private.user_api_secrets enable row level security;
alter table public.quiz_banks enable row level security;
alter table public.quiz_progress enable row level security;
alter table public.guest_imports enable row level security;
alter table private.phone_auth_rate_limits enable row level security;
alter table private.first_email_links enable row level security;

revoke all on public.profiles, public.user_api_configs, private.user_api_secrets,
  public.quiz_banks, public.quiz_progress, public.guest_imports, private.phone_auth_rate_limits, private.first_email_links
  from public, anon, authenticated;
grant select on public.profiles, public.user_api_configs, public.quiz_banks, public.quiz_progress,
  public.guest_imports to authenticated;
grant update (nickname) on public.profiles to authenticated;
grant select on public.profiles to service_role;
grant update (phone) on public.profiles to service_role;

create policy own_profile on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy edit_own_profile on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_api_config on public.user_api_configs for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);
create policy own_banks on public.quiz_banks for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);
create policy own_progress on public.quiz_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy own_imports on public.guest_imports for select to authenticated using ((select auth.uid()) = user_id);

create function private.touch_profile() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger quizhub_touch_profile before update on public.profiles
  for each row execute function private.touch_profile();

create function private.sync_auth_profile() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  real_email text;
  login_phone text;
  display_name text;
begin
  if new.is_anonymous then return new; end if;
  if split_part(lower(new.email), '@', 2) = 'phone.quizhub.local' then
    -- Auth creates the row before applying trusted app metadata and email confirmation.
    if new.raw_app_meta_data->>'quizhub_phone_account' is distinct from 'true'
      or new.email_confirmed_at is null then return new; end if;
    login_phone := split_part(new.email, '@', 1);
  elsif new.email_confirmed_at is not null then
    real_email := lower(new.email);
  end if;
  display_name := coalesce(nullif(left(btrim(new.raw_user_meta_data->>'nickname'), 80), ''), '刷题用户');
  insert into public.profiles(user_id, email, phone, nickname)
    values (new.id, real_email, login_phone, display_name)
    on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;
create trigger quizhub_sync_auth_profile after insert or update of email, email_confirmed_at, raw_app_meta_data on auth.users
  for each row execute function private.sync_auth_profile();

create function private.check_reserved_auth_alias() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if split_part(lower(new.email), '@', 2) = 'phone.quizhub.local' and exists (
    select 1 from auth.users where id = new.id and split_part(lower(email), '@', 2) = 'phone.quizhub.local'
      and raw_app_meta_data->>'quizhub_phone_account' is distinct from 'true'
  ) then
    raise exception 'Reserved account domain';
  end if;
  return null;
end;
$$;
create constraint trigger quizhub_check_reserved_auth_alias
  after insert or update of email, raw_app_meta_data on auth.users deferrable initially deferred
  for each row execute function private.check_reserved_auth_alias();

insert into public.profiles(user_id, email, nickname)
select id, case when email_confirmed_at is not null then lower(email) end,
  coalesce(nullif(left(btrim(raw_user_meta_data->>'nickname'), 80), ''), '刷题用户')
from auth.users where not is_anonymous
  and coalesce(split_part(lower(email), '@', 2), '') <> 'phone.quizhub.local';

-- Configure this function as the Auth Before User Created hook.
create function public.quizhub_before_user_created(event jsonb) returns jsonb language sql stable set search_path = '' as $$
  select case when split_part(lower(event->'user'->>'email'), '@', 2) = 'phone.quizhub.local'
    and event->'user'->'app_metadata'->>'quizhub_phone_account' is distinct from 'true'
    then '{"error":{"http_code":400,"message":"Invalid email address"}}'::jsonb else '{}'::jsonb end;
$$;
revoke all on function public.quizhub_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.quizhub_before_user_created(jsonb) to supabase_auth_admin;

create function public.quizhub_authorize_first_email(p_user_id uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_email is null or char_length(p_email) > 254 or p_email <> lower(p_email)
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or split_part(p_email, '@', 2) = 'phone.quizhub.local' then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  perform 1 from auth.users where id = p_user_id and email_confirmed_at is not null
    and split_part(email, '@', 2) = 'phone.quizhub.local' and raw_app_meta_data->>'quizhub_phone_account' = 'true'
    for update;
  if not found then raise exception 'Account is ineligible for first email binding' using errcode = '42501'; end if;
  insert into private.first_email_links(user_id, email, expires_at) values (p_user_id, p_email, now() + interval '1 hour')
    on conflict (user_id) do update set email = excluded.email, expires_at = excluded.expires_at;
end;
$$;
revoke all on function public.quizhub_authorize_first_email(uuid, text) from public, anon, authenticated;
grant execute on function public.quizhub_authorize_first_email(uuid, text) to service_role;

-- The one-mailbox Auth flow is restricted to an explicitly authorized first binding.
create function private.guard_email_link() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  email_changed boolean := new.email is distinct from old.email;
  target_email text;
begin
  if email_changed then
    target_email := new.email;
  elsif nullif(new.email_change, '') is not null and new.email_change is distinct from old.email_change then
    target_email := new.email_change;
  else
    return new;
  end if;
  if split_part(coalesce(old.email, ''), '@', 2) <> 'phone.quizhub.local'
    or old.raw_app_meta_data->>'quizhub_phone_account' is distinct from 'true' then
    raise exception 'Only first email binding is supported' using errcode = '42501';
  end if;
  if email_changed then
    if old.email_change is distinct from target_email or nullif(new.email_change, '') is not null then
      raise exception 'Email confirmation is required' using errcode = '42501';
    end if;
    delete from private.first_email_links where user_id = old.id and email = target_email and expires_at > now();
  else
    perform 1 from private.first_email_links where user_id = old.id and email = target_email and expires_at > now();
  end if;
  if not found then raise exception 'Email binding authorization missing or expired' using errcode = '42501'; end if;
  return new;
end;
$$;
create trigger quizhub_guard_email_link before update of email, email_change on auth.users
  for each row execute function private.guard_email_link();
revoke all on function private.guard_email_link() from public, anon, authenticated;

create function public.quizhub_take_phone_attempt(p_action text, p_account_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  period timestamptz := date_bin('15 minutes', now(), '2000-01-01 00:00:00+00');
  overall_limit integer;
  account_limit integer;
begin
  if p_action not in ('register', 'login', 'link') or p_account_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid rate-limit input';
  end if;
  overall_limit := case p_action when 'register' then 60 else 600 end;
  account_limit := case p_action when 'register' then 4 else 12 end;
  delete from private.phone_auth_rate_limits where window_start < period - interval '1 day';
  insert into private.phone_auth_rate_limits as counter(bucket, window_start)
    values (p_action || ':overall', period)
    on conflict (bucket, window_start) do update set attempts = counter.attempts + 1
    where counter.attempts < overall_limit;
  if not found then return false; end if;
  insert into private.phone_auth_rate_limits as counter(bucket, window_start)
    values (p_action || ':account:' || p_account_hash, period)
    on conflict (bucket, window_start) do update set attempts = counter.attempts + 1
    where counter.attempts < account_limit;
  return found;
end;
$$;
revoke all on function public.quizhub_take_phone_attempt(text, text) from public, anon, authenticated;
grant execute on function public.quizhub_take_phone_attempt(text, text) to service_role;

create function private.ensure_builtin(p_user_id uuid) returns void language sql set search_path = '' as $$
  insert into public.quiz_banks(user_id, bank_id, name, builtin, created_at_ms, updated_at_ms)
    values (p_user_id, 'builtin-ai-intro', '人工智能导论', true, 0, 0)
    on conflict (user_id, bank_id) do nothing;
$$;

create function private.insert_custom_bank(p_user_id uuid, p_bank jsonb, p_import_source_id uuid default null) returns public.quiz_banks
language plpgsql set search_path = '' as $$
declare result public.quiz_banks;
begin
  if (p_bank->>'builtin')::boolean is distinct from false then raise exception 'Expected a custom bank'; end if;
  insert into public.quiz_banks as stored(user_id, bank_id, name, description, source_format, created_at_ms, updated_at_ms,
    data, import_source_id)
    values (p_user_id, p_bank->>'id', p_bank->>'name', p_bank->>'description', p_bank->>'sourceFormat',
      (p_bank->>'createdAt')::bigint, (p_bank->>'updatedAt')::bigint, p_bank->'data', p_import_source_id)
    on conflict (user_id, bank_id) do update set name = excluded.name, description = excluded.description,
      source_format = excluded.source_format, updated_at_ms = excluded.updated_at_ms, data = excluded.data,
      revision = stored.revision + 1, deleted_at = null
    where stored.import_source_id = excluded.import_source_id
    returning * into result;
  return result;
end;
$$;

create function public.quizhub_save_bank(p_bank jsonb, p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  result public.quiz_banks;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  if p_revision = 0 then
    result := private.insert_custom_bank(owner_id, p_bank);
  else
    update public.quiz_banks set name = p_bank->>'name', description = p_bank->>'description',
      source_format = p_bank->>'sourceFormat', updated_at_ms = (p_bank->>'updatedAt')::bigint,
      data = p_bank->'data', import_source_id = null, revision = revision + 1
      where user_id = owner_id and bank_id = p_bank->>'id' and not builtin
        and deleted_at is null and revision = p_revision returning * into result;
  end if;
  if result.bank_id is null then raise exception 'Bank changed or was deleted' using errcode = '40001'; end if;
  return to_jsonb(result);
end;
$$;

create function public.quizhub_delete_bank(p_bank_id text, p_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  update public.quiz_banks set deleted_at = now(), import_source_id = null, revision = revision + 1
    where user_id = owner_id and bank_id = p_bank_id and not builtin and deleted_at is null and revision = p_revision;
  if not found then raise exception 'Bank changed or was deleted' using errcode = '40001'; end if;
  delete from public.quiz_progress where user_id = owner_id and bank_id = p_bank_id;
end;
$$;

create function public.quizhub_save_progress(p_bank_id text, p_store jsonb, p_revision bigint, p_reset boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  result public.quiz_progress;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  if p_bank_id = 'builtin-ai-intro' then perform private.ensure_builtin(owner_id); end if;
  if not exists (select 1 from public.quiz_banks where user_id = owner_id and bank_id = p_bank_id and deleted_at is null) then
    raise exception 'Bank not found' using errcode = '42501';
  end if;
  if p_reset then p_store := '{"records":{},"fav":{},"mastery":{}}'; end if;
  if p_revision = 0 then
    insert into public.quiz_progress(user_id, bank_id, store, reset_at)
      values (owner_id, p_bank_id, p_store, case when p_reset then now() end)
      on conflict (user_id, bank_id) do nothing returning * into result;
  else
    update public.quiz_progress set store = p_store, revision = revision + 1, import_source_id = null,
      reset_at = case when p_reset then now() else reset_at end, updated_at = now()
      where user_id = owner_id and bank_id = p_bank_id and revision = p_revision returning * into result;
  end if;
  if result.bank_id is null then raise exception 'Progress changed' using errcode = '40001'; end if;
  return to_jsonb(result);
end;
$$;

create function public.quizhub_set_api_config(p_user_id uuid, p_config jsonb, p_secret jsonb, p_import_source_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.user_api_configs;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  insert into public.user_api_configs(user_id, provider, base_url, model, temperature, max_tokens, timeout_ms, has_key, import_source_id)
    values (p_user_id, p_config->>'provider', p_config->>'baseUrl', p_config->>'model',
      (p_config->>'temperature')::numeric, (p_config->>'maxTokens')::integer,
      (p_config->>'timeoutMs')::integer, p_secret is not null, p_import_source_id)
    on conflict (user_id) do update set provider = excluded.provider, base_url = excluded.base_url,
      model = excluded.model, temperature = excluded.temperature, max_tokens = excluded.max_tokens,
      timeout_ms = excluded.timeout_ms, has_key = excluded.has_key, import_source_id = excluded.import_source_id, deleted_at = null,
      updated_at = now()
    returning * into result;
  if p_secret is null then
    delete from private.user_api_secrets where user_id = p_user_id;
  else
    insert into private.user_api_secrets(user_id, ciphertext, nonce, key_version)
      values (p_user_id, decode(p_secret->>'ciphertext', 'base64'), decode(p_secret->>'nonce', 'base64'),
        (p_secret->>'keyVersion')::smallint)
      on conflict (user_id) do update set ciphertext = excluded.ciphertext, nonce = excluded.nonce,
        key_version = excluded.key_version, updated_at = now();
  end if;
  return to_jsonb(result);
end;
$$;

create function public.quizhub_restore_api_config(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('config', to_jsonb(config), 'secret', case when secret.user_id is not null then
    jsonb_build_object('ciphertext', encode(secret.ciphertext, 'base64'), 'nonce', encode(secret.nonce, 'base64'),
      'keyVersion', secret.key_version) end)
  from public.user_api_configs config left join private.user_api_secrets secret using (user_id)
  where config.user_id = p_user_id and config.deleted_at is null;
$$;

create function public.quizhub_clear_api_config(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from private.user_api_secrets where user_id = p_user_id;
  update public.user_api_configs set has_key = false, import_source_id = null, deleted_at = now(), updated_at = now()
    where user_id = p_user_id and deleted_at is null;
end;
$$;

create function private.merge_guest_progress(p_cloud jsonb, p_guest jsonb, p_reset_at timestamptz) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  records jsonb := p_cloud->'records';
  incoming_records jsonb;
  favorites jsonb := p_guest->'fav';
  mastery jsonb := p_guest->'mastery';
  reset_ms numeric := extract(epoch from p_reset_at) * 1000;
begin
  if p_reset_at is not null then
    -- Legacy favorites and mastery do not have timestamps. Only carry them for questions answered after the reset.
    select coalesce(jsonb_object_agg(key, value), '{}') into favorites from jsonb_each(favorites)
      where (p_guest->'records'->key->>'ts')::numeric > reset_ms;
    select coalesce(jsonb_object_agg(key, value), '{}') into mastery from jsonb_each(mastery)
      where (p_guest->'records'->key->>'ts')::numeric > reset_ms;
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}') into incoming_records from jsonb_each(p_guest->'records')
    where (reset_ms is null or (value->>'ts')::numeric > reset_ms)
      and (not (records ? key) or (value->>'ts')::numeric > (records->key->>'ts')::numeric);
  return jsonb_build_object('records', records || incoming_records, 'fav', favorites || (p_cloud->'fav'),
    'mastery', mastery || (p_cloud->'mastery'));
end;
$$;

create function public.quizhub_import_guest(p_user_id uuid, p_import_id uuid, p_source_id uuid, p_source_version bigint,
  p_banks jsonb, p_progress jsonb, p_api_config jsonb, p_secret jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bank jsonb;
  imported_bank public.quiz_banks;
  progress jsonb;
  skipped_banks text[] := '{}';
  skipped_api_config boolean := false;
  latest_version bigint;
  outcome jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select result into outcome from public.guest_imports where user_id = p_user_id and import_id = p_import_id;
  if found then return outcome; end if;
  select max(source_version) into latest_version from public.guest_imports where user_id = p_user_id and source_id = p_source_id;
  if latest_version >= p_source_version then return jsonb_build_object('supersededBy', latest_version); end if;
  perform private.ensure_builtin(p_user_id);
  update public.quiz_banks as prior_bank set deleted_at = now(), revision = revision + 1
    where prior_bank.user_id = p_user_id and prior_bank.import_source_id = p_source_id and prior_bank.deleted_at is null
      and not exists (select 1 from jsonb_array_elements(p_banks) as incoming where incoming->>'id' = prior_bank.bank_id);
  delete from public.quiz_progress as prior_progress
    where prior_progress.user_id = p_user_id and prior_progress.import_source_id = p_source_id
      and not exists (select 1 from jsonb_array_elements(p_progress) as incoming where incoming->>'bankId' = prior_progress.bank_id);
  for bank in select value from jsonb_array_elements(p_banks) loop
    imported_bank := private.insert_custom_bank(p_user_id, bank, p_source_id);
    if imported_bank.bank_id is null and not exists (
      select 1 from public.quiz_banks b where b.user_id = p_user_id and b.bank_id = bank->>'id'
        and b.deleted_at is null and b.data = bank->'data' and b.name = bank->>'name'
        and b.description is not distinct from bank->>'description'
        and b.source_format is not distinct from bank->>'sourceFormat'
    ) then
      skipped_banks := array_append(skipped_banks, bank->>'id');
    end if;
  end loop;
  for progress in select value from jsonb_array_elements(p_progress) loop
    insert into public.quiz_progress as current_progress(user_id, bank_id, store, import_source_id)
      select p_user_id, bank_id, progress->'store', p_source_id from public.quiz_banks
        where user_id = p_user_id and bank_id = progress->>'bankId' and deleted_at is null
          and not (bank_id = any(skipped_banks))
      on conflict (user_id, bank_id) do update set
        store = case when current_progress.import_source_id = p_source_id then excluded.store
          else private.merge_guest_progress(current_progress.store, excluded.store, current_progress.reset_at) end,
        import_source_id = case when current_progress.import_source_id = p_source_id then p_source_id end,
        revision = current_progress.revision + 1, updated_at = now();
  end loop;
  if p_api_config is null then
    delete from public.user_api_configs where user_id = p_user_id and import_source_id = p_source_id;
  else
    skipped_api_config := exists (select 1 from public.user_api_configs where user_id = p_user_id
      and import_source_id is distinct from p_source_id);
    if not skipped_api_config then
      perform public.quizhub_set_api_config(p_user_id, p_api_config, p_secret, p_source_id);
    end if;
  end if;
  outcome := jsonb_build_object('skippedBankIds', skipped_banks, 'skippedApiConfig', skipped_api_config);
  insert into public.guest_imports(user_id, import_id, source_id, source_version, result)
    values (p_user_id, p_import_id, p_source_id, p_source_version, outcome);
  return outcome;
end;
$$;

revoke all on function private.touch_profile(), private.sync_auth_profile(), private.check_reserved_auth_alias(), private.ensure_builtin(uuid),
  private.insert_custom_bank(uuid, jsonb, uuid), private.merge_guest_progress(jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.quizhub_save_bank(jsonb, bigint), public.quizhub_delete_bank(text, bigint),
  public.quizhub_save_progress(text, jsonb, bigint, boolean), public.quizhub_set_api_config(uuid, jsonb, jsonb, uuid),
  public.quizhub_restore_api_config(uuid), public.quizhub_clear_api_config(uuid),
  public.quizhub_import_guest(uuid, uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.quizhub_save_bank(jsonb, bigint), public.quizhub_delete_bank(text, bigint),
  public.quizhub_save_progress(text, jsonb, bigint, boolean) to authenticated;
grant execute on function public.quizhub_set_api_config(uuid, jsonb, jsonb, uuid), public.quizhub_restore_api_config(uuid),
  public.quizhub_clear_api_config(uuid), public.quizhub_import_guest(uuid, uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb) to service_role;

commit;
