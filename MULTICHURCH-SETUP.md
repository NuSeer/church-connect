# Multi-church setup (Phase 11) — step by step

Tested here on a rebuilt copy of the live database structure (exported 2026-10-20). **Not yet run on the real Supabase project.**

## Before you start
- Your current database is single-church. Everything already in it becomes "Your Church" (slug `default`); nothing is deleted.
- Best practice: try these steps on a spare, empty Supabase project first. If you go straight to the live one, keep `structure.json` (the export) as your record of how it looked before.
- `multichurch-rollback.sql` puts the single-church shape back (only while one church exists).

## 1. Run the three migrations, in this order
In Supabase → **SQL Editor** → **New query**, paste one file, click **Run**, wait for "Success", then do the next:
1. `messaging-migration.sql` — missing from your database today (unread counts and read markers need it)
2. `phase12-hardening-migration.sql` — removes extra public permissions, push de-duplication, staff-member text numbers
3. `multichurch-migration.sql` — churches, subscriptions, separation

If any shows a red error, stop and send me the exact message. All three are safe to run again.

## 2. Make yourself the platform owner
1. Supabase → **Authentication → Users**, find your own account and copy its **User UID**.
2. SQL Editor, run (put your UID between the quotes):
   `insert into public.cc_platform_admins values ('YOUR-USER-UID');`
Only platform owners can create churches or change subscriptions. Nobody can read or edit this list from the website.

## 3. Tell the website which church it is (optional while you have one church)
Run `select id, name, slug from public.churches;` and copy the `id`. In `config.js` set `churchId: 'that-id'` and commit to `re-design-preview`.
With two or more churches this is required, and each church's site needs its own copy of the site with its own `churchId`.

## 4. Add another church
1. The new church's administrator signs up once at `connect.html` (they will show as waiting for approval — that's fine).
2. Copy their **User UID** from Authentication → Users.
3. Run: `select public.cc_platform_create_church('Grace Chapel','grace','THEIR-USER-UID');`
   This creates the church, a 30-day trial, makes that person its approved administrator, and moves their profile into the new church.
4. To change the plan or turn a church off or on:
   `select public.cc_platform_set_subscription('CHURCH-ID','pro','active');` (status: `trialing`, `active`, `past_due`, `canceled`)

## What a subscription does
`trialing` (until its end date) and `active` let a church add and change things. `past_due` and `canceled` (and an expired trial) make it **read-only**: members can still read and sign in, but nobody can post events, add ministries, start chats, add members or publish the site. There is no payment connection yet; you set the status by hand.

## What is separated
Members, ministries, conversations and messages, events, announcements, giving links, directory members, settings, donation records, delegations and website content all carry the church they belong to. A signed-in person only ever sees and changes their own church's rows, and every administrator function checks that what it is asked to change belongs to the caller's church.
The public website still shows **published** events/announcements/giving links to everyone; pass `churchId` so each site only shows its own.

## Not included
Payments (Stripe), per-church logos/domains, moving a member between churches, and a platform dashboard page. Those are separate pieces of work.

## Undo
Delete any extra churches (`delete from public.churches where slug <> 'default';`), then run `multichurch-rollback.sql`.
