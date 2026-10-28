-- Purchase orders have an independent series; preserve the existing invoice counter.
create sequence public.a1_purchase_order_number_seq minvalue 3100 maxvalue 9007199254740990 start with 3100;
revoke all on sequence public.a1_purchase_order_number_seq from public,anon,authenticated;
grant usage on sequence public.a1_purchase_order_number_seq to authenticated;

create or replace function public.a1_save_dashboard_invoice(p_document jsonb,p_presets jsonb default '{}'::jsonb)
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
    candidate:=case when p_document->>'type' like 'po-%' then nextval('public.a1_purchase_order_number_seq') else nextval('public.a1_invoice_number_seq') end;
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

