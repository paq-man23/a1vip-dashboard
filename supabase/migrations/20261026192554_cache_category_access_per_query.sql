-- Cache row-independent permission checks for one statement, not one session.
-- Keep CASE outside each subquery so mixed-kind tables retain category isolation.
-- Existing restrictive policies and security-invoker views stay in force.
alter policy category_invoices on public.a1_invoices
 using ((select public.a1_can_access('invoices')))
 with check ((select public.a1_can_access('invoices')));

alter policy category_invoice_presets on public.a1_invoice_presets
 using ((select public.a1_can_access('invoices')))
 with check ((select public.a1_can_access('invoices')));

alter policy category_documents on public.a1_documents
 using (case kind when 'letter' then (select public.a1_can_access('formLetter')) else (select public.a1_can_access('tripItinerary')) end)
 with check (case kind when 'letter' then (select public.a1_can_access('formLetter')) else (select public.a1_can_access('tripItinerary')) end);

alter policy category_contact_edits on public.a1_contact_edits
 using (case kind when 'customer' then (select public.a1_can_access('customers')) else (select public.a1_can_access('vendors')) end)
 with check (case kind when 'customer' then (select public.a1_can_access('customers')) else (select public.a1_can_access('vendors')) end);

alter policy category_skybox on public.a1_skybox_records
 using (case kind when 'customer' then (select public.a1_can_access('customers')) when 'vendor' then (select public.a1_can_access('vendors')) else (select public.a1_can_access('invoices')) end)
 with check (case kind when 'customer' then (select public.a1_can_access('customers')) when 'vendor' then (select public.a1_can_access('vendors')) else (select public.a1_can_access('invoices')) end);

alter policy category_sync_state on public.a1_skybox_sync_state
 using (case kind when 'customer' then (select public.a1_can_access('customers')) when 'vendor' then (select public.a1_can_access('vendors')) else (select public.a1_can_access('invoices')) end)
 with check (case kind when 'customer' then (select public.a1_can_access('customers')) when 'vendor' then (select public.a1_can_access('vendors')) else (select public.a1_can_access('invoices')) end);

alter policy category_revisions on public.a1_skybox_revisions
 using (case kind when 'customer' then (select public.a1_can_access('customers')) when 'vendor' then (select public.a1_can_access('vendors')) else (select public.a1_can_access('invoices')) end)
 with check (case kind when 'customer' then (select public.a1_can_access('customers')) when 'vendor' then (select public.a1_can_access('vendors')) else (select public.a1_can_access('invoices')) end);
