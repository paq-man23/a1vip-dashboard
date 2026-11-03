-- No real customer data is returned; all fixture changes roll back.
begin;
select set_config('a1.security.admin',gen_random_uuid()::text,true);
select set_config('a1.security.user',gen_random_uuid()::text,true);
select set_config('a1.security.customer',gen_random_uuid()::text,true);
select set_config('a1.security.vendor',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('a1.security.admin')::uuid,'security-admin-fixture@example.invalid'),(current_setting('a1.security.user')::uuid,'security-user-fixture@example.invalid');
insert into public.a1_staff(user_id,is_admin) values(current_setting('a1.security.admin')::uuid,true),(current_setting('a1.security.user')::uuid,false);
insert into public.a1_account_profiles(user_id,username,allowed_sections) values(current_setting('a1.security.user')::uuid,'security-test-fixture','{}');
select set_config('request.jwt.claim.sub',current_setting('a1.security.admin'),true);
set local role authenticated;
select public.a1_save_contact('customer',current_setting('a1.security.customer'),' {"displayName":"Synthetic security fixture"}',0);
select public.a1_save_contact('vendor',current_setting('a1.security.vendor'),' {"displayName":"Synthetic security fixture"}',0);
reset role;
select set_config('request.jwt.claim.sub',current_setting('a1.security.user'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.a1_contacts) or exists(select 1 from public.a1_invoice_history) then raise exception 'Restricted user can read customer or invoice data';end if;
 begin perform public.a1_list_accounts();raise exception 'Restricted user can list accounts';exception when raise_exception then if sqlerrm<>'Administrator access required' then raise;end if;end;
 begin update public.a1_staff set is_admin=true where user_id=auth.uid();raise exception 'Restricted user can promote themselves';exception when insufficient_privilege then null;end;
 begin perform public.a1_save_contact('customer',current_setting('a1.security.customer'),'{"displayName":"Unauthorized edit"}',0);raise exception 'Restricted user can edit contacts';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.a1_account_profiles set allowed_sections=array['customers'] where user_id=current_setting('a1.security.user')::uuid;
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.a1_contacts where id=current_setting('a1.security.customer') and kind='customer') then raise exception 'Assigned customer access unavailable';end if;
 if exists(select 1 from public.a1_contacts where kind='vendor') or exists(select 1 from public.a1_invoice_history) then raise exception 'Customer access exposed another category';end if;
end $$;
reset role;
update public.a1_account_profiles set allowed_sections='{}' where user_id=current_setting('a1.security.user')::uuid;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.a1_contacts) or exists(select 1 from public.a1_invoice_history) then raise exception 'Revoked customer permission still permits reading data';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.a1_contacts limit 1;raise exception 'Anonymous customer query allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from public.a1_invoice_history limit 1;raise exception 'Anonymous invoice query allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: live customer/category isolation, anonymous denial, restricted writes, admin isolation and immediate category revocation' as result;
