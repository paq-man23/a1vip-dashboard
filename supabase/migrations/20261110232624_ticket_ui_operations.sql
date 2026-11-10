-- Native Ticket UI uses saved credentials without changing the existing sync worker.
-- Service-only access: neither credentials nor audit rows are exposed to browser roles.
create table a1_skybox_private.ticket_operations (
 id uuid primary key,
 actor uuid not null references auth.users(id),
 operation text not null,
 status text not null default 'pending' check(status in ('pending','not_sent','rejected','unknown','succeeded')),
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
alter table a1_skybox_private.ticket_operations enable row level security;
revoke all on a1_skybox_private.ticket_operations from public,anon,authenticated;

create function a1_skybox_private.ticket_ui(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c a1_skybox_private.connection; result jsonb; actor_id uuid; operation_id uuid;
begin
 -- Existing authorization enforces admin, current auth session, active dashboard
 -- session, and disabled-account rules before any secret is read or action recorded.
 perform a1_skybox_private.service('authorize',p_input);
 actor_id:=(p_input->>'actor')::uuid;
 if p_action='connection' then
  select * into c from a1_skybox_private.connection where id;
  if c.credential_id is null then return '{}'::jsonb; end if;
  select decrypted_secret::jsonb into result from vault.decrypted_secrets where id=c.credential_id;
  return result||jsonb_build_object('accountId',c.account_id);
 elsif p_action='begin' then
  operation_id:=(p_input->>'id')::uuid;
  if operation_id is null or coalesce(length(p_input->>'operation'),0) not between 1 and 150 then raise exception 'Invalid operation';end if;
  insert into a1_skybox_private.ticket_operations(id,actor,operation)
   values(operation_id,actor_id,p_input->>'operation') on conflict(id) do nothing;
  return to_jsonb(found);
 elsif p_action='finish' then
  if p_input->>'status' not in ('not_sent','rejected','unknown','succeeded') then raise exception 'Invalid status';end if;
  update a1_skybox_private.ticket_operations set status=p_input->>'status',finished_at=now()
   where id=(p_input->>'id')::uuid and actor=actor_id and status='pending';
  return '{}'::jsonb;
 end if;
 raise exception 'Unsupported Ticket UI service action';
end $$;
revoke all on function a1_skybox_private.ticket_ui(text,jsonb) from public,anon,authenticated;
grant execute on function a1_skybox_private.ticket_ui(text,jsonb) to service_role;
create function public.a1_ticket_ui_service(p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select a1_skybox_private.ticket_ui(p_action,p_input)$$;
revoke all on function public.a1_ticket_ui_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.a1_ticket_ui_service(text,jsonb) to service_role;
