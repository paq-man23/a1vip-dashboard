create function public.a1_resolve_import_conflict(p_source_hash text, p_imported_id text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id = auth.uid()) then raise exception 'A1 staff access required'; end if;
  if not exists(select 1 from public.a1_invoices where id=p_imported_id) then raise exception 'Save the imported invoice first'; end if;
  insert into public.a1_document_imports(kind,source_hash,imported_id)
    select kind,source_hash,p_imported_id from public.a1_import_conflicts where kind='invoice' and source_hash=p_source_hash
    on conflict do nothing;
  delete from public.a1_import_conflicts where kind='invoice' and source_hash=p_source_hash;
end $$;

revoke all on function public.a1_resolve_import_conflict(text,text) from public, anon;
grant execute on function public.a1_resolve_import_conflict(text,text) to authenticated;
