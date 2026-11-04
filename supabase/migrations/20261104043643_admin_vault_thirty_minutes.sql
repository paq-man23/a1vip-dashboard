-- Determine the unlock lifetime from current, server-controlled staff membership.
-- Keep non-admin unlocks at five minutes and retain all session/permission checks.
do $$
declare definition text; original text := $old$now()+interval '5 minutes'$old$;
begin
 definition := pg_get_functiondef('a1_vault_private.service(uuid,uuid,text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,original,'')))/length(original) <> 2 then
  raise exception 'Vault unlock expiry changed; review before applying';
 end if;
 definition := replace(definition,original,$new$now()+(case when admin then interval '30 minutes' else interval '5 minutes' end)$new$);
 execute definition;
end $$;
