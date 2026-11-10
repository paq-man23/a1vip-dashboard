# a1vip-dashboard
Dashboard for links for A1VIP Entertainment Events

### Shared dashboard links

Category links now sync through Supabase `a1_button_layout` using the existing staff session. There is no separate button sync key or Cloudflare worker request. Approved staff can read the shared layout; only staff with `a1_staff.is_admin` can save it. Saves use an expected version to reject concurrent overwrites. `buttons.json` is retained as the legacy migration snapshot rather than the live link database.

Existing browser-local additions and pending confirmed moves are migrated automatically when an admin loads the dashboard. New link edits sync after saving, and other signed-in devices refresh the shared layout every 30 seconds. A failed save retains the local layout and reports the failure so the admin can retry. The database was initially populated from the currently published shared layout.

### User links and activity

Admins set shared links in Button Manager and individual starting preferences in Admin → Set User Link Defaults. Each account can use My Buttons to choose visibility and add personal http/https links. Preferences sync through `a1_user_preferences`, with ownership policies and admin override. Hidden links are a display preference, not an access-control boundary. New accounts still require Supabase Auth and an approved `a1_staff` membership; this feature does not grant users account-management privileges.

Regular users open website links in a sandboxed dashboard iframe; admins retain popups and private-ticket shortcuts. Providers may forbid framing or embedded sign-in. The app does not bypass those restrictions, and iframe popups/top navigation are blocked for regular users. The viewer records panel-visible time, capped at elapsed server time; it cannot inspect third-party clicks, typing, or navigation and does not prove work. URLs and query strings are not stored in website history.

Admin → User Login History / Punch Card shows the latest 500 sessions with user/date filters and elapsed totals. Website panel records are a separate list (latest 500). History has admin-only RLS and no direct client write privileges; narrow authenticated functions generate timestamps. Existing JAW/JV admin roles are preserved.

The dashboard locks after 20 minutes without observed dashboard interaction. Input in a cross-origin iframe cannot reliably reset the timer. Reloads reuse the Auth session and cannot revive expired or ended punch cards. Abruptly closed/offline sessions have an explicitly estimated end at last activity plus 20 minutes. Live sessions on multiple devices can overlap, and totals may double-count that time. Browser suspension/offline failures can delay delivery of final events; website durations are the last successfully reported count. This is an application idle timeout; Supabase access tokens follow their normal expiry/revocation rules.

### Admin account management and category access

Admin → Manage Accounts & User Layouts lists every Auth account, including JAW and JV. Admins can add regular users, edit usernames/display names, set a password, disable/restore access, select category permissions, and open Assigned Links / Layout for that account. Administrator roles cannot be granted through this UI; administrator usernames and full category access are protected, and self-disable is rejected. Account changes are recorded without passwords in `a1_account_events`.

A new user's email is optional; a missing email creates a temporary `username@a1vip.invalid` sign-in identity. New usernames sign in through the `a1-account-management` Edge Function, while existing aliases and email sign-in remain supported. The function validates every management caller with Auth and current admin membership before using its server-held Auth credentials. Its gateway JWT switch is off because the password-login operation is public; management actions still require a validated user JWT and an admin membership check inside the handler.

Category permissions apply to navigation and restrictive Supabase RLS policies on invoices, documents, contacts, source snapshots, revisions, and contact photos. Removing a category does not delete shared data. Existing accounts retain their access until edited; new accounts start with no category access until the selected permissions are saved. Disabling removes staff membership immediately and bans sign-in; restoring preserves category restrictions and the account's existing role. Signed-in clients recheck permissions about every 30 seconds. Admin-blocked default links stay hidden in personal layouts, including moved copies. Website permissions remain controlled by each external website.

The header's Refresh App action clears only dashboard asset caches and reloads a fresh page URL, keeping Supabase sign-in storage and saved layouts. Navigation responses also use a versioned network request to avoid reusing an older cached page on phones.

### Secure Vault

Secure Vault opens a standalone screen without the dashboard assistant or third-party scripts. Administrators can add site logins and company purchasing cards. In Manage Accounts → Vault Access, grant site-password access, company-card access, and optional editing to regular staff without changing their administrator role. Then use Share on each entry to assign specific accounts. Every regular account starts with no vault access. New entries are visible to administrators and their creator until sharing changes; an administrator can revoke even the creator's item grant.

Unlock using the existing dashboard password. The server verifies that password and issues a session-bound, five-minute unlock token held only in memory. Switching away, leaving, signing out, and explicit Lock clear rendered secrets; reveal dialogs also close after 30 seconds. The server independently checks current staff membership, the live Auth session, dashboard session state, category access, item assignment, editing permissions, and unlock expiry on every operation. Five unsuccessful unlock attempts within 15 minutes trigger a cooldown. Successful unlocks reset the failure count. No regular account can change sharing or account permissions.

