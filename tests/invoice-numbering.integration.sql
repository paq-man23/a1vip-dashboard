begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff order by user_id limit 1),true);
set local role authenticated;
do $$
declare first_result jsonb; second_result jsonb; first_number bigint; counter_after bigint; fixture jsonb; blocked boolean;
begin
 -- Both devices can submit the same stale proposed number; the DB ignores it.
 fixture:='{"id":"inv-number-fixture-one","number":"999999","autoNumber":true,"notes":"First"}';
 first_result:=public.a1_save_dashboard_invoice(fixture);
 first_number:=(first_result->'document'->>'number')::bigint;
 second_result:=public.a1_save_dashboard_invoice('{"id":"inv-number-fixture-two","number":"999999","autoNumber":true}');
 if (second_result->'document'->>'number')::bigint<>first_number+1 then raise exception 'New numbers were not incremental';end if;
 if first_result->'document'->>'number'='999999' then raise exception 'Browser guess was accepted';end if;
 counter_after:=currval('public.a1_invoice_number_seq');
 second_result:=public.a1_save_dashboard_invoice(fixture);
 if second_result->'document'->>'number'<>first_number::text or currval('public.a1_invoice_number_seq')<>counter_after then raise exception 'Retry allocated another number';end if;
 blocked:=false;
 begin perform public.a1_save_invoice(first_result->'document'||'{"number":"77777"}',1);exception when raise_exception then blocked:=true;end;
 if not blocked then raise exception 'Permanent assigned number was editable';end if;
 delete from public.a1_invoices where id='inv-number-fixture-two';
 second_result:=public.a1_save_dashboard_invoice('{"id":"inv-number-fixture-three","autoNumber":true}');
 if (second_result->'document'->>'number')::bigint<>first_number+2 then raise exception 'Deleted number reused';end if;
 -- A Skybox collision is skipped rather than overwritten.
 counter_after:=currval('public.a1_invoice_number_seq')+1;
 perform public.a1_import_skybox('invoice','12345','{"Invoice ID":"12345","Vendor":"Example Vendor","Payment Reference":"PAYREF","COGS":"100"}',jsonb_build_object('id','inv-skybox-invoice-12345','number',counter_after::text));
 second_result:=public.a1_save_dashboard_invoice('{"id":"inv-number-fixture-four","autoNumber":true}');
 if (second_result->'document'->>'number')::bigint<>counter_after+1 then raise exception 'Skybox collision not skipped';end if;
 if (select origin from public.a1_invoices where id='inv-skybox-invoice-12345')<>'skybox' then raise exception 'Skybox origin not classified';end if;
 if (select document->'skybox'->>'Payment Reference' from public.a1_invoice_history where id='inv-skybox-invoice-12345')<>'PAYREF' then raise exception 'Existing import fields did not populate';end if;
 if (select document from public.a1_invoices where id='inv-skybox-invoice-12345') ? 'skybox' then raise exception 'Read view mutated stored weekly snapshot';end if;
 -- Saving only derived/enriched metadata must not cause a false weekly conflict.
 perform public.a1_save_invoice((select document from public.a1_invoice_history where id='inv-skybox-invoice-12345')||'{"vendor":"Example Vendor","cogs":"100","autoNumber":false}',1);
 perform public.a1_sync_skybox('invoice','12345','{"Invoice ID":"12345","Vendor":"Updated","COGS":"200"}',jsonb_build_object('id','inv-skybox-invoice-12345','number',counter_after::text));
 if (select document->'skybox'->>'COGS' from public.a1_invoice_history where id='inv-skybox-invoice-12345')<>'200' then raise exception 'Current accepted revision fields not populated';end if;
 -- Resolving an imported invoice into a fresh ID must keep the Skybox origin.
 perform public.a1_save_invoice('{"id":"inv-skybox-resolution-test","number":"source-resolved","origin":"skybox"}',null);
 if (select origin from public.a1_invoice_history where id='inv-skybox-resolution-test')<>'skybox' then raise exception 'Resolved import mislabeled as A1';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff order by user_id desc limit 1),true);
set local role authenticated;
do $$ declare r jsonb;prev bigint;begin
 prev:=currval('public.a1_invoice_number_seq');
 r:=public.a1_save_dashboard_invoice('{"id":"inv-number-other-staff","autoNumber":true}');
 if (r->'document'->>'number')::bigint<>prev+1 then raise exception 'Other staff used a separate number series';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.a1_invoice_history) then raise exception 'Nonstaff could read invoice history';end if;
 begin perform public.a1_save_dashboard_invoice('{"id":"inv-number-nonstaff"}');raise exception 'Nonstaff allocated invoice';exception when raise_exception then if sqlerrm not like 'A1 staff access required%' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.a1_invoice_history;raise exception 'Anonymous history read succeeded';exception when insufficient_privilege then null;end;
 begin perform public.a1_save_dashboard_invoice('{}');raise exception 'Anonymous invoice save succeeded';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: incremental shared numbering, stale browser guesses, retry receipts, deletion and collision handling, source fields without snapshot mutation, and staff-only access' as result;
