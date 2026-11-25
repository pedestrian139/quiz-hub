-- Run against a database with the QuizHub migration applied. All fixtures are rolled back.
begin;

do $$
declare
  phone_user constant uuid := 'f31cf6cc-7d89-45b5-9806-e2a339385784';
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
  insert into auth.users(id, email, raw_app_meta_data) values (phone_user, '56472910000@phone.quizhub.local', '{}');
  update auth.users set raw_app_meta_data = '{"quizhub_phone_account":true}', email_confirmed_at = now() where id = phone_user;
  insert into auth.users(id, email, email_confirmed_at) values (email_user, 'verified-quizhub@example.test', now());

  begin
    update auth.users set email_change = 'first-quizhub@example.test' where id = phone_user;
    raise exception 'First email binding did not require authorization';
  exception when insufficient_privilege then null;
  end;
  perform public.quizhub_authorize_first_email(phone_user, 'first-quizhub@example.test');
  update auth.users set email_change = 'first-quizhub@example.test' where id = phone_user;
  update auth.users set email = email_change, email_change = '' where id = phone_user;
  if not exists (select 1 from public.profiles where user_id = phone_user
    and email = 'first-quizhub@example.test' and phone = '56472910000') then
    raise exception 'First email binding must preserve the phone and user ID';
  end if;
  if exists (select 1 from private.first_email_links where user_id = phone_user) then
    raise exception 'First email authorization must be consumed';
  end if;
  begin
    update auth.users set email_change = 'replacement-quizhub@example.test' where id = email_user;
    raise exception 'Verified email must stay protected from the first binding flow';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('authenticated', 'public.quizhub_authorize_first_email(uuid,text)', 'EXECUTE') then
    raise exception 'Only the backend role should authorize an email binding';
  end if;

  result := public.quizhub_import_guest(phone_user, first_import, source_id, 1, jsonb_build_array(bank), progress, config, null);
  if result is distinct from '{"skippedBankIds":[],"skippedApiConfig":false}'::jsonb then
    raise exception 'Unexpected conflicts on a new account';
  end if;
  bank := bank || '{"name":"Renamed"}';
  config := config || '{"model":"new-model"}';
  perform public.quizhub_import_guest(phone_user, second_import, source_id, 2, jsonb_build_array(bank), '[]', config, null);
  if (select name from public.quiz_banks where user_id = phone_user and bank_id = 'test-bank') is distinct from 'Renamed'
    or (select model from public.user_api_configs where user_id = phone_user) is distinct from 'new-model'
    or exists (select 1 from public.quiz_progress where user_id = phone_user and bank_id = 'test-bank') then
    raise exception 'A newer snapshot of the same import must apply edits and clear removed progress';
  end if;
  result := public.quizhub_import_guest(phone_user, gen_random_uuid(), source_id, 1, jsonb_build_array(bank), progress, config, null);
  if result is distinct from '{"supersededBy":2}'::jsonb then raise exception 'An older snapshot must remain superseded'; end if;

  perform public.quizhub_clear_api_config(phone_user);
  update public.quiz_banks set name = 'Cloud edit', import_source_id = null where user_id = phone_user and bank_id = 'test-bank';
  result := public.quizhub_import_guest(phone_user, conflict_import, source_id, 3, jsonb_build_array(bank), progress, config, null);
  if result is distinct from '{"skippedBankIds":["test-bank"],"skippedApiConfig":true}'::jsonb
    or public.quizhub_restore_api_config(phone_user) is not null then
    raise exception 'Independent cloud edits and explicit clears must survive a guest import';
  end if;
  delete from public.quiz_banks where user_id = phone_user and bank_id = 'test-bank';
  delete from public.user_api_configs where user_id = phone_user;
  if public.quizhub_import_guest(phone_user, conflict_import, source_id, 3, jsonb_build_array(bank), progress, config, null) is distinct from result then
    raise exception 'A retried import ID must return the original result';
  end if;
  result := public.quizhub_import_guest(phone_user, gen_random_uuid(), source_id, 4, jsonb_build_array(bank), progress, config, null);
  if result is distinct from '{"skippedBankIds":[],"skippedApiConfig":false}'::jsonb then
    raise exception 'A new version must evaluate conflicts again after they are resolved';
  end if;
end;
$$;

rollback;
