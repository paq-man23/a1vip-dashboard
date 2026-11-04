import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
const db = await PGlite.create();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key,bucket_id text,name text); alter table storage.objects enable row level security;
    create schema auth;
    create table auth.users(id uuid primary key, email text, aud text, role text, email_confirmed_at timestamptz, created_at timestamptz default now(),last_sign_in_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,updated_at timestamptz,not_after timestamptz);
    -- Test-only substitutes: PGlite has no Supabase Vault/pgcrypto. These test
    -- authorization and data flow, NOT encryption. Real encryption is checked
    -- separately against Supabase using synthetic fixtures and rollback.
    create schema vault; create schema extensions;
    create table vault.secrets(id uuid primary key default gen_random_uuid(),test_value text);
    create view vault.decrypted_secrets as select id,test_value as decrypted_secret from vault.secrets;
    create function vault.create_secret(text) returns uuid language sql as $$ insert into vault.secrets(test_value) values($1) returning id $$;
    create function vault.update_secret(uuid,text) returns void language sql as $$ update vault.secrets set test_value=$2 where id=$1 $$;
    create function extensions.gen_random_bytes(integer) returns bytea language sql as $$ select decode(substr(repeat(md5(random()::text),8),1,$1*2),'hex') $$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$ select decode(md5($1)||md5($1),'hex') $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  const names = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const name of names) await db.exec(await readFile('supabase/migrations/' + name,'utf8'));
  await db.exec(`insert into auth.users(id,email) values (gen_random_uuid(),'first@example.invalid'),(gen_random_uuid(),'second@example.invalid'); insert into public.a1_staff(user_id,is_admin) select id,true from auth.users;`);
  for (const name of ['rls.integration.sql','shared-documents.integration.sql','skybox.integration.sql','skybox-sync.integration.sql','invoice-numbering.integration.sql','contacts.integration.sql','admin.integration.sql','button-layout.integration.sql','activity.integration.sql','accounts.integration.sql','category-performance.integration.sql','login-location.integration.sql','vault.integration.sql','customer-security-live.integration.sql','vault-import.integration.sql']) {
    const results = await db.exec(await readFile('tests/' + name,'utf8'));
    console.log(name + ': ' + JSON.stringify(results.at(-1).rows));
  }
} finally { await db.close(); }
