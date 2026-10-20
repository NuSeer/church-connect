# Church Connect — Phase 5: Website Studio

## Scope
A **single-church** optional public website editor: church name, tagline, headline, welcome text, service details, contact email, address, draft preview, save/publish, and website enable/disable. Public events and announcements continue using existing modules. The editor is restricted to `church_admins` via authentication and database RPC checks.

## Deploy
1. Upload the full `church-connect-main` folder contents to `redesign-preview` (preserve file locations at the site root).
2. In Supabase SQL Editor, run `phase5-website-migration.sql` **after** `membership-migration.sql`.
3. Wait for Vercel preview deployment to be Ready.
4. Open `/website-editor.html` on the **same preview domain** and sign in as an administrator.
5. Save a draft, inspect the on-page preview, publish, then visit `/index.html` to confirm the changes.
6. Test the enable/disable control; `/connect.html` should remain reachable.

## Security and limitations
- **This is not multi-tenant isolation.** The existing project schema is single-church. Do not onboard multiple independent churches to the same database without a tenant-ID and RLS redesign.
- The public endpoint `cc_public_website` exposes only published content. Drafts are admin-only.
- The editor does not yet support media upload, page creation/reordering, navigation editing, custom domains, logos, 24 brand palettes, or full role-delegated editing. Those are separate features.
- `cc_website_content` row access is administrator-only; modifications are through checked RPC functions. Never place service-role keys in browser JavaScript.
- Existing hardcoded public page content is fallback when there is no published website record.
- This package was syntax-checked locally but not tested against your Supabase or Vercel deployment.
