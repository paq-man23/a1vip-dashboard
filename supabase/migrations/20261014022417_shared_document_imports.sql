create function public.a1_import_document(p_kind text, p_document jsonb, p_presets jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_hash text := md5(p_document::text);
  imported_id text;
  existing jsonb;
  candidate jsonb := p_document;
  result jsonb;
  copied boolean := false;
begin
  if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id = auth.uid()) then raise exception 'A1 staff access required'; end if;
  if p_kind is null or p_kind not in ('invoice','letter','itinerary') or jsonb_typeof(p_document) <> 'object' then raise exception 'Unsupported document type'; end if;
  if p_document->>'id' is null then raise exception 'Document ID required'; end if;
  -- Serialize repeats of this same source document, including across devices.
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':' || v_hash, 0));
  select i.imported_id into imported_id from public.a1_document_imports i where i.kind = p_kind and i.source_hash = v_hash;
  if found then return jsonb_build_object('outcome','skipped','id',imported_id); end if;
  if p_kind = 'invoice' then
    select document into existing from public.a1_invoices where id = p_document->>'id';
  else
    select document into existing from public.a1_documents where kind = p_kind and id = p_document->>'id';
  end if;
  if existing = p_document then
    imported_id := p_document->>'id';
    insert into public.a1_document_imports(kind,source_hash,imported_id) values(p_kind,v_hash,imported_id);
    return jsonb_build_object('outcome','skipped','id',imported_id);
  end if;
  if p_kind = 'invoice' then
    if existing is not null or exists(select 1 from public.a1_invoices where number = p_document->>'number') then
      insert into public.a1_import_conflicts(kind,source_hash,document,reason)
        values(p_kind,v_hash,p_document,'Invoice ID or number already exists with different content.') on conflict do nothing;
      return jsonb_build_object('outcome','conflict','source_hash',v_hash);
    end if;
    begin
      result := public.a1_save_invoice(p_document,null,p_presets);
    exception when unique_violation then
      insert into public.a1_import_conflicts(kind,source_hash,document,reason)
        values(p_kind,v_hash,p_document,'Another device imported the same invoice ID or number.') on conflict do nothing;
      return jsonb_build_object('outcome','conflict','source_hash',v_hash);
    end;
  else
    if existing is not null then
      candidate := jsonb_set(candidate,'{id}',to_jsonb((case when p_kind='letter' then 'letter-' else 'itin-' end) || gen_random_uuid()::text));
      copied := true;
    end if;
    begin
      result := public.a1_save_document(p_kind,candidate,null);
    exception when unique_violation then
      candidate := jsonb_set(candidate,'{id}',to_jsonb((case when p_kind='letter' then 'letter-' else 'itin-' end) || gen_random_uuid()::text));
      result := public.a1_save_document(p_kind,candidate,null); copied := true;
    end;
  end if;
  imported_id := result->>'id';
  insert into public.a1_document_imports(kind,source_hash,imported_id) values(p_kind,v_hash,imported_id);
  return result || jsonb_build_object('outcome','imported','copied',copied);
end $$;

revoke all on function public.a1_import_document(text,jsonb,jsonb) from public, anon;
grant execute on function public.a1_import_document(text,jsonb,jsonb) to authenticated;
