-- Shared internal ticket-holder directory; access is explicitly assignable.
alter table public.a1_account_profiles drop constraint valid_sections;
alter table public.a1_account_profiles add constraint valid_sections check(allowed_sections <@ array['main','luxury','accounts','travel','social','invoices','customers','vendors','formLetter','tripItinerary','seatSniper','seasonTickets']);

create function public.a1_valid_season_holder(d jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>40000 then return false;end if;
 for k,v in select key,value from jsonb_each(d) loop
  if k not in ('holderName','company','email','phone','preferredContact','venue','team','event','city','state','season','section','row','seats','quantity','ticketType','status','lastContact','nextFollowUp','notes') or jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>(case when k='notes' then 5000 else 500 end) then return false;end if;
 end loop;
 if coalesce(btrim(d->>'holderName'),'')='' or coalesce(btrim(d->>'venue'),'')='' or (coalesce(btrim(d->>'team'),'')='' and coalesce(btrim(d->>'event'),'')='') or (coalesce(btrim(d->>'email'),'')='' and coalesce(btrim(d->>'phone'),'')='') then return false;end if;
 if coalesce(d->>'email','')<>'' and d->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then return false;end if;
 if coalesce(d->>'quantity','')<>'' and d->>'quantity' !~ '^[1-9][0-9]{0,4}$' then return false;end if;
 if coalesce(d->>'preferredContact','') not in ('','Email','Phone','Text') or coalesce(d->>'ticketType','') not in ('','Standard','Premium','Suite','Parking') or coalesce(d->>'status','') not in ('Open to offers','Ask first','Not selling','Archived') then return false;end if;
 if coalesce(d->>'lastContact','')<>'' then perform (d->>'lastContact')::date;end if;
 if coalesce(d->>'nextFollowUp','')<>'' then perform (d->>'nextFollowUp')::date;end if;
 return true;
 exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
revoke all on function public.a1_valid_season_holder(jsonb) from public,anon;
grant execute on function public.a1_valid_season_holder(jsonb) to authenticated;

create function public.a1_can_access_season_tickets() returns boolean language sql stable security invoker set search_path='' as $$
 select public.a1_can_access('seasonTickets') and not coalesce((select disabled from public.a1_account_profiles where user_id=(select auth.uid())),false)
$$;
revoke all on function public.a1_can_access_season_tickets() from public,anon;
grant execute on function public.a1_can_access_season_tickets() to authenticated;

create table public.a1_season_ticket_holders(
 id uuid primary key default gen_random_uuid(), document jsonb not null check(public.a1_valid_season_holder(document)),
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null,
 updated_by uuid default auth.uid() references auth.users(id) on delete set null
);
create index a1_season_holders_created_by_idx on public.a1_season_ticket_holders(created_by);
create index a1_season_holders_updated_by_idx on public.a1_season_ticket_holders(updated_by);
alter table public.a1_season_ticket_holders enable row level security;
revoke all on public.a1_season_ticket_holders from public,anon,authenticated;
grant select on public.a1_season_ticket_holders to authenticated;
grant insert(id,document),update(document) on public.a1_season_ticket_holders to authenticated;
create policy season_holders_read on public.a1_season_ticket_holders for select to authenticated using((select public.a1_can_access_season_tickets()));
create policy season_holders_insert on public.a1_season_ticket_holders for insert to authenticated with check((select public.a1_can_access_season_tickets()));
create policy season_holders_update on public.a1_season_ticket_holders for update to authenticated using((select public.a1_can_access_season_tickets())) with check((select public.a1_can_access_season_tickets()));

create function public.a1_stamp_season_holder() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then new.version:=1;new.created_at:=now();new.created_by:=auth.uid();
 else new.version:=old.version+1;new.created_at:=old.created_at;new.created_by:=old.created_by;end if;
 new.updated_at:=now();new.updated_by:=auth.uid();return new;
end $$;
revoke all on function public.a1_stamp_season_holder() from public,anon,authenticated;
create trigger season_holder_stamp before insert or update on public.a1_season_ticket_holders for each row execute function public.a1_stamp_season_holder();

create function public.a1_save_season_holder(p_id uuid,p_document jsonb,p_expected_version bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.a1_season_ticket_holders;
begin
 if not public.a1_can_access_season_tickets() then raise insufficient_privilege using message='Season Tickets access required';end if;
 if p_id is null or p_expected_version is null or p_expected_version<0 or not public.a1_valid_season_holder(p_document) then raise exception 'Enter a holder name, venue, team or event, and phone or email. Check the remaining fields.';end if;
 if p_expected_version=0 then
  insert into public.a1_season_ticket_holders(id,document) values(p_id,p_document) on conflict(id) do nothing returning * into r;
 else
  update public.a1_season_ticket_holders set document=p_document where id=p_id and version=p_expected_version returning * into r;
 end if;
 if r.id is null then raise exception 'This holder changed on another device. Refresh and reopen the entry before saving.';end if;
 return to_jsonb(r);
end $$;
revoke all on function public.a1_save_season_holder(uuid,jsonb,bigint) from public,anon;
grant execute on function public.a1_save_season_holder(uuid,jsonb,bigint) to authenticated;
