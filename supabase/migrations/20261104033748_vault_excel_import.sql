-- Imported credentials may have a site name without a known login URL.
-- Retain them encrypted so an admin can attach the correct dashboard link later.
do $$ declare definition text; original text; replacement text; begin
 definition:=pg_get_functiondef('a1_vault_private.service(uuid,uuid,text,jsonb)'::regprocedure);
 original:=$old$or (details->>'url') !~ '^https://[^[:space:]]+$' or details->>'url' is null$old$;
 replacement:=$new$or length(coalesce(details->>'url',''))>2000 or (coalesce(details->>'url','')<>'' and coalesce(details->>'url','') !~ '^https://[^/@?#[:space:]]+([/?#][^[:space:]]*)?$')$new$;
 if position(original in definition)=0 then raise exception 'Vault URL validation changed; review this migration before applying';end if;
 definition:=replace(definition,original,replacement);
 definition:=replace(definition,$old$'url',details->>'url'$old$,$new$'url',coalesce(details->>'url','')$new$);
 execute definition;
end $$;

create table a1_vault_private.a1_vault_imports (
 batch_id uuid primary key, actor_id uuid not null references auth.users(id),
 request_hash text not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table a1_vault_private.a1_vault_imports enable row level security;
revoke all on a1_vault_private.a1_vault_imports from public,anon,authenticated;

create function a1_vault_private.login_identity(p_label text,p_username text) returns text
language sql immutable security invoker set search_path='' as $$
 select encode(extensions.digest(jsonb_build_array(lower(trim(p_label)),lower(trim(p_username)))::text,'sha256'),'hex')
$$;
revoke all on function a1_vault_private.login_identity(text,text) from public,anon,authenticated;

create function a1_vault_private.import_logins(p_actor uuid,p_session uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 flags jsonb; entries jsonb:=p_input->'entries'; entry jsonb; saved jsonb; result jsonb;
 seen text[]; key text; digest text; batch uuid; receipt a1_vault_private.a1_vault_imports;
 created integer:=0; skipped integer:=0; existing jsonb:='[]'; identifiers jsonb:='[]';
begin
 flags:=a1_vault_private.service(p_actor,p_session,'status','{}');
 if not coalesce((flags->>'admin')::boolean,false) then raise exception 'Administrator access required' using errcode='42501';end if;
 -- This validates the session-bound unlock before either preview or import.
 perform a1_vault_private.service(p_actor,p_session,'list',p_input);
 if p_action not in ('preview_import','import_logins') then raise exception 'Unsupported vault import action';end if;
 if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries) not between 1 and 200 then raise exception 'Choose between 1 and 200 login rows';end if;
 for entry in select value from jsonb_array_elements(entries) loop
  if jsonb_typeof(entry)<>'object' or length(trim(coalesce(entry->>'label',''))) not between 1 and 120 or length(trim(coalesce(entry->>'username',''))) not between 1 and 254 then raise exception 'Every imported row needs a site name and username';end if;
  if p_action='import_logins' and (length(coalesce(entry->>'password','')) not between 1 and 2000 or length(coalesce(entry->>'notes',''))>4000 or length(coalesce(entry->>'url',''))>2000 or (coalesce(entry->>'url','')<>'' and coalesce(entry->>'url','') !~ '^https://[^/@?#[:space:]]+([/?#][^[:space:]]*)?$')) then raise exception 'One or more imported login rows need correction';end if;
 end loop;
 -- Serializes competing imports, including an uncertain-network retry.
 perform pg_advisory_xact_lock(hashtextextended('a1-vault-login-import',0));
 if p_action='import_logins' then
  batch:=(p_input->>'batch_id')::uuid;if batch is null then raise exception 'Import batch identifier is missing';end if;
  -- Receipts fingerprint nonsecret identity fields only. Never retain an
  -- unsalted password/notes hash alongside the encrypted Vault values.
  digest:=encode(extensions.digest((select jsonb_agg(value-'password'-'notes')::text from jsonb_array_elements(entries)),'sha256'),'hex');
  select * into receipt from a1_vault_private.a1_vault_imports where batch_id=batch;
  if found then
   if receipt.actor_id<>p_actor or receipt.request_hash<>digest then raise exception 'This import batch has changed. Preview it again';end if;
   return receipt.result;
  end if;
 end if;
 select coalesce(array_agg(a1_vault_private.login_identity(i.label,coalesce(v.decrypted_secret::jsonb->>'username',''))),'{}') into seen
 from a1_vault_private.a1_vault_items i join vault.decrypted_secrets v on v.id=i.secret_id where i.kind='login';
 for entry in select value from jsonb_array_elements(entries) loop
  key:=a1_vault_private.login_identity(entry->>'label',entry->>'username');
  if key=any(seen) and not coalesce((entry->>'keep_separate')::boolean,false) then
   existing:=existing||jsonb_build_array(entry->'row');skipped:=skipped+1;
  elsif p_action='import_logins' then
   saved:=a1_vault_private.service(p_actor,p_session,'save',jsonb_build_object('unlock_token',p_input->>'unlock_token','kind','login','label',trim(entry->>'label'),'details',jsonb_build_object('username',trim(entry->>'username'),'password',entry->>'password','url',coalesce(entry->>'url',''),'notes',coalesce(entry->>'notes',''))));
   identifiers:=identifiers||jsonb_build_array(saved->'id');created:=created+1;seen:=array_append(seen,key);
  end if;
 end loop;
 if p_action='preview_import' then return jsonb_build_object('existing_rows',existing);end if;
 result:=jsonb_build_object('created',created,'skipped',skipped,'ids',identifiers,'batch_id',batch);
 insert into a1_vault_private.a1_vault_imports(batch_id,actor_id,request_hash,result) values(batch,p_actor,digest,result);
 insert into a1_vault_private.a1_vault_events(actor_id,action) values(p_actor,'import');
 return result;
end $$;
revoke all on function a1_vault_private.import_logins(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function a1_vault_private.import_logins(uuid,uuid,text,jsonb) to service_role;
create or replace function public.a1_vault_service(p_actor uuid,p_session uuid,p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select case when p_action in ('preview_import','import_logins') then a1_vault_private.import_logins(p_actor,p_session,p_action,p_input)
 else a1_vault_private.service(p_actor,p_session,p_action,p_input) end
$$;
revoke all on function public.a1_vault_service(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.a1_vault_service(uuid,uuid,text,jsonb) to service_role;
