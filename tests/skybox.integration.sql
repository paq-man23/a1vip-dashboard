begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff order by user_id limit 1),true);
set local role authenticated;
do $$
declare r jsonb; before_count bigint;
begin
 r:=public.a1_import_skybox('customer','123','{"Customer ID":"123","Display Name":"Example"}','{"id":"123","kind":"customer","displayName":"Example"}','{"clientContacts":["Example"],"clientEmails":["example@example.invalid"]}');
 if r->>'outcome'<>'imported' then raise exception 'Contact import failed'; end if;
 if not exists(select 1 from public.a1_invoice_presets where value='example@example.invalid') then raise exception 'Contact dropdown not saved'; end if;
 r:=public.a1_import_skybox('customer','123','{"Customer ID":"123","Display Name":"Example"}','{"id":"123","kind":"customer","displayName":"Enriched later"}');
 if r->>'outcome'<>'skipped' then raise exception 'Repeat contact duplicated'; end if;
 r:=public.a1_import_skybox('customer','123','{"Customer ID":"123","Display Name":"Changed"}','{"id":"123","kind":"customer","displayName":"Changed"}');
 if r->>'outcome'<>'changed' then raise exception 'Changed contact overwritten'; end if;
 if (select document->>'displayName' from public.a1_skybox_records where kind='customer' and source_id='123')<>'Example' then raise exception 'Contact lost'; end if;
 r:=public.a1_import_skybox('vendor','123','{"Vendor ID":"123"}','{"id":"123","kind":"vendor","displayName":"Vendor"}');
 if r->>'outcome'<>'imported' then raise exception 'Customer/vendor ID collision'; end if;
 r:=public.a1_import_skybox('invoice','456','{"Invoice ID":"456","Invoice Total":"100"}','{"id":"inv-skybox-invoice-456","number":"456","type":"invoice-ticket","notes":"Source"}');
 if r->>'outcome'<>'imported' then raise exception 'Invoice conversion failed'; end if;
 perform public.a1_save_invoice('{"id":"inv-skybox-invoice-456","number":"456","type":"invoice-ticket","notes":"Edited"}',1);
 r:=public.a1_import_skybox('invoice','456','{"Invoice ID":"456","Invoice Total":"100"}','{"id":"inv-skybox-invoice-456","number":"456","notes":"Source"}');
 if r->>'outcome'<>'skipped' then raise exception 'Repeat invoice did not skip'; end if;
 if (select document->>'notes' from public.a1_invoices where id='inv-skybox-invoice-456')<>'Edited' then raise exception 'Cloud edit lost'; end if;
 r:=public.a1_import_skybox('invoice','457','{"Invoice ID":"457"}','{"id":"inv-skybox-invoice-457","number":"456","notes":"Conflict"}');
 if r->>'outcome'<>'conflict' then raise exception 'Number conflict not preserved'; end if;
 if not exists(select 1 from public.a1_skybox_records where source_id='457') or not exists(select 1 from public.a1_import_conflicts where document->>'id'='inv-skybox-invoice-457') then raise exception 'Original or conflict lost'; end if;
 r:=public.a1_import_skybox('purchase','789','{"Purchase ID":"789"}','{"id":"inv-skybox-purchase-789","number":"SB-PO-789","type":"po-ticket"}');
 if r->>'outcome'<>'imported' then raise exception 'Purchase conversion failed'; end if;
 r:=public.a1_import_skybox_batch('[{"kind":"vendor","sourceId":"333","record":{"Vendor ID":"333"},"document":{"id":"333","kind":"vendor"}},{"kind":"vendor","sourceId":"334","record":{"Vendor ID":"999"},"document":{"id":"334","kind":"vendor"}}]');
 if r->0->>'outcome'<>'imported' or r->1->>'outcome'<>'error' then raise exception 'Batch did not isolate row failure'; end if;
 if exists(select 1 from public.a1_skybox_records where source_id='334') then raise exception 'Failed batch row remained'; end if;
 before_count:=(select count(*) from public.a1_skybox_records);
 begin
 perform public.a1_import_skybox('purchase','999','{"Purchase ID":"999"}','{"id":"inv-invalid","number":"999"}');
 raise exception 'Invalid identity accepted';
 exception when raise_exception then if sqlerrm='Invalid identity accepted' then raise; end if; end;
 if (select count(*) from public.a1_skybox_records)<>before_count then raise exception 'Failed transaction left original row'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff order by user_id desc limit 1),true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.a1_skybox_records)<>6 then raise exception 'Other staff cannot see shared originals'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.a1_skybox_records) then raise exception 'Nonstaff could read originals'; end if;
 begin
 perform public.a1_import_skybox('vendor','777','{"Vendor ID":"777"}','{"id":"777","kind":"vendor"}');
 raise exception 'Nonstaff import succeeded';
 exception when raise_exception then if sqlerrm not like 'A1 staff access required%' then raise; end if; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.a1_skybox_records; raise exception 'Anonymous read succeeded'; exception when insufficient_privilege then null; end;
 begin perform public.a1_import_skybox('vendor','777','{}','{}'); raise exception 'Anonymous import succeeded'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: contact presets, original retention, repeat and changed exports, preserved invoice edits/conflicts, atomic failure, staff sharing and anonymous rejection' as result;
