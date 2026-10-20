# Church Connect: preview login and ministry colors

1. Deploy this ZIP to `redesign-preview` (not main).
2. Run `ministry-colors-migration.sql` in Supabase SQL Editor after the prior migrations.
3. Open the **preview deployment URL** /membership.html and sign in there with the same Supabase admin credentials. Production and preview are different browser origins; their sessions do not automatically transfer.
4. Open /ministries-admin.html, edit a group, choose its color, and save.
5. Return to /membership.html to view colored ministry tags for staff-entered members. Ministry chat list uses the saved color as well.

If sign-in succeeds but access is denied, confirm the signed-in user's UID exists in church_admins. Do not add hard-coded admin passwords.

Not live-tested with your Supabase instance. Do not merge to main until you verify it.
