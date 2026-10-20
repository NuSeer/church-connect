# Phase 2 setup and limits

1. Deploy this folder on an HTTPS static host (Netlify, Vercel or VPS).
2. Follow SETUP-NEW.md to configure Supabase and run schema.sql, then run schema-phase2.sql. Existing admin user permissions apply to giving links.
3. Sign in at admin.html, select Giving links and add a verified HTTPS donation page from your church’s payment provider. The app does not collect payment card details or record donations. Recurring gifts are only available if the payment provider supports them.
4. Admin events and announcements populate the public calendar and update feed. Recurring weekly/monthly events are expanded client-side up to 12 months. Calendar downloads use a one-hour placeholder duration because event end time is not in the current schema.
5. Browser notifications only occur for newly observed published announcements while the website is open and notification permission is granted. No SMS, email, background push, delivery queue, or subscriber management is implemented.
6. The site is installable as a PWA on supported browsers using HTTPS and the included icons. Offline fallback is limited; live data still needs internet.
7. The design remains the existing Phase 1 styling until a visual direction is selected.

Security: never place Supabase service-role keys in config.js. Only authenticated admins should edit content, enforced by row-level security. Review provider URLs before publishing.