Sensitive entry fields are encrypted at rest by Supabase Vault. Metadata (entry label, host, card last four digits) is separate. All vault tables are in an unexposed private schema and are inaccessible to browser database roles. Browser roles cannot query vault tables, the decrypted view, or the service RPC. The `a1-secure-vault` Edge Function verifies each bearer token with Supabase Auth before the service-only RPC checks authorization. The gateway JWT switch is disabled because the function performs its own Auth verification; there is no anonymous action. No service credential is included in frontend code. This is server-managed encryption, not end-to-end encryption: trusted project administrators retain backend access.

Vault values are not included in assistant search, dashboard exports, local storage, asset caches, or audit records. Audit records contain actor, action, entry ID, target account ID, and server timestamp. Login URLs are opened only on explicit request; this feature does not inject passwords into third-party pages. Clipboard copies remain until the user replaces them. Customer payment processing and customer cards are outside this feature. CVV fields are not collected.

Administrators can use Secure Vault → Import Excel to preview `.xlsx` login workbooks. Parsing runs locally with a pinned, vendored ZIP reader; formulas and external links are never executed or fetched. Select the worksheet, headings, and columns for site/account name, username, password, optional URL, and optional notes. The account/password/unlabelled-site layout is recognized with column A as username, B as password, and C as site/account label. Different site/account labels or usernames remain separate entries, even if they use the same email or password. Passwords remain masked and are preserved exactly, including whitespace. Existing vault entries are kept unless the admin explicitly checks Keep separately to add another login; imported data never overwrites an existing password. Repeat site/account rows can also be kept as separate logins. A login can be saved without a website URL and linked to a dashboard button later.

The preview checks existing identities with the authenticated vault service using only site/account names and usernames. Full selected entries are sent only after Import is clicked. Files are not uploaded or attached to vault records. Cancelling or locking clears parsed cells and the preview. Imports are limited to 200 selected rows per transaction; the server verifies administrator access and the current vault unlock independently. A private receipt makes uncertain-network retries idempotent, with no password/notes values or hashes in receipts. Every administrator sees imported and sales-created entries, and sales accounts receive no automatic sharing. The workbook is a one-time import, not an ongoing Excel sync. No customer credential workbook belongs in the repository or test fixtures.

Deploy both secure-vault migrations and the `a1-secure-vault` function before publishing the frontend. Keep Vault encrypted secrets in your backup/recovery plan. Do not delete or rotate Vault encryption keys without a tested recovery procedure. Use `npm test` for the handler and database authorization suite; `tests/vault.integration.sql` also runs against real Supabase using synthetic records and rollback. Its PGlite substitutes test authorization only; they do not test encryption. `tests/customer-security-live.integration.sql` checks direct database role restrictions without returning real customer rows. Browser QA can use `node scripts/verify-vault-browser.cjs` where Playwright Chromium is installed.

### Al AI assistant

Al supports conversational task planning, dashboard/contact/document searches, invoice/PO drafts, reviewed website-button additions, and deterministic summaries filtered by year, document type and payment state. Invoice history searches include event names, venues and line descriptions, so event-based searches show the related customer on matching invoices. Follow-up context contains the last six user requests and the current public event-search filters; result records are not forwarded to the model. Vault passwords and cards remain excluded.

Deploy the `a1-assistant` Edge Function and configure its server-only `OPENAI_API_KEY` to enable live conversation. Dashboard commands and financial summaries also work without that key. Al settings include a configuration check and opt-in browser voice input with transcript review. See [assistant setup](supabase/functions/a1-assistant/README.md) for deployment, privacy boundaries and validation.

