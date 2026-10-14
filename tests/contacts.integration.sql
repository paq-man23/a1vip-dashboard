begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff order by user_id limit 1),true);
set local role authenticated;
do $$ declare r jsonb; d jsonb;
begin
 perform public.a1_sync_skybox('customer','50001','{"Customer ID":"50001","First Name":"Alex","Last Name":"Zulu"}','{"id":"50001","kind":"customer","displayName":"Alex Zulu","phone":"","email":"old@example.invalid"}');
 if (select document->>'lastName' from public.a1_contacts where kind='customer' and id='50001')<>'Zulu' then raise exception 'Imported last name missing'; end if;
 r:=public.a1_save_contact('customer','50001','{"phone":"555-0100","notes":"Call after 2"}',0);
 if r->>'version'<>'1' or r->'document'->>'phone'<>'555-0100' then raise exception 'Contact save failed'; end if;
 perform public.a1_sync_skybox('customer','50001','{"Customer ID":"50001","First Name":"Alex","Last Name":"Zulu","Email":"weekly@example.invalid"}','{"id":"50001","kind":"customer","displayName":"Alex Zulu","phone":"555-9999","email":"weekly@example.invalid"}');
 select document into d from public.a1_contacts where kind='customer' and id='50001';
 if d->>'phone'<>'555-0100' or d->>'notes'<>'Call after 2' or d->>'email'<>'weekly@example.invalid' then raise exception 'Skybox update erased contact edits or blocked unedited fields'; end if;
 if (select document->>'phone' from public.a1_skybox_records where kind='customer' and source_id='50001')<>'' then raise exception 'Original changed'; end if;
 begin perform public.a1_save_contact('customer','50001','{"phone":"stale"}',0);raise exception 'Stale save allowed';exception when raise_exception then if sqlerrm not like 'Contact changed on another device.%' then raise;end if;end;
 perform public.a1_save_contact('vendor','a0000000-0000-4000-8000-000000000001','{"displayName":"New Vendor","email":"vendor@example.invalid"}',0);
 if not exists(select 1 from public.a1_contacts where kind='vendor' and id='a0000000-0000-4000-8000-000000000001') then raise exception 'New contact missing'; end if;
 begin perform public.a1_save_contact('customer','50001','{"kind":"vendor"}',1);raise exception 'Identity injection allowed';exception when raise_exception then if sqlerrm not like 'Invalid contact field:%' then raise;end if;end;
 begin perform public.a1_save_contact('customer','50001','{"photoPath":"vendor/50001/abc.jpg"}',1);raise exception 'Other contact photo allowed';exception when raise_exception then if sqlerrm<>'Invalid contact photo path' then raise;end if;end;
 perform public.a1_save_contact('customer','50001','{"phone":"","photoPath":"customer/50001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg"}',1);
 if (select document->>'phone' from public.a1_contacts where kind='customer' and id='50001')<>'' then raise exception 'Explicit clearing not kept'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select user_id::text from public.a1_staff order by user_id desc limit 1),true);
set local role authenticated;
do $$ begin
 if (select document->>'notes' from public.a1_contacts where kind='customer' and id='50001')<>'Call after 2' then raise exception 'Other staff cannot read edits'; end if;
 perform public.a1_save_contact('customer','50001','{"phone2":"555-0200"}',2);
end $$;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.a1_contacts) then raise exception 'Nonstaff can read contacts'; end if;
 begin perform public.a1_save_contact('customer','50001','{}',3);raise exception 'Nonstaff can save';exception when raise_exception then if sqlerrm<>'A1 staff access required' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.a1_contacts;raise exception 'Anon can read';exception when insufficient_privilege then null;end;
 begin perform public.a1_save_contact('customer','50001','{}',3);raise exception 'Anon can save';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: shared contacts, source last names, weekly edit protection, original retention, optimistic locking, new contacts, identity and photo validation, staff-only access' as result;
