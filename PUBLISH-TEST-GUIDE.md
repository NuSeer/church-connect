# Publish & Live Website — Test Guide

1. Deploy all files from this package to your `redesign-preview` branch.
2. Open `/website-editor.html` on the *preview deployment URL*, not the old GitHub Pages site.
3. Confirm the `phase5-website-migration.sql` has been applied to your Supabase database.
4. Sign in with a church administrator account and enable **Public website enabled**.
5. Change Church name and Hero headline. Click **Publish website**.
6. Look for **Published and verified**, then click **Open published website**.
7. If there is an error, copy the exact status message. It identifies save, publish, or verification failure.

Important: publishing saves content to the configured Supabase instance. It does not deploy files to a different website provider. Each church’s custom hosting requires a separately configured publishing adapter. The existing database schema is single-church, not production multi-tenant.

Changes in this patch:
- Live links target index.html on the SAME deployment as the editor and include a cache-busting query parameter.
- Publish button reports save, publish, and verification errors and prevents repeated clicks.
- Publishing is blocked with a clear explanation if the public website is disabled.
- Published church name, pastor name, and hero headline are verified before success is reported.
