# Church Connect — Add Member + Ministries / Departments

## Installation (preview branch only)
1. Back up your existing `redesign-preview` branch. Upload the contents of `church-connect-main/` to the same repository root as your existing `membership.html` (not into an extra nested folder). Do not merge into `main` yet.
2. In Supabase SQL Editor, run **`directory-ministry-migration.sql`** AFTER your already-successful `phase4-migration.sql` and `membership-migration.sql`.
3. Open the Ready Vercel preview deployment and visit `/membership.html`. Use **+ Add Member** to enter a member without a login, and **Edit member** to revise them.
4. Visit `/ministries-admin.html` to create/rename independent ministries or departments and change the terminology.
5. Test with a church administrator account and a non-admin account. Non-admins must not read directory records or call the admin-only write functions.

## What is implemented
- Staff-entered member directory, with name, optional phone/email, courtesy title, multiple church titles, primary title, staff notes, explicit SMS consent flag, active/inactive flag, and ministry assignments.
- Search and edit staff-entered members; the existing registered-member approvals remain separate and unchanged.
- New ministry administration page: create/rename independent ministries and choose the church's terminology. Group overview shows approved registered and staff-entered directory counts.
- Admin-only Supabase RPCs and row-level read policies for the new private directory tables.
- Links from administration and membership to ministry administration.

## Important limitations
- Staff-entered directory records do **not** create login accounts and cannot access private ministry chats. A later account-linking workflow is needed to reconcile a manually entered person who registers online.
- SMS consent flag **records permission only**; it does not send SMS.
- This update does not implement push notifications, SMS gateway, ministry calendars, or delegated ministry-leader dashboards.
- Existing `church_admins` access remains global as in the previous project. Multi-church tenancy isolation is NOT implemented or verified in this package; do not deploy as a multi-tenant production service until per-church ownership and RLS have been added.
- Supabase integration must be tested against your actual schema; JavaScript syntax checks alone are not an end-to-end test.
