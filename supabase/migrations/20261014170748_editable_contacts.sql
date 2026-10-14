-- Staff edits overlay imported data, so weekly Skybox updates cannot erase them.
create table public.a1_contact_edits (
  kind text not null check(kind in ('customer','vendor')),
  id text not null,
  patch jsonb not null default '{}'::jsonb check(jsonb_typeof(patch)='object'),
  version bigint not null default 1 check(version>0),
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(kind,id)
);
create index a1_contact_edits_updated_by_idx on public.a1_contact_edits(updated_by);
alter table public.a1_contact_edits enable row level security;
revoke all on public.a1_contact_edits from public,anon,authenticated;
grant select,insert,update on public.a1_contact_edits to authenticated;
create policy staff_contact_edits on public.a1_contact_edits for all to authenticated
using(exists(select 1 from public.a1_staff where user_id=(select auth.uid())))
with check(exists(select 1 from public.a1_staff where user_id=(select auth.uid())));

create view public.a1_contacts with(security_invoker=true) as
with imported as (
 select c.kind,c.source_id as id,c.document || jsonb_build_object(
 'firstName',coalesce(latest.raw_record,r.raw_record)->>'First Name',
 'lastName',coalesce(latest.raw_record,r.raw_record)->>'Last Name') as document
 from public.a1_skybox_contacts c
 join public.a1_skybox_records r on r.kind=c.kind and r.source_id=c.source_id
 left join public.a1_skybox_sync_state s on s.kind=c.kind and s.source_id=c.source_id
 left join public.a1_skybox_revisions latest on latest.kind=c.kind and latest.source_id=c.source_id and latest.source_hash=s.source_hash
)
select coalesce(i.kind,e.kind) as kind,coalesce(i.id,e.id) as id,
 coalesce(i.document,'{}'::jsonb) || coalesce(e.patch,'{}'::jsonb) ||
 jsonb_build_object('kind',coalesce(i.kind,e.kind),'id',coalesce(i.id,e.id)) as document,
 coalesce(e.version,0) as version
from imported i full join public.a1_contact_edits e on e.kind=i.kind and e.id=i.id;
revoke all on public.a1_contacts from public,anon,authenticated;
grant select on public.a1_contacts to authenticated;

create function public.a1_save_contact(p_kind text,p_id text,p_patch jsonb,p_expected_version bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.a1_contact_edits; result public.a1_contacts; merged jsonb; k text; v jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.a1_staff where user_id=auth.uid()) then raise exception 'A1 staff access required'; end if;
 if p_kind is null or p_kind not in ('customer','vendor') or p_id is null or length(p_id)>100 or p_expected_version is null or p_expected_version<0 or jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'Invalid contact'; end if;
 for k,v in select key,value from jsonb_each(p_patch) loop
  if k not in ('displayName','firstName','lastName','name','company','email','phone','phone2','address','paymentMethod','tags','type','notes','photoPath') or jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>10000 then raise exception 'Invalid contact field: %',k; end if;
 end loop;
 if p_patch ? 'photoPath' and p_patch->>'photoPath'<>'' and p_patch->>'photoPath' !~ ('^'||p_kind||'/'||p_id||'/[a-f0-9-]+[.]jpg$') then raise exception 'Invalid contact photo path'; end if;
 perform pg_advisory_xact_lock(hashtextextended('contact:'||p_kind||':'||p_id,0));
 select * into previous from public.a1_contact_edits where kind=p_kind and id=p_id for update;
 if coalesce(previous.version,0)<>p_expected_version then raise exception 'Contact changed on another device. Refresh and reopen the card before saving.'; end if;
 if not exists(select 1 from public.a1_contacts where kind=p_kind and id=p_id) and p_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'Contact does not exist'; end if;
 select document into merged from public.a1_contacts where kind=p_kind and id=p_id;
 merged:=coalesce(merged,'{}'::jsonb)||p_patch;
 if length(btrim(coalesce(merged->>'displayName','')))=0 then raise exception 'Display name is required'; end if;
 insert into public.a1_contact_edits(kind,id,patch,version) values(p_kind,p_id,p_patch,1)
 on conflict(kind,id) do update set patch=a1_contact_edits.patch||excluded.patch,version=a1_contact_edits.version+1,updated_by=auth.uid(),updated_at=now();
 select * into result from public.a1_contacts where kind=p_kind and id=p_id;
 return jsonb_build_object('document',result.document,'version',result.version);
end $$;
revoke all on function public.a1_save_contact(text,text,jsonb,bigint) from public,anon;
grant execute on function public.a1_save_contact(text,text,jsonb,bigint) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('a1-contact-photos','a1-contact-photos',false,524288,array['image/jpeg'])
on conflict(id) do nothing;
create policy a1_contact_photos_read on storage.objects for select to authenticated
using(bucket_id='a1-contact-photos' and exists(select 1 from public.a1_staff where user_id=(select auth.uid())));
create policy a1_contact_photos_insert on storage.objects for insert to authenticated
with check(bucket_id='a1-contact-photos' and exists(select 1 from public.a1_staff where user_id=(select auth.uid())));
create policy a1_contact_photos_delete on storage.objects for delete to authenticated
using(bucket_id='a1-contact-photos' and exists(select 1 from public.a1_staff where user_id=(select auth.uid())));
