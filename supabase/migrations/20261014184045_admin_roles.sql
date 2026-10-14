alter table public.a1_staff add column is_admin boolean not null default false;
update public.a1_staff s set is_admin=true from auth.users u where u.id=s.user_id and lower(u.email) in ('jaw@a1eei.com','vollario@mac.com');
-- Membership rows remain read-only to browser clients; users cannot grant themselves admin.
create function public.a1_is_admin() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.a1_staff where user_id=(select auth.uid()) and is_admin)
$$;
create function public.a1_require_admin() returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id=auth.uid()) then raise exception 'A1 staff access required'; end if;
 if not public.a1_is_admin() then raise exception 'Administrator access required'; end if;
end $$;
revoke all on function public.a1_is_admin(),public.a1_require_admin() from public,anon;
grant execute on function public.a1_is_admin(),public.a1_require_admin() to authenticated;
-- Guard the existing import/sync/review entry points without changing their conversion logic.
do $$ declare entry record; definition text;
begin
 for entry in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('a1_import_document','a1_import_skybox','a1_import_skybox_batch','a1_sync_skybox','a1_sync_skybox_batch','a1_resolve_import_conflict') loop
  definition:=pg_get_functiondef(entry.oid);
  if strpos(definition,E'\nbegin\n')=0 then raise exception 'Admin guard insertion point missing'; end if;
  execute replace(definition,E'\nbegin\n',E'\nbegin\n  perform public.a1_require_admin();\n');
 end loop;
end $$;
-- Restrictive policies also reject direct Data API writes, even if the UI is bypassed.
create policy admin_skybox_insert on public.a1_skybox_records as restrictive for insert to authenticated with check((select public.a1_is_admin()));
create policy admin_import_receipts_insert on public.a1_document_imports as restrictive for insert to authenticated with check((select public.a1_is_admin()));
create policy admin_import_conflicts on public.a1_import_conflicts as restrictive for all to authenticated using((select public.a1_is_admin())) with check((select public.a1_is_admin()));
create policy admin_sync_runs on public.a1_skybox_sync_runs as restrictive for all to authenticated using((select public.a1_is_admin())) with check((select public.a1_is_admin()));
create policy admin_revisions_insert on public.a1_skybox_revisions as restrictive for insert to authenticated with check((select public.a1_is_admin()));
create policy admin_sync_insert on public.a1_skybox_sync_state as restrictive for insert to authenticated with check((select public.a1_is_admin()));
create policy admin_sync_update on public.a1_skybox_sync_state as restrictive for update to authenticated using((select public.a1_is_admin())) with check((select public.a1_is_admin()));
create policy admin_sync_delete on public.a1_skybox_sync_state as restrictive for delete to authenticated using((select public.a1_is_admin()));
