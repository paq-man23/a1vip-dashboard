begin;
do $$
declare a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); sa uuid:=gen_random_uuid(); su uuid:=gen_random_uuid(); operation_id uuid:=gen_random_uuid(); ident jsonb; value jsonb;
begin
 insert into auth.users(id,email) values(a,'ticket-ui-admin@example.invalid'),(u,'ticket-ui-staff@example.invalid');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sa,a,now(),now()),(su,u,now(),now());
 insert into public.a1_staff(user_id,is_admin) values(a,true),(u,false);
 insert into public.a1_activity_sessions(user_id,auth_session_id,display_name,idle_exempt) values(a,sa,'Ticket UI fixture',true),(u,su,'Staff fixture',false);
 ident:=jsonb_build_object('actor',a,'session',sa);
 perform public.a1_skybox_service('configure',ident||'{"accountId":"123","applicationToken":"SYNTHETIC-TICKET-APP","apiToken":"SYNTHETIC-TICKET-API"}');
 value:=public.a1_ticket_ui_service('connection',ident);
 if value->>'apiToken'<>'SYNTHETIC-TICKET-API' then raise exception 'Service connection missing';end if;
 begin perform public.a1_ticket_ui_service('connection',jsonb_build_object('actor',u,'session',su));raise exception 'Staff gained live access';exception when others then if sqlerrm='Staff gained live access' then raise;end if;end;
 begin perform public.a1_ticket_ui_service('connection',ident||jsonb_build_object('session',su));raise exception 'Mismatched session accepted';exception when others then if sqlerrm='Mismatched session accepted' then raise;end if;end;
 value:=public.a1_ticket_ui_service('begin',ident||jsonb_build_object('id',operation_id,'operation','holdsInsert'));if value<>'true'::jsonb then raise exception 'First submission not accepted';end if;
 value:=public.a1_ticket_ui_service('begin',ident||jsonb_build_object('id',operation_id,'operation','holdsInsert'));if value<>'false'::jsonb then raise exception 'Duplicate submission accepted';end if;
 perform public.a1_ticket_ui_service('finish',ident||jsonb_build_object('id',operation_id,'status','unknown'));
 if (select status from a1_skybox_private.ticket_operations where id=operation_id)<>'unknown' then raise exception 'Unknown result not recorded';end if;
 if has_function_privilege('authenticated','public.a1_ticket_ui_service(text,jsonb)','EXECUTE') or has_function_privilege('anon','public.a1_ticket_ui_service(text,jsonb)','EXECUTE') then raise exception 'Browser roles can read secrets';end if;
 if has_table_privilege('authenticated','a1_skybox_private.ticket_operations','SELECT') then raise exception 'Audit rows exposed';end if;
 update public.a1_activity_sessions set ended_at=now() where user_id=a;
 begin perform public.a1_ticket_ui_service('connection',ident);raise exception 'Ended session accepted';exception when others then if sqlerrm='Ended session accepted' then raise;end if;end;
end $$;
rollback;
select 'PASS: admin-only live connection, session matching, secret isolation, duplicate submissions and unknown outcomes' as result;
