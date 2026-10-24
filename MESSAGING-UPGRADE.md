# Church Connect — complete app with upgraded messaging

This update preserves the existing public website, branding and website editor, church/platform administration, membership approval, ministry workspaces, directory privacy, giving, event feeds, broadcasts, and app installation. Messaging is part of the existing member portal (`connect.html`); GroupMe is neither connected nor required.

## Included behavior

- Conversation names, initials, latest message previews, timestamps, unread counts, search and archived/unread views.
- Latest-first history retrieval with earlier-message loading; search across the conversation; saved-message, pinned-message and shared-file views.
- Sender identities, quoted replies, reactions, acknowledgments, edit labels, soft deletion and reporting.
- Saved drafts on the member's device, cleared at sign-out; sending/sent/failure feedback, manual retry, and idempotent send requests.
- Private files up to 15 MB: JPG/PNG/WebP, PDF, plain text, supported audio and MP4. Short-lived links require conversation access. Voice notes record for up to two minutes on supported HTTPS browsers.
- Polls with 2–10 choices, participant mentions, leader-only whole-group mentions, event sharing and event RSVPs in the existing Events tab. Recurring-event RSVPs apply to the event series.
- Named planning groups and topics, announcement-only mode, leader transfer, participant management, archive/reopen, and a clear notice that participants can see existing history. Topics inherit their initial participants; removal from a parent also revokes access to its topics.
- Chat mute, quiet hours with time-zone selection, private-message blocking and invitation preferences. Honorific church titles do not grant permissions.
- Push recipient access rechecked server-side, per-device delivery claims, expired subscription cleanup, and retryable failures. Notifications hide private message bodies.
- Administrator Messaging health panel: reported messages and recent push attempt states.
- Notification links work with both the query-string format and earlier hash links.

## Safety layer added on top (messaging-plus-migration.sql)

Run **messaging-plus-migration.sql** right after messaging-upgrade.sql (the desktop file "29-NEW-messaging-upgrade-and-safety" has both). It adds:

- **Ask me first.** A member can choose who may start a private chat: any approved member, ask me first (the person accepts, declines or blocks; the sender may send one message until accepted), or no one (ministry groups still work). Groups invitations follow the same choice.
- **Youth rules.** Members under 18 (from a private date of birth the member enters once, or an administrator sets) cannot start or continue private chats with adults, and are hidden from adults in the directory. An administrator can link a parent or guardian, who can read (never reply in) the young member's conversations. A member with no date of birth saved counts as an adult.
- **Announcements.** Pin a church-wide broadcast, give it an expiry date, and members tap "I've seen this"; administrators and pastors see how many have.
- **Who is coming.** Administrators can see the names behind event RSVPs.
- **Messaging health** also shows how many members have notifications on and how many message requests are waiting.
- **Larger text** and a step-by-step notification guide for older members.

One fix to the original upgrade: push subscription ids in this app are numbers, so the per-device push tracking uses bigint ids (the first version used uuid ids and would have failed on a real project).

## Update an existing project

1. Back up the Supabase project. Publish this branch to a staging deployment first.
2. Run **messaging-upgrade.sql** in the Supabase SQL Editor after all existing migrations. It is additive and re-runnable. Existing messages, users and church records remain intact.
3. Deploy the updated `send-message-push` Edge Function using the existing VAPID/webhook secrets. Its new checked recipient and delivery functions require the migration.
4. Deploy the complete frontend from this repository. Deploy the SQL and frontend together: older frontends that directly insert messages cannot bypass the new checked send action.
5. Verify two real approved member accounts, leader/member posting permissions, a private attachment, notifications with the recipient app closed, and a muted/quiet-hours conversation. Keep production on the old version until staging passes.

For a new project, run the two existing files in `fresh-install/` in order. Part 2 includes this update. Provision the first administrator through the existing setup flow. No Supabase credentials or live database configuration were changed by this code update.

## Checks

Run `npm ci`, then `npm test` from the repository root. Tests apply the full current schema in embedded Postgres, re-run the migration, check cross-church isolation and messaging permissions, and execute the actual Edge Function code with fake network/database services. The edge test's fake inserts now generate IDs like Postgres does.

Browser QA uses `tests/messaging-preview-data.js` as a fictional local data adapter, never as a production backend. The app was checked for conversation loading, sending, failed-send draft preservation and saved-message filtering. Device microphone capture, real private-file storage and real phone push delivery still require the staging checks above.

## Accurate limits

- SMS continues to open the sender's phone messaging app. No automatic SMS gateway or reply synchronization is included.
- Voice notes include audio playback; automatic transcripts require a separately configured speech service and are not advertised as active.
- Push “accepted” means the push service accepted it, not delivered/read. Quiet-hours notifications are suppressed; messages remain in the app. No deferred reminder queue is claimed.
- Individual blocks affect private messages/invitations; they do not hide shared ministry conversations. Group reports go to administrators; they do not automatically delete content.
- Youth rules cover private chats and what a guardian can read. Ministry group chats are not age-restricted; leaders decide who is in each group. Confidential pastoral case management is not included.
- Drafts retain message text, not unsent file bytes or recordings. Files uploaded but never sent can remain in the private bucket; configure retention cleanup as appropriate.

## Review and deployment

The review branch retains the entire application, rather than a replacement messaging demo. Merge and production database deployment are separate steps. Existing feature flags, membership approvals and church isolation remain enforced.
