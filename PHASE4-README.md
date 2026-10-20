# Church Connect — Phase 4 implementation package

## Included changes
- Public navigation now shows **Sign In**, not prominent staff/member administrative links.
- Private messages have a **New message** composer and member name search (minimum two characters); directory is not a running membership list.
- Approved ministry members can select their ministry and open its existing group conversation; individual ministry recipient search uses membership data where allowed by Supabase RLS.
- Membership profile now includes multiple church titles, primary display title, no-title Brother/Sister option, and ministry join requests.
- Updated responsive styling and mobile-friendly forms.
- `phase4-migration.sql` provides database storage and RLS for requests and titles.

## Required setup
1. Keep production `main` unchanged; upload these files to the `redesign-preview` branch.
2. Back up Supabase and review/run `phase4-migration.sql` in the Supabase SQL editor **before testing the new profile features**. Verify that `ministries.id` is UUID; adjust the foreign-key type if your original schema uses another type.
3. The new features require approved `ministry_members` records and correct Supabase RLS for conversations/messages. Test with two separate non-admin accounts.
4. The SQL migration intentionally **does not** permit a member to approve their own request or verify their own title. Build and test a server-side privileged approval flow before offering that administrative action in production.

## Still to implement (not represented as completed)
- Real push notifications (including service worker push handlers, VAPID keys, consent and server delivery), optional SMS, notification preferences.
- Full pastor/delegate role-based dashboards, granular permissions and visual Flowboard-style task management.
- Church-wide admin ministry creation, organization terminology selector, ministry color settings and administrative approval UI.
- Website-only vs member-only vs complete-package subscriptions and per-church tenant isolation.
- Ministry member search requires an appropriate secure RLS policy; do not broaden ministry member visibility to all users.
- Some legacy pages (`admin-dashboard.html`, `ministry-dashboard.html`) need security review before deployment. Do not link to them from the public website.

This is an **incremental code update**, not a finished production-ready multi-church platform.
