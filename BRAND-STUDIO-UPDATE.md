# Brand Studio restoration update

## Included
- 24 named palettes with editable primary/accent colors.
- Four font presets, visible in draft preview and published public page.
- Fixed missing editor controls for logo URL, header logo placement, hero logo placement, logo width, photo placement, focal point, and overlay.
- All settings are stored in the existing draft/published JSON using the Phase 5 Supabase RPCs. No new SQL required.

## Deploy
1. Commit files to `redesign-preview` only.
2. Ensure `phase5-website-migration.sql` was previously applied.
3. Open `/website-editor.html` on the preview deployment and sign in as an admin.
4. Choose a palette, adjust logo/photo layout, save draft, then publish and check the public page.

## Limitations
- Logo and photo are HTTPS URL fields, not direct file uploads.
- Four font presets, not custom font uploading.
- The editor still opens from the administration dashboard rather than being embedded inside it.
- Requires live Supabase and browser testing.
- Other pending items: ministry messaging permissions, privacy/RLS audit, multi-church tenancy, advanced page builder.
