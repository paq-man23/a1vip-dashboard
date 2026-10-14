create table public.a1_skybox_sync_state (
  kind text not null,
  source_id text not null,
  source_hash text not null,
  document jsonb not null,
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(kind,source_id),
  foreign key(kind,source_id) references public.a1_skybox_records(kind,source_id)
);
create index a1_skybox_sync_state_updated_by_idx on public.a1_skybox_sync_state(updated_by);
create table public.a1_skybox_revisions (
  kind text not null,
  source_id text not null,
  source_hash text not null,
  raw_record jsonb not null,
  document jsonb not null,
  outcome text not null,
  imported_by uuid not null default auth.uid() references auth.users(id),
  imported_at timestamptz not null default now(),
  primary key(kind,source_id,source_hash),
  foreign key(kind,source_id) references public.a1_skybox_records(kind,source_id)
);
create index a1_skybox_revisions_imported_by_idx on public.a1_skybox_revisions(imported_by);
create table public.a1_skybox_sync_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  machine_label text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check(status in ('running','success','review','failed')),
  source_files jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id)
);
create index a1_skybox_sync_runs_created_by_idx on public.a1_skybox_sync_runs(created_by);
create index a1_skybox_sync_runs_started_at_idx on public.a1_skybox_sync_runs(started_at desc);
alter table public.a1_skybox_sync_state enable row level security;
alter table public.a1_skybox_revisions enable row level security;
alter table public.a1_skybox_sync_runs enable row level security;
revoke all on public.a1_skybox_sync_state,public.a1_skybox_revisions,public.a1_skybox_sync_runs from public,anon,authenticated;
grant select,insert,update on public.a1_skybox_sync_state,public.a1_skybox_sync_runs to authenticated;
grant select,insert on public.a1_skybox_revisions to authenticated;
create policy staff_sync_state on public.a1_skybox_sync_state for all to authenticated
using(exists(select 1 from public.a1_staff where user_id=(select auth.uid())))
with check(exists(select 1 from public.a1_staff where user_id=(select auth.uid())));
create policy staff_sync_revisions on public.a1_skybox_revisions for all to authenticated
using(exists(select 1 from public.a1_staff where user_id=(select auth.uid())))
with check(exists(select 1 from public.a1_staff where user_id=(select auth.uid())));
create policy staff_sync_runs on public.a1_skybox_sync_runs for all to authenticated
using(exists(select 1 from public.a1_staff where user_id=(select auth.uid())))
with check(exists(select 1 from public.a1_staff where user_id=(select auth.uid())));
create view public.a1_skybox_contacts with (security_invoker=true) as
select r.kind,r.source_id,coalesce(s.document,r.document) as document
from public.a1_skybox_records r left join public.a1_skybox_sync_state s using(kind,source_id)
where r.kind in ('customer','vendor');
revoke all on public.a1_skybox_contacts from public,anon,authenticated;
grant select on public.a1_skybox_contacts to authenticated;

