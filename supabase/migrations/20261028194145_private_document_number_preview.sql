-- Keep privileged sequence reads outside the exposed API schema.
alter function public.a1_preview_document_number(text) set schema a1_activity_private;
create function public.a1_preview_document_number(p_type text default 'invoice-ticket')
returns text language sql security invoker set search_path='' as $$
 select a1_activity_private.a1_preview_document_number(p_type)
$$;
revoke all on function public.a1_preview_document_number(text) from public,anon;
grant execute on function public.a1_preview_document_number(text) to authenticated;
