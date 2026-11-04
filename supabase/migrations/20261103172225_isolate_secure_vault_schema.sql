-- Keep all vault state outside the Data API's exposed public schema.
alter table public.a1_vault_permissions set schema a1_vault_private;
alter table public.a1_vault_items set schema a1_vault_private;
alter table public.a1_vault_grants set schema a1_vault_private;
alter table public.a1_vault_unlocks set schema a1_vault_private;
alter table public.a1_vault_events set schema a1_vault_private;
-- Recompile the existing fully-qualified service implementation against the
-- moved tables. Only its table schema names change; ACLs remain service-only.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('a1_vault_private.service(uuid,uuid,text,jsonb)'::regprocedure);
 execute replace(definition,'public.a1_vault_','a1_vault_private.a1_vault_');
end $$;
