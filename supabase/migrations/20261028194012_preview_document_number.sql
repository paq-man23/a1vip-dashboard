-- Read-only preview: no sequence value is consumed or reserved.
create function public.a1_preview_document_number(p_type text default 'invoice-ticket')
returns text language plpgsql security definer set search_path='' as $$
declare candidate bigint;
begin
 if auth.uid() is null or not public.a1_can_access('invoices') then raise exception 'Invoice access required';end if;
 if p_type like 'po-%' then
  select case when is_called then last_value+1 else last_value end into candidate from public.a1_purchase_order_number_seq;
 else
  select case when is_called then last_value+1 else last_value end into candidate from public.a1_invoice_number_seq;
 end if;
 while exists(select 1 from public.a1_invoices where number=candidate::text) loop candidate:=candidate+1;end loop;
 return candidate::text;
end $$;
revoke all on function public.a1_preview_document_number(text) from public,anon;
grant execute on function public.a1_preview_document_number(text) to authenticated;
