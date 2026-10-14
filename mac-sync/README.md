# A1VIP Skybox folder sync for Mac

## Install once on JAW's Mac

1. Install Node.js 22 or newer (current LTS recommended): https://nodejs.org/en/download.
2. Download **Mac Folder Sync** from dashboard Admin → Import from Skybox, unzip it, and run `Install.command`. If Finder does not open the command, open Terminal, type `bash `, drag Install.command into the window, and press Return.
3. Sign in using JAW and the normal dashboard password in the local setup dialogs. The password is used once and discarded. An encrypted macOS Keychain item holds the session. No database admin/service-role key is used.
4. The installer creates `~/skyexport` and registers a user LaunchAgent. It checks every five minutes, on login, and when the folder changes. The Mac must be logged in, awake, and online. A logged-out or sleeping Mac cannot import files; checks resume after login/wake. Leave exported files in place until a successful run appears in dashboard Admin.

## Each week

Export the same Skybox Invoices Report (.xlsx or CSV) into `~/skyexport`. Add customer, vendor, and purchase exports when they change. Keeping one current export of each kind and overwriting it weekly is simplest. With multiple versions in the folder, the helper selects the latest modified file for each report kind. Previously observed source revisions are not reapplied.

The helper waits for files to be at least one minute old and checks they did not change while being read. It ignores Excel lock files, subdirectories, and symlinks. Required original headings and financial balances are validated before database writes. All source rows are read locally. Initial imports and updates then run in batches of 50 under the signed-in staff account's RLS permissions.

New source IDs create documents. Previously seen source revisions skip. A changed invoice updates only when its current A1 document still matches the last imported document; otherwise the incoming copy is preserved under Admin → Imports Needing Review. Deleted documents are not silently recreated. Original exports and every imported source revision are retained in Supabase. Changed customer/vendor records update the shared directory; old dropdown preset choices remain available.

A1-created invoices are never matched to Skybox by customer name or date. Skybox IDs identify their own imported invoices; A1 numeric numbering remains separate. Invoice summaries still lack original ticket line details. Customer credit remains reference information rather than an automatic invoice payment.

A validation or network failure leaves files eligible for retry. Already completed rows safely skip on the next run. Conflicts are retained for manual review and do not block other records. Files are not deleted or moved. Removing a row from a later export does not delete its saved dashboard record.

## Status and troubleshooting

Dashboard Admin → Import from Skybox shows the latest sync runs, counts, and errors. Select Refresh Sync Status after a run. Local logs are in `~/Library/Application Support/A1VIP-Skybox-Sync/logs/`.

The local helper and private config/state live in `~/Library/Application Support/A1VIP-Skybox-Sync/`. To run it manually, run the Node.js executable with that directory's `sync.mjs`. Add `--dry-run` to validate and count pending exports without importing. A local process lock prevents overlapping runs.

If the dashboard login is revoked/expired, Keychain is locked, or the password-reset process signs the helper out, run Install.command again to sign in. The installer replaces helper code and retains processed-file receipts. Keep the Mac's login Keychain unlocked for background use. Never put passwords, tokens, or a Supabase service-role key into spreadsheet files or the dashboard's public configuration.

Run Uninstall.command to stop the LaunchAgent and delete its saved Keychain session. Export files, local logs/state, and cloud documents are preserved.

This package creates the job on the Mac where it is installed. Downloading it or publishing dashboard code does not install or activate a job on JAW's Mac. Mac Keychain dialogs and launchd activation must be verified on that Mac after setup.

Implementation references: https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html and https://supabase.com/docs/reference/javascript/auth-setsession
