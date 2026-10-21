# Phase 10 Messaging: phone SMS handoff + opt-in preferences

1. Run `phase10-sms-migration.sql` in the Supabase SQL Editor after existing messaging migrations.
2. Deploy this package to your preview branch, not production.
3. Have a member sign in to `connect.html` and save their phone number and SMS opt-in under My Profile.
4. Start or open a conversation. Check **Also send as text** and choose whether to text only people without the app.
5. Send the in-app message, then tap the **Open messaging app** link to send SMS manually.

## What works
- Existing in-app messages, unread counts, ministry chat and directory stay in place.
- Consent-aware phone-number collection and opt-in.
- Recipient filtering for the active conversation.
- A mobile SMS composer handoff.

## Not implemented / limitations
- Automated SMS provider, SMS delivery receipts, webhook replies, STOP processing, quiet-hour queues, and push delivery are **not implemented**.
- The phone SMS handoff does not send texts itself, cannot verify delivery, and cannot import replies.
- Phone SMS URI support for multiple recipients varies by phone; a mobile device is required.
- `conversation_members` must contain participants for SMS recipient lookup; ministry chats that rely on membership without explicit rows may return no numbers.
- Custom recipient lists and reliable server-side subscription gating are future work.
- Production should limit phone number exposure to authorized senders and add auditing, rate limits, and bulk-text safeguards.
