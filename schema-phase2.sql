-- Run AFTER schema.sql in Supabase SQL editor.
create table if not exists public.church_giving_links (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(title) between 1 and 120),
 description text not null default '',
 url text not null check(url ~ '^https://[^[:space:]]+$'),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.church_giving_links enable row level security;
create policy "Public active giving links" on public.church_giving_links for select to anon,authenticated using(active or public.is_church_admin());
create policy "Admin giving links insert" on public.church_giving_links for insert to authenticated with check(public.is_church_admin());
create policy "Admin giving links update" on public.church_giving_links for update to authenticated using(public.is_church_admin()) with check(public.is_church_admin());
create policy "Admin giving links delete" on public.church_giving_links for delete to authenticated using(public.is_church_admin());
-- Optional: enable Realtime publication for events/announcements/giving links in Supabase Dashboard.
