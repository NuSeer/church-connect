# Website events + administrator alerts — setup

Tested here with the real function code against a fake database/network, using your live site's real events list (270 events), plus a rebuilt copy of the live database and headless-browser checks. **Not yet run on the real Supabase project or on a phone.**

## What it does
- **Events come from your church website.** Church Connect reads the events list your site already publishes (`https://newbeginningsoutreachctrcogic.org/api/events`) and keeps copies in Church Connect, so events are typed once, on the website. It only *reads* the website; it never changes it.
  - Times are converted from your time zone (Eastern by default). Events with no time are marked "All day." Zoom links stay in the description. Website formatting is stripped to plain text.
  - Events that come from the website show "From your church website" in the admin list and can't be edited or deleted here (they would just come back). Events typed in Church Connect are untouched.
  - If the website list is empty or broken, existing events are **kept**, and the problem is shown in the panel.
- **Administrators and pastors get a phone alert** when someone signs up and is waiting for approval, and when someone asks to join a ministry. Tapping it opens the Membership page.

## Steps (in this order)
1. **Database:** SQL Editor → run `7-events-sync-migration.sql`.
2. **Push function:** Edge Functions → `send-message-push` → replace the code with the new `4-push-function-code.ts` → Deploy.
3. **New sync function:** Edge Functions → **Deploy a new function → Via Editor** → name it exactly `sync-website-events` → paste `8-sync-website-events-function-code.ts` → Deploy → in its settings turn **Verify JWT** OFF (the function checks who is calling). It uses the same `CC_PUSH_WEBHOOK_SECRET` secret you already made.
4. **Two more webhooks** (Database → Webhooks → Create), each with the same URL (`https://vizcmyqyoaazkcytcunp.supabase.co/functions/v1/send-message-push`), method POST, and the same `x-cc-webhook-secret` header:
   - table `member_profiles`, Insert only
   - table `ministry_join_requests`, Insert only
5. **Automatic refresh (hourly):** Integrations → **Cron** → Create job → name `sync-website-events`, schedule `0 * * * *` (every hour), type **HTTP Request**, POST to `https://vizcmyqyoaazkcytcunp.supabase.co/functions/v1/sync-website-events`, header `x-cc-webhook-secret` = your secret.
6. **Website:** wait for Vercel to show Ready for `re-design-preview`.
7. **Set it up:** sign in at `admin.html` → **Events** tab → **Events from your church website** → type `https://newbeginningsoutreachctrcogic.org/api/events`, pick your time zone, **Save address**, then **Sync now**. Your events appear in the list marked "From your church website".
8. **Alerts need a phone turned on:** each administrator/pastor opens `connect.html` on their phone → My Profile → **Enable notifications** (iPhone: add the site to the Home Screen first).

## Good to know
- If you already typed events into Church Connect that also exist on your website, delete the hand-typed copies after the first sync or they'll show twice.
- Who can change the website address: administrators (including pastors given access). Only plain public https addresses are accepted; internal/IP addresses are refused.
- The website's own events list currently runs from Feb 2026 to Jan 2027; once those pass, nothing new appears until the website adds more.
- Not included: recurring events (the website already lists each date separately), event photos/flyers, and importing from sites that don't publish a list like this (a calendar `.ics` feed could be added).

## Undo
`multichurch-rollback.sql` also removes the feed setting and the website-event columns. Delete the two new webhooks and the cron job to stop alerts and syncing.
