begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff order by user_id limit 1),true);
set local role authenticated;
do $$
declare r jsonb; first_doc jsonb; changed_doc jsonb; newest_doc jsonb;
begin
 first_doc:='{"id":"inv-skybox-invoice-1001","number":"1001","notes":"Initial","credit":0}';
 changed_doc:='{"id":"inv-skybox-invoice-1001","number":"1001","notes":"Weekly paid","credit":100}';
 newest_doc:='{"id":"inv-skybox-invoice-1001","number":"1001","notes":"Next week","credit":120}';
 r:=public.a1_sync_skybox('invoice','1001','{"Invoice ID":"1001","Invoice Total":"100","Outstanding Balance":"100"}',first_doc);
 if r->>'outcome'<>'imported' then raise exception 'Initial sync failed'; end if;
 r:=public.a1_sync_skybox('invoice','1001','{"Invoice ID":"1001","Invoice Total":"100","Outstanding Balance":"0"}',changed_doc);
 if r->>'outcome'<>'updated' then raise exception 'Weekly source update not applied'; end if;
 if (select document from public.a1_invoices where id=first_doc->>'id')<>changed_doc then raise exception 'Paid balance not updated'; end if;
 if (select document from public.a1_skybox_records where kind='invoice' and source_id='1001')<>first_doc then raise exception 'Original archive was mutated'; end if;
 r:=public.a1_sync_skybox('invoice','1001','{"Invoice ID":"1001","Invoice Total":"100","Outstanding Balance":"100"}',first_doc);
 if r->>'outcome'<>'skipped' then raise exception 'Old observed export rolled back current invoice'; end if;
 perform public.a1_save_invoice(changed_doc||'{"notes":"A1 edit"}',2);
 r:=public.a1_sync_skybox('invoice','1001','{"Invoice ID":"1001","Invoice Total":"120","Outstanding Balance":"0"}',newest_doc);
 if r->>'outcome'<>'conflict' then raise exception 'A1 edit was not protected'; end if;
 if (select document->>'notes' from public.a1_invoices where id=first_doc->>'id')<>'A1 edit' then raise exception 'A1 edit overwritten'; end if;
 if not exists(select 1 from public.a1_import_conflicts where document=newest_doc) then raise exception 'Weekly incoming copy lost'; end if;
 r:=public.a1_sync_skybox('invoice','1001','{"Invoice ID":"1001","Invoice Total":"120","Outstanding Balance":"0"}',newest_doc);
 if r->>'outcome'<>'skipped' then raise exception 'Conflict repeated instead of retaining receipt'; end if;
 -- Manually imported invoices acquire their baseline from the original archive.
 perform public.a1_import_skybox('invoice','1002','{"Invoice ID":"1002","Outstanding Balance":"10"}','{"id":"inv-skybox-invoice-1002","number":"1002","credit":0}');
 r:=public.a1_sync_skybox('invoice','1002','{"Invoice ID":"1002","Outstanding Balance":"0"}','{"id":"inv-skybox-invoice-1002","number":"1002","credit":10}');
 if r->>'outcome'<>'updated' then raise exception 'Manual import baseline failed'; end if;
 -- Deleted invoices are not recreated by a changed export.
 delete from public.a1_invoices where id='inv-skybox-invoice-1002';
 r:=public.a1_sync_skybox('invoice','1002','{"Invoice ID":"1002","Outstanding Balance":"1"}','{"id":"inv-skybox-invoice-1002","number":"1002","credit":9}');
 if r->>'outcome'<>'conflict' or exists(select 1 from public.a1_invoices where id='inv-skybox-invoice-1002') then raise exception 'Deleted invoice was recreated'; end if;
 perform public.a1_sync_skybox('vendor','333','{"Vendor ID":"333","Email":"old@example.invalid"}','{"id":"333","kind":"vendor","email":"old@example.invalid"}');
 r:=public.a1_sync_skybox('vendor','333','{"Vendor ID":"333","Email":"new@example.invalid"}','{"id":"333","kind":"vendor","email":"new@example.invalid"}','{"clientEmails":["new@example.invalid"]}');
 if r->>'outcome'<>'updated' or (select document->>'email' from public.a1_skybox_contacts where kind='vendor' and source_id='333')<>'new@example.invalid' then raise exception 'Directory did not use updated contact'; end if;
 if (select document->>'email' from public.a1_skybox_records where kind='vendor' and source_id='333')<>'old@example.invalid' then raise exception 'Original contact lost'; end if;
 r:=public.a1_sync_skybox_batch('[{"kind":"customer","sourceId":"444","record":{"Customer ID":"444"},"document":{"id":"444","kind":"customer"}},{"kind":"vendor","sourceId":"445","record":{"Vendor ID":"446"},"document":{"id":"445","kind":"vendor"}}]');
 if r->0->>'outcome'<>'imported' or r->1->>'outcome'<>'error' then raise exception 'Batch row isolation failed'; end if;
 insert into public.a1_skybox_sync_runs(job_id,machine_label,status) values(gen_random_uuid(),'Fixture Mac','success');
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff order by user_id desc limit 1),true);
set local role authenticated;
do $$ begin
 if (select document->>'email' from public.a1_skybox_contacts where kind='vendor' and source_id='333')<>'new@example.invalid' then raise exception 'Other staff cannot see new contacts'; end if;
 if not exists(select 1 from public.a1_skybox_sync_runs) then raise exception 'Other staff cannot see job history'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.a1_skybox_contacts) or exists(select 1 from public.a1_skybox_revisions) or exists(select 1 from public.a1_skybox_sync_runs) then raise exception 'Nonstaff could read sync data'; end if;
 begin perform public.a1_sync_skybox_batch('[]');raise exception 'Nonstaff sync succeeded';exception when raise_exception then if sqlerrm not like 'A1 staff access required%' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.a1_skybox_contacts;raise exception 'Anonymous contacts readable';exception when insufficient_privilege then null;end;
 begin perform public.a1_sync_skybox_batch('[]');raise exception 'Anonymous sync succeeded';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: weekly balances, repeats, old revisions, preserved A1 edits/deletions, manual baseline, updated contacts, row isolation and shared staff-only job history' as result;
