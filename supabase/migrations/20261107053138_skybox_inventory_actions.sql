-- Trading is disabled by default. No provider transaction is performed by this migration.
create table a1_skybox_private.trade_settings(id boolean primary key default true check(id), enabled boolean not null default false, verified_by uuid references auth.users(id), verified_at timestamptz, next_request_at timestamptz not null default now());
insert into a1_skybox_private.trade_settings(id) values(true);
create table a1_skybox_private.trade_orders(
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id), inventory_id text not null,
 kind text not null check(kind in ('sale','hold','price','listing')),
 state text not null default 'preview' check(state in ('preview','executing','uncertain','provider_confirmed','complete','rejected','expired')),
 intent jsonb not null, snapshot jsonb not null, fingerprint text not null,
 provider_id text, invoice_id text, result jsonb, error_code text,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '2 minutes', updated_at timestamptz not null default now()
);
create unique index skybox_trade_inventory_lock on a1_skybox_private.trade_orders(inventory_id) where state in ('preview','executing','uncertain','provider_confirmed');
create index skybox_trade_actor_history on a1_skybox_private.trade_orders(actor_id,created_at desc);
create table a1_skybox_private.trade_events(id bigint generated always as identity primary key, actor_id uuid references auth.users(id), order_id uuid references a1_skybox_private.trade_orders(id), action text not null, created_at timestamptz not null default now());
alter table a1_skybox_private.trade_settings enable row level security;
alter table a1_skybox_private.trade_orders enable row level security;
alter table a1_skybox_private.trade_events enable row level security;
revoke all on a1_skybox_private.trade_settings,a1_skybox_private.trade_orders,a1_skybox_private.trade_events from public,anon,authenticated,service_role;

