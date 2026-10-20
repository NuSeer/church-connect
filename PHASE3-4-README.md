# Church Connect — Ministry Workspace + Administration Center (Preview)

## Install
1. Keep `main` untouched. Upload this project to the `redesign-preview` branch.
2. In Supabase SQL Editor run **`phase3-4-migration.sql`** after the earlier migrations (`phase4-migration.sql`, `membership-migration.sql`, `directory-ministry-migration.sql`, `ministry-colors-migration.sql`).
3. On the **preview deployment URL**, sign in and visit `/ministries-admin.html`. Click **Open workspace** next to a ministry.
4. Visit `/admin-center.html` for the administration overview and delegation record controls.

## Included
- Ministry workspace: registered/directory rosters, leader toggle for both kinds of members, activity creation/listing, ministry color stripe, links to membership and messaging.
- Administration center: member, directory, ministry, and pending-request counts; navigation; saved staff delegation records.
- Admin link in the existing administration page.

## Known limits (important)
- The `cc_staff_delegations` table records proposed permissions, but individual modules currently authorize using `church_admins`. **Delegation does not yet grant functional access**. Do not describe role-based access as complete until RLS policies and each module enforce the new permissions.
- Ministry activities use the existing `ministry_activities` schema. SQL may require adjustment if the live schema differs.
- No SMS gateway or background push delivery added in this package.
- Existing single-church tables and authorization are not a completed multi-tenant architecture.
- No live Supabase or device end-to-end test was performed. Test on preview and report any errors.
