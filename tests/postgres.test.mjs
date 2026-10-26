import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
const db = await PGlite.create();
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key,bucket_id text,name text); alter table storage.objects enable row level security;
    create schema auth;
    create table auth.users(id uuid primary key, email text, aud text, role text, email_confirmed_at timestamptz, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  const names = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const name of names) await db.exec(await readFile('supabase/migrations/' + name,'utf8'));
  await db.exec(`insert into auth.users(id,email) values (gen_random_uuid(),'first@example.invalid'),(gen_random_uuid(),'second@example.invalid'); insert into public.a1_staff(user_id,is_admin) select id,true from auth.users;`);
  for (const name of ['rls.integration.sql','shared-documents.integration.sql','skybox.integration.sql','skybox-sync.integration.sql','invoice-numbering.integration.sql','contacts.integration.sql','admin.integration.sql','button-layout.integration.sql','activity.integration.sql']) {
    const results = await db.exec(await readFile('tests/' + name,'utf8'));
    console.log(name + ': ' + JSON.stringify(results.at(-1).rows));
  }
} finally { await db.close(); }
