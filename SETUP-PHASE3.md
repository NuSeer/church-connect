# Phase 3 — Church Connect setup

1. Deploy these files over the Phase 2 site. Configure `config.js` with Supabase project URL and publishable/anon key. Never expose a service-role key.
2. In Supabase SQL Editor run `schema.sql`, then `schema-phase2.sql`, then `schema-phase3.sql` on a fresh database. On an existing Phase 2 database run only the new `schema-phase3.sql`.
3. Create church staff accounts using Supabase Authentication. Add administrators to `church_admins` using the SQL editor (not the browser). Only admins can approve members via `set_member_approval`.
4. Member signs up at `connect.html`, verifies email, signs in, completes profile. Approval is required before the private portal is accessible. The directory is opt-in and off by default.
5. Administrators currently need to provision ministries, ministry memberships, and group conversations using Supabase SQL editor or a trusted backend. The new member portal displays the workspaces, ministry schedules, and group chats after provisioning.
6. To create a ministry group conversation, insert a row into `conversations` with `kind='ministry'` and the ministry ID. Membership is derived from `ministry_members`.
7. Enable Supabase Realtime publication for `messages`, `member_updates`, and `ministry_activities` for live updates. The UI also includes a manual refresh.
8. Donation history is OFF by default; enabling it requires a secure admin-side action or SQL update to `church_settings`, and importing or recording contributions from verified sources. This app does NOT process payments or automatically sync giving providers.

## Security and remaining work

- Database row-level security restricts messages to approved conversation participants and ministry groups to ministry members. Direct conversations are created through a server-side RPC.
- Member profile approval and role assignment cannot be self-granted. Contact details are displayed only when opted in.
- Member privacy requires further testing in a real Supabase project before launch, including two-member isolation, role checks, realtime access, moderation/blocking, account deletion, and safeguarding minors.
- No native background push, SMS, or email delivery is implemented in Phase 3. Live changes show inside the open app after Supabase Realtime is configured.
- Existing legacy `ministry-dashboard.html` and `admin-dashboard.html` remain for reference; use `index.html`, `admin.html`, and `connect.html` as the supported entry points.