Al also supports Ticketmaster Discovery event lookup using the server-only `TICKETMASTER_API_KEY` (the developer app's Consumer Key). Ask “find events Knicks” or a natural question with artist/team, city and dates. Cards show provider-reported event details, status, public links, source/check time and optional published event price ranges. These ranges are not live seat/section quotes, and fees are not confirmed. Ticketmaster credentials and raw responses are not sent to OpenAI; authenticated staff use the same guarded assistant endpoint. No OAuth/Consumer Secret is needed for Discovery.

Al’s Ticketmaster event buttons open a separate popup in the browser running the dashboard, including for regular staff. When the dashboard is in Safari, these open in Safari without a macOS shortcut or Chrome. The popup uses Safari’s existing cookies: Ticketmaster stays logged out only if Safari is already logged out. It does not sign in, sign out, clear browser cookies, or transfer credentials from another browser. Blocked popups offer a copy-link action. Existing private-ticket-account shortcuts and non-Ticketmaster event links are unchanged.

Al’s natural event search now works as a guided ticket inquiry: it recognizes likely artist-name typos, separates performer keywords from city/state/country, asks for missing location and month, and offers Any Location / Any Month. Florida is sent as `stateCode=FL` and `countryCode=US`, not as an artist keyword or city. Public event-search filters remain in the in-memory conversation so follow-ups can retain the artist while changing city or date. Result headers state the interpreted scope; empty results offer explicit broader searches without silently dropping filters. The direct `find events <keywords>` command remains a quick upcoming-events lookup.

Al can also search SeatGeek alongside Ticketmaster when server-only `SEATGEEK_CLIENT_ID` (and `SEATGEEK_CLIENT_SECRET` if issued) are configured. Matching events can share a card while retaining separate source links, timestamps and event-level prices. Partial provider failures preserve other results. SeatGeek access still requires developer credentials and live verification; individual seat quotes and equivalent-ticket price comparisons are not supplied by this integration. See [assistant setup](supabase/functions/a1-assistant/README.md).

### Skybox API connection

Admins can open Seat Sniper / Skybox → Skybox Connection & Sync, enter the Account ID, Application Token and account API Token, then choose Test Connection & Enable Sync. The backend validates access before storing tokens encrypted in Vault. A scheduled worker imports customers, vendors, invoices, purchase orders and inventory in pages while the dashboard is closed. Completed scans refresh after five minutes; initial history takes multiple passes. Pause and Resume control automatic syncing, and conflicts preserve A1 document edits. See [Skybox setup and boundaries](SKYBOX_IMPORT.md#skybox-api--seat-sniper-workspace).

## Ticket UI

The separate **Ticket UI** dashboard button opens a native, Skybox-style workspace
in A1's navy/green colors. It does not embed the Skybox website. Inventory is grouped
by event in a dense grid with filters, pagination, listing details, and Edit/Sell/Hold
row actions. Broadcast On/Off is shown in its own column, with a dedicated reviewed action that changes only the selected listing’s broadcast flag. Rows-per-page choices, numbered pages, range counts, and direct page jumps support larger inventories. Event headers include an Open seat map viewer using Skybox’s event chartUrl when supplied, with a full-size map link and a clear unavailable state. Separate workspaces cover invoices, purchases, holds, contacts, events,
and reports. The action menu exposes typed forms generated from the official
Skybox OpenAPI contract captured on November 10, 2026 (207 operations). The Sierra
STS-token endpoint is excluded because it belongs to a separate integration.

- The `a1-ticket-ui` Edge Function sends requests to Skybox using the **existing
  encrypted connection**. Account ID, Application Token and API Token stay server-side.
  No credentials need to be entered again. The existing sync function is unchanged.
- Live records and all Skybox actions are **administrator-only**. Regular users with
  existing Seat Sniper permissions can browse the synced inventory snapshot in Ticket
  UI. Ticket UI inherits that category's permissions; this does not expand staff access.
- Skybox itself enforces account/API permissions. Having a documented action in the
  catalog does not establish that this account is permitted to perform it.
- Mutations, including GET-based send-email and resend actions, require an expiring,
  signed review tied to the current user/session and exact payload. A private operation
  ledger prevents replay of the same submission. Provider writes are never retried.
  A timeout or 5xx can leave the result **unknown**: check Skybox before creating a
  new submission. The ledger stores action/status metadata, not payloads or secrets.
- Sell refreshes ticket IDs before preparing an invoice. The user chooses customer,
  ticket IDs and line amounts, then reviews before submitting. Provider validation is
  authoritative; no sales, purchases, payments, refunds or emails run during QA.
- Invoice and PO records written to Skybox are imported by the existing automatic
  inbound sync; they are not also created as separate A1 invoices at submission time.
- All filters/actions beyond the primary tables use schema-driven forms. This is an
  API-backed workspace, **not verified feature-for-feature or pixel-for-pixel parity**
  with the authenticated Skybox website. Unsupported provider responses, large exports
  over 8 MB, and permission denials surface as errors. The broad catalog has synthetic
  contract/authorization tests; each write workflow still needs account-level acceptance
  testing with deliberately chosen records before operational use.

Deploy `20261110232624_ticket_ui_operations.sql` and the new `a1-ticket-ui` Edge
Function (JWT validation is performed explicitly with Auth plus current-session DB
checks) before publishing the frontend. The new function uses the same CORS origins
and shared request pacing as the existing Skybox sync. Run `npm test`; browser QA uses
synthetic data, including the sale review step, without sending any real transaction.
Regenerate the documented contract with `python scripts/update-ticket-catalog.py`
only after reviewing upstream API changes.
