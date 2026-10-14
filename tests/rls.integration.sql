-- Safe integration assertions: fixture rows and Auth identities roll back.
begin;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
insert into auth.users(id, aud, role, email)
values (current_setting('request.jwt.claim.sub')::uuid, 'authenticated', 'authenticated', 'a1-integration-test@example.invalid');
insert into public.a1_staff(user_id) values (current_setting('request.jwt.claim.sub')::uuid);
set local role authenticated;
do $$
declare saved jsonb; blocked boolean := false;
begin
  saved := public.a1_save_invoice('{"id":"inv-integration-test","number":"integration-test","lines":[]}', null, '{"clientCompanies":["Integration client"]}');
  if saved->>'version' <> '1' then raise exception 'Insert version incorrect'; end if;
  if (select count(*) from public.a1_invoice_presets where value = 'Integration client') <> 1 then raise exception 'Preset save failed'; end if;
  saved := public.a1_save_invoice('{"id":"inv-integration-test","number":"integration-test","lines":[]}', 1);
  if saved->>'version' <> '2' then raise exception 'Update version incorrect'; end if;
  begin
    perform public.a1_save_invoice('{"id":"inv-integration-test","number":"integration-test","lines":[]}', 1);
  exception when raise_exception then
    if sqlerrm like 'Invoice changed on another device.%' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'Stale edit was accepted'; end if;
  blocked := false;
  begin
    perform public.a1_save_invoice('{"id":"inv-integration-duplicate","number":"integration-test","lines":[]}', null);
  exception when unique_violation then blocked := true;
  end;
  if not blocked then raise exception 'Duplicate number was accepted'; end if;
  delete from public.a1_invoices where id = 'inv-integration-test' and version = 1;
  if not exists(select 1 from public.a1_invoices where id = 'inv-integration-test') then raise exception 'Stale delete removed invoice'; end if;
end $$;
reset role;
-- A signed-in non-staff identity cannot see records or approve itself.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  if exists(select 1 from public.a1_invoices where id = 'inv-integration-test') then raise exception 'Unapproved account could read invoices'; end if;
  if exists(select 1 from public.a1_invoice_presets where value = 'Integration client') then raise exception 'Unapproved account could read presets'; end if;
  begin
    perform public.a1_save_invoice('{"id":"inv-unapproved","number":"unapproved"}', null);
  exception when raise_exception then
    if sqlerrm = 'A1 staff access required' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'Unapproved account could save'; end if;
  blocked := false;
  begin
    insert into public.a1_staff(user_id) values (current_setting('request.jwt.claim.sub')::uuid);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'Unapproved account could approve itself'; end if;
end $$;
reset role;
-- Anonymous sessions cannot access invoice tables or invoke the save API.
set local role anon;
do $$
declare blocked boolean := false;
begin
  begin
    perform 1 from public.a1_invoices;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'Anonymous table access was granted'; end if;
  blocked := false;
  begin
    perform public.a1_save_invoice('{"id":"inv-anon","number":"anon"}', null);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'Anonymous save API access was granted'; end if;
end $$;
reset role;
rollback;
select 'PASS: staff CRUD, presets, duplicate numbers, stale edits/deletes, non-staff and anonymous access' as integration_result;
