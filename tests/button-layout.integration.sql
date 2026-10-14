begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff where is_admin limit 1),true);
set local role authenticated;
do $$ declare v bigint; result jsonb;
begin
 select version into v from public.a1_button_layout;
 result:=public.a1_save_button_layout('{"added":{"accounts":[{"label":"Fixture","url":"https://example.invalid"}]},"removed":{},"secret":"discard"}',v);
 if (result->>'version')::bigint<>v+1 or result->'state' ? 'secret' then raise exception 'Save failed';end if;
 begin perform public.a1_save_button_layout('{"added":{},"removed":{}}',v);raise exception 'Stale save allowed';exception when raise_exception then if sqlerrm not like 'Links changed%' then raise;end if;end;
end $$;
reset role;
insert into auth.users(id,email) values(gen_random_uuid(),'button-staff@example.invalid');
insert into public.a1_staff(user_id) select id from auth.users where email='button-staff@example.invalid';
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='button-staff@example.invalid'),true);
set local role authenticated;
do $$ declare n int;
begin
 if not exists(select 1 from public.a1_button_layout) then raise exception 'Staff read denied';end if;
 begin perform public.a1_save_button_layout('{"added":{},"removed":{}}',0);raise exception 'Staff write allowed';exception when raise_exception then if sqlerrm<>'Administrator access required' then raise;end if;end;
 update public.a1_button_layout set state='{"added":{},"removed":{}}';get diagnostics n=row_count;if n<>0 then raise exception 'Direct staff update allowed';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform * from public.a1_button_layout;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin perform public.a1_save_button_layout('{"added":{},"removed":{}}',0);raise exception 'Anonymous write allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: admin save, stale-write rejection, staff read only, direct-write guard and anonymous denial' as result;
