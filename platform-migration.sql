-- Generic platform: church settings, invites, and platform-owner tools. Run AFTER photos-security-migration.sql. Safe to re-run.
-- Church Connect is the product; each church is a tenant. This file moves church-specific settings out of the code and into the database,
-- adds email invites (approved automatically on sign-up), and gives the platform owner a church list, church creation by email,
-- a demo church for showing the product, and "open as administrator" for support.

-- ===== 1. Church settings ========================================================================================
alter table public.churches add column if not exists website_url text;
alter table public.churches drop constraint if exists churches_website_url_ck;
alter table public.churches add constraint churches_website_url_ck check (website_url is null or website_url ~* '^https://[a-z0-9.-]+(:[0-9]+)?(/[^\s]*)?$');

create or replace function public.cc_update_church_settings(p_name text, p_website_url text, p_timezone text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_url text := nullif(trim(coalesce(p_website_url,'')),''); v_host text;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 150 then raise exception 'The church name must be 2–150 characters'; end if;
 if v_url is not null then
  if length(v_url)>300 or v_url !~* '^https://[a-z0-9.-]+(:[0-9]+)?(/[^\s]*)?$' then raise exception 'Use a full https:// web address, or leave it blank'; end if;
  v_host := lower(substring(v_url from '^https://([^/:]+)'));
  if v_host !~ '\.' or v_host ~ '^[0-9.]+$' or v_host = 'localhost' or v_host ~ '\.(local|internal|localhost)$' then raise exception 'Use the public address of your church website'; end if;
 end if;
 if p_timezone is not null and not exists(select 1 from pg_timezone_names where name = p_timezone) then raise exception 'Unknown time zone'; end if;
 update public.churches set name = trim(p_name), website_url = v_url, events_timezone = coalesce(p_timezone, events_timezone) where id = public.cc_my_church_id();
end $$;
revoke all on function public.cc_update_church_settings(text,text,text) from public;
grant execute on function public.cc_update_church_settings(text,text,text) to authenticated;

-- ===== 2. Invites (approved automatically when the invited email signs up) =======================================
create table if not exists public.cc_invites (
 id uuid primary key default gen_random_uuid(),
 church_id uuid not null references public.churches(id) on delete cascade,
 email text not null check (email = lower(email) and length(email) <= 254),
 role text not null check (role in ('member','pastor','admin')),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 used_at timestamptz
);
create index if not exists cc_invites_email_idx on public.cc_invites(email) where used_at is null;
alter table public.cc_invites enable row level security;
revoke all on public.cc_invites from anon, authenticated;
grant select on public.cc_invites to authenticated;
drop policy if exists cc_invites_admin_read on public.cc_invites;
create policy cc_invites_admin_read on public.cc_invites for select to authenticated using (church_id = public.cc_my_church_id() and public.cc_is_admin());

create or replace function public.cc_invite_member(p_email text, p_role text default 'member') returns uuid
language plpgsql security definer set search_path='' as $$
declare v_email text := lower(trim(coalesce(p_email,''))); v_church uuid := public.cc_my_church_id(); v_id uuid;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'Enter a valid email address'; end if;
 if p_role not in ('member','pastor') then raise exception 'Choose Member or Pastor'; end if;
 if exists(select 1 from auth.users u join public.member_profiles p on p.user_id = u.id where lower(u.email) = v_email and p.church_id = v_church) then
  raise exception 'That person is already a member of your church'; end if;
 delete from public.cc_invites where church_id = v_church and email = v_email and used_at is null;
 insert into public.cc_invites(church_id, email, role, created_by) values (v_church, v_email, p_role, auth.uid()) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cc_invite_member(text,text) from public;
grant execute on function public.cc_invite_member(text,text) to authenticated;

create or replace function public.cc_cancel_invite(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 delete from public.cc_invites where id = p_id and church_id = public.cc_my_church_id() and used_at is null;
end $$;
revoke all on function public.cc_cancel_invite(uuid) from public;
grant execute on function public.cc_cancel_invite(uuid) to authenticated;

-- Sign-up: an invite for the person's email approves them (and gives pastor/administrator access) in the invited church.
drop function if exists public.create_my_profile(text, uuid);
create or replace function public.create_my_profile(n text, p_church uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare v uuid; v_email text := lower(coalesce(auth.jwt() ->> 'email','')); inv record; made int;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into inv from public.cc_invites where email = v_email and used_at is null and (p_church is null or church_id = p_church) order by created_at desc limit 1;
 v := coalesce(p_church, inv.church_id, (select id from public.churches where (select count(*) from public.churches) = 1));
 if v is null or not exists(select 1 from public.churches where id = v) then raise exception 'Choose a church to join'; end if;
 if not public.cc_church_writable(v) then raise exception 'This church is not accepting new members right now'; end if;
 insert into public.member_profiles(user_id, display_name, church_id) values (auth.uid(), left(trim(n),100), v) on conflict(user_id) do nothing;
 get diagnostics made = row_count;
 if made = 1 and inv.id is not null and inv.church_id = v then
  update public.member_profiles set approved = true where user_id = auth.uid();
  if inv.role in ('pastor','admin') then
   if inv.role = 'pastor' and not exists(select 1 from public.member_roles where user_id = auth.uid() and role = 'pastor') then
    insert into public.member_roles(user_id, role, church_id) values (auth.uid(), 'pastor', v); end if;
   if not exists(select 1 from public.church_admins where user_id = auth.uid()) then insert into public.church_admins(user_id, church_id) values (auth.uid(), v); end if;
  end if;
  update public.cc_invites set used_at = now() where id = inv.id;
 end if;
end $$;
revoke all on function public.create_my_profile(text, uuid) from public;
grant execute on function public.create_my_profile(text, uuid) to authenticated;

-- ===== 3. Platform owner tools ===================================================================================
alter table public.cc_platform_admins add column if not exists home_church_id uuid references public.churches(id) on delete set null;
create table if not exists public.cc_platform_audit (
 id bigint generated always as identity primary key,
 user_id uuid, action text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
alter table public.cc_platform_audit enable row level security;
revoke all on public.cc_platform_audit from anon, authenticated;

create or replace function public.cc_platform_overview() returns table(id uuid, name text, slug text, created_at timestamptz, plan text, status text, trial_ends_at timestamptz,
  current_period_end timestamptz, members bigint, administrators bigint, is_current boolean, is_home boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.cc_is_platform_admin() then raise exception 'Platform administrator access required'; end if;
 return query
 select c.id, c.name, c.slug, c.created_at, s.plan, s.status, s.trial_ends_at, s.current_period_end,
  (select count(*) from public.member_profiles p where p.church_id = c.id),
  (select count(*) from public.church_admins a where a.church_id = c.id),
  c.id = public.cc_my_church_id(),
  c.id = (select pa.home_church_id from public.cc_platform_admins pa where pa.user_id = auth.uid())
 from public.churches c left join public.church_subscriptions s on s.church_id = c.id order by c.created_at;
end $$;
revoke all on function public.cc_platform_overview() from public;
grant execute on function public.cc_platform_overview() to authenticated;

create or replace function public.cc_platform_new_church(p_name text, p_slug text, p_status text, p_plan text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 if length(trim(coalesce(p_name,''))) not between 2 and 150 then raise exception 'The church name must be 2–150 characters'; end if;
 if lower(trim(coalesce(p_slug,''))) !~ '^[a-z0-9-]{2,50}$' then raise exception 'The short name may use only letters, numbers and dashes'; end if;
 if exists(select 1 from public.churches where slug = lower(trim(p_slug))) then raise exception 'That short name is already taken'; end if;
 insert into public.churches(name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into v;
 insert into public.church_subscriptions(church_id, plan, status, trial_ends_at) values (v, p_plan, p_status, case when p_status = 'trialing' then now() + interval '30 days' end);
 insert into public.church_settings(church_id, id) values (v, true) on conflict do nothing;
 insert into public.church_organization_preferences(church_id, id) values (v, true) on conflict do nothing;
 return v;
end $$;
revoke all on function public.cc_platform_new_church(text,text,text,text) from public, anon, authenticated;

create or replace function public.cc_platform_create_church_for(p_name text, p_slug text, p_admin_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v uuid; v_email text := lower(trim(coalesce(p_admin_email,''))); u uuid; has_profile boolean;
begin
 if not public.cc_is_platform_admin() then raise exception 'Platform administrator access required'; end if;
 if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter the first administrator''s email address'; end if;
 select id into u from auth.users where lower(email) = v_email limit 1;
 if u is not null then
  select exists(select 1 from public.member_profiles where user_id = u) into has_profile;
  if has_profile then raise exception 'That email already belongs to a member of a church. Use a different email for the new church''s administrator.'; end if;
 end if;
 v := public.cc_platform_new_church(p_name, p_slug, 'trialing', 'trial');
 if u is not null then
  insert into public.member_profiles(user_id, display_name, approved, church_id) values (u, 'Church administrator', true, v);
  insert into public.church_admins(user_id, church_id) values (u, v);
 else
  insert into public.cc_invites(church_id, email, role, created_by) values (v, v_email, 'admin', auth.uid());
 end if;
 insert into public.cc_platform_audit(user_id, action, details) values (auth.uid(), 'create_church', jsonb_build_object('church', v, 'name', trim(p_name), 'admin_email', v_email));
 return jsonb_build_object('church_id', v, 'admin', case when u is not null then 'linked' else 'invited' end);
end $$;
revoke all on function public.cc_platform_create_church_for(text,text,text) from public;
grant execute on function public.cc_platform_create_church_for(text,text,text) to authenticated;

-- A demo church with made-up people, ministries, events and announcements, for showing the product.
create or replace function public.cc_platform_create_demo_church() returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid; m_w uuid; m_m uuid; m_y uuid; m_mu uuid; m_o uuid; d uuid;
begin
 if not public.cc_is_platform_admin() then raise exception 'Platform administrator access required'; end if;
 v := public.cc_platform_new_church('Grace Community Church (demo)', 'demo-' || substr(md5(random()::text), 1, 6), 'active', 'demo');
 insert into public.ministries(church_id, name, description, color) values (v, 'Women''s Ministry', 'Fellowship, study and service', '#be185d') returning id into m_w;
 insert into public.ministries(church_id, name, description, color) values (v, 'Men''s Ministry', 'Prayer breakfasts and mentoring', '#1d4ed8') returning id into m_m;
 insert into public.ministries(church_id, name, description, color) values (v, 'Youth', 'Ages 12–18', '#16a34a') returning id into m_y;
 insert into public.ministries(church_id, name, description, color) values (v, 'Music & Choir', 'Praise team and choir', '#7c3aed') returning id into m_mu;
 insert into public.ministries(church_id, name, description, color) values (v, 'Outreach', 'Community care and food pantry', '#ea580c') returning id into m_o;
 insert into public.church_events(church_id, title, description, starts_at, location, recurrence, published) values
  (v, 'Sunday Worship', 'Join us for worship and the Word.', date_trunc('week', now()) + interval '6 days 15 hours', 'Main Sanctuary', 'weekly', true),
  (v, 'Midweek Bible Study', 'This month: the Book of James.', date_trunc('week', now()) + interval '2 days 23 hours', 'Fellowship Hall', 'weekly', true),
  (v, 'Youth Night', 'Games, worship and pizza.', now() + interval '5 days', 'Youth Center', 'none', true),
  (v, 'Community Food Drive', 'Bring canned goods to the lobby.', now() + interval '12 days', 'Church Lobby', 'none', true),
  (v, 'Choir Rehearsal', 'All voices welcome.', now() + interval '3 days', 'Sanctuary', 'none', true),
  (v, 'Women''s Fellowship Brunch', 'Brunch and testimonies.', now() + interval '19 days', 'Fellowship Hall', 'none', true);
 insert into public.church_announcements(church_id, title, body, pinned, published) values
  (v, 'Welcome to our new church app', 'Message each other, see events and stay connected.', true, true),
  (v, 'Food drive this month', 'Help us fill the pantry before Thanksgiving.', false, true),
  (v, 'Pastor''s message', 'Thank you for a wonderful season of growth and service.', false, true);
 insert into public.cc_directory_members(church_id, full_name, phone, courtesy_title, church_titles, primary_title, sms_consent, active, gender) values
  (v, 'Ruth Adams', '9045550101', 'Sis.', array['Mother'], 'Mother', true, true, 'female') returning id into d;
 insert into public.cc_directory_ministries(member_id, ministry_id, is_leader) values (d, m_w, true);
 insert into public.cc_directory_members(church_id, full_name, phone, courtesy_title, church_titles, primary_title, sms_consent, active, gender) values (v, 'James Carter', '9045550102', 'Bro.', array['Deacon'], 'Deacon', true, true, 'male') returning id into d;
 insert into public.cc_directory_ministries(member_id, ministry_id, is_leader) values (d, m_m, true);
 insert into public.cc_directory_members(church_id, full_name, phone, courtesy_title, church_titles, primary_title, sms_consent, active, gender) values (v, 'Naomi Brooks', '9045550103', 'Sis.', '{}', null, false, true, 'female') returning id into d;
 insert into public.cc_directory_ministries(member_id, ministry_id, is_leader) values (d, m_mu, false);
 insert into public.cc_directory_members(church_id, full_name, phone, courtesy_title, church_titles, primary_title, sms_consent, active, gender) values (v, 'Samuel Reed', '9045550104', 'Bro.', array['Minister'], 'Minister', true, true, 'male') returning id into d;
 insert into public.cc_directory_ministries(member_id, ministry_id, is_leader) values (d, m_y, true);
 insert into public.cc_directory_members(church_id, full_name, phone, courtesy_title, church_titles, primary_title, sms_consent, active, gender) values (v, 'Dorothy Hayes', '9045550105', 'Sis.', array['Missionary'], 'Missionary', true, true, 'female') returning id into d;
 insert into public.cc_directory_ministries(member_id, ministry_id, is_leader) values (d, m_o, true);
 insert into public.cc_directory_members(church_id, full_name, phone, courtesy_title, church_titles, primary_title, sms_consent, active, gender) values (v, 'Marcus Webb', '9045550106', 'Bro.', '{}', null, false, true, 'male') returning id into d;
 insert into public.cc_directory_ministries(member_id, ministry_id, is_leader) values (d, m_y, false);
 insert into public.cc_platform_audit(user_id, action, details) values (auth.uid(), 'create_demo_church', jsonb_build_object('church', v));
 return v;
end $$;
revoke all on function public.cc_platform_create_demo_church() from public;
grant execute on function public.cc_platform_create_demo_church() to authenticated;

-- Open any church as its administrator (support / demos). Your home church is remembered so "Back to my church" works.
-- Your photo reference is cleared when you move (photos are stored per church).
create or replace function public.cc_platform_switch_church(p_church uuid) returns void language plpgsql security definer set search_path='' as $$
declare me uuid := auth.uid(); cur uuid;
begin
 if not public.cc_is_platform_admin() then raise exception 'Platform administrator access required'; end if;
 if not exists(select 1 from public.churches where id = p_church) then raise exception 'Church not found'; end if;
 select church_id into cur from public.member_profiles where user_id = me;
 update public.cc_platform_admins set home_church_id = coalesce(home_church_id, cur) where user_id = me;
 if cur is null then
  insert into public.member_profiles(user_id, display_name, approved, church_id) values (me, 'Platform administrator', true, p_church);
 else
  update public.member_profiles set church_id = p_church, approved = true, photo_path = null, photo_visible = false where user_id = me;
 end if;
 delete from public.church_admins where user_id = me;
 insert into public.church_admins(user_id, church_id) values (me, p_church);
 insert into public.cc_platform_audit(user_id, action, details) values (me, 'switch_church', jsonb_build_object('from', cur, 'to', p_church));
end $$;
revoke all on function public.cc_platform_switch_church(uuid) from public;
grant execute on function public.cc_platform_switch_church(uuid) to authenticated;
