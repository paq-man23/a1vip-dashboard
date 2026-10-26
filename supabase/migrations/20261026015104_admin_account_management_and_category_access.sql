create table public.a1_account_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check(username=lower(username) and username ~ '^[a-z0-9][a-z0-9_.-]{1,39}$'),
 display_name text not null default '' check(length(display_name)<=120),
 admin_role boolean not null default false,
 disabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.a1_account_profiles enable row level security;
revoke all on public.a1_account_profiles from public,anon,authenticated;
grant select on public.a1_account_profiles to authenticated;
grant all on public.a1_account_profiles to service_role;
create policy own_account_profile on public.a1_account_profiles for select to authenticated
 using((user_id=(select auth.uid()) and exists(select 1 from public.a1_staff where user_id=(select auth.uid()))) or (select public.a1_is_admin()));
insert into public.a1_account_profiles(user_id,username,display_name,admin_role)
 select u.id,
 case lower(u.email) when 'jaw@a1eei.com' then 'jaw' when 'vollario@mac.com' then 'jv' else coalesce(nullif(lower(u.raw_user_meta_data->>'username'),''),'account-'||replace(u.id::text,'-','')) end,
 coalesce(nullif(u.raw_user_meta_data->>'display_name',''),case lower(u.email) when 'jaw@a1eei.com' then 'JAW' when 'vollario@mac.com' then 'JV' else split_part(u.email,'@',1) end),
 coalesce(s.is_admin,false)
 from auth.users u left join public.a1_staff s on s.user_id=u.id;
create table public.a1_account_events (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id),
 target_id uuid references auth.users(id), action text not null,
 created_at timestamptz not null default now()
);
alter table public.a1_account_events enable row level security;
revoke all on public.a1_account_events from public,anon,authenticated;
grant select on public.a1_account_events to authenticated;
create policy admin_account_events on public.a1_account_events for select to authenticated using((select public.a1_is_admin()));
alter table public.a1_account_profiles add column allowed_sections text[] not null default array['main','luxury','accounts','travel','social','invoices','customers','vendors','formLetter','tripItinerary'];
alter table public.a1_account_profiles add constraint valid_sections check(allowed_sections <@ array['main','luxury','accounts','travel','social','invoices','customers','vendors','formLetter','tripItinerary']);
alter table public.a1_account_profiles add column blocked_links jsonb not null default '[]'::jsonb check(jsonb_typeof(blocked_links)='array' and octet_length(blocked_links::text)<=100000);
create function a1_activity_private.account_list() returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id=auth.uid() and is_admin) then raise exception 'Administrator access required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
 'id',u.id,'username',coalesce(p.username,''),'name',coalesce(p.display_name,''),'email',u.email,
 'is_admin',coalesce(p.admin_role,s.is_admin,false),'enabled',s.user_id is not null and not coalesce(p.disabled,false),
 'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at,'self',u.id=auth.uid(),'allowed_sections',p.allowed_sections,'blocked_links',p.blocked_links) order by coalesce(p.admin_role,s.is_admin,false) desc,coalesce(p.username,u.email))
 from auth.users u left join public.a1_staff s on s.user_id=u.id left join public.a1_account_profiles p on p.user_id=u.id),'[]'::jsonb);
end $$;
create function a1_activity_private.manage_account(p_action text,p_user_id uuid,p_username text default null,p_name text default null) returns void
 language plpgsql security definer set search_path='' as $$
declare target public.a1_account_profiles; actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.a1_staff where user_id=actor and is_admin) then raise exception 'Administrator access required';end if;
 -- Serializes access changes, including competing attempts to disable the last admin.
 perform pg_advisory_xact_lock(17012601);
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Account not found';end if;
 select * into target from public.a1_account_profiles where user_id=p_user_id for update;
 if p_action='register' then
  if found then raise exception 'Account already registered';end if;
  insert into public.a1_account_profiles(user_id,username,display_name,allowed_sections) values(p_user_id,lower(btrim(p_username)),btrim(coalesce(p_name,'')),array[]::text[]);
  insert into public.a1_staff(user_id,is_admin) values(p_user_id,false) on conflict(user_id) do nothing;
  insert into public.a1_user_preferences(user_id) values(p_user_id) on conflict(user_id) do nothing;
 elsif not found then raise exception 'Register this account before editing';
 elsif p_action='edit' then
  if target.admin_role and lower(btrim(p_username))<>target.username then raise exception 'JAW and JV administrator usernames are protected';end if;
  update public.a1_account_profiles set username=lower(btrim(p_username)),display_name=btrim(coalesce(p_name,'')),updated_at=now() where user_id=p_user_id;
 elsif p_action='disable' then
  if p_user_id=actor then raise exception 'You cannot disable your own account';end if;
  if target.admin_role and (select count(*) from public.a1_staff where is_admin)<=1 then raise exception 'At least one administrator must remain active';end if;
  delete from public.a1_staff where user_id=p_user_id;
  update public.a1_account_profiles set disabled=true,updated_at=now() where user_id=p_user_id;
 elsif p_action='enable' then
  insert into public.a1_staff(user_id,is_admin) values(p_user_id,target.admin_role) on conflict(user_id) do update set is_admin=excluded.is_admin;
  update public.a1_account_profiles set disabled=false,updated_at=now() where user_id=p_user_id;
 elsif p_action='password' then
  null; -- Records a successful server-side Auth password reset; no password is stored here.
 else raise exception 'Unsupported account action';end if;
 insert into public.a1_account_events(actor_id,target_id,action) values(actor,p_user_id,p_action);
