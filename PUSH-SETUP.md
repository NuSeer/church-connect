# Church Connect — Background Push Setup (Phase 11)

## Included
- Service worker handles `push` while PWA is closed, and notification taps open the target conversation.
- Member Profile contains Enable/Disable notification controls, storing one subscription per device.
- Supabase Edge Function sends Web Push to approved recipients of direct and ministry messages.
- SMS remains **Send from My Phone** only; no SMS provider is used.

## REQUIRED setup before push can work
1. In Supabase SQL Editor run `phase11-push-migration.sql` (and `phase10-sms-migration.sql` for SMS), then `phase12-hardening-migration.sql` last (push de-duplication log, staff-member text numbers, explicit access limits).
2. Generate VAPID keys using `npx web-push generate-vapid-keys`. Keep the **private key secret**.
3. The **public** key is already set as `vapidPublicKey` in `config.js`. The matching private key is in `church-connect-vapid-keys.json` on Joy's Desktop; put it only in the Supabase secret below, then move that file somewhere private.
4. Install Supabase CLI and deploy the included function (source: `supabase/functions/send-message-push/index.ts`): `supabase functions deploy send-message-push --no-verify-jwt`. Use the correct linked project. The function itself authenticates the webhook secret.
5. Set Supabase Edge Function secrets `CC_VAPID_PUBLIC_KEY`, `CC_VAPID_PRIVATE_KEY`, `CC_VAPID_CONTACT_EMAIL`, and a long random `CC_PUSH_WEBHOOK_SECRET` with `supabase secrets set` or Dashboard. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must also be available to the function (typically supplied by Supabase). Never put private keys or service_role in GitHub frontend files.
6. In Supabase Dashboard → Database → Webhooks, create a webhook for table `public.messages`, event **INSERT**, pointing to `https://YOUR-PROJECT.supabase.co/functions/v1/send-message-push`. Add header `x-cc-webhook-secret` matching the secret above. Ensure webhook payload includes `type`, `table`, and `record`.
7. Deploy site to HTTPS and install PWA on a test phone. On iOS use Safari → Add to Home Screen, then open the installed PWA. Sign in as approved member and select **Enable notifications** under My Profile.
8. Send a direct or ministry message from a *different* approved account while the recipient PWA is closed. Confirm the notification appears and opens the conversation.

## Important limitations
- This package is code + setup, **not a live deployed or end-to-end tested service**. Push cannot work until Supabase secrets, function, webhook and VAPID keys are configured.
- OS/browser permission, connectivity, battery restrictions and platform push policies can delay or block notifications. Web Push is not guaranteed delivery.
- The current project is single-church; multi-tenant isolation and subscription enforcement remain required for commercial deployment.
- Quiet hours, emergency overrides, push delivery receipts, message deduplication, and custom recipient lists are not yet implemented.
- Supabase webhook retries may duplicate a notification; add idempotency and a delivery log before production.
- Notification bodies intentionally hide message text for privacy.
- For phone SMS handoff, native SMS app behavior and multiple recipients vary by device. Replies stay in the native messaging app.
