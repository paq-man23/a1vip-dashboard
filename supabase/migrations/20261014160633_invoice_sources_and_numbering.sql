-- Origin is a separate column: backfilling it must not alter weekly-sync snapshots.
alter table public.a1_invoices add column origin text not null default 'a1' check(origin in ('a1','skybox'));
update public.a1_invoices i set origin='skybox'
where i.id like 'inv-skybox-%' or i.document->>'origin'='skybox' or exists(
  select 1 from public.a1_skybox_records r left join public.a1_document_imports d
  on d.kind='invoice' and d.source_hash=md5(r.document::text)
  where r.kind in ('invoice','purchase') and coalesce(d.imported_id,r.document->>'id')=i.id
);
create index a1_invoices_origin_idx on public.a1_invoices(origin);
create function public.a1_invoice_origin_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.origin:=case when new.id like 'inv-skybox-%' or new.document->>'origin'='skybox' then 'skybox' else 'a1' end;
  else
    new.origin:=old.origin;
    if old.document->>'numberAssignedByDB'='true' then
      if new.number is distinct from old.number then raise exception 'Database-assigned A1 invoice numbers cannot be changed'; end if;
      new.document:=jsonb_set(new.document,'{numberAssignedByDB}','true'::jsonb);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.a1_invoice_origin_guard() from public,anon,authenticated;
create trigger a1_invoice_origin_guard before insert or update on public.a1_invoices
for each row execute function public.a1_invoice_origin_guard();

-- Enrich existing historical invoices on reads; never mutate archived/raw snapshots.
create view public.a1_invoice_history with (security_invoker=true) as
select i.id,i.number,i.version,i.origin,
  i.document||jsonb_build_object('origin',i.origin)||
  case when i.origin='skybox' then jsonb_build_object('skybox',coalesce(i.document->'skybox',v.raw_record,r.raw_record,'{}'::jsonb)) else '{}'::jsonb end as document
from public.a1_invoices i
left join (
  public.a1_skybox_records r
  left join public.a1_document_imports d on d.kind='invoice' and d.source_hash=md5(r.document::text)
  left join public.a1_skybox_sync_state s on s.kind=r.kind and s.source_id=r.source_id
  left join public.a1_skybox_revisions v on v.kind=r.kind and v.source_id=r.source_id and v.source_hash=s.source_hash
) on r.kind in ('invoice','purchase') and coalesce(d.imported_id,r.document->>'id')=i.id;
revoke all on public.a1_invoice_history from public,anon,authenticated;
grant select on public.a1_invoice_history to authenticated;

create sequence public.a1_invoice_number_seq minvalue 4100 maxvalue 9007199254740990;
select setval('public.a1_invoice_number_seq',greatest(4100,coalesce((select max(number::bigint)+1 from public.a1_invoices where origin='a1' and number ~ '^[0-9]{1,15}$'),4100)),false);
revoke all on sequence public.a1_invoice_number_seq from public,anon,authenticated;
grant usage on sequence public.a1_invoice_number_seq to authenticated;
create function public.a1_save_dashboard_invoice(p_document jsonb,p_presets jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.a1_invoices; candidate bigint; next_document jsonb; result jsonb; violated_constraint text;
begin
  if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id=auth.uid()) then raise exception 'A1 staff access required'; end if;
  if jsonb_typeof(p_document) is distinct from 'object' or p_document->>'id' is null or p_document->>'id' !~ '^inv-[A-Za-z0-9-]+$' or p_document->>'id' like 'inv-skybox-%' then raise exception 'Invalid new A1 invoice ID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('a1-new-invoice:'||(p_document->>'id'),0));
  select * into previous from public.a1_invoices where id=p_document->>'id';
  if found then
    if previous.origin='a1' and previous.document->>'numberAssignedByDB'='true' and
      (previous.document-'number'-'autoNumber'-'origin'-'numberAssignedByDB')=(p_document-'number'-'autoNumber'-'origin'-'numberAssignedByDB') then
      return jsonb_build_object('id',previous.id,'document',previous.document,'version',previous.version);
    end if;
    raise exception 'Invoice already saved with different content. Refresh history before saving changes.';
  end if;
  loop
    candidate:=nextval('public.a1_invoice_number_seq');
    if exists(select 1 from public.a1_invoices where number=candidate::text) then continue; end if;
    next_document:=p_document||jsonb_build_object('number',candidate::text,'autoNumber',false,'numberAssignedByDB',true,'origin','a1');
    begin
      result:=public.a1_save_invoice(next_document,null,p_presets);
      return result;
    exception when unique_violation then
      get stacked diagnostics violated_constraint=constraint_name;
      if violated_constraint<>'a1_invoices_number_key' then raise; end if;
      -- An import/older client can claim the number after the existence check.
    end;
  end loop;
end $$;
revoke all on function public.a1_save_dashboard_invoice(jsonb,jsonb) from public,anon;
grant execute on function public.a1_save_dashboard_invoice(jsonb,jsonb) to authenticated;

-- Derived report fields and UI flags do not constitute a manual business edit.
create function public.a1_invoice_sync_snapshot(p_document jsonb,p_record jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
select (p_document||jsonb_build_object('vendor',coalesce(p_document->>'vendor',p_record->>'Vendor',''),'paymentReference',coalesce(p_document->>'paymentReference',p_record->>'Payment Reference',''),'nonInventoryCosts',coalesce(p_document->>'nonInventoryCosts',p_record->>'Non-Inventory Costs',p_record->>'Non-Inventory Cost',''),'cogs',coalesce(p_document->>'cogs',p_record->>'COGS',''),'inventoryPnl',coalesce(p_document->>'inventoryPnl',p_record->>'Inventory P&L',''),'inventoryTags',coalesce(p_document->>'inventoryTags',p_record->>'Inventory Tags',''),'ticketSales',coalesce(p_document->>'ticketSales',p_record->>'Ticket Sales',''),'inventoryMargin',coalesce(p_document->>'inventoryMargin',p_record->>'Inventory Margin',''),'consignment',coalesce(p_document->>'consignment',p_record->>'Consignment',''),'poTags',coalesce(p_document->>'poTags',p_record->>'PO Tags',''),'internalNotes',coalesce(p_document->>'internalNotes',p_record->>'Internal Notes',''),'vendorId',coalesce(p_document->>'vendorId','')))-'origin'-'skybox'-'autoNumber'-'numberAssignedByDB';
$$;
revoke all on function public.a1_invoice_sync_snapshot(jsonb,jsonb) from public,anon;
grant execute on function public.a1_invoice_sync_snapshot(jsonb,jsonb) to authenticated;
create or replace function public.a1_sync_skybox(p_kind text,p_source_id text,p_record jsonb,p_document jsonb,p_presets jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare original public.a1_skybox_records; state public.a1_skybox_sync_state; current_invoice public.a1_invoices;
  baseline jsonb; previous_record jsonb; digest text; result jsonb; outcome text; reason text; category_name text; category_values jsonb;
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
    select raw_record into previous_record from public.a1_skybox_revisions where kind=p_kind and source_id=p_source_id and source_hash=state.source_hash;
    previous_record:=coalesce(previous_record,original.raw_record);
    outcome:='updated';
    if p_kind in ('invoice','purchase') then
      select * into current_invoice from public.a1_invoices where id=baseline->>'id' for update;
      if not found then reason:='Original invoice was removed or its initial import needs review.';
      elsif public.a1_invoice_sync_snapshot(current_invoice.document,previous_record) is distinct from public.a1_invoice_sync_snapshot(baseline,previous_record) then reason:='Invoice was edited in A1 after its last Skybox import. Weekly update preserved for review.';
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
