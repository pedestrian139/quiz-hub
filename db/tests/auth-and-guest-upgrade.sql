-- Run against a database with all QuizHub migrations applied. All fixtures are rolled back.
begin;

do $$
declare
  email_user constant uuid := 'ab1cb346-1e44-4745-aed3-e66cc4243726';
  source_id constant uuid := 'f79a40f0-144b-4d3e-ba2c-ed0ead48f648';
  first_import constant uuid := '66e3eb40-19e1-4a18-adad-537c573da206';
  second_import constant uuid := 'ec55265b-8cf0-4155-b543-5de4ac116c4e';
  conflict_import constant uuid := '556623c2-ea1f-49a3-9375-248e85d6c270';
  bank jsonb := '{"id":"test-bank","name":"First name","builtin":false,"createdAt":1,"updatedAt":2,"data":{"meta":{},"chapters":[],"questions":[]}}';
  config jsonb := '{"provider":"custom","baseUrl":"https://example.test","model":"first-model","temperature":0.3,"maxTokens":1200,"timeoutMs":45000}';
  progress jsonb := '[{"bankId":"test-bank","store":{"records":{},"fav":{"question":true},"mastery":{}}}]';
  result jsonb;
begin
  -- Verify obsolete phone-auth objects were cleaned up.
  if to_regprocedure('public.quizhub_before_user_created(jsonb)') is not null
    or to_regprocedure('public.quizhub_authorize_first_email(uuid,text)') is not null
    or to_regprocedure('public.quizhub_take_phone_attempt(text,text)') is not null
    or to_regclass('private.phone_auth_rate_limits') is not null
    or to_regclass('private.first_email_links') is not null then
    raise exception 'Obsolete phone-auth database objects must be removed';
  end if;

  -- Email signup starts unconfirmed, then populates profiles.email upon OTP confirmation.
  insert into auth.users(id, email, raw_user_meta_data)
    values (email_user, 'Verified-QuizHub@Example.Test', '{"nickname":"邮箱用户"}');
  if not exists (select 1 from public.profiles where user_id = email_user and email is null and nickname = '邮箱用户') then
    raise exception 'Unconfirmed email user must create a profile with null email';
  end if;
  update auth.users set email_confirmed_at = now() where id = email_user;
  if not exists (select 1 from public.profiles where user_id = email_user and email = 'verified-quizhub@example.test') then
    raise exception 'Confirmed email user must sync lowercase email to public.profiles';
  end if;

  -- Guest import, revision updates, and independent cloud edit protection.
  result := public.quizhub_import_guest(email_user, first_import, source_id, 1, jsonb_build_array(bank), progress, config, null);
  if result is distinct from '{"skippedBankIds":[],"skippedApiConfig":false}'::jsonb then
    raise exception 'Unexpected conflicts on a new account';
  end if;
  bank := bank || '{"name":"Renamed"}';
  config := config || '{"model":"new-model"}';
  perform public.quizhub_import_guest(email_user, second_import, source_id, 2, jsonb_build_array(bank), '[]', config, null);
  if (select name from public.quiz_banks where user_id = email_user and bank_id = 'test-bank') is distinct from 'Renamed'
    or (select model from public.user_api_configs where user_id = email_user) is distinct from 'new-model'
    or exists (select 1 from public.quiz_progress where user_id = email_user and bank_id = 'test-bank') then
    raise exception 'A newer snapshot of the same import must apply edits and clear removed progress';
  end if;
  result := public.quizhub_import_guest(email_user, gen_random_uuid(), source_id, 1, jsonb_build_array(bank), progress, config, null);
  if result is distinct from '{"supersededBy":2}'::jsonb then raise exception 'An older snapshot must remain superseded'; end if;

  perform public.quizhub_clear_api_config(email_user);
  update public.quiz_banks set name = 'Cloud edit', import_source_id = null where user_id = email_user and bank_id = 'test-bank';
  result := public.quizhub_import_guest(email_user, conflict_import, source_id, 3, jsonb_build_array(bank), progress, config, null);
  if result is distinct from '{"skippedBankIds":["test-bank"],"skippedApiConfig":true}'::jsonb
    or public.quizhub_restore_api_config(email_user) is not null then
    raise exception 'Independent cloud edits and explicit clears must survive a guest import';
  end if;
  delete from public.quiz_banks where user_id = email_user and bank_id = 'test-bank';
  delete from public.user_api_configs where user_id = email_user;
  if public.quizhub_import_guest(email_user, conflict_import, source_id, 3, jsonb_build_array(bank), progress, config, null) is distinct from result then
    raise exception 'A retried import ID must return the original result';
  end if;
  result := public.quizhub_import_guest(email_user, gen_random_uuid(), source_id, 4, jsonb_build_array(bank), progress, config, null);
  if result is distinct from '{"skippedBankIds":[],"skippedApiConfig":false}'::jsonb then
    raise exception 'A new version must evaluate conflicts again after they are resolved';
  end if;
end;
$$;

rollback;
