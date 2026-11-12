begin;
select set_config('a1.season.admin',gen_random_uuid()::text,true),set_config('a1.season.staff',gen_random_uuid()::text,true),set_config('a1.season.denied',gen_random_uuid()::text,true),set_config('a1.season.id',gen_random_uuid()::text,true);
insert into auth.users(id,email) select current_setting('a1.season.'||k)::uuid,'season-'||k||'-fixture@example.invalid' from unnest(array['admin','staff','denied']) k;
insert into public.a1_staff(user_id,is_admin) select current_setting('a1.season.'||k)::uuid,k='admin' from unnest(array['admin','staff','denied']) k;
insert into public.a1_account_profiles(user_id,username,allowed_sections,admin_role) select current_setting('a1.season.'||k)::uuid,'season-'||k||'-'||left(current_setting('a1.season.'||k),8),case when k='denied' then array['main'] else array['seasonTickets'] end,k='admin' from unnest(array['admin','staff','denied']) k;
select set_config('request.jwt.claim.sub',current_setting('a1.season.staff'),true);
set local role authenticated;
select public.a1_save_season_holder(current_setting('a1.season.id')::uuid,'{"holderName":"Fixture Holder","venue":"Hard Rock Stadium","team":"Miami Dolphins","phone":"5550100","status":"Ask first","quantity":"4"}',0);
do $$ declare r jsonb;begin
 select document into r from public.a1_season_ticket_holders where id=current_setting('a1.season.id')::uuid;
 if r->>'team'<>'Miami Dolphins' then raise exception 'Saved holding missing';end if;
 perform public.a1_save_season_holder(current_setting('a1.season.id')::uuid,r||'{"status":"Open to offers"}',1);
 begin perform public.a1_save_season_holder(current_setting('a1.season.id')::uuid,r,1);raise exception 'Stale update allowed';exception when raise_exception then if sqlerrm not like 'This holder changed%' then raise;end if;end;
 begin insert into public.a1_season_ticket_holders(document) values('{"holderName":"Invalid"}');raise exception 'Invalid direct insert allowed';exception when check_violation then null;end;
 begin update public.a1_season_ticket_holders set version=999;raise exception 'Version tampering allowed';exception when insufficient_privilege then null;end;
 begin delete from public.a1_season_ticket_holders;raise exception 'Direct deletion allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('a1.season.admin'),true);
set local role authenticated;
do $$ declare r public.a1_season_ticket_holders;begin
 select * into r from public.a1_season_ticket_holders where id=current_setting('a1.season.id')::uuid;
 if r.version<>2 or r.updated_by<>current_setting('a1.season.staff')::uuid then raise exception 'Shared read or server audit failed';end if;
 perform public.a1_save_season_holder(r.id,r.document||'{"status":"Archived"}',r.version);
 perform public.a1_set_account_access(current_setting('a1.season.denied')::uuid,array['seasonTickets'],'[]');
 perform public.a1_set_account_access(current_setting('a1.season.denied')::uuid,array['main'],'[]');
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('a1.season.denied'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.a1_season_ticket_holders) then raise exception 'Restricted category leaked';end if;
 begin perform public.a1_save_season_holder(gen_random_uuid(),'{"holderName":"Denied","venue":"Venue","event":"Event","phone":"555","status":"Ask first"}',0);raise exception 'Restricted save allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.a1_account_profiles set disabled=true where user_id=current_setting('a1.season.staff')::uuid;
select set_config('request.jwt.claim.sub',current_setting('a1.season.staff'),true);
set local role authenticated;
do $$ begin if exists(select 1 from public.a1_season_ticket_holders) then raise exception 'Disabled account retained access';end if;end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.a1_season_ticket_holders;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin perform public.a1_save_season_holder(gen_random_uuid(),'{}',0);raise exception 'Anonymous save allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: shared holder CRUD, version conflicts, validation, audit protection, archive, category isolation, disabled users and anonymous denial' as result;