create function public.a1_sync_skybox(p_kind text,p_source_id text,p_record jsonb,p_document jsonb,p_presets jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare original public.a1_skybox_records; state public.a1_skybox_sync_state; current_invoice public.a1_invoices;
  baseline jsonb; digest text; result jsonb; outcome text; reason text; category_name text; category_values jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id=auth.uid()) then raise exception 'A1 staff access required'; end if;
  if p_kind is null or p_kind not in ('customer','vendor','invoice','purchase') or p_source_id is null or p_source_id !~ '^[0-9]+$' then raise exception 'Invalid Skybox record identity'; end if;
  if jsonb_typeof(p_record) is distinct from 'object' or jsonb_typeof(p_document) is distinct from 'object' then raise exception 'Invalid Skybox record objects'; end if;
  if p_record->>(case p_kind when 'customer' then 'Customer ID' when 'vendor' then 'Vendor ID' when 'invoice' then 'Invoice ID' else 'Purchase ID' end) is distinct from p_source_id then raise exception 'Source ID does not match original record'; end if;
  if p_kind in ('invoice','purchase') then
    if p_document->>'id' is distinct from 'inv-skybox-'||p_kind||'-'||p_source_id then raise exception 'Converted invoice ID does not match source'; end if;
  elsif p_document->>'id' is distinct from p_source_id or p_document->>'kind' is distinct from p_kind then raise exception 'Contact identity does not match source'; end if;
  digest:=md5(p_record::text);
  perform pg_advisory_xact_lock(hashtextextended('skybox:'||p_kind||':'||p_source_id,0));
  select * into original from public.a1_skybox_records where kind=p_kind and source_id=p_source_id;
  if not found then
    result:=public.a1_import_skybox(p_kind,p_source_id,p_record,p_document,p_presets);
    outcome:=result->>'outcome';
  else
    select * into state from public.a1_skybox_sync_state where kind=p_kind and source_id=p_source_id;
    if digest=coalesce(state.source_hash,original.source_hash) or exists(select 1 from public.a1_skybox_revisions where kind=p_kind and source_id=p_source_id and source_hash=digest) then return jsonb_build_object('outcome','skipped'); end if;
    baseline:=coalesce(state.document,original.document);
    outcome:='updated';
    if p_kind in ('invoice','purchase') then
      select * into current_invoice from public.a1_invoices where id=baseline->>'id' for update;
      if not found then reason:='Original invoice was removed or its initial import needs review.';
      elsif current_invoice.document is distinct from baseline then reason:='Invoice was edited in A1 after its last Skybox import. Weekly update preserved for review.';
      else
        begin
          perform public.a1_save_invoice(p_document,current_invoice.version,p_presets);
        exception when unique_violation then reason:='Updated invoice number is already used. Weekly update preserved for review.';
        end;
      end if;
      if reason is not null then
        outcome:='conflict';
        insert into public.a1_import_conflicts(kind,source_hash,document,reason)
        values('invoice',md5(p_document::text),p_document,reason) on conflict do nothing;
      end if;
    else
      for category_name,category_values in select key,value from jsonb_each(p_presets) loop
        insert into public.a1_invoice_presets(category,value)
        select category_name,btrim(value) from jsonb_array_elements_text(category_values)
        where length(btrim(value))>0 on conflict do nothing;
      end loop;
    end if;
  end if;
  if outcome in ('imported','updated') then
    insert into public.a1_skybox_sync_state(kind,source_id,source_hash,document)
    values(p_kind,p_source_id,digest,p_document)
    on conflict(kind,source_id) do update set source_hash=excluded.source_hash,document=excluded.document,updated_by=auth.uid(),updated_at=now();
  end if;
  insert into public.a1_skybox_revisions(kind,source_id,source_hash,raw_record,document,outcome)
  values(p_kind,p_source_id,digest,p_record,p_document,outcome) on conflict do nothing;
  return jsonb_build_object('outcome',outcome,'reason',reason);
end $$;
revoke all on function public.a1_sync_skybox(text,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.a1_sync_skybox(text,text,jsonb,jsonb,jsonb) to authenticated;
create function public.a1_sync_skybox_batch(p_items jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; outcome jsonb; results jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id=auth.uid()) then raise exception 'A1 staff access required'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Sync batch must be an array'; end if;
  if jsonb_array_length(p_items)>50 then raise exception 'Sync batch exceeds 50 records'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    begin
      outcome:=public.a1_sync_skybox(item->>'kind',item->>'sourceId',item->'record',item->'document',coalesce(item->'presets','{}'::jsonb));
    exception when others then outcome:=jsonb_build_object('outcome','error','reason',sqlerrm);
    end;
    results:=results||jsonb_build_array(outcome);
  end loop;
  return results;
end $$;
revoke all on function public.a1_sync_skybox_batch(jsonb) from public,anon;
grant execute on function public.a1_sync_skybox_batch(jsonb) to authenticated;