create function a1_skybox_private.trade(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(p_input->>'actor')::uuid; sid uuid:=(p_input->>'session')::uuid; c a1_skybox_private.connection;
 o a1_skybox_private.trade_orders; settings a1_skybox_private.trade_settings; creds jsonb; imported jsonb; saved public.a1_invoices; wait_ms bigint;
begin
 -- The Edge Function supplies a verified Auth identity; SQL independently checks live access.
 if actor is null or sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=actor and (not_after is null or not_after>now())) or not exists(select 1 from public.a1_activity_sessions where user_id=actor and auth_session_id=sid and ended_at is null and (idle_exempt or last_active_at>now()-interval '20 minutes')) then raise exception 'Sign in again';end if;
 if not exists(select 1 from public.a1_staff where user_id=actor and is_admin) or exists(select 1 from public.a1_account_profiles where user_id=actor and disabled) then raise exception 'Administrator access required';end if;
 select * into strict c from a1_skybox_private.connection where id;
 select * into strict settings from a1_skybox_private.trade_settings where id for update;
 if p_action='settings' then
  if p_input->>'confirmation' is distinct from 'ENABLE SKYBOX TRADING' and coalesce((p_input->>'enabled')::boolean,false) then raise exception 'Explicit trading approval required';end if;
  update a1_skybox_private.trade_settings set enabled=coalesce((p_input->>'enabled')::boolean,false),verified_by=actor,verified_at=now() where id;
  insert into a1_skybox_private.trade_events(actor_id,action) values(actor,case when (p_input->>'enabled')::boolean then 'enable_trading' else 'disable_trading' end);
  return jsonb_build_object('enabled',coalesce((p_input->>'enabled')::boolean,false));
 end if;
 if p_action='status' then
  return jsonb_build_object('enabled',settings.enabled,'configured',c.credential_id is not null,'orders',(select coalesce(jsonb_agg(x),'[]') from (select id,kind,state,inventory_id,provider_id,invoice_id,error_code,created_at from a1_skybox_private.trade_orders order by created_at desc limit 50)x));
 end if;
 if p_action='context' then
  if c.credential_id is null then raise exception 'Connect Skybox in Admin first';end if;
  select decrypted_secret::jsonb into creds from vault.decrypted_secrets where id=c.credential_id;
  return creds||jsonb_build_object('accountId',c.account_id,'enabled',settings.enabled);
 end if;
 if p_action='cooldown' then
  update a1_skybox_private.trade_settings set next_request_at=greatest(next_request_at,clock_timestamp()+greatest(0,(p_input->>'retryMs')::bigint)*interval '1 millisecond') where id;
  return '{}'::jsonb;
 end if;
 if p_action='pace' then
  wait_ms:=greatest(0,ceil(extract(epoch from(settings.next_request_at-clock_timestamp()))*1000))::bigint;
  if wait_ms>15000 then raise exception 'Skybox trading is busy; try again shortly';end if;
  update a1_skybox_private.trade_settings set next_request_at=greatest(clock_timestamp(),next_request_at)+interval '1.1 seconds' where id;
  return jsonb_build_object('waitMs',wait_ms);
 end if;
 if p_action='prepare' then
  if not c.enabled then raise exception 'Skybox syncing is paused. Resume it before trading';end if;
  if p_input->>'kind' not in ('sale','hold','price','listing') or coalesce(p_input->>'inventoryId','') !~ '^[1-9][0-9]{0,15}$' or length(p_input->>'fingerprint')<>64 or jsonb_typeof(p_input->'intent') is distinct from 'object' or jsonb_typeof(p_input->'snapshot') is distinct from 'object' then raise exception 'Invalid trade preview';end if;
  update a1_skybox_private.trade_orders set state='expired',updated_at=now() where inventory_id=p_input->>'inventoryId' and state='preview' and expires_at<=now();
  insert into a1_skybox_private.trade_orders(actor_id,inventory_id,kind,intent,snapshot,fingerprint) values(actor,p_input->>'inventoryId',p_input->>'kind',p_input->'intent',p_input->'snapshot',p_input->>'fingerprint') returning * into o;
  insert into a1_skybox_private.trade_events(actor_id,order_id,action) values(actor,o.id,'preview');
  return jsonb_build_object('id',o.id,'expiresAt',o.expires_at,'externalRef','A1-'||o.id,'enabled',settings.enabled);
 end if;
 select * into strict o from a1_skybox_private.trade_orders where id=(p_input->>'id')::uuid for update;
 if p_action='get' then return to_jsonb(o);end if;
 if p_action='write_gate' then
  if o.actor_id<>actor or o.state<>'executing' or not settings.enabled or not c.enabled then raise exception 'Trading permission changed';end if;
  return '{}'::jsonb;
 end if;
 if p_action='cancel' then
  if o.actor_id<>actor or o.state<>'preview' then raise exception 'Only an unsubmitted preview can be cancelled';end if;
  update a1_skybox_private.trade_orders set state='expired',updated_at=now() where id=o.id;
  return jsonb_build_object('state','expired');
 end if;
 if p_action='claim' then
  if o.state<>'preview' then return to_jsonb(o)||jsonb_build_object('claimed',false);end if;
  if o.actor_id<>actor then raise exception 'This preview belongs to another administrator';end if;
  if not settings.enabled or not c.enabled then raise exception 'Live trading is disabled';end if;
  if o.expires_at<=now() or p_input->>'confirmation' is distinct from 'CONFIRM SKYBOX ACTION' then raise exception 'Preview expired or explicit confirmation missing';end if;
  update a1_skybox_private.trade_orders set state='executing',updated_at=now() where id=o.id returning * into o;
  insert into a1_skybox_private.trade_events(actor_id,order_id,action) values(actor,o.id,'confirmed');
  return to_jsonb(o)||jsonb_build_object('claimed',true);
 end if;
 if p_action='state' then
  if o.state not in ('executing','uncertain','provider_confirmed') then raise exception 'Action is no longer pending';end if;
  if p_input->>'state' not in ('uncertain','provider_confirmed','rejected','complete') then raise exception 'Invalid action state';end if;
  if o.kind='sale' and p_input->>'state'='complete' then raise exception 'Sales require verified invoice finalization';end if;
  update a1_skybox_private.trade_orders set state=p_input->>'state',provider_id=coalesce(p_input->>'providerId',provider_id),result=p_input->'result',error_code=left(p_input->>'code',80),updated_at=now() where id=o.id returning * into o;
  if o.state='complete' then update a1_skybox_private.inventory set available=false where id=o.inventory_id;end if;
  insert into a1_skybox_private.trade_events(actor_id,order_id,action) values(actor,o.id,o.state);
  return jsonb_build_object('id',o.id,'state',o.state,'providerId',o.provider_id,'invoiceId',o.invoice_id);
 end if;
 if p_action='finalize' then
  if o.state='complete' then return o.result;end if;
  if o.kind<>'sale' or o.state<>'provider_confirmed' or o.provider_id is null then raise exception 'Provider sale is not confirmed';end if;
  if p_input->'document'->>'id'<>'inv-skybox-invoice-'||o.provider_id then raise exception 'Invoice identity mismatch';end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  imported:=public.a1_sync_skybox('invoice',o.provider_id,p_input->'record',p_input->'document','{}');
  if imported->>'outcome'='conflict' then raise exception 'Skybox sale is confirmed; invoice needs import-conflict review';end if;
  select * into strict saved from public.a1_invoices where id='inv-skybox-invoice-'||o.provider_id;
  update a1_skybox_private.trade_orders set state='complete',invoice_id=saved.id,result=jsonb_build_object('id',o.id,'state','complete','providerId',o.provider_id,'invoiceId',saved.id,'invoiceNumber',saved.number),updated_at=now() where id=o.id returning * into o;
  -- Invalidate the snapshot immediately; only a later full provider scan can re-enable a listing.
  update a1_skybox_private.inventory set available=false where id=o.inventory_id;
  insert into a1_skybox_private.trade_events(actor_id,order_id,action) values(actor,o.id,'invoice_created');
  return o.result;
 end if;
 raise exception 'Unsupported trading operation';
end $$;
revoke all on function a1_skybox_private.trade(text,jsonb) from public,anon,authenticated;
grant execute on function a1_skybox_private.trade(text,jsonb) to service_role;
create function public.a1_skybox_trade_service(p_action text,p_input jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select a1_skybox_private.trade(p_action,p_input) $$;
revoke all on function public.a1_skybox_trade_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.a1_skybox_trade_service(text,jsonb) to service_role;
