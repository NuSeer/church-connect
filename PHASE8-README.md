# Integrated Website Studio update

1. Deploy these files to the `redesign-preview` branch only.
2. Run `phase8-media-migration.sql` in the Supabase SQL editor. The Phase 5 website migration must already be installed.
3. Log in as a church administrator on the **same preview domain**.
4. Open `/website-editor.html`, upload an image, add sections, save draft, inspect preview, and publish.
5. Check the public page on preview. Uploaded images are publicly readable by design. Do not upload private member photos without consent.

New: upload PNG/JPEG/WebP logo and hero images (8MB maximum), section builder with text/image/split/CTA blocks, duplicate, reorder, remove, draft preview and published rendering. The existing palettes, Giving Center and membership files are retained.

Important limits: upload controls cover logo and hero; custom section images currently use URL input (paste uploaded media URL). This is not yet a full multi-tenant media library, and the existing database schema remains a single-website record. Test access and publishing in Supabase before production use.
