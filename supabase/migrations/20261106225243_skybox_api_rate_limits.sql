-- Shared outbound pacing across setup, manual sync, and scheduled workers.
create table a1_skybox_private.rate_limits (
 kind text primary key check(kind in ('customer','vendor','invoice','purchase','inventory')),
 next_request_at timestamptz not null default now()
);
alter table a1_skybox_private.rate_limits enable row level security;
revoke all on a1_skybox_private.rate_limits from public,anon,authenticated,service_role;
insert into a1_skybox_private.rate_limits(kind) values('customer'),('vendor'),('invoice'),('purchase'),('inventory');
create function a1_skybox_private.reserve_request(p_kind text,p_retry_ms bigint default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare due timestamptz; stamp timestamptz; wait_ms bigint;
begin
 select next_request_at into strict due from a1_skybox_private.rate_limits where kind=p_kind for update;
 stamp:=clock_timestamp();
 if p_retry_ms>0 then
  update a1_skybox_private.rate_limits set next_request_at=greatest(due,stamp+p_retry_ms*interval '1 millisecond') where kind=p_kind;
  return jsonb_build_object('deferred',true);
 end if;
 wait_ms:=greatest(0,ceil(extract(epoch from (due-stamp))*1000))::bigint;
 -- Never create an unbounded queue of requests or wait beyond the Edge budget.
 if wait_ms>20000 then return jsonb_build_object('reserved',false,'waitMs',wait_ms);end if;
 update a1_skybox_private.rate_limits set next_request_at=greatest(due,stamp)+case when p_kind='inventory' then interval '10.5 seconds' else interval '1.1 seconds' end where kind=p_kind;
 return jsonb_build_object('reserved',true,'waitMs',wait_ms);
end $$;
revoke all on function a1_skybox_private.reserve_request(text,bigint) from public,anon,authenticated;
grant execute on function a1_skybox_private.reserve_request(text,bigint) to service_role;
create function public.a1_skybox_reserve_request(p_kind text,p_retry_ms bigint default 0) returns jsonb
language sql security invoker set search_path='' as $$ select a1_skybox_private.reserve_request(p_kind,p_retry_ms) $$;
revoke all on function public.a1_skybox_reserve_request(text,bigint) from public,anon,authenticated;
grant execute on function public.a1_skybox_reserve_request(text,bigint) to service_role;
