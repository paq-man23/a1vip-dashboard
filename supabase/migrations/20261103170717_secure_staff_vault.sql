-- Secrets are encrypted by Supabase Vault. No browser role can read the tables,
-- decrypted view, or this service RPC. The Edge Function authenticates the actor.
create schema if not exists a1_vault_private;
revoke all on schema a1_vault_private from public,anon,authenticated;
create table public.a1_vault_permissions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 passwords boolean not null default false, cards boolean not null default false,
 can_edit boolean not null default false
);
create table public.a1_vault_items (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('login','card')),
 label text not null check(length(label) between 1 and 120),
 site_host text not null default '', last_four text not null default '',
 secret_id uuid not null unique, owner_id uuid not null references auth.users(id),
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table public.a1_vault_grants (
 item_id uuid not null references public.a1_vault_items(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(item_id,user_id)
);
create index a1_vault_grants_user on public.a1_vault_grants(user_id,item_id);
create table public.a1_vault_unlocks (
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null, token_hash text not null,
 expires_at timestamptz not null, primary key(user_id,session_id)
);
create table public.a1_vault_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id), action text not null,
 item_id uuid, target_id uuid, created_at timestamptz not null default now()
);
create index a1_vault_events_actor on public.a1_vault_events(actor_id,created_at desc);
alter table public.a1_vault_permissions enable row level security;
alter table public.a1_vault_items enable row level security;
alter table public.a1_vault_grants enable row level security;
alter table public.a1_vault_unlocks enable row level security;
alter table public.a1_vault_events enable row level security;
revoke all on public.a1_vault_permissions,public.a1_vault_items,public.a1_vault_grants,public.a1_vault_unlocks,public.a1_vault_events from public,anon,authenticated;
revoke all on sequence public.a1_vault_events_id_seq from public,anon,authenticated;

