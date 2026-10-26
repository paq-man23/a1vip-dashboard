alter table public.a1_activity_sessions add column idle_exempt boolean not null default false;
update public.a1_activity_sessions s set idle_exempt=true from public.a1_staff u where s.user_id=u.user_id and u.is_admin and s.ended_at is null;
create or replace function a1_activity_private.session_event(p_action text) returns timestamptz
 language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
 record public.a1_activity_sessions;
 actor_name text;
 exempt boolean;
begin
 if actor is null or not exists(select 1 from public.a1_staff where user_id=actor) then
  raise exception 'A1 staff access required';
 end if;
 if sid is null then raise exception 'A signed-in session is required'; end if;
 if p_action not in ('start','activity','logout','idle') or p_action is null then raise exception 'Unsupported activity event'; end if;
 select is_admin into exempt from public.a1_staff where user_id=actor;
 if p_action='idle' and exempt then return now();end if;
 if p_action='start' then
  select coalesce(email,actor::text) into actor_name from auth.users where id=actor;
  insert into public.a1_activity_sessions(user_id,auth_session_id,display_name,idle_exempt)
   values(actor,sid,actor_name,exempt) on conflict(user_id,auth_session_id) do nothing;
 end if;
 select * into record from public.a1_activity_sessions where user_id=actor and auth_session_id=sid for update;
 if not found then raise exception 'Open the dashboard before recording activity';end if;
 if p_action in ('logout','idle') then
  update public.a1_activity_sessions set
   ended_at=coalesce(ended_at,greatest(started_at,case when exempt then now() else least(now(),last_active_at+interval '20 minutes') end)),
   end_reason=coalesce(end_reason,case when not exempt and (p_action='idle' or now()>=last_active_at+interval '20 minutes') then 'idle' else 'logout' end)
   where id=record.id;
  return record.last_active_at;
 end if;
 if record.ended_at is not null or (not exempt and now()>=record.last_active_at+interval '20 minutes') then
  raise exception 'Session ended after inactivity. Sign in again.';
 end if;
 update public.a1_activity_sessions set idle_exempt=exempt where id=record.id;
 if p_action='activity' then
  update public.a1_activity_sessions set last_active_at=now() where id=record.id;
  return now();
 end if;
 return record.last_active_at;
end $$;
create or replace function a1_activity_private.website_event(p_id uuid,p_host text,p_label text,p_seconds integer,p_close boolean) returns void
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if actor is null or sid is null or not exists(select 1 from public.a1_staff where user_id=actor) then raise exception 'A1 staff access required';end if;
 if not exists(select 1 from public.a1_activity_sessions where user_id=actor and auth_session_id=sid and ended_at is null and (public.a1_is_admin() or now()<last_active_at+interval '20 minutes')) then raise exception 'Session ended after inactivity. Sign in again.';end if;
 if p_id is null or p_host is null or p_host !~ '^[a-zA-Z0-9.:-]{1,253}$' or p_seconds is null or p_seconds<0 then raise exception 'Invalid website view';end if;
 insert into public.a1_website_views(id,user_id,auth_session_id,display_name,site_host,label)
 select p_id,actor,sid,coalesce(email,actor::text),p_host,left(coalesce(p_label,p_host),200) from auth.users where id=actor
 on conflict(id) do nothing;
 update public.a1_website_views set last_seen_at=now(),
 visible_seconds=greatest(visible_seconds,least(p_seconds,greatest(0,floor(extract(epoch from now()-started_at))::integer))),
 ended_at=case when p_close then now() else null end
 where id=p_id and user_id=actor and auth_session_id=sid and ended_at is null;
end $$;
