-- Run in Supabase SQL Editor after the earlier Church Connect schema migrations.
-- Independent ministries; optional naming terminology is a display preference only.
create table if not exists public.church_organization_preferences (
 id boolean primary key default true check (id), group_term text not null default 'Ministry' check (group_term in ('Ministry','Department'))
);
insert into public.church_organization_preferences(id) values(true) on conflict do nothing;
create table if not exists public.member_church_titles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 title_mode text not null default 'none' check(title_mode in ('title','none')),
 titles text[] not null default '{}',
 primary_title text,
 courtesy_title text not null default 'Sis.' check(courtesy_title in ('Bro.','Sis.')),
 verified_titles text[] not null default '{}',
 updated_at timestamptz not null default now(),
 constraint primary_is_selected check (primary_title is null or primary_title = any(titles))
);
create table if not exists public.ministry_join_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 ministry_id uuid not null references public.ministries(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 requested_at timestamptz not null default now(),
 primary key(user_id,ministry_id)
);
-- Admins approve by adding a row to ministry_members; requests never grant access.
alter table public.member_church_titles enable row level security;
alter table public.ministry_join_requests enable row level security;
alter table public.church_organization_preferences enable row level security;
create policy "Member reads own titles" on public.member_church_titles for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.church_admins a where a.user_id=auth.uid()));
create policy "Member creates own titles" on public.member_church_titles for insert to authenticated with check(user_id=auth.uid() and coalesce(array_length(verified_titles,1),0)=0);
create policy "Member edits own titles" on public.member_church_titles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
-- IMPORTANT: verified_titles must never be user-writable; column-level grant restrictions below.
revoke update on public.member_church_titles from authenticated;
grant update (title_mode,titles,primary_title,courtesy_title,updated_at) on public.member_church_titles to authenticated;
revoke insert on public.member_church_titles from authenticated;
grant insert (user_id,title_mode,titles,primary_title,courtesy_title,updated_at) on public.member_church_titles to authenticated;
create policy "Member reads own requests" on public.ministry_join_requests for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.church_admins a where a.user_id=auth.uid()));
revoke update on public.ministry_join_requests from authenticated;
create policy "Member creates request" on public.ministry_join_requests for insert to authenticated with check(user_id=auth.uid() and status='pending');
-- No member update policy: approved/rejected status can only be set by trusted server/admin.
create policy "Read group terminology" on public.church_organization_preferences for select to authenticated using(true);
-- Use server-side privileged actions for administrator approvals and title verification.
