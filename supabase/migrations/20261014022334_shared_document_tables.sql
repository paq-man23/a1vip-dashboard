create table public.a1_documents (
  kind text not null check (kind in ('letter','itinerary')),
  id text not null,
  document jsonb not null check (jsonb_typeof(document) = 'object' and document->>'id' is not null and document->>'id' = id),
  version bigint not null default 1,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(kind,id),
  check ((kind = 'letter' and id ~ '^letter-[A-Za-z0-9-]+$') or (kind = 'itinerary' and id ~ '^itin-[A-Za-z0-9-]+$'))
);
create index a1_documents_created_by_idx on public.a1_documents(created_by);
create index a1_documents_updated_by_idx on public.a1_documents(updated_by);
create table public.a1_document_imports (
  kind text not null check (kind in ('invoice','letter','itinerary')),
  source_hash text not null,
  imported_id text not null,
  primary key(kind,source_hash)
);
create table public.a1_import_conflicts (
  kind text not null check (kind = 'invoice'),
  source_hash text not null,
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  reason text not null,
  created_at timestamptz not null default now(),
  primary key(kind,source_hash)
);
alter table public.a1_documents enable row level security;
alter table public.a1_document_imports enable row level security;
alter table public.a1_import_conflicts enable row level security;
revoke all on public.a1_documents, public.a1_document_imports, public.a1_import_conflicts from anon, authenticated;
grant select, insert, update, delete on public.a1_documents to authenticated;
grant select, insert on public.a1_document_imports to authenticated;
grant select, insert, delete on public.a1_import_conflicts to authenticated;
create policy staff_documents on public.a1_documents for all to authenticated
  using (exists(select 1 from public.a1_staff where user_id = (select auth.uid())))
  with check (exists(select 1 from public.a1_staff where user_id = (select auth.uid())));
create policy staff_read_imports on public.a1_document_imports for select to authenticated
  using (exists(select 1 from public.a1_staff where user_id = (select auth.uid())));
create policy staff_insert_imports on public.a1_document_imports for insert to authenticated
  with check (exists(select 1 from public.a1_staff where user_id = (select auth.uid())));
create policy staff_import_conflicts on public.a1_import_conflicts for all to authenticated
  using (exists(select 1 from public.a1_staff where user_id = (select auth.uid())))
  with check (exists(select 1 from public.a1_staff where user_id = (select auth.uid())));

