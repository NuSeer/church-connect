# Phase 6 — Website Studio design and Giving Center

## Changes
- Website Studio is linked from Administration Center.
- Three responsive visual templates, two brand colors, hero image URL, and preview.
- Giving Center provider enable/disable and HTTPS URLs: Givelify, Tithe.ly, Cash App, PayPal, Other Provider.
- Giving links appear on the public site after publishing.
- Uses the existing Phase 5 draft/publish database schema; no new migration needed if Phase 5 was run.

## Deployment
1. Upload all files to `redesign-preview` and wait for the preview deployment.
2. Sign in at `/admin-center.html` and open Website Studio.
3. Choose a template, enter your own licensed/owned hero image URL, and configure verified giving URLs.
4. Save draft, inspect preview, then publish. Test mobile and public page.

## Limitations / remaining work
- These templates are a first implementation inspired by the supplied reference screenshots, not copies of their copyrighted branding or photos.
- Website Studio remains a separate page linked inside the administration dashboard, not an embedded dashboard tab yet.
- The site still uses a single-church database schema, not production-ready multi-tenancy.
- Giving links are outbound only; no contribution reporting or payment provider APIs.
- Member-only directory and its RLS/privacy settings need a separate audit and end-to-end testing.
- User needs to test Supabase authentication, permissions, publishing and device responsiveness.
