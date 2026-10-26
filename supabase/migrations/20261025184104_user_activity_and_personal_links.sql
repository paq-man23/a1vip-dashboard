-- Additive setup for dashboard punch cards and personal link visibility.
create schema if not exists a1_activity_private;
revoke all on schema a1_activity_private from public,anon;
grant usage on schema a1_activity_private to authenticated;
create table public.a1_activity_sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 auth_session_id uuid not null,
 display_name text not null,
 started_at timestamptz not null default now(),
 last_active_at timestamptz not null default now(),
 ended_at timestamptz,
 end_reason text check(end_reason in ('logout','idle')),
 unique(user_id,auth_session_id),
 check(ended_at is null or ended_at>=started_at)
);
create index a1_activity_sessions_recent on public.a1_activity_sessions(started_at desc);
alter table public.a1_activity_sessions enable row level security;
revoke all on public.a1_activity_sessions from anon,authenticated;
grant select on public.a1_activity_sessions to authenticated;
create policy admin_only_punch_cards on public.a1_activity_sessions for select to authenticated
 using((select public.a1_is_admin()));
-- Only this narrow, authenticated entry point can write server-generated times.
-- It is in a non-exposed schema; neither arbitrary user IDs nor timestamps are accepted.
create function a1_activity_private.session_event(p_action text) returns timestamptz
 language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
 record public.a1_activity_sessions;
 actor_name text;
begin
 if actor is null or not exists(select 1 from public.a1_staff where user_id=actor) then
  raise exception 'A1 staff access required';
 end if;
 if sid is null then raise exception 'A signed-in session is required'; end if;
 if p_action not in ('start','activity','logout','idle') or p_action is null then raise exception 'Unsupported activity event'; end if;
 if p_action='start' then
  select coalesce(email,actor::text) into actor_name from auth.users where id=actor;
  insert into public.a1_activity_sessions(user_id,auth_session_id,display_name)
   values(actor,sid,actor_name) on conflict(user_id,auth_session_id) do nothing;
 end if;
 select * into record from public.a1_activity_sessions where user_id=actor and auth_session_id=sid for update;
 if not found then raise exception 'Open the dashboard before recording activity';end if;
 if p_action in ('logout','idle') then
  update public.a1_activity_sessions set
   ended_at=coalesce(ended_at,greatest(started_at,least(now(),last_active_at+interval '20 minutes'))),
   end_reason=coalesce(end_reason,case when p_action='idle' or now()>=last_active_at+interval '20 minutes' then 'idle' else 'logout' end)
   where id=record.id;
  return record.last_active_at;
 end if;
 if record.ended_at is not null or now()>=record.last_active_at+interval '20 minutes' then
  raise exception 'Session ended after inactivity. Sign in again.';
 end if;
 if p_action='activity' then
  update public.a1_activity_sessions set last_active_at=now() where id=record.id;
  return now();
 end if;
 return record.last_active_at;
end $$;
revoke all on function a1_activity_private.session_event(text) from public,anon;
grant execute on function a1_activity_private.session_event(text) to authenticated;
create function public.a1_activity_session(p_action text) returns timestamptz
 language sql security invoker set search_path='' as $$ select a1_activity_private.session_event(p_action) $$;
revoke all on function public.a1_activity_session(text) from public,anon;
grant execute on function public.a1_activity_session(text) to authenticated;
create table public.a1_user_preferences (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 hidden_buttons jsonb not null default '[]'::jsonb,
 check(jsonb_typeof(hidden_buttons)='array' and octet_length(hidden_buttons::text)<=100000)
);
alter table public.a1_user_preferences enable row level security;
revoke all on public.a1_user_preferences from anon,authenticated;
grant select,insert,update on public.a1_user_preferences to authenticated;
create policy personal_buttons on public.a1_user_preferences for all to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.a1_staff where user_id=(select auth.uid())))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.a1_staff where user_id=(select auth.uid())));

