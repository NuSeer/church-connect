Church Connect publishing and pastor information patch.

IMPORTANT: This package does NOT publish to the separate GitHub Pages site at nuseer.github.io/the-church. Publishing via cc_publish_website updates Supabase content used by the Church Connect website-public.js on the deployed Church Connect site. Deploy the same package to the intended site and use its own URL.

Added Pastor Name, Title, Message, Photo URL to editor preview and public website. Publish now checks cc_public_website response after RPC; a successful DB publish does not prove a different domain is updated.

Run existing Phase 5 migration if not installed. Test on redesign-preview; do not replace production until verified.
