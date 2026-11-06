begin;
do $$
declare a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); sa uuid:=gen_random_uuid(); su uuid:=gen_random_uuid(); job jsonb; r jsonb; ident jsonb; before_page integer;
begin
 insert into auth.users(id,email) values(a,'skybox-api-fixture@example.invalid'),(u,'skybox-api-user@example.invalid');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sa,a,now(),now()),(su,u,now(),now());
 insert into public.a1_staff(user_id,is_admin) values(a,true),(u,false);
 insert into public.a1_activity_sessions(user_id,auth_session_id,display_name,idle_exempt) values(a,sa,'API Test',true),(u,su,'API User',false);
 insert into public.a1_account_profiles(user_id,username,allowed_sections) values(u,'skybox-api-fixture',array[]::text[]) on conflict(user_id) do update set allowed_sections=array[]::text[];
 ident:=jsonb_build_object('actor',a,'session',sa);
 r:=public.a1_skybox_service('configure',ident||'{"accountId":"123","applicationToken":"SYNTHETIC-APP","apiToken":"SYNTHETIC-API"}');
 if r::text like '%SYNTHETIC%' then raise exception 'Credentials leaked in status';end if;
 if (r->>'enabled')::boolean is distinct from true then raise exception 'Not enabled';end if;
 job:=public.a1_skybox_service('claim','{}');if job is null then raise exception 'No claim';end if;
 if public.a1_skybox_service('claim','{}') is not null then raise exception 'Concurrent claim';end if;
 r:=public.a1_skybox_service('apply',jsonb_build_object('lease',job->>'lease','kind','customer','page',0,'total',1,'done',true,'errors',0,'items',jsonb_build_array(jsonb_build_object('kind','customer','sourceId','999777111','record','{"Customer ID":"999777111","api":"fixture"}'::jsonb,'document','{"id":"999777111","kind":"customer","displayName":"API Test"}'::jsonb))));
 if r->>'imported'<>'1' then raise exception 'Customer not imported: %',r;end if;
 r:=public.a1_skybox_service('apply',jsonb_build_object('lease',job->>'lease','kind','inventory','page',0,'total',1,'done',true,'errors',0,'items',jsonb_build_array(jsonb_build_object('sourceId','999777112','document','{"id":"999777112","eventName":"API concert","quantity":2}'::jsonb))));
 r:=public.a1_skybox_service('apply',jsonb_build_object('lease',job->>'lease','kind','purchase','page',0,'total',1,'done',true,'errors',0,'items',jsonb_build_array(jsonb_build_object('kind','purchase','sourceId','999777113','record','{"Purchase ID":"999777113","api":"fixture"}'::jsonb,'document','{"id":"inv-skybox-purchase-999777113","number":"SB-PO-999777113","type":"po-ticket","credit":0}'::jsonb))));
 if r->>'imported'<>'1' then raise exception 'PO not imported: %',r;end if;
 r:=public.a1_skybox_service('inventory',ident);if r->>'total'<>'1' then raise exception 'Inventory missing';end if;
 begin perform public.a1_skybox_service('inventory',jsonb_build_object('actor',u,'session',su));raise exception 'Denied category leaked';exception when others then if sqlerrm='Denied category leaked' then raise;end if;end;
 r:=public.a1_skybox_service('apply',jsonb_build_object('lease',job->>'lease','kind','invoice','page',0,'total',1,'done',true,'errors',1,'items','[]'::jsonb));
 if (select page from a1_skybox_private.progress where kind='invoice')<>0 or (select completed_at from a1_skybox_private.progress where kind='invoice') is not null then raise exception 'Failed page advanced';end if;
 perform public.a1_skybox_service('pause',ident);
 begin perform public.a1_skybox_service('release',jsonb_build_object('lease',job->>'lease'));raise exception 'Stale lease accepted';exception when others then if sqlerrm='Stale lease accepted' then raise;end if;end;
 if public.a1_skybox_service('claim','{}') is not null then raise exception 'Paused worker ran';end if;
 if has_function_privilege('authenticated','public.a1_skybox_service(text,jsonb)','execute') or has_schema_privilege('authenticated','a1_skybox_private','usage') then raise exception 'Private API exposed';end if;
end $$;
do $$
declare first_slot jsonb; second_slot jsonb; cooled jsonb;
begin
 update a1_skybox_private.rate_limits set next_request_at=clock_timestamp()-interval '1 second';
 first_slot:=public.a1_skybox_reserve_request('inventory');
 second_slot:=public.a1_skybox_reserve_request('inventory');
 if (first_slot->>'waitMs')::integer<>0 or (second_slot->>'waitMs')::integer<10000 then raise exception 'Inventory requests were not paced';end if;
 perform public.a1_skybox_reserve_request('customer',60000);
 cooled:=public.a1_skybox_reserve_request('customer');
 if (cooled->>'reserved')::boolean or (cooled->>'waitMs')::integer<59000 then raise exception 'Retry-After cooldown ignored';end if;
 if has_function_privilege('anon','public.a1_skybox_reserve_request(text,bigint)','execute') or has_function_privilege('authenticated','public.a1_skybox_reserve_request(text,bigint)','execute') then raise exception 'Public throttle access';end if;
end $$;
rollback;
select 'PASS: encrypted credentials, no secret readback, leased runs, inbound contact and inventory writes, failed page retention, category restrictions, pause and fencing' as result;