create table public.a1_website_views (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 auth_session_id uuid not null,
 display_name text not null,
 site_host text not null,
 label text not null,
 started_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 ended_at timestamptz,
 visible_seconds integer not null default 0 check(visible_seconds>=0)
);
create index a1_website_views_recent on public.a1_website_views(started_at desc);
alter table public.a1_website_views enable row level security;
revoke all on public.a1_website_views from anon,authenticated;
grant select on public.a1_website_views to authenticated;
create policy admin_only_website_views on public.a1_website_views for select to authenticated using((select public.a1_is_admin()));
create function a1_activity_private.website_event(p_id uuid,p_host text,p_label text,p_seconds integer,p_close boolean) returns void
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if actor is null or sid is null or not exists(select 1 from public.a1_staff where user_id=actor) then raise exception 'A1 staff access required';end if;
 if not exists(select 1 from public.a1_activity_sessions where user_id=actor and auth_session_id=sid and ended_at is null and now()<last_active_at+interval '20 minutes') then raise exception 'Session ended after inactivity. Sign in again.';end if;
 if p_id is null or p_host is null or p_host !~ '^[a-zA-Z0-9.:-]{1,253}$' or p_seconds is null or p_seconds<0 then raise exception 'Invalid website view';end if;
 insert into public.a1_website_views(id,user_id,auth_session_id,display_name,site_host,label)
 select p_id,actor,sid,coalesce(email,actor::text),p_host,left(coalesce(p_label,p_host),200) from auth.users where id=actor
 on conflict(id) do nothing;
 update public.a1_website_views set last_seen_at=now(),
 visible_seconds=greatest(visible_seconds,least(p_seconds,greatest(0,floor(extract(epoch from now()-started_at))::integer))),
 ended_at=case when p_close then now() else null end
 where id=p_id and user_id=actor and auth_session_id=sid and ended_at is null;
end $$;
revoke all on function a1_activity_private.website_event(uuid,text,text,integer,boolean) from public,anon;
grant execute on function a1_activity_private.website_event(uuid,text,text,integer,boolean) to authenticated;
create function public.a1_website_view(p_id uuid,p_host text,p_label text,p_seconds integer,p_close boolean) returns void
 language sql security invoker set search_path='' as $$ select a1_activity_private.website_event(p_id,p_host,p_label,p_seconds,p_close) $$;
revoke all on function public.a1_website_view(uuid,text,text,integer,boolean) from public,anon;
grant execute on function public.a1_website_view(uuid,text,text,integer,boolean) to authenticated;

alter table public.a1_user_preferences add column added_links jsonb not null default '[]'::jsonb
 check(jsonb_typeof(added_links)='array' and octet_length(added_links::text)<=100000);
drop policy personal_buttons on public.a1_user_preferences;
create policy personal_buttons on public.a1_user_preferences for all to authenticated
 using((user_id=(select auth.uid()) or (select public.a1_is_admin())) and exists(select 1 from public.a1_staff where user_id=(select auth.uid())))
 with check((user_id=(select auth.uid()) or (select public.a1_is_admin())) and exists(select 1 from public.a1_staff where user_id=(select auth.uid())));
create function a1_activity_private.staff_directory() returns table(user_id uuid,email text)
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.a1_staff where a1_staff.user_id=auth.uid() and is_admin) then raise exception 'Administrator access required';end if;
 return query select s.user_id,u.email::text from public.a1_staff s join auth.users u on u.id=s.user_id order by u.email;
end $$;
revoke all on function a1_activity_private.staff_directory() from public,anon;
grant execute on function a1_activity_private.staff_directory() to authenticated;
create function public.a1_preference_users() returns table(user_id uuid,email text)
 language sql security invoker set search_path='' as $$ select * from a1_activity_private.staff_directory() $$;
revoke all on function public.a1_preference_users() from public,anon;
grant execute on function public.a1_preference_users() to authenticated;
