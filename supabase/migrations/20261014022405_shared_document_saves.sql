create function public.a1_save_document(p_kind text, p_document jsonb, p_expected_version bigint default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.a1_documents;
begin
  if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id = auth.uid()) then raise exception 'A1 staff access required'; end if;
  if p_kind not in ('letter','itinerary') or p_kind is null then raise exception 'Unsupported document type'; end if;
  if p_expected_version is null then
    insert into public.a1_documents(kind,id,document) values(p_kind,p_document->>'id',p_document) returning * into saved;
  else
    update public.a1_documents set document = p_document, version = version + 1, updated_by = auth.uid(), updated_at = now()
      where kind = p_kind and id = p_document->>'id' and version = p_expected_version returning * into saved;
    if not found then raise exception 'Document changed on another device. Refresh history before saving.'; end if;
  end if;
  return jsonb_build_object('id',saved.id,'kind',saved.kind,'document',saved.document,'version',saved.version);
end $$;

revoke all on function public.a1_save_document(text,jsonb,bigint) from public, anon;
grant execute on function public.a1_save_document(text,jsonb,bigint) to authenticated;
