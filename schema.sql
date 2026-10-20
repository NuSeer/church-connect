-- Run in Supabase SQL editor. Create an admin account in Authentication > Users.
create table if not exists public.church_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.church_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 180),
  description text not null default '',
  starts_at timestamptz not null,
  location text not null default '',
  recurrence text not null default 'none' check (recurrence in ('none','weekly','monthly')),
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.church_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 180),
  body text not null default '',
  pinned boolean not null default false,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.church_admins enable row level security;
alter table public.church_events enable row level security;
alter table public.church_announcements enable row level security;
create or replace function public.is_church_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.church_admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_church_admin() from public;
grant execute on function public.is_church_admin() to authenticated;
create policy "Admins see their own role" on public.church_admins for select to authenticated using (user_id = (select auth.uid()));
create policy "Public events read" on public.church_events for select to anon, authenticated using (published or public.is_church_admin());
create policy "Admin events insert" on public.church_events for insert to authenticated with check (public.is_church_admin());
create policy "Admin events update" on public.church_events for update to authenticated using (public.is_church_admin()) with check (public.is_church_admin());
create policy "Admin events delete" on public.church_events for delete to authenticated using (public.is_church_admin());
create policy "Public announcements read" on public.church_announcements for select to anon, authenticated using (published or public.is_church_admin());
create policy "Admin announcements insert" on public.church_announcements for insert to authenticated with check (public.is_church_admin());
create policy "Admin announcements update" on public.church_announcements for update to authenticated using (public.is_church_admin()) with check (public.is_church_admin());
create policy "Admin announcements delete" on public.church_announcements for delete to authenticated using (public.is_church_admin());
-- AFTER creating a user, grant admin manually in SQL editor:
-- insert into public.church_admins(user_id) values ('PASTE-AUTH-USER-UUID');
