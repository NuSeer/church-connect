# Sanctuary Studio test build

This build adds a refreshed Sanctuary Studio interface, section navigation, desktop/mobile preview, pastor photograph upload, and clearer publish guidance. Existing Church Connect features are retained from the prior publishing-and-pastor package.

## Test on preview only
1. Back up your current branch. Upload the contents of this ZIP to the `redesign-preview` branch of `NuSeer/church-connect` (not `NuSeer/the-church`).
2. Run the existing `phase5-website-migration.sql` and `phase8-media-migration.sql` in Supabase if not already run.
3. Sign in on the preview deployment and open `/website-editor.html`.
4. Confirm the new Sanctuary Studio toolbar and section tabs work.
5. Upload a pastor photo, fill in pastor name, save draft, preview and publish.
6. Open `/index.html` on that same preview deployment to verify published content.

## Limitations
The hosted preview has not been browser-tested against your live Supabase instance. Publishing uses the existing Supabase RPC and only updates the connected Church Connect website; it does not deploy to arbitrary domains. Independent church domains, portable self-hosting, and multi-tenant data isolation need backend work before commercial sale. Do not treat this build as commercially production-ready.
