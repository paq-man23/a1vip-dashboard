-- Real database assertions; all fixture data rolls back.
begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.a1_staff order by user_id limit 1), true);
set local role authenticated;
do $$
declare
  result jsonb;
  original jsonb;
  imported jsonb;
  conflict_hash text;
  blocked boolean := false;
begin
  original := '{"id":"letter-shared-test","subject":"Original","body":"Letter body"}';
  result := public.a1_import_document('letter',original);
  if result->>'outcome' <> 'imported' then raise exception 'Letter import failed'; end if;
  result := public.a1_import_document('letter',original);
  if result->>'outcome' <> 'skipped' then raise exception 'Repeat import duplicated the letter'; end if;
  result := public.a1_save_document('letter',original || '{"body":"Cloud edit"}',1);
  if result->>'version' <> '2' then raise exception 'Letter update failed'; end if;
  result := public.a1_import_document('letter',original);
  if result->>'outcome' <> 'skipped' then raise exception 'Old browser copy overwrote cloud edit'; end if;
  if (select document->>'body' from public.a1_documents where kind='letter' and id='letter-shared-test') <> 'Cloud edit' then raise exception 'Cloud edit was overwritten'; end if;
  result := public.a1_import_document('letter',original || '{"body":"Different computer copy"}');
  if result->>'outcome' <> 'imported' or result->>'copied' <> 'true' or result->>'id' = 'letter-shared-test' then raise exception 'Differing letter copy was not preserved'; end if;
  begin
    perform public.a1_save_document('letter',original,1);
  exception when raise_exception then
    if sqlerrm like 'Document changed on another device.%' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'Stale document edit was accepted'; end if;
  delete from public.a1_documents where kind='letter' and id='letter-shared-test' and version=1;
  if not exists(select 1 from public.a1_documents where kind='letter' and id='letter-shared-test') then raise exception 'Stale document delete was accepted'; end if;
  imported := '{"id":"itin-shared-test","eventContacts":"Contact","hotelReservations":[{"roomNumber":"123","notes":"Hotel notes"}],"rentalCars":[{"company":"Rental"}],"flightDetails":[{"flightNumber":"ABC","notes":"Flight notes"}]}';
  result := public.a1_import_document('itinerary',imported);
  if (select document from public.a1_documents where kind='itinerary' and id='itin-shared-test') <> imported then raise exception 'Trip or travel fields were lost'; end if;
  result := public.a1_import_document('invoice','{"id":"inv-shared-test","number":"shared-import-test","type":"invoice-travel","notes":"Original"}');
  if result->>'outcome' <> 'imported' then raise exception 'Travel invoice import failed'; end if;
  result := public.a1_import_document('invoice','{"id":"inv-shared-conflict","number":"shared-import-test","type":"invoice-travel","notes":"Different copy"}');
  if result->>'outcome' <> 'conflict' then raise exception 'Duplicate invoice number was not preserved for review'; end if;
  conflict_hash := result->>'source_hash';
  if not exists(select 1 from public.a1_import_conflicts where source_hash=conflict_hash and document->>'notes'='Different copy') then raise exception 'Conflicting invoice lost'; end if;
  perform public.a1_save_invoice('{"id":"inv-shared-resolved","number":"shared-import-test-resolved","type":"invoice-travel","notes":"Different copy"}',null);
  perform public.a1_resolve_import_conflict(conflict_hash,'inv-shared-resolved');
  if exists(select 1 from public.a1_import_conflicts where source_hash=conflict_hash) then raise exception 'Resolved conflict remained in review'; end if;
  result := public.a1_import_document('invoice','{"id":"inv-shared-conflict","number":"shared-import-test","type":"invoice-travel","notes":"Different copy"}');
  if result->>'outcome' <> 'skipped' then raise exception 'Resolved browser copy was duplicated'; end if;
end $$;
reset role;
-- Another approved account sees the same shared records.
select set_config('request.jwt.claim.sub', (select user_id::text from public.a1_staff order by user_id desc limit 1), true);
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.a1_documents where id='letter-shared-test') then raise exception 'Other account cannot read letters'; end if;
  if not exists(select 1 from public.a1_documents where id='itin-shared-test') then raise exception 'Other account cannot read trips'; end if;
  if not exists(select 1 from public.a1_invoices where id='inv-shared-test') then raise exception 'Other account cannot read travel invoices'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  if exists(select 1 from public.a1_documents) or exists(select 1 from public.a1_document_imports) or exists(select 1 from public.a1_import_conflicts) then raise exception 'Unapproved user could read shared documents'; end if;
  begin
    perform public.a1_save_document('letter','{"id":"letter-unapproved"}',null);
  exception when raise_exception then
    if sqlerrm='A1 staff access required' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'Unapproved user could save shared documents'; end if;
  blocked := false;
  begin
    perform public.a1_import_document('letter','{"id":"letter-unapproved"}');
  exception when raise_exception then
    if sqlerrm='A1 staff access required' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'Unapproved user could import shared documents'; end if;
end $$;
reset role;
set local role anon;
do $$
declare blocked boolean := false;
begin
  begin
    perform 1 from public.a1_documents;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'Anonymous user could read shared documents'; end if;
  blocked := false;
  begin
    perform public.a1_import_document('letter','{"id":"letter-anonymous"}');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'Anonymous user could call shared import'; end if;
end $$;
reset role;
rollback;
select 'PASS: cross-account access, complete trip data, repeats, differing copies, stale edits/deletes, invoice conflict review and resolution' as result;
