-- Immutable originals let later A1 edits coexist with repeat-safe Skybox imports.
create table public.a1_skybox_records (
  kind text not null check(kind in ('customer','vendor','invoice','purchase')),
  source_id text not null check(source_id ~ '^[0-9]+$'),
  source_hash text not null,
  raw_record jsonb not null check(jsonb_typeof(raw_record) = 'object'),
  document jsonb not null check(jsonb_typeof(document) = 'object'),
  imported_by uuid not null default auth.uid() references auth.users(id),
  imported_at timestamptz not null default now(),
  primary key(kind,source_id)
);
create index a1_skybox_imported_by_idx on public.a1_skybox_records(imported_by);
alter table public.a1_skybox_records enable row level security;
revoke all on public.a1_skybox_records from public, anon, authenticated;
grant select, insert on public.a1_skybox_records to authenticated;
create policy staff_skybox_read on public.a1_skybox_records for select to authenticated
using(exists(select 1 from public.a1_staff where user_id = (select auth.uid())));
create policy staff_skybox_insert on public.a1_skybox_records for insert to authenticated
with check(exists(select 1 from public.a1_staff where user_id = (select auth.uid())));
create function public.a1_import_skybox(p_kind text,p_source_id text,p_record jsonb,p_document jsonb,p_presets jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare previous public.a1_skybox_records; digest text; result jsonb; category_name text; category_values jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id = auth.uid()) then raise exception 'A1 staff access required'; end if;
  if p_kind is null or p_kind not in ('customer','vendor','invoice','purchase') then raise exception 'Unsupported Skybox record type'; end if;
  if p_source_id is null or p_source_id !~ '^[0-9]+$' then raise exception 'Invalid Skybox source ID'; end if;
  if jsonb_typeof(p_record) is distinct from 'object' or jsonb_typeof(p_document) is distinct from 'object' then raise exception 'Skybox records must be objects'; end if;
  if p_record->>(case p_kind when 'customer' then 'Customer ID' when 'vendor' then 'Vendor ID' when 'invoice' then 'Invoice ID' else 'Purchase ID' end) is distinct from p_source_id then raise exception 'Source ID does not match original record'; end if;
  digest := md5(p_record::text);
  perform pg_advisory_xact_lock(hashtextextended('skybox:'||p_kind||':'||p_source_id,0));
  select * into previous from public.a1_skybox_records where kind=p_kind and source_id=p_source_id;
  if found then
    if previous.source_hash=digest then return jsonb_build_object('outcome','skipped'); end if;
    return jsonb_build_object('outcome','changed','reason','This Skybox ID was imported with different data. The existing record has been kept; review the updated export separately.');
  end if;
  if p_kind in ('invoice','purchase') then
    if p_document->>'id' is distinct from 'inv-skybox-'||p_kind||'-'||p_source_id then raise exception 'Converted invoice ID does not match source'; end if;
    result := public.a1_import_document('invoice',p_document,p_presets);
  else
    if p_document->>'id' is distinct from p_source_id or p_document->>'kind' is distinct from p_kind then raise exception 'Contact identity does not match source'; end if;
    result := jsonb_build_object('outcome','imported');
    for category_name, category_values in select key,value from jsonb_each(p_presets) loop
      insert into public.a1_invoice_presets(category,value)
      select category_name,btrim(value) from jsonb_array_elements_text(category_values)
      where length(btrim(value))>0 on conflict do nothing;
    end loop;
  end if;
  insert into public.a1_skybox_records(kind,source_id,source_hash,raw_record,document)
  values(p_kind,p_source_id,digest,p_record,p_document);
  return result;
end $$;
revoke all on function public.a1_import_skybox(text,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.a1_import_skybox(text,text,jsonb,jsonb,jsonb) to authenticated;
-- Batches avoid a round trip for each row. Each row has its own rollback scope.
create function public.a1_import_skybox_batch(p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare item jsonb; outcome jsonb; results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id=auth.uid()) then raise exception 'A1 staff access required'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Import batch must be an array'; end if;
  if jsonb_array_length(p_items)>50 then raise exception 'Import batch exceeds 50 records'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    begin
      outcome := public.a1_import_skybox(item->>'kind',item->>'sourceId',item->'record',item->'document',coalesce(item->'presets','{}'::jsonb));
    exception when others then outcome := jsonb_build_object('outcome','error','reason',sqlerrm);
    end;
    results := results || jsonb_build_array(outcome);
  end loop;
  return results;
end $$;
revoke all on function public.a1_import_skybox_batch(jsonb) from public,anon;
grant execute on function public.a1_import_skybox_batch(jsonb) to authenticated;
