begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff where is_admin limit 1),true);
set local role authenticated;
select public.a1_sync_skybox('customer','908001','{"Customer ID":"908001"}','{"id":"908001","kind":"customer","displayName":"Performance fixture"}');
select public.a1_sync_skybox('vendor','908002','{"Vendor ID":"908002"}','{"id":"908002","kind":"vendor","displayName":"Performance fixture"}');
select public.a1_sync_skybox('invoice','908003','{"Invoice ID":"908003"}','{"id":"inv-skybox-invoice-908003","number":"908003"}');
select public.a1_sync_skybox('purchase','908004','{"Purchase ID":"908004"}','{"id":"inv-skybox-purchase-908004","number":"908004"}');
reset role;
select set_config('a1.test.restricted',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('a1.test.restricted')::uuid,'category-performance@example.invalid');
insert into public.a1_staff(user_id,is_admin) values(current_setting('a1.test.restricted')::uuid,false);
insert into public.a1_account_profiles(user_id,username,allowed_sections) values(current_setting('a1.test.restricted')::uuid,'category-performance',array['customers']);
select set_config('request.jwt.claim.sub',current_setting('a1.test.restricted'),true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.a1_skybox_records)<>1 or exists(select 1 from public.a1_skybox_records where kind<>'customer') then raise exception 'Customer-only record isolation failed';end if;
 if (select count(*) from public.a1_skybox_sync_state)<>1 or exists(select 1 from public.a1_skybox_revisions where kind<>'customer') then raise exception 'Customer-only sync isolation failed';end if;
 if exists(select 1 from public.a1_invoice_history) then raise exception 'Customer-only invoice leak';end if;
end $$;
reset role;
update public.a1_account_profiles set allowed_sections=array['invoices'] where user_id=current_setting('a1.test.restricted')::uuid;
set local role authenticated;
do $$ begin
 if (select count(*) from public.a1_skybox_records)<>2 or exists(select 1 from public.a1_skybox_records where kind not in ('invoice','purchase')) then raise exception 'Permission change or purchase/invoice isolation failed';end if;
 if (select count(*) from public.a1_invoice_history)<>2 then raise exception 'Allowed invoices missing';end if;
 if exists(select 1 from public.a1_contacts) then raise exception 'Invoice-only contact leak';end if;
end $$;
reset role;
delete from public.a1_staff where user_id=current_setting('a1.test.restricted')::uuid;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.a1_invoice_history) or exists(select 1 from public.a1_skybox_records) then raise exception 'Revoked staff can still read records';end if;
end $$;
reset role;
rollback;
select 'PASS: cached checks retain mixed-category isolation, invoice and PO access, immediate permission updates and staff revocation' as result;
