begin;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select set_config('request.jwt.claims',jsonb_build_object('session_id',gen_random_uuid())::text,true);
insert into auth.users(id,email) values(auth.uid(),'location-fixture@example.invalid');
insert into public.a1_staff(user_id,is_admin) values(auth.uid(),false);
select set_config('request.headers','{"x-forwarded-for":"1.1.1.1, 10.0.0.1"}',true);
set local role authenticated;
select public.a1_activity_session('start');
do $$ begin
 if exists(select 1 from public.a1_activity_sessions) then raise exception 'Regular user can read login location';end if;
 begin update public.a1_activity_sessions set login_city='Forged';raise exception 'Client can forge location';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.headers','{"x-forwarded-for":"8.8.8.8"}',true);
set local role authenticated;
select public.a1_activity_session('start');
reset role;
do $$ begin
 if (select login_ip::text from public.a1_activity_sessions where user_id=auth.uid())<>'1.1.1.1/32' then raise exception 'Original login IP overwritten or missing';end if;
 if (select login_city from public.a1_activity_sessions where user_id=auth.uid()) is not null then raise exception 'Unresolved location fabricated';end if;
end $$;
update public.a1_staff set is_admin=true where user_id=auth.uid();
set local role authenticated;
do $$ begin if not exists(select 1 from public.a1_activity_sessions where login_ip='1.1.1.1'::inet) then raise exception 'Admin cannot view login IP';end if;end $$;
reset role;
rollback;
select 'PASS: first-connection IP, no refresh overwrite, admin-only visibility and no client location writes' as result;
