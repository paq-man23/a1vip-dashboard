-- Run in the selected Supabase project before configuring the dashboard.
create table public.a1_staff (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.a1_invoices (
  id text primary key check (id ~ '^inv-[A-Za-z0-9-]+$'),
  number text not null unique check (length(btrim(number)) > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object' and document ? 'id' and document ? 'number' and document->>'id' = id and document->>'number' = number),
  version bigint not null default 1,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index a1_invoices_created_by_idx on public.a1_invoices(created_by);
create index a1_invoices_updated_by_idx on public.a1_invoices(updated_by);
create table public.a1_invoice_presets (
  category text not null check (category in ('clientCompanies','clientContacts','clientEmails','clientPhones','terms','paymentTypes','deliveryMethods','eventNames','venues')),
  value text not null,
  primary key (category, value)
);
alter table public.a1_staff enable row level security;
alter table public.a1_invoices enable row level security;
alter table public.a1_invoice_presets enable row level security;
revoke all on public.a1_staff, public.a1_invoices, public.a1_invoice_presets from anon, authenticated;
grant select on public.a1_staff to authenticated;
grant select, insert, update, delete on public.a1_invoices to authenticated;
grant select, insert on public.a1_invoice_presets to authenticated;
create policy own_staff_membership on public.a1_staff for select to authenticated
  using (user_id = (select auth.uid()));
create policy staff_invoices on public.a1_invoices for all to authenticated
  using (exists (select 1 from public.a1_staff where user_id = (select auth.uid())))
  with check (exists (select 1 from public.a1_staff where user_id = (select auth.uid())));
create policy staff_read_presets on public.a1_invoice_presets for select to authenticated
  using (exists (select 1 from public.a1_staff where user_id = (select auth.uid())));
create policy staff_insert_presets on public.a1_invoice_presets for insert to authenticated
  with check (exists (select 1 from public.a1_staff where user_id = (select auth.uid())));
-- Save invoice + learned client/preset values together; stale edits fail instead
-- of overwriting another staff member's changes. Unique numbers are enforced in DB.
create function public.a1_save_invoice(p_document jsonb, p_expected_version bigint default null, p_presets jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.a1_invoices;
  category_name text;
  category_values jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.a1_staff where user_id = auth.uid()) then
    raise exception 'A1 staff access required';
  end if;
  if p_document->>'id' is null or p_document->>'number' is null then
    raise exception 'Invoice ID and number are required';
  end if;
  if p_expected_version is null then
    insert into public.a1_invoices(id, number, document)
    values (p_document->>'id', p_document->>'number', p_document) returning * into saved;
  else
    update public.a1_invoices set number = p_document->>'number', document = p_document,
      version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = p_document->>'id' and version = p_expected_version returning * into saved;
    if not found then raise exception 'Invoice changed on another device. Refresh history before saving.'; end if;
  end if;
  for category_name, category_values in select key, value from jsonb_each(p_presets) loop
    insert into public.a1_invoice_presets(category, value)
    select category_name, btrim(value) from jsonb_array_elements_text(category_values)
    where length(btrim(value)) > 0 on conflict do nothing;
  end loop;
  return jsonb_build_object('id', saved.id, 'document', saved.document, 'version', saved.version);
end;
$$;
revoke all on function public.a1_save_invoice(jsonb, bigint, jsonb) from public, anon;
grant execute on function public.a1_save_invoice(jsonb, bigint, jsonb) to authenticated;