end $$;
revoke all on function a1_activity_private.account_list(),a1_activity_private.manage_account(text,uuid,text,text) from public,anon;
grant execute on function a1_activity_private.account_list(),a1_activity_private.manage_account(text,uuid,text,text) to authenticated;
create function public.a1_list_accounts() returns jsonb language sql security invoker set search_path='' as $$ select a1_activity_private.account_list() $$;
create function public.a1_manage_account(p_action text,p_user_id uuid,p_username text default null,p_name text default null) returns void language sql security invoker set search_path='' as $$ select a1_activity_private.manage_account(p_action,p_user_id,p_username,p_name) $$;
revoke all on function public.a1_list_accounts(),public.a1_manage_account(text,uuid,text,text) from public,anon;
grant execute on function public.a1_list_accounts(),public.a1_manage_account(text,uuid,text,text) to authenticated;

create function public.a1_can_access(p_section text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.a1_staff where user_id=auth.uid()) and
 (public.a1_is_admin() or p_section=any(coalesce((select allowed_sections from public.a1_account_profiles where user_id=auth.uid()),array['main','luxury','accounts','travel','social','invoices','customers','vendors','formLetter','tripItinerary'])))
$$;
revoke all on function public.a1_can_access(text) from public,anon;
grant execute on function public.a1_can_access(text) to authenticated;
create function a1_activity_private.set_account_access(p_user_id uuid,p_sections text[],p_blocked jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id=auth.uid() and is_admin) then raise exception 'Administrator access required';end if;
 if p_sections is null or p_blocked is null then raise exception 'Permissions are required';end if;
 if exists(select 1 from public.a1_account_profiles where user_id=p_user_id and admin_role) then raise exception 'Administrator access cannot be restricted';end if;
 update public.a1_account_profiles set allowed_sections=p_sections,blocked_links=p_blocked,updated_at=now() where user_id=p_user_id;
 if not found then raise exception 'Account not found';end if;
 insert into public.a1_account_events(actor_id,target_id,action) values(auth.uid(),p_user_id,'access');
end $$;
revoke all on function a1_activity_private.set_account_access(uuid,text[],jsonb) from public,anon;
grant execute on function a1_activity_private.set_account_access(uuid,text[],jsonb) to authenticated;
create function public.a1_set_account_access(p_user_id uuid,p_sections text[],p_blocked jsonb) returns void language sql security invoker set search_path='' as $$ select a1_activity_private.set_account_access(p_user_id,p_sections,p_blocked) $$;
revoke all on function public.a1_set_account_access(uuid,text[],jsonb) from public,anon;
grant execute on function public.a1_set_account_access(uuid,text[],jsonb) to authenticated;
-- Restrictive rules combine with the existing staff policies, covering direct REST/RPC access.
create policy category_invoices on public.a1_invoices as restrictive for all to authenticated using(public.a1_can_access('invoices')) with check(public.a1_can_access('invoices'));
create policy category_invoice_presets on public.a1_invoice_presets as restrictive for all to authenticated using(public.a1_can_access('invoices')) with check(public.a1_can_access('invoices'));
create policy category_documents on public.a1_documents as restrictive for all to authenticated using(public.a1_can_access(case kind when 'letter' then 'formLetter' else 'tripItinerary' end)) with check(public.a1_can_access(case kind when 'letter' then 'formLetter' else 'tripItinerary' end));
create policy category_contact_edits on public.a1_contact_edits as restrictive for all to authenticated using(public.a1_can_access(case kind when 'customer' then 'customers' else 'vendors' end)) with check(public.a1_can_access(case kind when 'customer' then 'customers' else 'vendors' end));
create policy category_skybox on public.a1_skybox_records as restrictive for all to authenticated using(public.a1_can_access(case kind when 'customer' then 'customers' when 'vendor' then 'vendors' else 'invoices' end)) with check(public.a1_can_access(case kind when 'customer' then 'customers' when 'vendor' then 'vendors' else 'invoices' end));
create policy category_sync_state on public.a1_skybox_sync_state as restrictive for all to authenticated using(public.a1_can_access(case kind when 'customer' then 'customers' when 'vendor' then 'vendors' else 'invoices' end)) with check(public.a1_can_access(case kind when 'customer' then 'customers' when 'vendor' then 'vendors' else 'invoices' end));
create policy category_revisions on public.a1_skybox_revisions as restrictive for all to authenticated using(public.a1_can_access(case kind when 'customer' then 'customers' when 'vendor' then 'vendors' else 'invoices' end)) with check(public.a1_can_access(case kind when 'customer' then 'customers' when 'vendor' then 'vendors' else 'invoices' end));
create policy category_contact_photos on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'a1-contact-photos' or public.a1_can_access(case split_part(name,'/',1) when 'customer' then 'customers' else 'vendors' end))
 with check(bucket_id<>'a1-contact-photos' or public.a1_can_access(case split_part(name,'/',1) when 'customer' then 'customers' else 'vendors' end));
