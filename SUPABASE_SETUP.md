# A1 Dashboard Supabase setup

The configured admin aliases are **JAW → jaw@a1eei.com** and **JV → vollario@mac.com**. Configure `adminAliases` in `supabase-config.js` to map usernames to real Supabase Auth email accounts; this is a login alias, never an authorization check. Other approved staff can sign in with email. This change uses Supabase Auth email/password accounts and shared invoices for approved A1 staff. Passwords never go into invoice tables or the dashboard source. Invoice payloads preserve all current ticket/travel invoice and purchase order fields and line items. Saved client/preset values also live in Supabase. Form letters, itineraries and button layout are outside this change and retain their existing storage.

## Current project status

Project `a1vip-dashboard` (`oncyuklfjtshfdayonoi`) is configured in `supabase-config.js` with its public publishable key. Migration `20261014004903_a1_invoices_auth` was applied successfully on October 13, 2026 (New York time). Do not rerun it against this project. Live rolled-back integration assertions passed for approved staff writes, presets, duplicate numbers, stale edits/deletes, unapproved account access, and anonymous access. No test accounts or invoices remain. Supabase security advisors reported no issues. Performance advisors only reported unused foreign-key indexes on the newly created empty tables; these are retained for referential-integrity operations.

The requested admin alias is JAW, backed by jaw@a1eei.com, and both are configured. On October 13, 2026, the confirmed Auth account jaw@a1eei.com was verified and its ID was added to a1_staff. Staff membership and invoice/preset reads were verified under its authenticated database role. No password was read or changed. An end-to-end browser login/save check is still required once GitHub publication and deployment are available. The code is published on the GitHub branch feat/supabase-invoices-auth and is awaiting review and deployment. The user approved publication of the existing dashboard source on October 13, 2026 after the automatic approval review identified its pre-existing button-sync secret and operational data. GitHub repository write access was subsequently restored and publication to feat/supabase-invoices-auth succeeded. No live deployment has occurred. Review the draft PR and verify recovery redirect/SMTP configuration before merging and deploying. The confirmed JAW account and its staff membership are ready.

## Before deploying

1. For a fresh project, apply `supabase/migrations/20261014004903_a1_invoices_auth.sql` once using migrations or the SQL editor. It creates new `a1_*` tables and a transactional save function. It does not alter existing project tables.
2. Disable public user signup for this internal dashboard. Create or invite each staff user through Supabase Authentication. Approve each specific Auth user UUID with administrator SQL:

   ```sql
   insert into public.a1_staff(user_id) values ('AUTH_USER_UUID') on conflict do nothing;
   ```

   Staff cannot approve themselves. All approved staff share invoice read/write/delete access. Removing a membership revokes database access through row level security.
3. Configure Supabase Auth Site URL as `https://a1dash.a1eei.com` and any exact approved preview redirect URLs. Confirm the email provider and account confirmation settings. Password changes require the current password. The dashboard retains JAW as the admin login alias; manage email changes through Supabase and update `adminAliases` accordingly. Add `https://a1dash.a1eei.com/reset-password.html` to the exact allowed redirect URLs. `reset-password.html` accepts a Supabase PASSWORD_RECOVERY session and lets the account choose and confirm a new password. Signed-in users can change their password with current-password verification or request a reset link; the login screen has Forgot Password. Reset emails contain a link, never the existing password. Configure SMTP and verify actual email delivery before deployment. No reset email was sent during development.
4. Set `adminAliases` to the desired username/email mappings. Set `url` and `publishableKey` in `supabase-config.js` using the project's URL and **publishable key** (legacy anon key also works). These are public browser settings. Never use a secret or service_role key.
5. Validate login and database permissions with an approved staff account, an unapproved account, and an anonymous session before merging/deploying. Validate two-device saves, duplicate numbers and stale edits against the live database. The Node tests mock Supabase. `tests/rls.integration.sql` performs the database access and write assertions with fixture data inside a rolled-back transaction; browser login validation is separate.

## Existing browser invoices

After signing in on each browser with existing history, open Invoice History and choose **Import Old Browser Invoices**. This requires confirmation, imports each missing ID separately, never overwrites an existing shared ID, and retains original local copies as a backup. If a duplicate invoice number or other error occurs, earlier successful imports remain saved; resolve the conflict and retry. Legacy preset values are imported alongside invoices. No stored plaintext credentials are migrated: create real Auth accounts instead.

New invoice writes require a successful cloud save; failures do not report success or fall back to local-only writes. Refresh History reloads the database. Invoice numbering still suggests the next loaded number; the database rejects concurrent duplicate numbers, so refresh and choose a new number if another staff member used it. Version checks reject stale edits/deletes rather than replacing newer records. Clearing history deletes only the loaded snapshot, can partially complete on an error, and reports that situation.

## Checks

Run `node --test tests/supabase-data.test.cjs` and JavaScript syntax checks. The service worker bypasses Supabase and all non-GET requests and uses fresh configuration/data scripts.

The current public repository also contains historical HTML backups with the old browser login, and a separate public shared secret for the button-sync worker. This change removes the old login from the active app but does not rewrite repository history or change that external worker. The old password must not be reused for Supabase; review the backup routes and worker authentication separately. Database RLS, rather than the browser login overlay, protects invoice records.

## JV account setup

The JV alias is configured, but the latest Auth check found no account for vollario@mac.com. Account creation is pending via Authentication > Users, followed by explicit a1_staff approval. No JV account or privileged provisioning endpoint was created: automatic approval review rejected the temporary helper approach. Both confirmed approved accounts will have the same shared invoice access; aliases alone confer no permissions.
