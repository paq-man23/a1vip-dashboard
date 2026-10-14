# a1vip-dashboard
Dashboard for links for A1VIP Entertainment Events

### Shared dashboard links

Category links now sync through Supabase `a1_button_layout` using the existing staff session. There is no separate button sync key or Cloudflare worker request. Approved staff can read the shared layout; only staff with `a1_staff.is_admin` can save it. Saves use an expected version to reject concurrent overwrites. `buttons.json` is retained as the legacy migration snapshot rather than the live link database.

Existing browser-local additions and pending confirmed moves are migrated automatically when an admin loads the dashboard. New link edits sync after saving, and other signed-in devices refresh the shared layout every 30 seconds. A failed save retains the local layout and reports the failure so the admin can retry. The database was initially populated from the currently published shared layout.