create function a1_vault_private.service(p_actor uuid,p_session uuid,p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 admin boolean; perm public.a1_vault_permissions; item public.a1_vault_items;
 result jsonb; details jsonb; target uuid; token text; sid uuid; host text; number text;
begin
 -- Every call checks current membership AND the actual Auth and dashboard sessions.
 select is_admin into admin from public.a1_staff where user_id=p_actor;
 if admin is null or not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>now()))
 or not exists(select 1 from public.a1_activity_sessions where user_id=p_actor and auth_session_id=p_session and ended_at is null and (idle_exempt or last_active_at>now()-interval '20 minutes')) then
  raise exception 'Sign in to the dashboard again' using errcode='42501';
 end if;
 select * into perm from public.a1_vault_permissions where user_id=p_actor;
 if p_action='status' then return jsonb_build_object('admin',admin,'passwords',admin or coalesce(perm.passwords,false),'cards',admin or coalesce(perm.cards,false),'can_edit',admin or coalesce(perm.can_edit,false));end if;
 if p_action='lock' then delete from public.a1_vault_unlocks where user_id=p_actor and session_id=p_session;return '{"ok":true}';end if;
 if not admin and not(coalesce(perm.passwords,false) or coalesce(perm.cards,false)) then raise exception 'Vault access has not been granted' using errcode='42501';end if;
 if p_action='unlock_attempt' then
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
  if (select count(*) from public.a1_vault_events where actor_id=p_actor and action='unlock_attempt' and created_at>now()-interval '15 minutes' and id>coalesce((select max(id) from public.a1_vault_events where actor_id=p_actor and action='unlock'),0))>=5 then
   return '{"allowed":false}';
  end if;
  insert into public.a1_vault_events(actor_id,action) values(p_actor,'unlock_attempt');
  return '{"allowed":true}';
 end if;
 if p_action='unlock' then
  -- Only the service role can call this, after verifying the account password.
  token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.a1_vault_unlocks(user_id,session_id,token_hash,expires_at)
   values(p_actor,p_session,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '5 minutes')
   on conflict(user_id,session_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at;
  insert into public.a1_vault_events(actor_id,action) values(p_actor,'unlock');
  return jsonb_build_object('unlock_token',token,'expires_at',now()+interval '5 minutes');
 end if;
 if not exists(select 1 from public.a1_vault_unlocks where user_id=p_actor and session_id=p_session and expires_at>now() and token_hash=encode(extensions.digest(coalesce(p_input->>'unlock_token',''),'sha256'),'hex')) then
  raise exception 'Vault is locked. Enter your dashboard password again' using errcode='42501';
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'label',i.label,'site_host',i.site_host,'last_four',i.last_four,'version',i.version) order by lower(i.label)),'[]') into result
   from public.a1_vault_items i where admin or
   ((case i.kind when 'login' then coalesce(perm.passwords,false) else coalesce(perm.cards,false) end) and
   exists(select 1 from public.a1_vault_grants g where g.item_id=i.id and g.user_id=p_actor));
  return result;
 end if;
 if p_action in ('accounts','permissions','audit') and not admin then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_action='accounts' then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',coalesce(p.display_name,p.username,u.email),'admin',s.is_admin,'passwords',coalesce(v.passwords,false),'cards',coalesce(v.cards,false),'can_edit',coalesce(v.can_edit,false)) order by u.email),'[]') into result
   from public.a1_staff s join auth.users u on u.id=s.user_id left join public.a1_account_profiles p on p.user_id=s.user_id left join public.a1_vault_permissions v on v.user_id=s.user_id;
  return result;
 end if;
 if p_action='permissions' then
  target:=(p_input->>'user_id')::uuid;
  if not exists(select 1 from public.a1_staff where user_id=target and not is_admin) then raise exception 'Choose a regular staff account';end if;
  insert into public.a1_vault_permissions(user_id,passwords,cards,can_edit) values(target,coalesce((p_input->>'passwords')::boolean,false),coalesce((p_input->>'cards')::boolean,false),coalesce((p_input->>'can_edit')::boolean,false))
   on conflict(user_id) do update set passwords=excluded.passwords,cards=excluded.cards,can_edit=excluded.can_edit;
  delete from public.a1_vault_unlocks where user_id=target;
  insert into public.a1_vault_events(actor_id,action,target_id) values(p_actor,'permissions',target);
  return '{"ok":true}';
 end if;
 if p_action='audit' then
  select coalesce(jsonb_agg(to_jsonb(e)),'[]') into result from
   (select e.action,e.item_id,e.target_id,e.created_at,coalesce(p.display_name,p.username,u.email) as actor from public.a1_vault_events e join auth.users u on u.id=e.actor_id left join public.a1_account_profiles p on p.user_id=e.actor_id order by e.id desc limit 200) e;
  return result;
 end if;
 if p_input->>'id' is not null then
  select * into item from public.a1_vault_items where id=(p_input->>'id')::uuid for update;
  if not found then raise exception 'Vault entry is unavailable' using errcode='42501';end if;
  if not admin and (not coalesce(case item.kind when 'login' then perm.passwords else perm.cards end,false) or
    not exists(select 1 from public.a1_vault_grants where item_id=item.id and user_id=p_actor)) then
   raise exception 'Vault entry is unavailable' using errcode='42501';
  end if;
 elsif p_action<>'save' then raise exception 'Choose a vault entry';end if;
 if p_action in ('reveal','edit') then
  if p_action='edit' and not(admin or coalesce(perm.can_edit,false)) then raise exception 'Vault editing has not been granted' using errcode='42501';end if;
  select decrypted_secret::jsonb into details from vault.decrypted_secrets where id=item.secret_id;
  if details is null then raise exception 'Vault entry is unavailable';end if;
  insert into public.a1_vault_events(actor_id,action,item_id) values(p_actor,p_action,item.id);
  return jsonb_build_object('id',item.id,'kind',item.kind,'label',item.label,'version',item.version,'details',details);
 end if;
 if p_action='grants' then
  if not admin then raise exception 'Administrator access required' using errcode='42501';end if;
  if p_input ? 'users' then
   if jsonb_typeof(p_input->'users')<>'array' or jsonb_array_length(p_input->'users')>100 then raise exception 'Choose valid staff accounts';end if;
   if exists(select 1 from jsonb_array_elements_text(p_input->'users') x where not exists(select 1 from public.a1_staff where user_id=x::uuid)) then raise exception 'Choose valid staff accounts';end if;
   delete from public.a1_vault_grants where item_id=item.id;
   insert into public.a1_vault_grants(item_id,user_id) select item.id,x::uuid from jsonb_array_elements_text(p_input->'users') x on conflict do nothing;
   -- Revoke existing unlocks for all regular users when item sharing changes.
   delete from public.a1_vault_unlocks where user_id in(select user_id from public.a1_staff where not is_admin);
   insert into public.a1_vault_events(actor_id,action,item_id) values(p_actor,'sharing',item.id);
  end if;
  return coalesce((select jsonb_agg(user_id) from public.a1_vault_grants where item_id=item.id),'[]');
 end if;
 if p_action in ('save','delete') then
  if not(admin or coalesce(perm.can_edit,false)) then raise exception 'Vault editing has not been granted' using errcode='42501';end if;
  if item.id is not null and (p_input->>'version')::integer is distinct from item.version then raise exception 'This entry changed. Refresh before saving';end if;
  if p_action='delete' then
   delete from public.a1_vault_items where id=item.id;
   delete from vault.secrets where id=item.secret_id;
   insert into public.a1_vault_events(actor_id,action,item_id) values(p_actor,'delete',item.id);
   return '{"ok":true}';
  end if;
  if p_input->>'kind' not in ('login','card') or p_input->>'kind' is null or length(trim(coalesce(p_input->>'label',''))) not between 1 and 120 then raise exception 'Enter a name and valid entry type';end if;
  if item.id is not null and item.kind<>p_input->>'kind' then raise exception 'Entry type cannot be changed';end if;
  if not admin and not coalesce(case p_input->>'kind' when 'login' then perm.passwords else perm.cards end,false) then raise exception 'Vault access has not been granted' using errcode='42501';end if;
  details:=p_input->'details';
  if details is null or jsonb_typeof(details)<>'object' or octet_length(details::text)>16000 then raise exception 'Enter valid entry details';end if;
  if p_input->>'kind'='login' then
   if length(coalesce(details->>'password','')) not between 1 and 2000 or length(coalesce(details->>'username',''))>254 or (details->>'url') !~ '^https://[^[:space:]]+$' or details->>'url' is null then raise exception 'Enter an HTTPS site URL, username, and password';end if;
   details:=jsonb_build_object('username',coalesce(details->>'username',''),'password',details->>'password','url',details->>'url','notes',left(coalesce(details->>'notes',''),4000));
   host:=split_part(split_part(substr(details->>'url',9),'/',1),'?',1);
  else
   number:=regexp_replace(coalesce(details->>'number',''),'[ -]','','g');
   if number !~ '^[0-9]{12,19}$' or length(trim(coalesce(details->>'cardholder','')))=0 or coalesce(details->>'expiry','') !~ '^(0[1-9]|1[0-2])/[0-9]{2}$' then raise exception 'Enter a valid company card number, cardholder, and MM/YY expiration';end if;
   details:=jsonb_build_object('number',number,'cardholder',left(details->>'cardholder',120),'expiry',details->>'expiry','billing',left(coalesce(details->>'billing',''),1000),'notes',left(coalesce(details->>'notes',''),4000));
   host:='';
  end if;
  if item.id is null then
   sid:=vault.create_secret(details::text);
   insert into public.a1_vault_items(kind,label,site_host,last_four,secret_id,owner_id) values(p_input->>'kind',trim(p_input->>'label'),host,case when p_input->>'kind'='card' then right(number,4) else '' end,sid,p_actor) returning * into item;
   insert into public.a1_vault_grants(item_id,user_id) values(item.id,p_actor);
  else
   perform vault.update_secret(item.secret_id,details::text);
   update public.a1_vault_items set label=trim(p_input->>'label'),site_host=host,last_four=case when item.kind='card' then right(number,4) else '' end,version=version+1,updated_at=now() where id=item.id returning * into item;
  end if;
  insert into public.a1_vault_events(actor_id,action,item_id) values(p_actor,'save',item.id);
  return jsonb_build_object('id',item.id,'version',item.version);
 end if;
 raise exception 'Unsupported vault action';
end $$;
revoke all on function a1_vault_private.service(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant usage on schema a1_vault_private to service_role;
grant execute on function a1_vault_private.service(uuid,uuid,text,jsonb) to service_role;
create function public.a1_vault_service(p_actor uuid,p_session uuid,p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select a1_vault_private.service(p_actor,p_session,p_action,p_input) $$;
revoke all on function public.a1_vault_service(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.a1_vault_service(uuid,uuid,text,jsonb) to service_role;
