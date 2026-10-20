# Church-wide broadcast + pastor access — setup

Tested on a rebuilt copy of the live database (SQL) and in headless Edge with a mocked sign-in (screens). **Not yet run on the real Supabase project or on a phone.**

## What it adds
- **Broadcast tab** in the member portal (`connect.html`), shown only to administrators and pastors. One title + message goes to every approved member of that church; it appears under **Updates**.
- **Phone alert** for members with notifications on (title only), and an optional **"Also send as a text"** step that opens your own messaging app with the message ready (one person at a time keeps numbers private, or one group text). Only people who agreed to texts are included; replies come to your phone.
- A limit of 10 broadcasts per hour per church, and a lapsed subscription blocks sending.
- **Give pastor access / Remove pastor access** button on each approved member in `membership.html`. It gives the pastor role AND access to all the administration pages, so only give it to someone you trust with that. Nobody can change their own access.

## Steps
1. **Database:** Supabase → SQL Editor → run `5-broadcast-migration.sql` (after the first three files). Safe to run again.
2. **Update the push function:** Edge Functions → `send-message-push` → open the editor → replace the code with `4-push-function-code.ts` → Deploy. (It now also handles broadcasts.)
3. **Second webhook:** Database → Webhooks → create one more, same as before but with Table `member_updates`, Insert only, same URL, and the same `x-cc-webhook-secret` header.
4. **Website:** the files are already on the `re-design-preview` branch; wait for Vercel to show Ready.
5. **Test:** sign in as an administrator at `connect.html`, open **Broadcast**, send a test to yourself and one other approved member.

## Setting up the test people
- Everyone signs up at `connect.html` (Create account → enter name) and you approve them in `membership.html`.
- Pastor: after approving, click **Give pastor access** on their row.
- Ministry leader: in `ministries-admin.html` open the ministry and click **Assign leader**.

## Not included
Approval alerts (a phone notification when someone asks to join), a way to connect an existing church website to the events list, and a full roles screen.

## Undo
`multichurch-rollback.sql` removes these functions too (it also removes the multi-church changes). Posted broadcasts stay in `member_updates` like any update.
