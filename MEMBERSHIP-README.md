# Church Connect — Membership Management Update

This ZIP builds on the previous messaging package. It adds `membership.html`, `membership.js`, and `membership-migration.sql`, plus an admin navigation link and responsive styles. It also fixes a ministry-request upsert bug and improves title-save error reporting.

## Install and test
1. Back up your existing deployment and database. Keep the live `main` branch unchanged. Upload this package to your **preview** branch.
2. In Supabase SQL Editor run existing schema migrations in order, then `phase4-migration.sql` if not already run, then `membership-migration.sql`. **Do not rerun existing CREATE POLICY statements blindly; Supabase may reject duplicates.**
3. Sign in as an existing `church_admins` user and open `membership.html` (also linked from `admin.html`).
4. Test account approval/suspension, ministry requests, ministry leader assignment, and official title verification with separate test accounts.
5. Verify that a regular member cannot access the admin view or invoke `cc_manage_member`/`cc_verify_titles`. Test privacy using a non-admin account.

## Important limitations
- The original project uses a **single church's** database structures; this update does not introduce multi-tenant isolation. Do not put multiple churches into the same database without church-scoped tables and RLS.
- The migration assumes the phase 3 and phase 4 schemas already exist.
- Membership suspension disables private portal access at application level; it does **not** delete or disable the Supabase Auth login. Review other admin/legacy pages separately.
- The `member_church_titles` phase 4 column grants may require reconciliation with earlier permissions in your Supabase project.
- No production Supabase environment or live devices were available to test this package.
- SMS gateway and background PWA push are **not** added by this membership update.
