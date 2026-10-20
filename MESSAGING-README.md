# Church Connect messaging update

Implemented: New Message composer, opt-in directory search, ministry group selection, individual private chats, ministry accent colors, unread message counts, read markers, in-app realtime updates, and authorized conversation deep links (`connect.html#conversation=UUID`).

## Install
1. Back up Supabase. Apply the existing migrations, then `phase4-migration.sql`, then `messaging-migration.sql` in Supabase SQL Editor.
2. Upload files to your GitHub **preview** branch and test Vercel preview.
3. Test with two approved members and one unapproved member; confirm private ministry access cannot be bypassed.

## Not yet included
Background push delivery while the app is closed needs server-side VAPID subscription storage, an authorized push sender and device testing. This release includes only live in-app updates and unread counts. Ministry group conversations must already exist. Nothing was deployed automatically.
