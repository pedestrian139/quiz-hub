-- Run after applying the migrations. Roll back all test data.
begin;

do $$
declare
  owner_id constant uuid := '395099d2-65ac-40e4-8a31-2cae42c01367';
  other_id constant uuid := '395099d2-65ac-40e4-8a31-2cae42c01368';
  legacy_store constant jsonb := '{"records":{"qb-c1-ch01":{"ok":0,"ts":1}},"fav":{"qb-c1-ch01":true},"mastery":{"qb-c1-ch01":1}}';
  guide_store constant jsonb := '{"records":{"qh-guide-choice-01":{"ok":1,"ts":2}},"fav":{},"mastery":{},"aiExplanations":{"qh-guide-choice-01":{"content":"Guide analysis","updatedAt":2}}}';
  guest_store constant jsonb := '{"records":{"qh-guide-multi-01":{"ok":0,"ts":3}},"fav":{},"mastery":{},"aiExplanations":{"qh-guide-multi-01":{"content":"Guest analysis","updatedAt":3}}}';
  saved jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at)
    values (owner_id, 'phase2-owner@example.test', now()), (other_id, 'phase2-other@example.test', now());
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.quizhub_save_progress('builtin-ai-intro', legacy_store, 0, false);
  saved := public.quizhub_save_progress('builtin-quizhub-guide', guide_store, 0, false);
  if saved->'store' is distinct from guide_store
    or not exists (select 1 from public.quiz_progress where user_id = owner_id and bank_id = 'builtin-ai-intro' and store = legacy_store)
    or not exists (select 1 from public.quiz_banks where user_id = owner_id and bank_id = 'builtin-quizhub-guide' and builtin and data is null) then
    raise exception 'Guide and legacy progress must persist independently';
  end if;

  begin
    perform public.quizhub_save_progress('builtin-quizhub-guide', guide_store, 0, false);
    raise exception 'Expected a version conflict';
  exception when serialization_failure then
    null;
  end;
  saved := public.quizhub_save_progress('builtin-quizhub-guide', guide_store, 1, false);
  if (saved->>'revision')::integer <> 2 then
    raise exception 'Guide progress must preserve the existing revision contract';
  end if;

  perform public.quizhub_import_guest(owner_id, gen_random_uuid(), gen_random_uuid(), 1, '[]',
    jsonb_build_array(jsonb_build_object('bankId', 'builtin-quizhub-guide', 'store', guest_store)), null, null);
  select store into saved from public.quiz_progress where user_id = owner_id and bank_id = 'builtin-quizhub-guide';
  if not (saved->'records' @> (guide_store->'records' || guest_store->'records'))
    or not coalesce(saved->'aiExplanations' @> (guide_store->'aiExplanations' || guest_store->'aiExplanations'), false) then
    raise exception 'Guide history must survive merging guest progress into an existing account';
  end if;

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  perform public.quizhub_save_progress('builtin-quizhub-guide', guide_store, 0, false);
  if (select revision from public.quiz_progress where user_id = owner_id and bank_id = 'builtin-quizhub-guide') <> 3 then
    raise exception 'Another account must not update the owner’s guide progress';
  end if;
end
$$;

set local role authenticated;
do $$
begin
  if (select count(*) from public.quiz_progress where bank_id = 'builtin-quizhub-guide') <> 1 then
    raise exception 'RLS must expose only the signed-in account’s guide progress';
  end if;
end
$$;

rollback;
