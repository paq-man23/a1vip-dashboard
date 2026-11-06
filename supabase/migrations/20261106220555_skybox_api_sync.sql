-- Inbound Skybox reads only. Credentials and worker state never enter the Data API.
create schema a1_skybox_private;
revoke all on schema a1_skybox_private from public,anon,authenticated;
grant usage on schema a1_skybox_private to service_role;
create table a1_skybox_private.connection (
 id boolean primary key default true check(id), account_id text, owner_id uuid references auth.users(id),
 credential_id uuid references vault.secrets(id), scheduler_id uuid references vault.secrets(id),
 enabled boolean not null default false, lease uuid, lease_until timestamptz
);
create table a1_skybox_private.progress (
 kind text primary key check(kind in ('customer','vendor','invoice','purchase','inventory')),
 page_base integer not null default 1 check(page_base in (0,1)), page integer not null default 0, since timestamptz, until timestamptz not null default now(),
 next_due timestamptz not null default now(), completed_at timestamptz, checked_at timestamptz,
 total integer, imported integer not null default 0, updated integer not null default 0,
 skipped integer not null default 0, conflicts integer not null default 0, errors integer not null default 0,
 message text, cycle uuid not null default gen_random_uuid()
);
create table a1_skybox_private.inventory (
 id text primary key, document jsonb not null, cycle uuid not null, available boolean not null default true,
 synced_at timestamptz not null default now()
);
create index skybox_inventory_cycle on a1_skybox_private.inventory(cycle);
alter table a1_skybox_private.connection enable row level security;
alter table a1_skybox_private.progress enable row level security;
alter table a1_skybox_private.inventory enable row level security;
revoke all on all tables in schema a1_skybox_private from public,anon,authenticated;
insert into a1_skybox_private.connection(id,scheduler_id) values(true,vault.create_secret(encode(extensions.gen_random_bytes(32),'hex')));
insert into a1_skybox_private.progress(kind) values('customer'),('vendor'),('invoice'),('purchase'),('inventory');

