# Phase 12 — testing, security and deployment readiness (2026-10-20)

Status words: **Verified** = run and passed here · **Untested** = written, not run against the real Supabase project · **Not started**.

## Verified in this session (automated)
- All 15 JavaScript files and every inline script pass a syntax check.
- `tests/sql-rls.test.mjs`: every migration applies in order on a stand-in Postgres and **re-runs cleanly** (phase4 and messaging were not re-runnable before; fixed). 33 access-control checks pass: non-admins cannot add/read directory members, members cannot self-verify titles, text-number lookup is limited to conversation participants, staff-member numbers go only to admins and ministry leaders, push subscriptions are per-user and approved-only, anonymous users get nothing.
- `tests/browser-auth.test.mjs` (headless Edge, Supabase calls mocked, no real email sent): every password box has a working Show/Hide, "Forgot password?" appears on all six sign-in pages, an empty email gets a nudge, a valid email sends one reset request that returns to `reset-password.html`, and the reset page shows an expired-link message without a session.

## Fixed
- Edge function was at the repo root; moved to `supabase/functions/send-message-push/index.ts` so `supabase functions deploy send-message-push` works.
- `ministries-admin.html` was missing the whole group-workspace section its script needs, so the script crashed on load. Markup added.
- `.vercelignore` keeps `*.sql`, `*.md`, `supabase/` and `tests/` off the public website.
- Push de-duplication (webhook retries) via `cc_push_deliveries`.
- Text handoff now includes staff-entered members who agreed to texts (admins and ministry leaders only) and has a "one person at a time" mode so numbers aren't shared.
- Show/Hide on every password field; Forgot password + `reset-password.html`.
- VAPID public key set in `config.js`.

## Still required before this works live (Untested / your steps)
1. Supabase → Authentication → URL Configuration: add `https://<preview-url>/reset-password.html` and the production equivalent to Redirect URLs.
2. Run `phase12-hardening-migration.sql`, set the function secrets, deploy the function, create the webhook (see PUSH-SETUP.md).
3. Real-phone test of push and of the text buttons on iPhone and Android.
4. Confirm `messaging-migration.sql` was actually run (the membership notes only mention phase4 + membership).
5. `admin-dashboard.html` (hardcoded password `church2024`) was **removed** at Joy's request; the public ministry page and README now point to `admin.html`. The old password is still in git history, so never reuse it.

## Phase 11 — multi-church accounts and subscriptions: **Implemented, tested on a rebuilt copy, not yet run on the real project**
Built from the live-structure export (2026-10-20). See `MULTICHURCH-SETUP.md`.
- `multichurch-migration.sql`, `multichurch-rollback.sql` (restores the exported original functions), updated `phase12-hardening-migration.sql`.
- `tests/replica-multichurch.test.mjs` rebuilds your real 24 tables, 23 functions and 57 policies from the export, applies the migrations (each twice), and runs 70+ checks: two churches cannot see or change each other's data (including through every administrator function), anonymous visitors only see published public data, a canceled or expired church becomes read-only, sign-up needs a church when there are several, and the rollback works.
- Found while testing and fixed: administrator functions bypass table locks, so the subscription lock is also enforced inside them.
- Findings from the live export: `messaging-migration.sql` had never been run (unread counts/read markers missing); the public (anon) role had every table permission including TRUNCATE (now revoked).
- Still open: payments, per-church branding/domains, and a platform dashboard page.

## Church-wide broadcast + pastor access — implemented, tested on a rebuilt copy, not yet on the real project
See `BROADCAST-SETUP.md`. `broadcast-migration.sql`, Broadcast tab in `connect.html`/`connect.js`, pastor-access button in `membership.js`, push function handles `member_updates`.
- SQL: 30+ checks in `tests/replica-multichurch.test.mjs` (pastor/admin only, same-church only, 10-per-hour limit, subscription lock, text list limited to consenting people in the same church, pastor access grant/remove, own-access guard).
- Screens: `tests/browser-broadcast.test.mjs` (mock sign-in): tab shows only for those allowed, sends the typed text, builds one `sms:` link per person, `?view=` opens a tab.
- Caught by the browser tests and fixed: an unescaped apostrophe in the pastor button that broke the Membership page.
- Pre-existing and left alone: `website-public.js` has a syntax error but no page loads it.
- Not browser-tested: the Give/Remove pastor access button itself (only its SQL).

## Website events + administrator alerts — implemented, tested on fakes/rebuilt copy, not yet on the real project
See `EVENTS-AND-ALERTS-SETUP.md`.
- `events-sync-migration.sql`, `supabase/functions/sync-website-events`, admin panel in `admin.html`/`admin.js`, push function handles `member_profiles` and `ministry_join_requests`.
- `tests/edge-functions.test.mjs` runs the real function code: push (broadcast, sign-up/ministry alerts, church separation, retry de-dup, expired phones) and website sync using the live site's real feed (270 events all mapped; time zones incl. daylight saving; HTML stripped; empty/broken/redirected/internal feeds never wipe or fetch anything).
- `tests/browser-events-feed.test.mjs` (mock admin sign-in) and extra checks in `tests/replica-multichurch.test.mjs`.
- Not tested: the real website feed through the real Supabase Edge runtime, phones, and the Cron job.

## Member photos + SECURITY FIX (2026-10-20/21)
- **Security fix:** members could approve themselves (table-wide update right on `member_profiles`). `photos-security-migration.sql` limits members to name/bio/directory settings/contact email/gender/photo fields. Tested on the rebuilt live schema.
- **Photos:** private storage bucket `member-photos`; a member's photo is visible to other approved members of the same church only if they turn sharing on (default off); administrators can always see/remove; staff-entered members (no account) get photos added by administrators, visible to administrators only. Generic woman / man / neutral pictures (`avatar-*.svg`) chosen by a Female/Male box; pictures are centre-cropped and shrunk in the browser before upload.
- Tests: 40+ database checks in `tests/replica-multichurch.test.mjs`, `tests/browser-photos.test.mjs` (profile upload/share/remove, directory privacy, administrator Membership screens, staff-entered photo flow).
- **Deploy order:** run the SQL first, then publish the screens (the screens read the new columns).
- Not built: photos in message lists/chat headers, ministry galleries, event flyers.

## Generic platform (2026-10-21)
`platform-migration.sql` + `brand.js`, Church settings (admin-center), invites (membership), Platform tab (connect). Church name/website come from the database (config.js is generic); first church moved in as "New Beginnings Outreach Center" with its website; administrators edit name/website/time zone; invites approve people automatically at sign-up; platform owner can list churches, create a church by the administrator's email, change status, create a demo church, and open any church as administrator (home church remembered, actions logged).
Tests: ~45 more database checks (invites, church creation, demo, switching, audit) and `tests/browser-platform.test.mjs`. **Deploy order:** run the SQL first, then publish the screens.
Not built: invite emails (needs Resend), per-church logo/branding/domain, self-service church sign-up and payments.
