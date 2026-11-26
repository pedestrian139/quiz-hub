begin;

alter table public.quiz_banks
  drop constraint quiz_banks_check,
  add constraint quiz_banks_builtin_data_check check (
    (builtin and bank_id in ('builtin-ai-intro', 'builtin-quizhub-guide') and data is null and deleted_at is null)
    or (not builtin and bank_id not in ('builtin-ai-intro', 'builtin-quizhub-guide') and data is not null
      and coalesce(jsonb_typeof(data->'meta') = 'object'
        and jsonb_typeof(data->'chapters') = 'array'
        and jsonb_typeof(data->'questions') = 'array', false))
  );

-- The existing guest-import RPC also provisions these rows before copying progress.
create or replace function private.ensure_builtin(p_user_id uuid) returns void
language sql set search_path = '' as $$
  insert into public.quiz_banks(user_id, bank_id, name, builtin, created_at_ms, updated_at_ms)
    values (p_user_id, 'builtin-ai-intro', '人工智能导论', true, 0, 0),
      (p_user_id, 'builtin-quizhub-guide', 'QuizHub 使用引导示例题库', true, 0, 0)
    on conflict (user_id, bank_id) do nothing;
$$;

create or replace function public.quizhub_save_progress(p_bank_id text, p_store jsonb, p_revision bigint, p_reset boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  result public.quiz_progress;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  if p_bank_id in ('builtin-ai-intro', 'builtin-quizhub-guide') then
    perform private.ensure_builtin(owner_id);
  end if;
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

create or replace function private.merge_guest_progress(p_cloud jsonb, p_guest jsonb, p_reset_at timestamptz) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  records jsonb := p_cloud->'records';
  incoming_records jsonb;
  favorites jsonb := p_guest->'fav';
  mastery jsonb := p_guest->'mastery';
  reset_ms numeric := extract(epoch from p_reset_at) * 1000;
  explanations jsonb;
begin
  if p_reset_at is not null then
    select coalesce(jsonb_object_agg(key, value), '{}') into favorites from jsonb_each(favorites)
      where (p_guest->'records'->key->>'ts')::numeric > reset_ms;
    select coalesce(jsonb_object_agg(key, value), '{}') into mastery from jsonb_each(mastery)
      where (p_guest->'records'->key->>'ts')::numeric > reset_ms;
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}') into incoming_records from jsonb_each(p_guest->'records')
    where (reset_ms is null or (value->>'ts')::numeric > reset_ms)
      and (not (records ? key) or (value->>'ts')::numeric > (records->key->>'ts')::numeric);

  -- Keep the latest valid analysis per question, preferring the account on a tie.
  with inputs as (
    select p_cloud->'aiExplanations' as entries, true as from_cloud
    union all select p_guest->'aiExplanations', false
  ), candidates as (
    select key, value, from_cloud,
      case when jsonb_typeof(value->'updatedAt') = 'number' then (value->>'updatedAt')::numeric end as updated_ms
    from inputs cross join lateral jsonb_each(
      case when jsonb_typeof(entries) = 'object' then entries else '{}'::jsonb end
    )
    where jsonb_typeof(value->'content') = 'string' and btrim(value->>'content') <> ''
  )
  select jsonb_object_agg(key, value) into explanations from (
    select distinct on (key) key, value
    from candidates
    where updated_ms >= 0 and (from_cloud or reset_ms is null or updated_ms > reset_ms)
    order by key, updated_ms desc, from_cloud desc
  ) latest;

  return jsonb_build_object('records', records || incoming_records, 'fav', favorites || (p_cloud->'fav'),
    'mastery', mastery || (p_cloud->'mastery')) ||
    case when explanations is null then '{}'::jsonb else jsonb_build_object('aiExplanations', explanations) end;
end;
$$;

commit;