create function a1_skybox_private.service(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c a1_skybox_private.connection; s a1_skybox_private.progress; actor uuid; session_id uuid; admin boolean;
 creds jsonb; item jsonb; result jsonb; counts jsonb; lease_id uuid; snapshot jsonb; outcome text; rows jsonb; total_rows integer;
begin
 select * into c from a1_skybox_private.connection where id for update;
 if p_action in ('status','configure','pause','resume','authorize','inventory') then
  actor:=(p_input->>'actor')::uuid;session_id:=(p_input->>'session')::uuid;
  if actor is null or session_id is null or not exists(select 1 from auth.sessions where id=session_id and user_id=actor and (not_after is null or not_after>now())) or not exists(select 1 from public.a1_activity_sessions where user_id=actor and auth_session_id=session_id and ended_at is null and (idle_exempt or last_active_at>now()-interval '20 minutes')) then raise exception 'Sign in again';end if;
  select is_admin into admin from public.a1_staff where user_id=actor;
  if admin is null or exists(select 1 from public.a1_account_profiles where user_id=actor and disabled) then raise exception 'Dashboard access required';end if;
  if p_action='inventory' then
   if not admin and exists(select 1 from public.a1_account_profiles where user_id=actor and allowed_sections is not null and not ('seatSniper'=any(allowed_sections))) then raise exception 'Category access required';end if;
   select count(*) into total_rows from a1_skybox_private.inventory where available and document::text ilike '%'||coalesce(p_input->>'query','')||'%';
   select coalesce(jsonb_agg(x.document||jsonb_build_object('syncedAt',x.synced_at)),'[]') into rows from (select document,synced_at from a1_skybox_private.inventory where available and document::text ilike '%'||coalesce(p_input->>'query','')||'%' order by document->>'eventDate',id limit 50 offset greatest(0,coalesce((p_input->>'page')::integer,0))*50) x;
   return jsonb_build_object('rows',rows,'total',total_rows,'completedAt',(select completed_at from a1_skybox_private.progress where kind='inventory'));
  end if;
  if not admin then raise exception 'Administrator access required';end if;
  if p_action='authorize' then return '{}'::jsonb;end if;
  if p_action='configure' then
   if c.account_id is not null and c.account_id<>p_input->>'accountId' then raise exception 'Skybox account change requires a separate migration';end if;
   if c.credential_id is null then c.credential_id:=vault.create_secret(jsonb_build_object('applicationToken',p_input->>'applicationToken','apiToken',p_input->>'apiToken')::text);
   else perform vault.update_secret(c.credential_id,jsonb_build_object('applicationToken',p_input->>'applicationToken','apiToken',p_input->>'apiToken')::text);end if;
   update a1_skybox_private.connection set account_id=p_input->>'accountId',owner_id=actor,credential_id=c.credential_id,enabled=true,lease=null,lease_until=null where id;
   update a1_skybox_private.progress set next_due=now(),message=null,page_base=coalesce((p_input->'pageBases'->>kind)::integer,1);
  elsif p_action='resume' then
   if c.credential_id is null then raise exception 'Connect Skybox first';end if;
   update a1_skybox_private.connection set enabled=true where id;
   update a1_skybox_private.progress set next_due=now();
  elsif p_action='pause' then update a1_skybox_private.connection set enabled=false,lease=null,lease_until=null where id;
  end if;
  select * into c from a1_skybox_private.connection where id;
  return jsonb_build_object('configured',c.credential_id is not null,'enabled',c.enabled,'accountId',c.account_id,'running',c.lease_until>now(),'resources',(select jsonb_agg(to_jsonb(p) order by kind) from a1_skybox_private.progress p));
 end if;
 if p_action='scheduler_secret' then return to_jsonb((select decrypted_secret from vault.decrypted_secrets where id=c.scheduler_id));end if;
 if p_action='claim' then
  if not c.enabled or c.credential_id is null or c.lease_until>now() then return null;end if;
  if not exists(select 1 from public.a1_staff where user_id=c.owner_id and is_admin) or exists(select 1 from public.a1_account_profiles where user_id=c.owner_id and disabled) then return null;end if;
  if not coalesce((p_input->>'manual')::boolean,false) and not exists(select 1 from a1_skybox_private.progress where next_due<=now()) then return null;end if;
  lease_id:=gen_random_uuid();update a1_skybox_private.connection set lease=lease_id,lease_until=now()+interval '2 minutes' where id;
  select decrypted_secret::jsonb into creds from vault.decrypted_secrets where id=c.credential_id;
  return creds||jsonb_build_object('lease',lease_id,'accountId',c.account_id,'manual',coalesce((p_input->>'manual')::boolean,false),'states',(select jsonb_object_agg(kind,to_jsonb(p)) from a1_skybox_private.progress p),'contacts',(select coalesce(jsonb_object_agg(kind||':'||source_id,document),'{}') from public.a1_skybox_contacts));
 end if;
 if c.lease is null or c.lease is distinct from (p_input->>'lease')::uuid or c.lease_until<now() then raise exception 'Sync lease expired';end if;
 if p_action='release' then update a1_skybox_private.connection set lease=null,lease_until=null where id;return '{}'::jsonb;end if;
 select * into strict s from a1_skybox_private.progress where kind=p_input->>'kind';
 if p_action='failure' then update a1_skybox_private.progress set errors=errors+1,message=left(p_input->>'message',300),checked_at=now(),next_due=now()+interval '5 minutes' where kind=s.kind;return '{}'::jsonb;end if;
 if not exists(select 1 from public.a1_staff where user_id=c.owner_id and is_admin) or exists(select 1 from public.a1_account_profiles where user_id=c.owner_id and disabled) then raise exception 'Sync owner access revoked';end if;
 if p_action<>'apply' then raise exception 'Unsupported worker action';end if;
 if (p_input->>'page')::integer<>s.page then raise exception 'Page changed';end if;
 if coalesce((p_input->>'errors')::integer,0)>0 then
  update a1_skybox_private.progress set errors=(p_input->>'errors')::integer,message='One or more source records need conversion review. This page has not advanced.',checked_at=now(),next_due=now()+interval '5 minutes' where kind=s.kind;
  return jsonb_build_object('errors',(p_input->>'errors')::integer);
 end if;
 -- Legacy sync RPCs require an approved staff identity; only this service-only
 -- wrapper can supply the connection's previously verified admin owner.
 perform set_config('request.jwt.claim.sub',c.owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c.owner_id,'role','authenticated')::text,true);
 counts:='{"imported":0,"updated":0,"skipped":0,"conflicts":0,"errors":0}'::jsonb;
 for item in select value from jsonb_array_elements(p_input->'items') loop
  if s.kind='inventory' then
   insert into a1_skybox_private.inventory(id,document,cycle,available) values(item->>'sourceId',item->'document',s.cycle,true)
   on conflict(id) do update set document=excluded.document,cycle=excluded.cycle,available=true,synced_at=now();outcome:='updated';
  else
   if item->>'kind' is distinct from s.kind then raise exception 'Kind mismatch';end if;
   result:=public.a1_sync_skybox(item->>'kind',item->>'sourceId',item->'record',item->'document','{}');outcome:=result->>'outcome';
  end if;
  if outcome='conflict' then outcome:='conflicts';end if;
  if outcome not in ('imported','updated','skipped','conflicts') then raise exception 'Unexpected import outcome';end if;
  counts:=jsonb_set(counts,array[outcome],to_jsonb((counts->>outcome)::integer+1));
 end loop;
 if (p_input->>'done')::boolean and s.kind='inventory' then
  if (select count(*) from a1_skybox_private.inventory where cycle=s.cycle)<>(p_input->>'total')::integer then
   update a1_skybox_private.progress set page=0,cycle=gen_random_uuid(),next_due=now(),message='Inventory changed during pagination. Restarting the scan before retiring any listings.' where kind=s.kind;
   return counts||jsonb_build_object('restarting',true);
  end if;
  update a1_skybox_private.inventory set available=false where cycle<>s.cycle;
 end if;
 update a1_skybox_private.progress set page=case when (p_input->>'done')::boolean then 0 else s.page+1 end,
  total=(p_input->>'total')::integer,checked_at=now(),message=null,errors=0,
  imported=imported+(counts->>'imported')::integer,updated=updated+(counts->>'updated')::integer,
  skipped=skipped+(counts->>'skipped')::integer,conflicts=conflicts+(counts->>'conflicts')::integer,
  completed_at=case when (p_input->>'done')::boolean then now() else completed_at end,
  since=case when (p_input->>'done')::boolean then s.until-interval '5 minutes' else s.since end,
  until=case when (p_input->>'done')::boolean then now()+interval '5 minutes' else s.until end,
  cycle=case when (p_input->>'done')::boolean then gen_random_uuid() else s.cycle end,
  next_due=case when (p_input->>'done')::boolean then now()+interval '5 minutes' else now() end
 where kind=s.kind;
 return counts;
end $$;
revoke all on function a1_skybox_private.service(text,jsonb) from public,anon,authenticated;
grant execute on function a1_skybox_private.service(text,jsonb) to service_role;
create function public.a1_skybox_service(p_action text,p_input jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select a1_skybox_private.service(p_action,p_input) $$;
revoke all on function public.a1_skybox_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.a1_skybox_service(text,jsonb) to service_role;

-- New category is explicitly assignable; existing user category grants are preserved.
alter table public.a1_account_profiles drop constraint valid_sections;
alter table public.a1_account_profiles add constraint valid_sections check(allowed_sections <@ array['main','luxury','accounts','travel','social','invoices','customers','vendors','formLetter','tripItinerary','seatSniper']);
alter table public.a1_account_profiles alter column allowed_sections set default array['main','luxury','accounts','travel','social','invoices','customers','vendors','formLetter','tripItinerary','seatSniper'];
