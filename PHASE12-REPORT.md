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

## Phase 11 — multi-church accounts and subscriptions: **Not started**
Not safe to build blind. The base schema (`schema-phase3.sql`) is not in the repo, and the admin functions (`cc_is_admin()` and the security-definer functions) are church-agnostic, so a second church's admin could act on the first church's data. It needs the real policy export from Supabase, then every function rewritten to be church-scoped.
