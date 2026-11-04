-- Some providers treat differently-cased usernames as different accounts.
-- Never merge those identities based on a case-insensitive comparison.
create or replace function a1_vault_private.login_identity(p_label text,p_username text) returns text
language sql immutable security invoker set search_path='' as $$
 select encode(extensions.digest(jsonb_build_array(lower(trim(p_label)),trim(p_username))::text,'sha256'),'hex')
$$;
revoke all on function a1_vault_private.login_identity(text,text) from public,anon,authenticated;
