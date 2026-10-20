# Church App — Upgraded Phase 1

## Included
- `index.html`: redesigned, responsive public ministry site
- `admin.html`: secure staff sign-in and CRUD management for events and announcements
- `schema.sql`: database schema and row-level security policies
- `config.js`: editable church identity and public Supabase project settings
- `public.js`, `admin.js`, `data.js`, `app.css`: application code
- Original prototype pages are retained for reference only; do not publish the old `admin-dashboard.html` because it has an insecure hardcoded password and nonfunctional save actions.

## Setup
1. Create a Supabase project. In SQL Editor, run `schema.sql`.
2. In Supabase Authentication > Users, create a staff user. Disable public email signup in Auth settings unless needed.
3. Run `insert into public.church_admins(user_id) values ('YOUR-USER-UUID');` in SQL Editor, substituting the user's Authentication UUID.
4. In `config.js`, enter Supabase Project URL and **publishable / anon** key. Never use a service-role or secret key in client code.
5. Set church name and tagline in `config.js`.
6. Upload the files to Netlify, Vercel, or a web server. Open `index.html` for the public site and `admin.html` for staff login. Use HTTPS.
7. For instant cross-browser updates, enable Supabase Realtime replication for `church_events` and `church_announcements`. Otherwise public pages refresh data every minute, and on page reload.

## Notes
- A connected Supabase project is required for real sign-in and persistent changes. The included zip does not contain credentials or a live backend.
- Recurring events are generated in the public view for six months, supporting weekly and monthly repeats. Monthly events on the 29th–31st shift to the last day of shorter months; edit the event to adjust the series.
- This phase focuses on the three requested areas only. Original prayer/member/giving/notification prototypes remain separate and are not connected to this database.
- Do not rely on the original service worker for this new interface until its cache list is updated.
