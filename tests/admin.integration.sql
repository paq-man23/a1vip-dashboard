begin;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('request.jwt.claim.sub')::uuid,'regular-fixture@example.invalid');
insert into public.a1_staff(user_id) values(current_setting('request.jwt.claim.sub')::uuid);
set local role authenticated;
do $$ begin
 if public.a1_is_admin() then raise exception 'New staff member received admin'; end if;
 begin perform public.a1_import_skybox_batch('[]');raise exception 'Nonadmin import allowed';exception when raise_exception then if sqlerrm<>'Administrator access required' then raise;end if;end;
 begin perform public.a1_resolve_import_conflict('fixture','missing');raise exception 'Nonadmin review allowed';exception when raise_exception then if sqlerrm<>'Administrator access required' then raise;end if;end;
 begin update public.a1_staff set is_admin=true where user_id=auth.uid();raise exception 'Self promotion allowed';exception when insufficient_privilege then null;end;
 begin insert into public.a1_skybox_records(kind,source_id,source_hash,raw_record,document) values('customer','990001','fixture','{}','{}');raise exception 'Direct source insert allowed';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.a1_skybox_sync_runs) then raise exception 'Admin job status exposed'; end if;
 perform public.a1_save_invoice('{"id":"inv-admin-role-fixture","number":"admin-role-fixture","lines":[]}',null);
 perform public.a1_save_contact('customer',gen_random_uuid()::text,'{"displayName":"Regular staff contact"}',0);
end $$;
reset role;
update public.a1_staff set is_admin=true where user_id=current_setting('request.jwt.claim.sub')::uuid;
set local role authenticated;
do $$ begin
 if not public.a1_is_admin() then raise exception 'Admin role not recognized'; end if;
 perform public.a1_import_skybox_batch('[]');
end $$;
reset role;
update public.a1_staff set is_admin=false where user_id=current_setting('request.jwt.claim.sub')::uuid;
set local role authenticated;
do $$ begin
 if public.a1_is_admin() then raise exception 'Revocation not immediate'; end if;
 begin perform public.a1_sync_skybox_batch('[]');raise exception 'Revoked admin can sync';exception when raise_exception then if sqlerrm<>'Administrator access required' then raise;end if;end;
end $$;
reset role;
rollback;
select 'PASS: default nonadmin, guarded import/review, direct-write protection, no self promotion, regular staff CRUD, admin access and immediate revocation' as result;
