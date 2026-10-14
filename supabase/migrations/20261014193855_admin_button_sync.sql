-- Shared category links use the current staff session; no separate shared secret.
create table public.a1_button_layout (
 id boolean primary key default true check(id),
 state jsonb not null default '{"added":{},"removed":{}}'::jsonb
  check(jsonb_typeof(state->'added')='object' and jsonb_typeof(state->'removed')='object' and state ? 'added' and state ? 'removed'),
 version bigint not null default 0 check(version>=0),
 updated_at timestamptz not null default now()
);
insert into public.a1_button_layout(id) values(true);
alter table public.a1_button_layout enable row level security;
revoke all on public.a1_button_layout from public,anon,authenticated;
grant select,update on public.a1_button_layout to authenticated;
create policy staff_read_button_layout on public.a1_button_layout for select to authenticated
 using(exists(select 1 from public.a1_staff where user_id=(select auth.uid())));
create policy admin_update_button_layout on public.a1_button_layout for update to authenticated
 using((select public.a1_is_admin())) with check((select public.a1_is_admin()));
create function public.a1_save_button_layout(p_state jsonb,p_expected_version bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.a1_button_layout;
begin
 perform public.a1_require_admin();
 if p_state is null or jsonb_typeof(p_state->'added') is distinct from 'object'
  or jsonb_typeof(p_state->'removed') is distinct from 'object' or octet_length(p_state::text)>1048576 then
  raise exception 'Invalid button layout';
 end if;
 update public.a1_button_layout set state=jsonb_build_object('added',p_state->'added','removed',p_state->'removed'),version=version+1,updated_at=now()
 where id=true and version=p_expected_version returning * into saved;
 if not found then raise exception 'Links changed on another device. Refresh links and retry your change.'; end if;
 return jsonb_build_object('state',saved.state,'version',saved.version);
end $$;
revoke all on function public.a1_save_button_layout(jsonb,bigint) from public,anon;
grant execute on function public.a1_save_button_layout(jsonb,bigint) to authenticated;
