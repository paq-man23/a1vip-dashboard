-- Apply once in the dashboard project after deploying a1-skybox-sync.
-- This job remains idle until an admin validates and enables a connection.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function a1_skybox_private.enqueue() returns bigint
language plpgsql security invoker set search_path='' as $$
declare request_id bigint;
begin
 if not exists(select 1 from a1_skybox_private.connection where enabled and credential_id is not null) then return null;end if;
 select net.http_post(
  url:='https://oncyuklfjtshfdayonoi.supabase.co/functions/v1/a1-skybox-sync',
  headers:=jsonb_build_object('Content-Type','application/json','x-a1-sync-token',
   (select decrypted_secret from vault.decrypted_secrets where id=(select scheduler_id from a1_skybox_private.connection))),
  body:='{"action":"scheduled"}'::jsonb,timeout_milliseconds:=90000
 ) into request_id;
 return request_id;
end $$;
revoke all on function a1_skybox_private.enqueue() from public,anon,authenticated,service_role;
select cron.schedule('a1-skybox-api-sync','* * * * *','select a1_skybox_private.enqueue();');
