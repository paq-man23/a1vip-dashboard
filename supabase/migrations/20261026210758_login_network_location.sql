-- Connection metadata belongs to the original punch, never a later page refresh.
alter table public.a1_activity_sessions
 add column login_ip inet,
 add column login_city text check(length(login_city)<=120),
 add column login_region text check(length(login_region)<=120),
 add column login_country text check(length(login_country)<=120),
 add column login_location_checked_at timestamptz;
create function a1_activity_private.capture_login_network() returns trigger
 language plpgsql security definer set search_path='' as $$
declare headers jsonb; candidate text;
begin
 headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 candidate:=coalesce(nullif(headers->>'cf-connecting-ip',''),nullif(split_part(headers->>'x-forwarded-for',',',1),''));
 begin new.login_ip:=btrim(candidate)::inet;exception when invalid_text_representation then new.login_ip:=null;end;
 return new;
end $$;
revoke all on function a1_activity_private.capture_login_network() from public,anon,authenticated;
create trigger capture_login_network before insert on public.a1_activity_sessions
 for each row execute function a1_activity_private.capture_login_network();
-- Existing admin-only SELECT policy and denial of client writes protect every new column.
grant select,update on public.a1_activity_sessions to service_role;
