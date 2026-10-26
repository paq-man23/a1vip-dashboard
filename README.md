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
