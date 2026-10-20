# Church Connect restoration update

This update builds on Phase 6 and adds independent logo and hero-photo controls to Website Studio.

## Implemented
- Header logo URL, left/center/right/full-width placement and width
- Optional hero logo, independently placed
- Hero photo full/left/right/center layouts, focal point and overlay
- Live preview and published-site rendering for those settings
- Existing draft/publish JSON functions persist the new settings without schema changes

## Not implemented or verified
- Direct file upload / storage, full drag-and-drop page builder, 24 palettes
- Messaging ministry dropdown authorization fix
- Membership field-level security and full end-to-end Supabase tests
- Production deployment

## Installation
Upload to redesign-preview only. The existing phase5 website migration must already be installed. Open /website-editor.html, save draft and publish. Test mobile and desktop on preview. Do not overwrite production until validated.
