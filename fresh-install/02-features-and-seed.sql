-- Church Connect: new project setup, part 2 of 2 (features and first church). Run AFTER part 1.

-- ===== phase4-migration.sql =====
-- Run in Supabase SQL Editor after the earlier Church Connect schema migrations.
-- Independent ministries; optional naming terminology is a display preference only.
create table if not exists public.church_organization_preferences (
 id boolean primary key default true check (id), group_term text not null default 'Ministry' check (group_term in ('Ministry','Department'))
);
-- (one-row-per-church settings are seeded by the multi-church step below)
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
drop policy if exists "Member reads own titles" on public.member_church_titles;
create policy "Member reads own titles" on public.member_church_titles for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.church_admins a where a.user_id=auth.uid()));
drop policy if exists "Member creates own titles" on public.member_church_titles;
create policy "Member creates own titles" on public.member_church_titles for insert to authenticated with check(user_id=auth.uid() and coalesce(array_length(verified_titles,1),0)=0);
drop policy if exists "Member edits own titles" on public.member_church_titles;
create policy "Member edits own titles" on public.member_church_titles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
-- IMPORTANT: verified_titles must never be user-writable; column-level grant restrictions below.
revoke update on public.member_church_titles from authenticated;
grant update (title_mode,titles,primary_title,courtesy_title,updated_at) on public.member_church_titles to authenticated;
revoke insert on public.member_church_titles from authenticated;
grant insert (user_id,title_mode,titles,primary_title,courtesy_title,updated_at) on public.member_church_titles to authenticated;
drop policy if exists "Member reads own requests" on public.ministry_join_requests;
create policy "Member reads own requests" on public.ministry_join_requests for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.church_admins a where a.user_id=auth.uid()));
revoke update on public.ministry_join_requests from authenticated;
drop policy if exists "Member creates request" on public.ministry_join_requests;
create policy "Member creates request" on public.ministry_join_requests for insert to authenticated with check(user_id=auth.uid() and status='pending');
-- No member update policy: approved/rejected status can only be set by trusted server/admin.
drop policy if exists "Read group terminology" on public.church_organization_preferences;
create policy "Read group terminology" on public.church_organization_preferences for select to authenticated using(true);
-- Use server-side privileged actions for administrator approvals and title verification.

-- ===== membership-migration.sql =====
-- Run after schema-phase3.sql and phase4-migration.sql.
-- Administrative mutations are confined to authenticated church administrators.
create or replace function public.cc_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.church_admins where user_id=auth.uid());
$$;
revoke all on function public.cc_is_admin() from public;
grant execute on function public.cc_is_admin() to authenticated;

-- Admin read access for membership review. Existing member self-access policies remain.
drop policy if exists "cc_admin_read_profiles" on public.member_profiles;
create policy "cc_admin_read_profiles" on public.member_profiles for select to authenticated using(public.cc_is_admin());
drop policy if exists "cc_admin_read_memberships" on public.ministry_members;
create policy "cc_admin_read_memberships" on public.ministry_members for select to authenticated using(public.cc_is_admin());
drop policy if exists "cc_admin_read_requests" on public.ministry_join_requests;
create policy "cc_admin_read_requests" on public.ministry_join_requests for select to authenticated using(public.cc_is_admin());
drop policy if exists "cc_admin_read_titles" on public.member_church_titles;
create policy "cc_admin_read_titles" on public.member_church_titles for select to authenticated using(public.cc_is_admin());

-- One narrow admin-only RPC for approvals and ministry assignments.
create or replace function public.cc_manage_member(
 p_user_id uuid, p_action text, p_ministry_id uuid default null, p_leader boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Not authorized'; end if;
 if not exists(select 1 from public.member_profiles where user_id=p_user_id) then raise exception 'Member not found'; end if;
 if p_action='approve_member' then
  update public.member_profiles set approved=true where user_id=p_user_id;
 elsif p_action='suspend_member' then
  if p_user_id=auth.uid() then raise exception 'You cannot suspend yourself'; end if;
  update public.member_profiles set approved=false where user_id=p_user_id;
  delete from public.ministry_members where user_id=p_user_id;
 elsif p_action='approve_ministry' then
  if p_ministry_id is null then raise exception 'Ministry required'; end if;
  if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true) then raise exception 'Approve member first'; end if;
  insert into public.ministry_members(ministry_id,user_id,is_leader) values(p_ministry_id,p_user_id,false)
   on conflict(ministry_id,user_id) do nothing;
  update public.ministry_join_requests set status='approved' where ministry_id=p_ministry_id and user_id=p_user_id;
 elsif p_action='reject_ministry' then
  update public.ministry_join_requests set status='rejected' where ministry_id=p_ministry_id and user_id=p_user_id and status='pending';
 elsif p_action='remove_ministry' then
  delete from public.ministry_members where ministry_id=p_ministry_id and user_id=p_user_id;
  delete from public.ministry_join_requests where ministry_id=p_ministry_id and user_id=p_user_id;
 elsif p_action='set_leader' then
  update public.ministry_members set is_leader=p_leader where ministry_id=p_ministry_id and user_id=p_user_id;
  if not found then raise exception 'Approve ministry membership first'; end if;
 else raise exception 'Unknown action'; end if;
end; $$;
revoke all on function public.cc_manage_member(uuid,text,uuid,boolean) from public;
grant execute on function public.cc_manage_member(uuid,text,uuid,boolean) to authenticated;

-- Official title verification: never accept verification from the member's browser.
create or replace function public.cc_verify_titles(p_user_id uuid, p_titles text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare permitted text[] := array['Pastor','First Lady','Minister','Elder','Missionary','Mother','Evangelist','Deacon','Deaconess'];
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Not authorized'; end if;
 if exists(select 1 from unnest(coalesce(p_titles,'{}'::text[])) t where not t=any(permitted)) then raise exception 'Invalid title'; end if;
 insert into public.member_church_titles(user_id,verified_titles) values(p_user_id,coalesce(p_titles,'{}'::text[]))
 on conflict(user_id) do update set verified_titles=excluded.verified_titles;
end; $$;
revoke all on function public.cc_verify_titles(uuid,text[]) from public;
grant execute on function public.cc_verify_titles(uuid,text[]) to authenticated;

-- Fix phase4 member self-service: do not let members reset approved/rejected requests via upsert.
-- They can create a new request only if no previous request exists.
-- Never grant general UPDATE on join requests to authenticated members.

-- ===== directory-ministry-migration.sql =====
-- Run AFTER phase4-migration.sql and membership-migration.sql.
-- Staff-entered people do not require Supabase Auth accounts.
-- They are NOT automatically authorized to read private app messages.
create table if not exists public.cc_directory_members (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check(length(trim(full_name)) between 2 and 150),
 phone text, email text, courtesy_title text not null default 'Sis.' check(courtesy_title in ('Bro.','Sis.')),
 church_titles text[] not null default '{}',
 primary_title text,
 notes text,
 sms_consent boolean not null default false,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint cc_directory_primary_title check(primary_title is null or primary_title=any(church_titles)),
 constraint cc_directory_contact check(phone is null or length(phone)<=30),
 constraint cc_directory_email check(email is null or length(email)<=254)
);
create table if not exists public.cc_directory_ministries (
 member_id uuid not null references public.cc_directory_members(id) on delete cascade,
 ministry_id uuid not null references public.ministries(id) on delete cascade,
 is_leader boolean not null default false,
 primary key(member_id,ministry_id)
);
alter table public.cc_directory_members enable row level security;
alter table public.cc_directory_ministries enable row level security;
drop policy if exists "cc_directory_admin_read" on public.cc_directory_members;
create policy "cc_directory_admin_read" on public.cc_directory_members for select to authenticated using(public.cc_is_admin());
drop policy if exists "cc_directory_ministries_admin_read" on public.cc_directory_ministries;
create policy "cc_directory_ministries_admin_read" on public.cc_directory_ministries for select to authenticated using(public.cc_is_admin());
-- Writes are only allowed through tightly scoped, admin-checked functions.
revoke insert,update,delete on public.cc_directory_members from anon,authenticated;
revoke insert,update,delete on public.cc_directory_ministries from anon,authenticated;
create or replace function public.cc_save_directory_member(
 p_id uuid, p_name text, p_phone text, p_email text, p_courtesy text,
 p_titles text[], p_primary text, p_notes text, p_sms_consent boolean,
 p_ministry_ids uuid[], p_active boolean default true
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; allowed text[]:=array['Pastor','First Lady','Minister','Elder','Missionary','Mother','Evangelist','Deacon','Deaconess'];
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 150 then raise exception 'Name must be 2–150 characters'; end if;
 if p_courtesy not in ('Bro.','Sis.') then raise exception 'Invalid courtesy title'; end if;
 if exists(select 1 from unnest(coalesce(p_titles,'{}'::text[])) t where not t=any(allowed)) then raise exception 'Invalid church title'; end if;
 if p_primary is not null and not p_primary=any(coalesce(p_titles,'{}'::text[])) then raise exception 'Primary title must be selected'; end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Notes too long'; end if;
 if length(coalesce(p_phone,''))>30 or length(coalesce(p_email,''))>254 then raise exception 'Contact information too long'; end if;
 if exists(select 1 from unnest(coalesce(p_ministry_ids,'{}'::uuid[])) m where not exists(select 1 from public.ministries where id=m)) then raise exception 'Invalid ministry'; end if;
 if p_id is null then
  insert into public.cc_directory_members(full_name,phone,email,courtesy_title,church_titles,primary_title,notes,sms_consent,active)
  values(trim(p_name),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_email,'')),''),p_courtesy,coalesce(p_titles,'{}'::text[]),p_primary,nullif(trim(coalesce(p_notes,'')),''),coalesce(p_sms_consent,false),coalesce(p_active,true)) returning id into v_id;
 else
  update public.cc_directory_members set full_name=trim(p_name),phone=nullif(trim(coalesce(p_phone,'')),''),email=nullif(trim(coalesce(p_email,'')),''),courtesy_title=p_courtesy,church_titles=coalesce(p_titles,'{}'::text[]),primary_title=p_primary,notes=nullif(trim(coalesce(p_notes,'')),''),sms_consent=coalesce(p_sms_consent,false),active=coalesce(p_active,true),updated_at=now() where id=p_id returning id into v_id;
  if v_id is null then raise exception 'Directory member not found'; end if;
 end if;
 delete from public.cc_directory_ministries where member_id=v_id and ministry_id<>all(coalesce(p_ministry_ids,'{}'::uuid[]));
 insert into public.cc_directory_ministries(member_id,ministry_id)
 select v_id,m from (select distinct unnest(coalesce(p_ministry_ids,'{}'::uuid[])) m) x
 on conflict do nothing;
 return v_id;
end $$;
revoke all on function public.cc_save_directory_member(uuid,text,text,text,text,text[],text,text,boolean,uuid[],boolean) from public;
grant execute on function public.cc_save_directory_member(uuid,text,text,text,text,text[],text,text,boolean,uuid[],boolean) to authenticated;

-- Organization settings: each church can choose terminology, without forced parent groups.
drop policy if exists "cc_org_admin_update" on public.church_organization_preferences;
create policy "cc_org_admin_update" on public.church_organization_preferences for update to authenticated using(public.cc_is_admin()) with check(public.cc_is_admin());
grant update(group_term) on public.church_organization_preferences to authenticated;
-- Safe ministry creation/editing, without assuming a fixed list of departments.
create or replace function public.cc_manage_ministry(p_id uuid,p_name text,p_action text default 'save')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_action='save' then
  if length(trim(coalesce(p_name,''))) not between 2 and 100 then raise exception 'Name must be 2–100 characters'; end if;
  if p_id is null then insert into public.ministries(name) values(trim(p_name)) returning id into v_id;
  else update public.ministries set name=trim(p_name) where id=p_id returning id into v_id;
  end if;
  if v_id is null then raise exception 'Ministry not found'; end if;
  return v_id;
 else raise exception 'Unsupported ministry action'; end if;
end $$;
revoke all on function public.cc_manage_ministry(uuid,text,text) from public;
grant execute on function public.cc_manage_ministry(uuid,text,text) to authenticated;

-- ===== ministry-colors-migration.sql =====
-- Run after directory-ministry-migration.sql. Safe to rerun.
alter table public.ministries add column if not exists color text not null default '#64748b';
alter table public.ministries drop constraint if exists ministries_color_hex;
alter table public.ministries add constraint ministries_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$');
-- Admins may update ministry colors; other roles cannot update this column.
grant update(color) on public.ministries to authenticated;
drop policy if exists cc_ministry_admin_color_update on public.ministries;
create policy cc_ministry_admin_color_update on public.ministries for update to authenticated using(public.cc_is_admin()) with check(public.cc_is_admin());

-- ===== phase3-4-migration.sql =====
-- Church Connect Phase 3 completion + Phase 4 starter. Run after existing membership and directory migrations.
-- Does not delete member records or modify existing church roles.
create or replace function public.cc_set_directory_ministry_leader(p_member_id uuid,p_ministry_id uuid,p_is_leader boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 update public.cc_directory_ministries set is_leader=coalesce(p_is_leader,false)
 where member_id=p_member_id and ministry_id=p_ministry_id;
 if not found then raise exception 'Directory assignment not found'; end if;
end $$;
revoke all on function public.cc_set_directory_ministry_leader(uuid,uuid,boolean) from public;
grant execute on function public.cc_set_directory_ministry_leader(uuid,uuid,boolean) to authenticated;

create or replace function public.cc_create_ministry_activity(p_ministry_id uuid,p_title text,p_details text,p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 180 then raise exception 'Activity title must be 2–180 characters'; end if;
 if length(coalesce(p_details,''))>2000 then raise exception 'Details too long'; end if;
 if p_starts_at is null then raise exception 'Start date is required'; end if;
 insert into public.ministry_activities(ministry_id,title,details,starts_at)
 values(p_ministry_id,trim(p_title),nullif(trim(coalesce(p_details,'')),''),p_starts_at) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cc_create_ministry_activity(uuid,text,text,timestamptz) from public;
grant execute on function public.cc_create_ministry_activity(uuid,text,text,timestamptz) to authenticated;

-- Delegation records are separate from honorific church titles. No role automatically grants privileges.
create table if not exists public.cc_staff_delegations (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 permission text not null check(permission in ('membership_view','membership_manage','ministry_view','ministry_manage','events_manage','announcements_manage','trustees_view')),
 granted_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(user_id,permission)
);
alter table public.cc_staff_delegations enable row level security;
drop policy if exists cc_delegations_admin_read on public.cc_staff_delegations;
create policy cc_delegations_admin_read on public.cc_staff_delegations for select to authenticated using(public.cc_is_admin() or user_id=auth.uid());
revoke insert,update,delete on public.cc_staff_delegations from anon,authenticated;
create or replace function public.cc_set_staff_delegation(p_user_id uuid,p_permission text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_permission not in ('membership_view','membership_manage','ministry_view','ministry_manage','events_manage','announcements_manage','trustees_view') then raise exception 'Unknown permission'; end if;
 if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true) then raise exception 'Select an approved registered member'; end if;
 if p_enabled then
  insert into public.cc_staff_delegations(user_id,permission,granted_by) values(p_user_id,p_permission,auth.uid()) on conflict(user_id,permission) do nothing;
 else
  delete from public.cc_staff_delegations where user_id=p_user_id and permission=p_permission;
 end if;
end $$;
revoke all on function public.cc_set_staff_delegation(uuid,text,boolean) from public;
grant execute on function public.cc_set_staff_delegation(uuid,text,boolean) to authenticated;
-- Delegations are recorded but MUST be enforced in each module's RLS before delegated users receive access.

-- ===== messaging-migration.sql =====
-- Run after phase4-migration.sql. Per-user read markers; existing RLS still applies.
create table if not exists public.conversation_read_states (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 last_read_at timestamptz not null default now(),
 primary key(conversation_id,user_id));
alter table public.conversation_read_states enable row level security;
drop policy if exists "read own markers" on public.conversation_read_states;
create policy "read own markers" on public.conversation_read_states for select to authenticated using(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid()));
drop policy if exists "insert own markers" on public.conversation_read_states;
create policy "insert own markers" on public.conversation_read_states for insert to authenticated with check(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid()));
drop policy if exists "update own markers" on public.conversation_read_states;
create policy "update own markers" on public.conversation_read_states for update to authenticated using(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid())) with check(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid()));
create or replace function public.my_conversation_unread_counts()
returns table(conversation_id uuid,unread_count bigint)
language sql stable security invoker set search_path=''
as $$
 with accessible as (select c.id from public.conversations c where public.can_read_conversation(c.id,auth.uid()))
 select a.id,count(m.conversation_id)::bigint from accessible a
 left join public.conversation_read_states r on r.conversation_id=a.id and r.user_id=auth.uid()
 left join public.messages m on m.conversation_id=a.id and m.sender_id<>auth.uid() and m.created_at>coalesce(r.last_read_at,'1970-01-01'::timestamptz)
 group by a.id
$$;
revoke all on function public.my_conversation_unread_counts() from public;
grant execute on function public.my_conversation_unread_counts() to authenticated;

-- ===== phase5-website-migration.sql =====
-- Phase 5: single-church website content editor. Run after membership-migration.sql.
-- IMPORTANT: current Church Connect schema is single-church; this table is NOT tenant-isolated.
create table if not exists public.cc_website_content (
  id integer primary key check(id=1),
  enabled boolean not null default true,
  published jsonb not null default '{}'::jsonb,
  draft jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
alter table public.cc_website_content enable row level security;
drop policy if exists cc_website_public_read on public.cc_website_content;
create policy cc_website_public_read on public.cc_website_content for select to anon, authenticated using(true);
-- Public SELECT can see drafts in the table; therefore block direct table SELECT and expose only safe published fields through a view.
drop policy if exists cc_website_public_read on public.cc_website_content;
drop policy if exists cc_website_admin_read on public.cc_website_content;
create policy cc_website_admin_read on public.cc_website_content for select to authenticated using(public.cc_is_admin());
revoke all on public.cc_website_content from anon, authenticated;
grant select on public.cc_website_content to authenticated;
create or replace function public.cc_public_website()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when enabled then published else jsonb_build_object('enabled',false) end
  from public.cc_website_content where id=1;
$$;
revoke all on function public.cc_public_website() from public;
grant execute on function public.cc_public_website() to anon, authenticated;
create or replace function public.cc_save_website_draft(p_content jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if jsonb_typeof(p_content) <> 'object' or pg_column_size(p_content)>30000 then raise exception 'Invalid or oversized content'; end if;
 insert into public.cc_website_content(id,draft) values(1,p_content)
 on conflict(id) do update set draft=excluded.draft,updated_at=now();
end $$;
create or replace function public.cc_publish_website()
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 update public.cc_website_content set published=draft,published_at=now(),updated_at=now() where id=1;
 if not found then raise exception 'Save a draft first'; end if;
end $$;
create or replace function public.cc_toggle_website(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 insert into public.cc_website_content(id,enabled) values(1,p_enabled)
 on conflict(id) do update set enabled=excluded.enabled,updated_at=now();
end $$;
revoke all on function public.cc_save_website_draft(jsonb) from public;
revoke all on function public.cc_publish_website() from public;
revoke all on function public.cc_toggle_website(boolean) from public;
grant execute on function public.cc_save_website_draft(jsonb) to authenticated;
grant execute on function public.cc_publish_website() to authenticated;
grant execute on function public.cc_toggle_website(boolean) to authenticated;

-- ===== phase8-media-migration.sql =====
-- Run once in Supabase SQL editor. Uses the existing church_admins authorization table.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('church-media','church-media',true,8388608,ARRAY['image/png','image/jpeg','image/webp'])
on conflict (id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "church_media_admin_upload" on storage.objects;
create policy "church_media_admin_upload" on storage.objects for insert to authenticated
with check (bucket_id='church-media' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.church_admins a where a.user_id=auth.uid()));

drop policy if exists "church_media_public_read" on storage.objects;
create policy "church_media_public_read" on storage.objects for select to public using (bucket_id='church-media');

-- ===== phase10-sms-migration.sql =====
-- Phase 10: private SMS consent, no third-party SMS provider needed for phone handoff.
create table if not exists public.member_sms_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 phone text, opted_in boolean not null default false, has_app boolean not null default true,
 updated_at timestamptz not null default now(),
 constraint sms_phone_format check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
 constraint sms_opt_in_requires_phone check (not opted_in or phone is not null));
alter table public.member_sms_preferences enable row level security;
revoke all on public.member_sms_preferences from anon;
grant select,insert,update on public.member_sms_preferences to authenticated;
drop policy if exists sms_read_self on public.member_sms_preferences;
create policy sms_read_self on public.member_sms_preferences for select to authenticated using(user_id=auth.uid());
drop policy if exists sms_insert_self on public.member_sms_preferences;
create policy sms_insert_self on public.member_sms_preferences for insert to authenticated with check(user_id=auth.uid());
drop policy if exists sms_update_self on public.member_sms_preferences;
create policy sms_update_self on public.member_sms_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
-- SECURITY DEFINER allows controlled access to opted-in phone numbers only for a conversation's authorized participants.
create or replace function public.cc_phone_sms_recipients(p_conversation_id uuid,p_without_app boolean default true)
returns table(phone text) language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.can_read_conversation(p_conversation_id,auth.uid()) then
  raise exception 'Not authorized for this conversation';
 end if;
 return query
 select distinct sp.phone from public.member_sms_preferences sp
 join public.conversation_members cm on cm.user_id=sp.user_id and cm.conversation_id=p_conversation_id
 join public.member_profiles mp on mp.user_id=sp.user_id and mp.approved=true
 where sp.opted_in and sp.phone is not null and sp.user_id<>auth.uid()
 and (not p_without_app or not sp.has_app);
end $$;
revoke all on function public.cc_phone_sms_recipients(uuid,boolean) from public;
grant execute on function public.cc_phone_sms_recipients(uuid,boolean) to authenticated;

-- ===== phase11-push-migration.sql =====
-- Run in Supabase SQL Editor after messaging-migration.sql.
create table if not exists public.member_push_subscriptions (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 p256dh text not null,
 auth text not null,
 user_agent text,
 created_at timestamptz not null default now()
);
create index if not exists push_user_idx on public.member_push_subscriptions(user_id);
alter table public.member_push_subscriptions enable row level security;
revoke all on public.member_push_subscriptions from anon;
grant select,insert,update,delete on public.member_push_subscriptions to authenticated;
drop policy if exists push_self_select on public.member_push_subscriptions;
create policy push_self_select on public.member_push_subscriptions for select to authenticated using(user_id=auth.uid());
drop policy if exists push_self_insert on public.member_push_subscriptions;
create policy push_self_insert on public.member_push_subscriptions for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.member_profiles p where p.user_id=auth.uid() and p.approved=true));
drop policy if exists push_self_update on public.member_push_subscriptions;
create policy push_self_update on public.member_push_subscriptions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists push_self_delete on public.member_push_subscriptions;
create policy push_self_delete on public.member_push_subscriptions for delete to authenticated using(user_id=auth.uid());
-- service_role can read all subscriptions via RLS bypass. Never expose that key in client files.

-- ===== phase12-hardening-migration.sql =====
-- Phase 12 hardening. Run LAST, after phase11-push-migration.sql. Safe to re-run.

-- 1. Staff-entered directory data is admin-only; make that explicit instead of relying on RLS alone.
revoke all on public.cc_directory_members from anon;
revoke all on public.cc_directory_ministries from anon;
revoke all on public.cc_staff_delegations from anon;
revoke all on public.member_sms_preferences from anon;
grant select on public.cc_directory_members to authenticated;
grant select on public.cc_directory_ministries to authenticated;

-- 2. Push idempotency: Supabase webhooks can retry, so record each message once and skip repeats.
create table if not exists public.cc_push_deliveries (
 message_id uuid primary key,
 created_at timestamptz not null default now()
);
alter table public.cc_push_deliveries enable row level security;
revoke all on public.cc_push_deliveries from anon, authenticated;
-- No policies: only the Edge Function (service_role) reads or writes this table.

-- 3. Phone numbers of staff-entered members (no app account) for the text handoff.
-- Only administrators and leaders of the conversation's ministry receive them, and only for members who consented.
create or replace function public.cc_directory_sms_recipients(p_conversation_id uuid)
returns table(phone text) language plpgsql security definer set search_path='' as $$
declare v_ministry uuid;
begin
 if auth.uid() is null or not public.can_read_conversation(p_conversation_id,auth.uid()) then
  raise exception 'Not authorized for this conversation';
 end if;
 select c.ministry_id into v_ministry from public.conversations c where c.id=p_conversation_id and c.kind='ministry';
 if v_ministry is null then return; end if;
 if not (public.cc_is_admin() or exists(select 1 from public.ministry_members m where m.ministry_id=v_ministry and m.user_id=auth.uid() and m.is_leader)) then
  raise exception 'Only administrators and ministry leaders can text staff-entered members';
 end if;
 return query
 select distinct n.p from (
  select case
   when length(regexp_replace(d.phone,'\D','','g'))=10 then '+1'||regexp_replace(d.phone,'\D','','g')
   when length(regexp_replace(d.phone,'\D','','g'))=11 and regexp_replace(d.phone,'\D','','g') like '1%' then '+'||regexp_replace(d.phone,'\D','','g')
   when d.phone like '+%' and length(regexp_replace(d.phone,'\D','','g')) between 8 and 15 then '+'||regexp_replace(d.phone,'\D','','g')
  end as p
  from public.cc_directory_members d
  join public.cc_directory_ministries dm on dm.member_id=d.id and dm.ministry_id=v_ministry
  where d.active and d.sms_consent and d.phone is not null
 ) n where n.p is not null;
end $$;
revoke all on function public.cc_directory_sms_recipients(uuid) from public;
grant execute on function public.cc_directory_sms_recipients(uuid) to authenticated;

-- 4. Least privilege. The live database exported on 2026-10-20 showed the public (anon) role holding full rights, including TRUNCATE,
-- on every table. Row-level security already blocks reads and writes, but TRUNCATE ignores it, so remove what is not needed.
do $$
declare t text;
begin
 for t in select tablename from pg_tables where schemaname='public' and tablename<>'churches' loop
  execute format('revoke all on public.%I from anon',t);
  execute format('revoke truncate,references,trigger on public.%I from authenticated',t);
 end loop;
end $$;
-- The public website only needs to read published events, announcements and active giving links.
grant select on public.church_events, public.church_announcements, public.church_giving_links to anon;
do $$ begin if to_regclass('public.churches') is not null then execute 'grant select on public.churches to anon'; end if; end $$;

-- ===== multichurch-migration.sql =====
-- Phase 11: multi-church accounts, subscriptions and data separation.
-- Run AFTER phase12-hardening-migration.sql. Safe to re-run.
-- Built from an export of the live database structure (2026-10-20). Existing data is kept and assigned to one default church.
--
-- How separation works:
--   * every church-owned table gets church_id; a person belongs to one church (church_admins / member_profiles).
--   * RESTRICTIVE row-level policies are ANDed with the policies that already exist, so nothing about the old rules is loosened.
--   * every administrator function that takes an id from the caller now confirms that id belongs to the caller's church.

-- ===== 1. Churches, subscriptions, platform owners ===================================================
create table if not exists public.churches (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 2 and 150),
 slug text not null unique check (slug ~ '^[a-z0-9-]{2,50}$'),
 created_at timestamptz not null default now()
);
create table if not exists public.church_subscriptions (
 church_id uuid primary key references public.churches(id) on delete cascade,
 plan text not null default 'trial',
 status text not null default 'trialing' check (status in ('trialing','active','past_due','canceled')),
 trial_ends_at timestamptz,
 current_period_end timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists public.cc_platform_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.churches enable row level security;
alter table public.church_subscriptions enable row level security;
alter table public.cc_platform_admins enable row level security;

insert into public.churches(name,slug) select 'Your Church','default' where not exists(select 1 from public.churches);
insert into public.church_subscriptions(church_id,plan,status)
 select id,'founder','active' from public.churches c where not exists(select 1 from public.church_subscriptions s where s.church_id=c.id);

-- ===== 2. church_id on every church-owned table =====================================================
do $$
declare t text; v_default uuid;
begin
 select id into v_default from public.churches order by created_at limit 1;
 foreach t in array array['church_admins','member_profiles','member_roles','ministries','conversations','church_events','church_announcements',
   'church_giving_links','church_settings','church_organization_preferences','donation_records','cc_directory_members','cc_website_content',
   'member_updates','cc_staff_delegations'] loop
  execute format('alter table public.%I add column if not exists church_id uuid references public.churches(id) on delete cascade',t);
  execute format('update public.%I set church_id=%L where church_id is null',t,v_default);
  execute format('alter table public.%I alter column church_id set not null',t);
  execute format('create index if not exists %I on public.%I(church_id)','cc_'||t||'_church_idx',t);
 end loop;
end $$;

-- ===== 3. Who is the caller's church? ================================================================
create or replace function public.cc_my_church_id() returns uuid language sql stable security definer set search_path='' as $$
 select coalesce(
  (select church_id from public.church_admins where user_id=(select auth.uid()) limit 1),
  (select church_id from public.member_profiles where user_id=(select auth.uid()) limit 1));
$$;
revoke all on function public.cc_my_church_id() from public;
grant execute on function public.cc_my_church_id() to authenticated;

create or replace function public.cc_same_church_user(u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.member_profiles p where p.user_id=u and p.church_id=public.cc_my_church_id());
$$;
revoke all on function public.cc_same_church_user(uuid) from public;
grant execute on function public.cc_same_church_user(uuid) to authenticated;

create or replace function public.cc_church_writable(p_church uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.church_subscriptions s where s.church_id=p_church and s.status in ('trialing','active')
  and (s.status<>'trialing' or s.trial_ends_at is null or s.trial_ends_at>now()));
$$;
revoke all on function public.cc_church_writable(uuid) from public;
grant execute on function public.cc_church_writable(uuid) to authenticated;

create or replace function public.cc_is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cc_platform_admins where user_id=(select auth.uid()));
$$;
revoke all on function public.cc_is_platform_admin() from public;
grant execute on function public.cc_is_platform_admin() to authenticated;

-- New rows default to the caller's church.
do $$
declare t text;
begin
 foreach t in array array['church_admins','member_profiles','member_roles','ministries','conversations','church_events','church_announcements',
   'church_giving_links','church_settings','church_organization_preferences','donation_records','cc_directory_members','cc_website_content',
   'member_updates','cc_staff_delegations'] loop
  execute format('alter table public.%I alter column church_id set default public.cc_my_church_id()',t);
 end loop;
end $$;

-- One-row-per-church settings tables: the old single-row key becomes (church_id, id).
do $$
declare t text; c text;
begin
 foreach t in array array['church_settings','church_organization_preferences','cc_website_content'] loop
  select conname into c from pg_constraint where conrelid=('public.'||t)::regclass and contype='p' and array_length(conkey,1)=1;
  if c is not null then
   execute format('alter table public.%I drop constraint %I',t,c);
   execute format('alter table public.%I add primary key (church_id,id)',t);
  end if;
 end loop;
end $$;
-- Every church gets its settings rows.
insert into public.church_settings(church_id,id) select c.id,true from public.churches c on conflict do nothing;
insert into public.church_organization_preferences(church_id,id) select c.id,true from public.churches c on conflict do nothing;

-- ===== 4. Restrictive row-level policies ==============================================================
-- Churches and subscriptions
drop policy if exists cc_churches_read on public.churches;
create policy cc_churches_read on public.churches for select to anon, authenticated using (true);
drop policy if exists cc_subscription_read on public.church_subscriptions;
create policy cc_subscription_read on public.church_subscriptions for select to authenticated
 using ((church_id=public.cc_my_church_id() and public.cc_is_admin()) or public.cc_is_platform_admin());
revoke insert,update,delete,truncate on public.churches, public.church_subscriptions, public.cc_platform_admins from anon, authenticated;
revoke all on public.cc_platform_admins from anon, authenticated;
grant select on public.churches to anon, authenticated;
grant select on public.church_subscriptions to authenticated;

-- Tables everybody can read the published part of: other churches' published rows stay visible to the public website only.
do $$
declare t text; flag text;
begin
 for t,flag in select * from (values ('church_events','published'),('church_announcements','published'),('church_giving_links','active')) v(t,f) loop
  execute format('drop policy if exists cc_tenant_select on public.%I',t);
  execute format('create policy cc_tenant_select on public.%I as restrictive for select to authenticated using (%I or church_id=public.cc_my_church_id())',t,flag);
  execute format('drop policy if exists cc_tenant_insert on public.%I',t);
  execute format('create policy cc_tenant_insert on public.%I as restrictive for insert to authenticated with check (church_id=public.cc_my_church_id() and public.cc_church_writable(church_id))',t);
  execute format('drop policy if exists cc_tenant_update on public.%I',t);
  execute format('create policy cc_tenant_update on public.%I as restrictive for update to authenticated using (church_id=public.cc_my_church_id()) with check (church_id=public.cc_my_church_id() and public.cc_church_writable(church_id))',t);
  execute format('drop policy if exists cc_tenant_delete on public.%I',t);
  execute format('create policy cc_tenant_delete on public.%I as restrictive for delete to authenticated using (church_id=public.cc_my_church_id())',t);
 end loop;
end $$;

-- Private tables: a signed-in person only ever sees and writes their own church's rows.
do $$
declare t text;
begin
 foreach t in array array['church_admins','member_profiles','member_roles','ministries','conversations','church_settings','church_organization_preferences',
   'donation_records','cc_directory_members','cc_website_content','member_updates','cc_staff_delegations'] loop
  execute format('drop policy if exists cc_tenant_all on public.%I',t);
  execute format('create policy cc_tenant_all on public.%I as restrictive for all to authenticated using (church_id=public.cc_my_church_id()) with check (church_id=public.cc_my_church_id())',t);
 end loop;
end $$;

-- A church whose subscription lapsed becomes read-only for the content that costs money to host.
do $$
declare t text;
begin
 foreach t in array array['ministries','member_updates','conversations','cc_directory_members'] loop
  execute format('drop policy if exists cc_subscription_insert on public.%I',t);
  execute format('create policy cc_subscription_insert on public.%I as restrictive for insert to authenticated with check (public.cc_church_writable(church_id))',t);
  execute format('drop policy if exists cc_subscription_update on public.%I',t);
  execute format('create policy cc_subscription_update on public.%I as restrictive for update to authenticated using (true) with check (public.cc_church_writable(church_id))',t);
 end loop;
end $$;

-- Child tables inherit their church from the parent row.
drop policy if exists cc_tenant_all on public.ministry_members;
create policy cc_tenant_all on public.ministry_members as restrictive for all to authenticated
 using (exists(select 1 from public.ministries m where m.id=ministry_id and m.church_id=public.cc_my_church_id()))
 with check (exists(select 1 from public.ministries m where m.id=ministry_id and m.church_id=public.cc_my_church_id()));
drop policy if exists cc_tenant_all on public.ministry_activities;
create policy cc_tenant_all on public.ministry_activities as restrictive for all to authenticated
 using (exists(select 1 from public.ministries m where m.id=ministry_id and m.church_id=public.cc_my_church_id()))
 with check (exists(select 1 from public.ministries m where m.id=ministry_id and m.church_id=public.cc_my_church_id()));
drop policy if exists cc_tenant_all on public.ministry_join_requests;
create policy cc_tenant_all on public.ministry_join_requests as restrictive for all to authenticated
 using (exists(select 1 from public.ministries m where m.id=ministry_id and m.church_id=public.cc_my_church_id()))
 with check (exists(select 1 from public.ministries m where m.id=ministry_id and m.church_id=public.cc_my_church_id()));
drop policy if exists cc_tenant_all on public.cc_directory_ministries;
create policy cc_tenant_all on public.cc_directory_ministries as restrictive for all to authenticated
 using (exists(select 1 from public.cc_directory_members d where d.id=member_id and d.church_id=public.cc_my_church_id()))
 with check (exists(select 1 from public.cc_directory_members d where d.id=member_id and d.church_id=public.cc_my_church_id()));
drop policy if exists cc_tenant_all on public.conversation_members;
create policy cc_tenant_all on public.conversation_members as restrictive for all to authenticated
 using (exists(select 1 from public.conversations c where c.id=conversation_id and c.church_id=public.cc_my_church_id()))
 with check (exists(select 1 from public.conversations c where c.id=conversation_id and c.church_id=public.cc_my_church_id()));
drop policy if exists cc_tenant_all on public.messages;
create policy cc_tenant_all on public.messages as restrictive for all to authenticated
 using (exists(select 1 from public.conversations c where c.id=conversation_id and c.church_id=public.cc_my_church_id()))
 with check (exists(select 1 from public.conversations c where c.id=conversation_id and c.church_id=public.cc_my_church_id()));
drop policy if exists cc_subscription_insert on public.messages;
create policy cc_subscription_insert on public.messages as restrictive for insert to authenticated
 with check (exists(select 1 from public.conversations c where c.id=conversation_id and public.cc_church_writable(c.church_id)));
drop policy if exists cc_tenant_all on public.member_church_titles;
create policy cc_tenant_all on public.member_church_titles as restrictive for all to authenticated
 using (public.cc_same_church_user(user_id)) with check (public.cc_same_church_user(user_id));

-- ===== 5. Administrator functions: act only inside the caller's own church ============================
create or replace function public.cc_manage_member(
 p_user_id uuid, p_action text, p_ministry_id uuid default null, p_leader boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(p_user_id) then raise exception 'Member not found'; end if;
 if p_ministry_id is not null and not exists(select 1 from public.ministries where id=p_ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Ministry not found'; end if;
 if p_action='approve_member' then
  update public.member_profiles set approved=true where user_id=p_user_id;
 elsif p_action='suspend_member' then
  if p_user_id=auth.uid() then raise exception 'You cannot suspend yourself'; end if;
  update public.member_profiles set approved=false where user_id=p_user_id;
  delete from public.ministry_members where user_id=p_user_id;
 elsif p_action='approve_ministry' then
  if p_ministry_id is null then raise exception 'Ministry required'; end if;
  if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true) then raise exception 'Approve member first'; end if;
  insert into public.ministry_members(ministry_id,user_id,is_leader) values(p_ministry_id,p_user_id,false) on conflict(ministry_id,user_id) do nothing;
  update public.ministry_join_requests set status='approved' where ministry_id=p_ministry_id and user_id=p_user_id;
 elsif p_action='reject_ministry' then
  update public.ministry_join_requests set status='rejected' where ministry_id=p_ministry_id and user_id=p_user_id and status='pending';
 elsif p_action='remove_ministry' then
  delete from public.ministry_members where ministry_id=p_ministry_id and user_id=p_user_id;
  delete from public.ministry_join_requests where ministry_id=p_ministry_id and user_id=p_user_id;
 elsif p_action='set_leader' then
  update public.ministry_members set is_leader=p_leader where ministry_id=p_ministry_id and user_id=p_user_id;
  if not found then raise exception 'Approve ministry membership first'; end if;
 else raise exception 'Unknown action'; end if;
end; $$;

create or replace function public.cc_verify_titles(p_user_id uuid, p_titles text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare permitted text[] := array['Pastor','First Lady','Minister','Elder','Missionary','Mother','Evangelist','Deacon','Deaconess'];
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(p_user_id) then raise exception 'Member not found'; end if;
 if exists(select 1 from unnest(coalesce(p_titles,'{}'::text[])) t where not t=any(permitted)) then raise exception 'Invalid title'; end if;
 insert into public.member_church_titles(user_id,verified_titles) values(p_user_id,coalesce(p_titles,'{}'::text[]))
 on conflict(user_id) do update set verified_titles=excluded.verified_titles;
end; $$;

create or replace function public.cc_set_staff_delegation(p_user_id uuid,p_permission text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_permission not in ('membership_view','membership_manage','ministry_view','ministry_manage','events_manage','announcements_manage','trustees_view') then raise exception 'Unknown permission'; end if;
 if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true and church_id=public.cc_my_church_id()) then raise exception 'Select an approved registered member'; end if;
 if p_enabled then
  insert into public.cc_staff_delegations(user_id,permission,granted_by,church_id) values(p_user_id,p_permission,auth.uid(),public.cc_my_church_id()) on conflict(user_id,permission) do nothing;
 else
  delete from public.cc_staff_delegations where user_id=p_user_id and permission=p_permission and church_id=public.cc_my_church_id();
 end if;
end $$;

create or replace function public.cc_save_directory_member(
 p_id uuid, p_name text, p_phone text, p_email text, p_courtesy text,
 p_titles text[], p_primary text, p_notes text, p_sms_consent boolean,
 p_ministry_ids uuid[], p_active boolean default true
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_church uuid:=public.cc_my_church_id(); allowed text[]:=array['Pastor','First Lady','Minister','Elder','Missionary','Mother','Evangelist','Deacon','Deaconess'];
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 150 then raise exception 'Name must be 2–150 characters'; end if;
 if p_courtesy not in ('Bro.','Sis.') then raise exception 'Invalid courtesy title'; end if;
 if exists(select 1 from unnest(coalesce(p_titles,'{}'::text[])) t where not t=any(allowed)) then raise exception 'Invalid church title'; end if;
 if p_primary is not null and not p_primary=any(coalesce(p_titles,'{}'::text[])) then raise exception 'Primary title must be selected'; end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Notes too long'; end if;
 if length(coalesce(p_phone,''))>30 or length(coalesce(p_email,''))>254 then raise exception 'Contact information too long'; end if;
 if exists(select 1 from unnest(coalesce(p_ministry_ids,'{}'::uuid[])) m where not exists(select 1 from public.ministries where id=m and church_id=v_church)) then raise exception 'Invalid ministry'; end if;
 if p_id is null then
  insert into public.cc_directory_members(church_id,full_name,phone,email,courtesy_title,church_titles,primary_title,notes,sms_consent,active)
  values(v_church,trim(p_name),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_email,'')),''),p_courtesy,coalesce(p_titles,'{}'::text[]),p_primary,nullif(trim(coalesce(p_notes,'')),''),coalesce(p_sms_consent,false),coalesce(p_active,true)) returning id into v_id;
 else
  update public.cc_directory_members set full_name=trim(p_name),phone=nullif(trim(coalesce(p_phone,'')),''),email=nullif(trim(coalesce(p_email,'')),''),courtesy_title=p_courtesy,church_titles=coalesce(p_titles,'{}'::text[]),primary_title=p_primary,notes=nullif(trim(coalesce(p_notes,'')),''),sms_consent=coalesce(p_sms_consent,false),active=coalesce(p_active,true),updated_at=now() where id=p_id and church_id=v_church returning id into v_id;
  if v_id is null then raise exception 'Directory member not found'; end if;
 end if;
 delete from public.cc_directory_ministries where member_id=v_id and ministry_id<>all(coalesce(p_ministry_ids,'{}'::uuid[]));
 insert into public.cc_directory_ministries(member_id,ministry_id)
 select v_id,m from (select distinct unnest(coalesce(p_ministry_ids,'{}'::uuid[])) m) x on conflict do nothing;
 return v_id;
end $$;

create or replace function public.cc_manage_ministry(p_id uuid,p_name text,p_action text default 'save')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_church uuid:=public.cc_my_church_id();
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if p_action='save' then
  if length(trim(coalesce(p_name,''))) not between 2 and 100 then raise exception 'Name must be 2–100 characters'; end if;
  if p_id is null then insert into public.ministries(church_id,name) values(v_church,trim(p_name)) returning id into v_id;
  else update public.ministries set name=trim(p_name) where id=p_id and church_id=v_church returning id into v_id;
  end if;
  if v_id is null then raise exception 'Ministry not found'; end if;
  return v_id;
 else raise exception 'Unsupported ministry action'; end if;
end $$;

create or replace function public.cc_create_ministry_activity(p_ministry_id uuid,p_title text,p_details text,p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if not exists(select 1 from public.ministries where id=p_ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Ministry not found'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 180 then raise exception 'Activity title must be 2–180 characters'; end if;
 if length(coalesce(p_details,''))>2000 then raise exception 'Details too long'; end if;
 if p_starts_at is null then raise exception 'Start date is required'; end if;
 insert into public.ministry_activities(ministry_id,title,details,starts_at)
 values(p_ministry_id,trim(p_title),nullif(trim(coalesce(p_details,'')),''),p_starts_at) returning id into v_id;
 return v_id;
end $$;

create or replace function public.cc_set_directory_ministry_leader(p_member_id uuid,p_ministry_id uuid,p_is_leader boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not exists(select 1 from public.cc_directory_members where id=p_member_id and church_id=public.cc_my_church_id())
  or not exists(select 1 from public.ministries where id=p_ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Directory assignment not found'; end if;
 update public.cc_directory_ministries set is_leader=coalesce(p_is_leader,false) where member_id=p_member_id and ministry_id=p_ministry_id;
 if not found then raise exception 'Directory assignment not found'; end if;
end $$;

-- Website content: one row per church.
create or replace function public.cc_save_website_draft(p_content jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if jsonb_typeof(p_content) <> 'object' or pg_column_size(p_content)>30000 then raise exception 'Invalid or oversized content'; end if;
 insert into public.cc_website_content(church_id,id,draft) values(public.cc_my_church_id(),1,p_content)
 on conflict(church_id,id) do update set draft=excluded.draft,updated_at=now();
end $$;
create or replace function public.cc_publish_website() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 update public.cc_website_content set published=draft,published_at=now(),updated_at=now() where id=1 and church_id=public.cc_my_church_id();
 if not found then raise exception 'Save a draft first'; end if;
end $$;
create or replace function public.cc_toggle_website(p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 insert into public.cc_website_content(church_id,id,enabled) values(public.cc_my_church_id(),1,p_enabled)
 on conflict(church_id,id) do update set enabled=excluded.enabled,updated_at=now();
end $$;
-- Public site: pass the church id from config.js; with one church (or none given) it returns the oldest church's site.
drop function if exists public.cc_public_website();
create or replace function public.cc_public_website(p_church uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select case when enabled then published else jsonb_build_object('enabled',false) end
 from public.cc_website_content where id=1 and church_id=coalesce(p_church,(select id from public.churches order by created_at limit 1));
$$;
revoke all on function public.cc_public_website(uuid) from public;
grant execute on function public.cc_public_website(uuid) to anon, authenticated;

create or replace function public.set_member_approval(u uuid, v boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_church_role('administrator') then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(u) then raise exception 'Member not found'; end if;
 update public.member_profiles set approved=v where user_id=u;
end $$;

create or replace function public.start_direct_chat(recipient uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; me uuid := auth.uid();
begin
 if me is null or recipient=me or not public.is_approved_member(me) or not public.is_approved_member(recipient) then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(recipient) then raise exception 'Recipient is not available'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if not exists(select 1 from public.member_profiles where user_id=recipient and directory_visible=true) then raise exception 'Recipient is not available'; end if;
 perform pg_advisory_xact_lock(hashtext(least(me::text,recipient::text)||greatest(me::text,recipient::text)));
 select c.id into cid from public.conversations c join public.conversation_members a on a.conversation_id=c.id and a.user_id=me
 join public.conversation_members b on b.conversation_id=c.id and b.user_id=recipient
 where c.kind='direct' and (select count(*) from public.conversation_members x where x.conversation_id=c.id)=2 limit 1;
 if cid is null then
  insert into public.conversations(kind,church_id) values('direct',public.cc_my_church_id()) returning id into cid;
  insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,recipient);
 end if;
 return cid;
end $$;

-- Sign-up: the member picks (or the site config supplies) a church. With exactly one church it is chosen automatically.
drop function if exists public.create_my_profile(text);
create or replace function public.create_my_profile(n text, p_church uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 v:=coalesce(p_church,(select id from public.churches where (select count(*) from public.churches)=1));
 if v is null or not exists(select 1 from public.churches where id=v) then raise exception 'Choose a church to join'; end if;
 if not public.cc_church_writable(v) then raise exception 'This church is not accepting new members right now'; end if;
 insert into public.member_profiles(user_id,display_name,church_id) values(auth.uid(),left(trim(n),100),v) on conflict(user_id) do nothing;
end $$;
revoke all on function public.create_my_profile(text,uuid) from public;
grant execute on function public.create_my_profile(text,uuid) to authenticated;

-- ===== 6. Platform owner tools ========================================================================
create or replace function public.cc_platform_create_church(p_name text,p_slug text,p_admin_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 if not public.cc_is_platform_admin() then raise exception 'Platform administrator access required'; end if;
 insert into public.churches(name,slug) values(trim(p_name),lower(trim(p_slug))) returning id into v;
 insert into public.church_subscriptions(church_id,plan,status,trial_ends_at) values(v,'trial','trialing',now()+interval '30 days');
 insert into public.church_settings(church_id,id) values(v,true);
 insert into public.church_organization_preferences(church_id,id) values(v,true);
 insert into public.member_profiles(user_id,display_name,approved,church_id) values(p_admin_user,'Church administrator',true,v)
  on conflict(user_id) do update set church_id=v,approved=true;
 insert into public.church_admins(user_id,church_id) values(p_admin_user,v) on conflict(user_id) do update set church_id=v;
 return v;
end $$;
create or replace function public.cc_platform_set_subscription(p_church uuid,p_plan text,p_status text,p_period_end timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.cc_is_platform_admin() then raise exception 'Platform administrator access required'; end if;
 if p_status not in ('trialing','active','past_due','canceled') then raise exception 'Unknown status'; end if;
 insert into public.church_subscriptions(church_id,plan,status,current_period_end) values(p_church,coalesce(p_plan,'trial'),p_status,p_period_end)
 on conflict(church_id) do update set plan=excluded.plan,status=excluded.status,current_period_end=excluded.current_period_end,updated_at=now();
end $$;
revoke all on function public.cc_platform_create_church(text,text,uuid) from public;
revoke all on function public.cc_platform_set_subscription(uuid,text,text,timestamptz) from public;
grant execute on function public.cc_platform_create_church(text,text,uuid) to authenticated;
grant execute on function public.cc_platform_set_subscription(uuid,text,text,timestamptz) to authenticated;

-- ===== broadcast-migration.sql =====
-- Church-wide broadcast. Run AFTER multichurch-migration.sql. Safe to re-run.
-- Administrators and pastors write one message; every approved member of THEIR church sees it under Updates.
-- Push notifications and the optional "text it too" step are handled by the app / Edge Function (see BROADCAST-SETUP.md).

-- Who may broadcast: an approved member of the caller's church who is an administrator or a pastor.
create or replace function public.cc_can_broadcast() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
  and exists(select 1 from public.member_profiles p where p.user_id=auth.uid() and p.approved=true and p.church_id=public.cc_my_church_id())
  and (public.has_church_role('administrator') or public.has_church_role('pastor'));
$$;
revoke all on function public.cc_can_broadcast() from public;
grant execute on function public.cc_can_broadcast() to authenticated;

create or replace function public.cc_send_broadcast(p_title text, p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_church uuid:=public.cc_my_church_id();
begin
 if not public.cc_can_broadcast() then raise exception 'Only administrators and pastors can send a church-wide broadcast'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 120 then raise exception 'Title must be 2–120 characters'; end if;
 if length(trim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Message must be 1–2000 characters'; end if;
 -- Abuse guard: a church-wide message goes to everyone, so cap how often it can be sent.
 if (select count(*) from public.member_updates u where u.church_id=v_church and u.ministry_id is null and u.created_at>now()-interval '1 hour')>=10 then
  raise exception 'Too many broadcasts in the last hour. Please wait before sending another.';
 end if;
 insert into public.member_updates(church_id,title,body,ministry_id,created_by)
 values(v_church,trim(p_title),trim(p_body),null,auth.uid()) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cc_send_broadcast(text,text) from public;
grant execute on function public.cc_send_broadcast(text,text) to authenticated;

-- Phone numbers to text for a broadcast: opted-in registered members plus staff-entered members who consented. Own church only.
create or replace function public.cc_broadcast_sms_recipients(p_without_app boolean default true) returns table(phone text)
language plpgsql security definer set search_path='' as $$
declare v_church uuid:=public.cc_my_church_id();
begin
 if not public.cc_can_broadcast() then raise exception 'Only administrators and pastors can send a church-wide broadcast'; end if;
 return query
 select distinct n.p from (
  select sp.phone as p
  from public.member_sms_preferences sp
  join public.member_profiles mp on mp.user_id=sp.user_id and mp.approved=true and mp.church_id=v_church
  where sp.opted_in and sp.phone is not null and sp.user_id<>auth.uid() and (not p_without_app or not sp.has_app)
  union all
  select case
   when length(regexp_replace(d.phone,'\D','','g'))=10 then '+1'||regexp_replace(d.phone,'\D','','g')
   when length(regexp_replace(d.phone,'\D','','g'))=11 and regexp_replace(d.phone,'\D','','g') like '1%' then '+'||regexp_replace(d.phone,'\D','','g')
   when d.phone like '+%' and length(regexp_replace(d.phone,'\D','','g')) between 8 and 15 then '+'||regexp_replace(d.phone,'\D','','g')
  end
  from public.cc_directory_members d
  where d.church_id=v_church and d.active and d.sms_consent and d.phone is not null
 ) n where n.p is not null;
end $$;
revoke all on function public.cc_broadcast_sms_recipients(boolean) from public;
grant execute on function public.cc_broadcast_sms_recipients(boolean) to authenticated;

-- ===== Pastor access ===================================================================================
-- Lets an administrator give a registered member of their church the pastor role AND access to the administration pages
-- (the admin pages let in anyone listed in church_admins). Removing it takes both away. Nobody can change their own access.
create or replace function public.cc_member_access() returns table(user_id uuid,is_admin boolean,is_pastor boolean,is_me boolean)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 return query
 select p.user_id,
  exists(select 1 from public.church_admins a where a.user_id=p.user_id),
  exists(select 1 from public.member_roles r where r.user_id=p.user_id and r.role='pastor'),
  p.user_id=auth.uid()
 from public.member_profiles p where p.church_id=public.cc_my_church_id();
end $$;
revoke all on function public.cc_member_access() from public;
grant execute on function public.cc_member_access() to authenticated;

create or replace function public.cc_set_pastor_access(p_user_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_church uuid:=public.cc_my_church_id();
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if p_user_id=auth.uid() then raise exception 'You cannot change your own access'; end if;
 if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true and church_id=v_church) then raise exception 'Select an approved member of your church'; end if;
 if p_enabled then
  insert into public.member_roles(user_id,role,church_id) select p_user_id,'pastor',v_church
   where not exists(select 1 from public.member_roles where user_id=p_user_id and role='pastor');
  insert into public.church_admins(user_id,church_id) select p_user_id,v_church
   where not exists(select 1 from public.church_admins where user_id=p_user_id);
 else
  if not exists(select 1 from public.member_roles where user_id=p_user_id and role='pastor') then raise exception 'This person was not given pastor access here'; end if;
  delete from public.member_roles where user_id=p_user_id and role='pastor';
  delete from public.church_admins where user_id=p_user_id;
 end if;
end $$;
revoke all on function public.cc_set_pastor_access(uuid,boolean) from public;
grant execute on function public.cc_set_pastor_access(uuid,boolean) to authenticated;

-- ===== events-sync-migration.sql =====
-- Events from the church's existing website. Run AFTER broadcast-migration.sql. Safe to re-run.
-- A church can point Church Connect at its website's events feed; the `sync-website-events` Edge Function reads that feed
-- (read-only) and keeps matching rows in church_events up to date. Church Connect never writes to the website.

alter table public.churches add column if not exists events_feed_url text;
alter table public.churches add column if not exists events_timezone text not null default 'America/New_York';
alter table public.churches add column if not exists events_synced_at timestamptz;
alter table public.churches add column if not exists events_sync_status text;

-- Rows that came from the website are marked so they can be refreshed without touching events typed in by hand.
alter table public.church_events add column if not exists source text;
alter table public.church_events add column if not exists external_id text;
-- Not a partial index on purpose: the Edge Function upserts with ON CONFLICT (church_id, source, external_id).
-- Hand-made events have NULL source/external_id, and NULLs never collide, so they are unaffected.
create unique index if not exists church_events_website_uq on public.church_events(church_id, source, external_id);

-- Administrators set (or clear) the feed address. Only a plain public https address is accepted.
create or replace function public.cc_set_events_feed(p_url text, p_timezone text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_url text:=nullif(trim(coalesce(p_url,'')),''); v_host text;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if v_url is not null then
  if length(v_url)>500 or v_url !~* '^https://[a-z0-9.-]+(:[0-9]+)?(/[^\s]*)?$' then raise exception 'Use a full https:// web address'; end if;
  v_host:=lower(substring(v_url from '^https://([^/:]+)'));
  if v_host !~ '\.' or v_host ~ '^[0-9.]+$' or v_host in ('localhost') or v_host ~ '\.(local|internal|localhost)$' then raise exception 'Use the public address of your church website'; end if;
 end if;
 if p_timezone is not null and not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Unknown time zone'; end if;
 update public.churches set events_feed_url=v_url, events_timezone=coalesce(p_timezone,events_timezone),
  events_sync_status=case when v_url is null then null else 'Waiting for first sync' end, events_synced_at=null
 where id=public.cc_my_church_id();
end $$;
revoke all on function public.cc_set_events_feed(text,text) from public;
grant execute on function public.cc_set_events_feed(text,text) to authenticated;

-- ===== photos-security-migration.sql =====
-- Member photos (with generic avatars) + a SECURITY FIX. Run AFTER events-sync-migration.sql. Safe to re-run.
--
-- SECURITY FIX: until now any signed-in member could change ANY column of their own profile, including `approved`
-- (so they could approve themselves) and `church_id`. Members may now change only the columns listed below;
-- approvals still go through the administrator-only functions.
--
-- PHOTOS: stored privately in Supabase Storage. A member's photo is visible to other approved members of the same church only if
-- the member turned "show my photo" on; administrators can always see/remove photos. Staff-entered members (no account) get their
-- photos added by administrators and are visible to administrators only.

-- 1. columns -------------------------------------------------------------------------------------------------------------
alter table public.member_profiles add column if not exists gender text;
alter table public.member_profiles add column if not exists photo_path text;
alter table public.member_profiles add column if not exists photo_visible boolean not null default false;
alter table public.cc_directory_members add column if not exists gender text;
alter table public.cc_directory_members add column if not exists photo_path text;
alter table public.cc_directory_members add column if not exists photo_visible boolean not null default false;

alter table public.member_profiles drop constraint if exists member_profiles_gender_ck;
alter table public.member_profiles add constraint member_profiles_gender_ck check (gender is null or gender in ('female','male'));
alter table public.member_profiles drop constraint if exists member_profiles_photo_path_ck;
alter table public.member_profiles add constraint member_profiles_photo_path_ck check (photo_path is null or photo_path = church_id::text || '/' || user_id::text || '.jpg');
alter table public.cc_directory_members drop constraint if exists cc_directory_gender_ck;
alter table public.cc_directory_members add constraint cc_directory_gender_ck check (gender is null or gender in ('female','male'));
alter table public.cc_directory_members drop constraint if exists cc_directory_photo_path_ck;
alter table public.cc_directory_members add constraint cc_directory_photo_path_ck check (photo_path is null or photo_path = church_id::text || '/dir-' || id::text || '.jpg');

-- 2. the security fix: members may edit only these columns of their profile ---------------------------------------------
revoke update on public.member_profiles from authenticated;
grant update (display_name, bio, directory_visible, directory_contact_visible, contact_email, gender, photo_path, photo_visible)
  on public.member_profiles to authenticated;

-- 3. private photo storage ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Who may touch a photo file? Path is  <church id>/<user id>.jpg  (member)  or  <church id>/dir-<directory id>.jpg  (staff-entered).
create or replace function public.cc_photo_access(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid := auth.uid(); v_file text; v_id uuid; v_dir boolean;
begin
 if v_uid is null then return false; end if;
 if (storage.foldername(p_name))[1] is distinct from public.cc_my_church_id()::text then return false; end if;
 v_file := regexp_replace(storage.filename(p_name), '\.(jpg|jpeg|png|webp)$', '');
 v_dir := v_file like 'dir-%';
 begin v_id := (case when v_dir then substr(v_file, 5) else v_file end)::uuid; exception when others then return false; end;
 if v_dir then
  return public.cc_is_admin() and exists(select 1 from public.cc_directory_members d where d.id = v_id and d.church_id = public.cc_my_church_id());
 end if;
 if not exists(select 1 from public.member_profiles p where p.user_id = v_id and p.church_id = public.cc_my_church_id()) then return false; end if;
 if v_uid = v_id then return true; end if;                       -- your own photo: read, replace, delete
 if public.cc_is_admin() then return true; end if;               -- administrators: read, replace, delete
 if p_write then return false; end if;                           -- nobody else may change it
 return public.is_approved_member(v_uid)                         -- other members: only if shared and both approved
    and exists(select 1 from public.member_profiles p where p.user_id = v_id and p.photo_visible and p.approved);
end $$;
revoke all on function public.cc_photo_access(text, boolean) from public;
grant execute on function public.cc_photo_access(text, boolean) to authenticated;

drop policy if exists cc_photo_read on storage.objects;
create policy cc_photo_read on storage.objects for select to authenticated using (bucket_id = 'member-photos' and public.cc_photo_access(name, false));
drop policy if exists cc_photo_insert on storage.objects;
create policy cc_photo_insert on storage.objects for insert to authenticated with check (bucket_id = 'member-photos' and public.cc_photo_access(name, true));
drop policy if exists cc_photo_update on storage.objects;
create policy cc_photo_update on storage.objects for update to authenticated using (bucket_id = 'member-photos' and public.cc_photo_access(name, true)) with check (bucket_id = 'member-photos' and public.cc_photo_access(name, true));
drop policy if exists cc_photo_delete on storage.objects;
create policy cc_photo_delete on storage.objects for delete to authenticated using (bucket_id = 'member-photos' and public.cc_photo_access(name, true));

-- 4. staff-entered members: gender / photo (administrators only) -------------------------------------------------------
create or replace function public.cc_set_directory_profile(p_id uuid, p_gender text, p_photo_path text, p_photo_visible boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_church uuid := public.cc_my_church_id();
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_gender is not null and p_gender not in ('female','male') then raise exception 'Gender must be female or male'; end if;
 if p_photo_path is not null and p_photo_path <> v_church::text || '/dir-' || p_id::text || '.jpg' then raise exception 'Invalid photo location'; end if;
 update public.cc_directory_members set gender = p_gender, photo_path = p_photo_path, photo_visible = (p_photo_path is not null and coalesce(p_photo_visible, false)), updated_at = now()
  where id = p_id and church_id = v_church;
 if not found then raise exception 'Directory member not found'; end if;
end $$;
revoke all on function public.cc_set_directory_profile(uuid, text, text, boolean) from public;
grant execute on function public.cc_set_directory_profile(uuid, text, text, boolean) to authenticated;

-- ===== platform-migration.sql =====
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

-- ===== colors-migration.sql =====
-- Church Connect: each church chooses its own colors (Administration Center -> Church colors).
-- Safe to run more than once. Run on EVERY Church Connect Supabase project (your church's and the demo).
alter table public.churches add column if not exists brand_primary text;
alter table public.churches add column if not exists brand_accent text;
alter table public.churches add column if not exists brand_text text;
alter table public.churches drop constraint if exists churches_brand_primary_ck;
alter table public.churches drop constraint if exists churches_brand_accent_ck;
alter table public.churches drop constraint if exists churches_brand_text_ck;
alter table public.churches add constraint churches_brand_primary_ck check (brand_primary is null or brand_primary ~ '^#[0-9a-f]{6}$');
alter table public.churches add constraint churches_brand_accent_ck check (brand_accent is null or brand_accent ~ '^#[0-9a-f]{6}$');
alter table public.churches add constraint churches_brand_text_ck check (brand_text is null or brand_text in ('white','black'));

-- Blank colors = the standard Church Connect colors. p_text is the lettering on the main color: 'white', 'black', or blank for
-- automatic (the app picks whichever is easier to read).
drop function if exists public.cc_update_church_colors(text,text);
create or replace function public.cc_update_church_colors(p_primary text, p_accent text, p_text text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_p text := nullif(lower(trim(coalesce(p_primary,''))),''); v_a text := nullif(lower(trim(coalesce(p_accent,''))),''); v_t text := nullif(lower(trim(coalesce(p_text,''))),'');
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if v_p is not null and v_p !~ '^#[0-9a-f]{6}$' then raise exception 'Colors must look like #4933a2'; end if;
 if v_a is not null and v_a !~ '^#[0-9a-f]{6}$' then raise exception 'Colors must look like #e0ae66'; end if;
 if v_t = 'auto' then v_t := null; end if;
 if v_t is not null and v_t not in ('white','black') then raise exception 'Lettering must be white or black'; end if;
 update public.churches set brand_primary = v_p, brand_accent = v_a, brand_text = v_t where id = public.cc_my_church_id();
end $$;
revoke all on function public.cc_update_church_colors(text,text,text) from public;
grant execute on function public.cc_update_church_colors(text,text,text) to authenticated;

-- ===== webmaster-migration.sql =====
-- Church Connect: a separate "Webmaster" staff permission (website design, colors and church settings), apart from ministry leaders.
-- Safe to run more than once. Run on EVERY Church Connect Supabase project.
alter table public.cc_staff_delegations drop constraint if exists cc_staff_delegations_permission_check;
alter table public.cc_staff_delegations add constraint cc_staff_delegations_permission_check
 check (permission in ('membership_view','membership_manage','ministry_view','ministry_manage','events_manage','announcements_manage','trustees_view','website_manage'));

create or replace function public.cc_set_staff_delegation(p_user_id uuid,p_permission text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_permission not in ('membership_view','membership_manage','ministry_view','ministry_manage','events_manage','announcements_manage','trustees_view','website_manage') then raise exception 'Unknown permission'; end if;
 if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true and church_id=public.cc_my_church_id()) then raise exception 'Select an approved registered member'; end if;
 if p_enabled then
  insert into public.cc_staff_delegations(user_id,permission,granted_by,church_id) values(p_user_id,p_permission,auth.uid(),public.cc_my_church_id()) on conflict(user_id,permission) do nothing;
 else
  delete from public.cc_staff_delegations where user_id=p_user_id and permission=p_permission and church_id=public.cc_my_church_id();
 end if;
end $$;

-- ===== webmaster-requests-migration.sql =====
-- Church Connect: "Message to the webmaster" requests, plus a safety net so members can always save their own profile.
-- Safe to run more than once. Run on EVERY Church Connect Supabase project.

-- 1. Members can edit these columns of their OWN profile (nothing else), phone and text preferences, and church titles.
revoke update on public.member_profiles from authenticated;
grant update (display_name, bio, directory_visible, directory_contact_visible, contact_email, gender, photo_path, photo_visible)
  on public.member_profiles to authenticated;
do $$ begin
 if to_regclass('public.member_sms_preferences') is not null then
  grant select, insert, update on public.member_sms_preferences to authenticated;
 end if;
 if to_regclass('public.member_church_titles') is not null then
  grant update (title_mode, titles, primary_title, courtesy_title, updated_at) on public.member_church_titles to authenticated;
  grant insert (user_id, title_mode, titles, primary_title, courtesy_title, updated_at) on public.member_church_titles to authenticated;
 end if;
end $$;

-- 2. Who is a webmaster? A church administrator, or a member given the Webmaster permission (Administration Center).
create or replace function public.cc_is_webmaster() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
  public.cc_is_admin()
  or exists(select 1 from public.cc_staff_delegations d where d.user_id=auth.uid() and d.permission='website_manage' and d.church_id=public.cc_my_church_id())
 );
$$;
revoke all on function public.cc_is_webmaster() from public;
grant execute on function public.cc_is_webmaster() to authenticated;

-- 3. The requests.
create table if not exists public.cc_webmaster_requests (
 id uuid primary key default gen_random_uuid(),
 church_id uuid not null references public.churches(id) on delete cascade,
 requested_by uuid not null,
 kind text not null check (kind in ('event','event_change','photo','other')),
 event_id uuid,
 message text not null default '' check (char_length(message) <= 1500),
 status text not null default 'open' check (status in ('open','done')),
 created_at timestamptz not null default now(),
 done_at timestamptz,
 done_by uuid
);
create index if not exists cc_webmaster_requests_church_idx on public.cc_webmaster_requests(church_id, status, created_at desc);
alter table public.cc_webmaster_requests enable row level security;
revoke all on public.cc_webmaster_requests from anon, authenticated;
grant select on public.cc_webmaster_requests to authenticated;
drop policy if exists cc_webmaster_requests_read on public.cc_webmaster_requests;
create policy cc_webmaster_requests_read on public.cc_webmaster_requests for select to authenticated
 using (church_id = public.cc_my_church_id() and (requested_by = auth.uid() or public.cc_is_webmaster()));

-- Send a request. Administrators and webmasters only.
create or replace function public.cc_send_webmaster_request(p_kind text, p_event_id uuid, p_message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_msg text := left(trim(coalesce(p_message,'')),1500);
begin
 if auth.uid() is null or not public.cc_is_webmaster() then raise exception 'Administrator access required'; end if;
 if p_kind not in ('event','event_change','photo','other') then raise exception 'Choose what the request is about'; end if;
 if p_kind in ('photo','other') and v_msg = '' then raise exception 'Please add a short message'; end if;
 if p_kind = 'event_change' and p_event_id is null then raise exception 'Choose the event to change'; end if;
 if p_event_id is not null and not exists(select 1 from public.church_events where id=p_event_id and church_id=public.cc_my_church_id()) then raise exception 'That event was not found'; end if;
 insert into public.cc_webmaster_requests(church_id, requested_by, kind, event_id, message)
  values (public.cc_my_church_id(), auth.uid(), p_kind, p_event_id, v_msg) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cc_send_webmaster_request(text,uuid,text) from public;
grant execute on function public.cc_send_webmaster_request(text,uuid,text) to authenticated;

-- Mark a request done (webmasters only).
create or replace function public.cc_finish_webmaster_request(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_webmaster() then raise exception 'Webmaster access required'; end if;
 update public.cc_webmaster_requests set status='done', done_at=now(), done_by=auth.uid()
  where id=p_id and church_id=public.cc_my_church_id() and status='open';
end $$;
revoke all on function public.cc_finish_webmaster_request(uuid) from public;
grant execute on function public.cc_finish_webmaster_request(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===== ministry-phone-migration.sql =====
-- Church Connect: ask to join a ministry again after a "no", delete a ministry (with a safety check in the app), and
-- let members choose to share their phone number in the directory.
-- Safe to run more than once. Run on EVERY Church Connect Supabase project.

-- 1. A member can ask again after a request was turned down (the old request is simply reset to pending).
create or replace function public.cc_request_ministry(p_ministry_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if not exists(select 1 from public.member_profiles where user_id=auth.uid() and approved=true) then raise exception 'Your membership must be approved first'; end if;
 if not exists(select 1 from public.ministries where id=p_ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Ministry not found'; end if;
 insert into public.ministry_join_requests(user_id, ministry_id, status) values (auth.uid(), p_ministry_id, 'pending')
  on conflict (user_id, ministry_id) do update set status='pending', requested_at=now() where public.ministry_join_requests.status='rejected';
end $$;
revoke all on function public.cc_request_ministry(uuid) from public;
grant execute on function public.cc_request_ministry(uuid) to authenticated;

-- 2. Deleting a ministry removes the group and everything that belongs only to it.
create or replace function public.cc_manage_ministry(p_id uuid,p_name text,p_action text default 'save')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_church uuid:=public.cc_my_church_id();
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if p_action='save' then
  if length(trim(coalesce(p_name,''))) not between 2 and 100 then raise exception 'Name must be 2–100 characters'; end if;
  if p_id is null then insert into public.ministries(church_id,name) values(v_church,trim(p_name)) returning id into v_id;
  else update public.ministries set name=trim(p_name) where id=p_id and church_id=v_church returning id into v_id;
  end if;
  if v_id is null then raise exception 'Ministry not found'; end if;
  return v_id;
 elsif p_action='delete' then
  if not exists(select 1 from public.ministries where id=p_id and church_id=v_church) then raise exception 'Ministry not found'; end if;
  delete from public.ministry_members where ministry_id=p_id;
  delete from public.ministry_join_requests where ministry_id=p_id;
  delete from public.cc_directory_ministries where ministry_id=p_id;
  delete from public.ministry_activities where ministry_id=p_id;
  delete from public.member_updates where ministry_id=p_id;
  delete from public.conversations where ministry_id=p_id;
  delete from public.ministries where id=p_id and church_id=v_church;
  return p_id;
 else raise exception 'Unsupported ministry action'; end if;
end $$;

-- 3. Sharing a phone number in the directory is the member's own choice (off until they tick it).
alter table public.member_sms_preferences add column if not exists directory_phone_visible boolean not null default false;

create or replace function public.cc_directory_phones() returns table(user_id uuid, phone text)
language sql stable security definer set search_path='' as $$
 select s.user_id, s.phone
 from public.member_sms_preferences s
 join public.member_profiles p on p.user_id = s.user_id
 where s.directory_phone_visible and s.phone is not null and s.phone <> ''
   and p.approved = true and p.directory_visible = true
   and p.church_id = public.cc_my_church_id()
   and exists(select 1 from public.member_profiles me where me.user_id = auth.uid() and me.approved = true);
$$;
revoke all on function public.cc_directory_phones() from public;
grant execute on function public.cc_directory_phones() to authenticated;

-- 4. Staff-entered directory members can be deleted (administrators only).
create or replace function public.cc_delete_directory_member(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not exists(select 1 from public.cc_directory_members where id=p_id and church_id=public.cc_my_church_id()) then raise exception 'Member not found'; end if;
 delete from public.cc_directory_ministries where member_id=p_id;
 delete from public.cc_directory_members where id=p_id and church_id=public.cc_my_church_id();
end $$;
revoke all on function public.cc_delete_directory_member(uuid) from public;
grant execute on function public.cc_delete_directory_member(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===== messaging-upgrade.sql =====
-- Run after the existing Church Connect migrations. Additive; preserves all records.
begin;
alter table public.conversations drop constraint if exists conversations_check;
alter table public.conversations add constraint conversations_check check((kind in ('direct','group') and ministry_id is null) or (kind='ministry' and ministry_id is not null));
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check(kind in ('direct','ministry','group'));
alter table public.conversations add column if not exists title text;
alter table public.conversations add column if not exists owner_id uuid references auth.users(id);
alter table public.conversations add column if not exists parent_id uuid references public.conversations(id);
alter table public.conversations add column if not exists announcement_only boolean not null default false;
alter table public.conversations add column if not exists archived boolean not null default false;
alter table public.messages add column if not exists reply_to uuid references public.messages(id);
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists attachment jsonb;
alter table public.messages add column if not exists poll jsonb;
alter table public.messages add column if not exists pinned boolean not null default false;
alter table public.messages add column if not exists client_id uuid;
create unique index if not exists cc_message_client on public.messages(sender_id,client_id) where client_id is not null;
create index if not exists cc_message_history on public.messages(conversation_id,created_at desc,id desc);
create table if not exists public.cc_chat_preferences(user_id uuid references auth.users(id) on delete cascade, conversation_id uuid references public.conversations(id) on delete cascade, muted boolean not null default false, primary key(user_id,conversation_id));
create table if not exists public.cc_message_marks(user_id uuid references auth.users(id) on delete cascade,message_id uuid references public.messages(id) on delete cascade,reaction text check(reaction in ('❤️','👍','🙏','🙌','✅')),saved boolean not null default false,acknowledged boolean not null default false, vote integer check(vote between 0 and 9),primary key(user_id,message_id));
create table if not exists public.cc_messaging_settings(user_id uuid primary key references auth.users(id) on delete cascade,allow_direct boolean not null default true,quiet_start integer check(quiet_start between 0 and 23),quiet_end integer check(quiet_end between 0 and 23),timezone text not null default 'America/New_York');
create table if not exists public.cc_message_blocks(user_id uuid references auth.users(id) on delete cascade,blocked_id uuid references auth.users(id) on delete cascade,primary key(user_id,blocked_id),check(user_id<>blocked_id));
create table if not exists public.cc_message_reports(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),message_id uuid references public.messages(id),reason text not null check(length(reason) between 3 and 1000),created_at timestamptz not null default now());
create or replace function public.can_read_conversation(c uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_approved_member(u) and exists(select 1 from public.conversations x join public.member_profiles p on p.user_id=u and p.church_id=x.church_id where x.id=c and (x.parent_id is null or public.can_read_conversation(x.parent_id,u)) and ((x.kind in ('direct','group') and exists(select 1 from public.conversation_members cm where cm.conversation_id=c and cm.user_id=u)) or (x.kind='ministry' and public.is_ministry_member(x.ministry_id,u))));
$$;
create or replace function public.cc_chat_manager(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_read_conversation(c,auth.uid()) and exists(select 1 from public.conversations x where x.id=c and (x.owner_id=auth.uid() or public.cc_is_admin() or exists(select 1 from public.ministry_members mm where mm.ministry_id=x.ministry_id and mm.user_id=auth.uid() and mm.is_leader)));
$$;
-- All writes pass through checked functions; read policies also require conversation access.
do $$ declare t text; begin foreach t in array array['cc_chat_preferences','cc_message_marks','cc_messaging_settings','cc_message_blocks','cc_message_reports'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop; end $$;
drop policy if exists cc_own on public.cc_chat_preferences;
create policy cc_own on public.cc_chat_preferences for select to authenticated using(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid()));
drop policy if exists cc_own on public.cc_message_marks;
create policy cc_own on public.cc_message_marks for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.messages m where m.id=message_id and public.can_read_conversation(m.conversation_id,auth.uid())));
drop policy if exists cc_own on public.cc_messaging_settings;
create policy cc_own on public.cc_messaging_settings for select to authenticated using(user_id=auth.uid());
drop policy if exists cc_own on public.cc_message_blocks;
create policy cc_own on public.cc_message_blocks for select to authenticated using(user_id=auth.uid());
drop policy if exists cc_own on public.cc_message_reports;
create policy cc_own on public.cc_message_reports for select to authenticated using(user_id=auth.uid() or (public.cc_is_admin() and exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=message_id and c.church_id=public.cc_my_church_id())));

create or replace function public.cc_chat_people(c uuid) returns table(user_id uuid,display_name text,photo_path text,photo_visible boolean,gender text) language sql stable security definer set search_path='' as $$
 select p.user_id,p.display_name,case when p.photo_visible then p.photo_path end,p.photo_visible,p.gender from public.member_profiles p where public.can_read_conversation(c,auth.uid()) and p.approved and p.church_id=public.cc_my_church_id() and (exists(select 1 from public.conversation_members cm where cm.conversation_id=c and cm.user_id=p.user_id) or exists(select 1 from public.conversations x join public.ministry_members mm on mm.ministry_id=x.ministry_id where x.id=c and x.kind='ministry' and mm.user_id=p.user_id));
$$;
create or replace function public.cc_chat_list() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row_to_json(q) order by q.last_at desc nulls last),'[]'::jsonb) from (select c.*,public.cc_chat_manager(c.id) as can_manage,coalesce(pr.muted,false) as muted,(select m.body from public.messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1) as preview,(select max(m.created_at) from public.messages m where m.conversation_id=c.id) as last_at,coalesce(c.title,(select mn.name from public.ministries mn where mn.id=c.ministry_id),(select string_agg(p.display_name,', ') from public.cc_chat_people(c.id) p where p.user_id<>auth.uid()),'Conversation') as label from public.conversations c left join public.cc_chat_preferences pr on pr.conversation_id=c.id and pr.user_id=auth.uid() where public.can_read_conversation(c.id,auth.uid())) q;
$$;
create or replace function public.cc_chat_action(c uuid,a text,p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare x public.conversations; m public.messages; mid uuid; v uuid; opts jsonb; target uuid; parent public.conversations;
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Approved membership required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'Church is read-only'; end if;
 if a='settings' then
  if not exists(select 1 from pg_timezone_names where name=coalesce(p->>'timezone','America/New_York')) then raise exception 'Invalid time zone'; end if;
  insert into public.cc_messaging_settings(user_id,allow_direct,quiet_start,quiet_end,timezone) values(auth.uid(),coalesce((p->>'allow_direct')::boolean,true),(p->>'quiet_start')::integer,(p->>'quiet_end')::integer,coalesce(p->>'timezone','America/New_York')) on conflict(user_id) do update set allow_direct=excluded.allow_direct,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,timezone=excluded.timezone; return '{}'::jsonb;
 end if;
 if a='block' then
  target:=(p->>'user_id')::uuid;
  if not public.cc_same_church_user(target) then raise exception 'Member unavailable'; end if;
  if coalesce((p->>'enabled')::boolean,true) then insert into public.cc_message_blocks values(auth.uid(),target) on conflict do nothing; else delete from public.cc_message_blocks where user_id=auth.uid() and blocked_id=target; end if; return '{}'::jsonb;
 end if;
 if a='create' then
  if length(trim(coalesce(p->>'title',''))) not between 2 and 100 then raise exception 'Use a group name of 2–100 characters'; end if;
  if (p->>'parent_id') is not null then select * into parent from public.conversations where id=(p->>'parent_id')::uuid; if not public.cc_chat_manager(parent.id) or parent.kind='direct' then raise exception 'Only group leaders can create topics'; end if; end if;
  insert into public.conversations(kind,church_id,title,owner_id,parent_id,announcement_only) values('group',public.cc_my_church_id(),trim(p->>'title'),auth.uid(),parent.id,coalesce((p->>'announcement_only')::boolean,false)) returning id into v;
  insert into public.conversation_members values(v,auth.uid());
  if parent.id is not null then insert into public.conversation_members select v,q.user_id from public.cc_chat_people(parent.id) q on conflict do nothing;
  else for target in select value::text::uuid from jsonb_array_elements_text(coalesce(p->'members','[]'::jsonb)) loop
   if not public.cc_same_church_user(target) or not public.is_approved_member(target) or exists(select 1 from public.cc_message_blocks b where (b.user_id=target and b.blocked_id=auth.uid()) or (b.user_id=auth.uid() and b.blocked_id=target)) then raise exception 'Member unavailable'; end if;
   if exists(select 1 from public.cc_messaging_settings s where s.user_id=target and not s.allow_direct) then raise exception 'Member is not accepting invitations'; end if;
   insert into public.conversation_members values(v,target) on conflict do nothing;
  end loop; end if;
  return jsonb_build_object('id',v);
 end if;
 select * into x from public.conversations where id=c for update;
 if not found or not public.can_read_conversation(c,auth.uid()) then raise exception 'Conversation unavailable'; end if;
 if a='preferences' then insert into public.cc_chat_preferences values(auth.uid(),c,coalesce((p->>'muted')::boolean,false)) on conflict(user_id,conversation_id) do update set muted=excluded.muted; return '{}'::jsonb; end if;
 if a='unread' then insert into public.conversation_read_states values(c,auth.uid(),coalesce((select max(created_at)-interval '1 microsecond' from public.messages where conversation_id=c),'1970-01-01')) on conflict(conversation_id,user_id) do update set last_read_at=excluded.last_read_at; return '{}'::jsonb; end if;
 if a='manage' then
  if not public.cc_chat_manager(c) then raise exception 'Leader access required'; end if;
  if p ? 'title' and length(trim(coalesce(p->>'title',''))) not between 2 and 100 then raise exception 'Use a group name of 2–100 characters'; end if;
  update public.conversations set title=coalesce(p->>'title',title),archived=coalesce((p->>'archived')::boolean,archived),announcement_only=coalesce((p->>'announcement_only')::boolean,announcement_only) where id=c;
  if p ? 'member_id' then
   target:=(p->>'member_id')::uuid;
   if x.kind<>'group' then raise exception 'Manage ministry membership in Administration'; end if;
   if target=x.owner_id then raise exception 'Transfer leadership before removing the owner'; end if;
   if (p->>'remove')::boolean then delete from public.conversation_members where conversation_id=c and user_id=target;
   else if not public.cc_same_church_user(target) or not public.is_approved_member(target) or exists(select 1 from public.cc_messaging_settings where user_id=target and not allow_direct) or exists(select 1 from public.cc_message_blocks b where (b.user_id=target and b.blocked_id=auth.uid()) or (b.user_id=auth.uid() and b.blocked_id=target)) then raise exception 'Member unavailable'; end if; insert into public.conversation_members values(c,target) on conflict do nothing; end if;
  end if;
  if p ? 'owner_id' then target:=(p->>'owner_id')::uuid; if x.kind<>'group' or not exists(select 1 from public.conversation_members where conversation_id=c and user_id=target) then raise exception 'Choose an existing participant'; end if; update public.conversations set owner_id=target where id=c; end if;
  return '{}'::jsonb;
 end if;
 if a='send' then
  if x.archived or (x.announcement_only and not public.cc_chat_manager(c)) then raise exception 'Only leaders may post here'; end if;
  if (p->>'body') ~* '@(everyone|all)\y' and not public.cc_chat_manager(c) then raise exception 'Only leaders can mention the whole group'; end if;
  if x.kind='direct' and exists(select 1 from public.conversation_members cm join public.cc_message_blocks b on (b.user_id=cm.user_id and b.blocked_id=auth.uid()) or (b.blocked_id=cm.user_id and b.user_id=auth.uid()) where cm.conversation_id=c) then raise exception 'This private conversation is blocked'; end if;
  if p ? 'reply_to' and not exists(select 1 from public.messages where id=(p->>'reply_to')::uuid and conversation_id=c) then raise exception 'Reply unavailable'; end if;
  if p ? 'poll' then opts:=p->'poll'->'options'; if jsonb_typeof(opts)<>'array' or jsonb_array_length(opts) not between 2 and 10 or length(p->'poll'->>'question') not between 1 and 300 then raise exception 'A poll needs a question and 2–10 options'; end if; if exists(select 1 from jsonb_array_elements_text(opts) o where length(o) not between 1 and 200) then raise exception 'Poll options must be 1–200 characters'; end if; end if;
  if p ? 'attachment' then if not ((p->'attachment'->>'path') like c::text||'/'||auth.uid()::text||'/%') or not exists(select 1 from storage.objects where bucket_id='chat-files' and name=p->'attachment'->>'path') then raise exception 'Attachment unavailable'; end if; end if;
  insert into public.messages(conversation_id,sender_id,body,reply_to,attachment,poll,client_id) values(c,auth.uid(),trim(p->>'body'),(p->>'reply_to')::uuid,p->'attachment',p->'poll',(p->>'client_id')::uuid) on conflict(sender_id,client_id) where client_id is not null do update set client_id=excluded.client_id returning id into mid;
  return jsonb_build_object('id',mid);
 end if;
 select * into m from public.messages where id=(p->>'message_id')::uuid and conversation_id=c for update;
 if not found then raise exception 'Message unavailable'; end if;
 if a in ('edit','delete') then
  if m.sender_id<>auth.uid() and not (a='delete' and public.cc_chat_manager(c)) then raise exception 'Cannot change this message'; end if;
  if m.deleted_at is not null then raise exception 'Message already deleted'; end if;
  if a='edit' then update public.messages set body=trim(p->>'body'),edited_at=now() where id=m.id;
  else update public.messages set body='Message deleted',deleted_at=now(),attachment=null,poll=null,pinned=false where id=m.id; end if;
 elsif a='pin' then if not public.cc_chat_manager(c) then raise exception 'Leader access required'; end if; update public.messages set pinned=not pinned where id=m.id;
 elsif a='report' then insert into public.cc_message_reports(user_id,message_id,reason) values(auth.uid(),m.id,p->>'reason');
 elsif a='mark' then
  if p ? 'vote' and (m.poll is null or (p->>'vote')::integer<0 or (p->>'vote')::integer>=jsonb_array_length(m.poll->'options')) then raise exception 'Invalid poll option'; end if;
  insert into public.cc_message_marks(user_id,message_id) values(auth.uid(),m.id) on conflict do nothing;
  update public.cc_message_marks set saved=case when p ? 'saved' then (p->>'saved')::boolean else saved end,reaction=case when p ? 'reaction' then p->>'reaction' else reaction end,acknowledged=case when p ? 'acknowledged' then (p->>'acknowledged')::boolean else acknowledged end,vote=case when p ? 'vote' then (p->>'vote')::integer else vote end where user_id=auth.uid() and message_id=m.id;
 else raise exception 'Unknown action'; end if;
 return '{}'::jsonb;
end $$;
-- Existing clients cannot bypass the checked send action.
revoke insert,update,delete on public.messages from authenticated;
drop function if exists public.cc_message_activity(uuid);
create or replace function public.cc_message_activity(c uuid,p_ids uuid[] default null) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('message_id',m.id,'reactions',(select coalesce(jsonb_object_agg(r.reaction,r.n),'{}'::jsonb) from (select mk.reaction,count(*) n from public.cc_message_marks mk where mk.message_id=m.id and mk.reaction is not null group by mk.reaction) r),'votes',(select coalesce(jsonb_object_agg(v.vote,v.n),'{}'::jsonb) from (select mk.vote,count(*) n from public.cc_message_marks mk where mk.message_id=m.id and mk.vote is not null group by mk.vote) v),'acknowledged',(select count(*) from public.cc_message_marks mk where mk.message_id=m.id and mk.acknowledged),'mine',(select row_to_json(mk) from public.cc_message_marks mk where mk.message_id=m.id and mk.user_id=auth.uid()))),'[]'::jsonb) from public.messages m where m.conversation_id=c and public.can_read_conversation(c,auth.uid()) and (p_ids is null or m.id=any(p_ids));
$$;
-- Guard direct-message invitations independently of directory listing, retaining the existing RPC.
create or replace function public.cc_guard_direct() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.conversations where id=new.conversation_id and kind='direct') and new.user_id<>auth.uid() and (exists(select 1 from public.cc_messaging_settings where user_id=new.user_id and not allow_direct) or exists(select 1 from public.cc_message_blocks b where (b.user_id=new.user_id and b.blocked_id=auth.uid()) or (b.user_id=auth.uid() and b.blocked_id=new.user_id))) then raise exception 'Member is not accepting private messages'; end if;
 return new;
end $$;
drop trigger if exists cc_guard_direct on public.conversation_members;
create trigger cc_guard_direct before insert on public.conversation_members for each row execute function public.cc_guard_direct();
-- Private file paths bind both conversation and uploader; access is checked again on every download.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('chat-files','chat-files',false,15728640,array['image/jpeg','image/png','image/webp','application/pdf','text/plain','audio/webm','audio/ogg','audio/mp4','video/mp4']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists cc_chat_file_read on storage.objects;
create policy cc_chat_file_read on storage.objects for select to authenticated using(bucket_id='chat-files' and exists(select 1 from public.conversations c where c.id::text=(storage.foldername(name))[1] and public.can_read_conversation(c.id,auth.uid())));
drop policy if exists cc_chat_file_upload on storage.objects;
create policy cc_chat_file_upload on storage.objects for insert to authenticated with check(bucket_id='chat-files' and (storage.foldername(name))[2]=auth.uid()::text and exists(select 1 from public.conversations c where c.id::text=(storage.foldername(name))[1] and public.can_read_conversation(c.id,auth.uid()) and not c.archived and public.cc_church_writable(c.church_id) and (not c.announcement_only or public.cc_chat_manager(c.id))));
do $$ declare f record; begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cc_chat_manager','cc_chat_people','cc_chat_list','cc_chat_action','cc_message_activity') loop execute format('revoke all on function %s from public',f.sig);execute format('grant execute on function %s to authenticated',f.sig);end loop;end $$;
-- (Subscription ids in this app are numbers, not uuids.)
-- Per-device delivery receipts allow partial failures to be retried without duplicating successful pushes.
create table if not exists public.cc_push_attempts(message_id uuid not null,subscription_id bigint not null,status text not null default 'pending',attempted_at timestamptz not null default now(),primary key(message_id,subscription_id));
alter table public.cc_push_attempts enable row level security;
revoke all on public.cc_push_attempts from public,anon,authenticated;
grant all on public.cc_push_attempts to service_role;
drop function if exists public.cc_claim_push(uuid,uuid);
create or replace function public.cc_claim_push(p_message uuid,p_subscription bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into public.cc_push_attempts(message_id,subscription_id,status) values(p_message,p_subscription,'sending') on conflict(message_id,subscription_id) do update set status='sending',attempted_at=now() where cc_push_attempts.status='pending' or (cc_push_attempts.status='sending' and cc_push_attempts.attempted_at<now()-interval '5 minutes');
 get diagnostics n=row_count;return n>0;
end $$;
revoke all on function public.cc_claim_push(uuid,bigint) from public,anon,authenticated;
grant execute on function public.cc_claim_push(uuid,bigint) to service_role;
create table if not exists public.cc_event_rsvps(event_id uuid references public.church_events(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,response text not null check(response in ('going','maybe','unable')),primary key(event_id,user_id));
alter table public.cc_event_rsvps enable row level security;
revoke all on public.cc_event_rsvps from public,anon,authenticated;
grant select on public.cc_event_rsvps to authenticated;
drop policy if exists cc_event_rsvp_read on public.cc_event_rsvps;
create policy cc_event_rsvp_read on public.cc_event_rsvps for select to authenticated using(user_id=auth.uid() or (public.cc_is_admin() and exists(select 1 from public.church_events e where e.id=event_id and e.church_id=public.cc_my_church_id())));
create or replace function public.cc_event_rsvp(p_event uuid,p_response text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_approved_member(auth.uid()) or not public.cc_church_writable(public.cc_my_church_id()) or not exists(select 1 from public.church_events where id=p_event and church_id=public.cc_my_church_id() and published) then raise exception 'Event unavailable'; end if;
 insert into public.cc_event_rsvps values(p_event,auth.uid(),p_response) on conflict(event_id,user_id) do update set response=excluded.response;
end $$;
revoke all on function public.cc_event_rsvp(uuid,text) from public;
grant execute on function public.cc_event_rsvp(uuid,text) to authenticated;
create or replace function public.cc_messaging_health() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.cc_is_admin() then raise exception 'Administrator required'; end if;
 select jsonb_build_object('reports',coalesce((select jsonb_agg(row_to_json(q)) from (select r.id,r.reason,r.created_at,m.body,c.title from public.cc_message_reports r join public.messages m on m.id=r.message_id join public.conversations c on c.id=m.conversation_id where c.church_id=public.cc_my_church_id() order by r.created_at desc limit 50) q),'[]'::jsonb),'push',coalesce((select jsonb_object_agg(q.status,q.n) from (select a.status,count(*) n from public.cc_push_attempts a join public.member_push_subscriptions s on s.id=a.subscription_id join public.member_profiles p on p.user_id=s.user_id where p.church_id=public.cc_my_church_id() and a.attempted_at>now()-interval '7 days' group by a.status) q),'{}'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.cc_messaging_health() from public;
grant execute on function public.cc_messaging_health() to authenticated;
create or replace function public.cc_push_recipient_ids(p_conversation uuid) returns table(user_id uuid) language sql stable security definer set search_path='' as $$
 select p.user_id from public.member_profiles p where public.can_read_conversation(p_conversation,p.user_id);
$$;
revoke all on function public.cc_push_recipient_ids(uuid) from public,anon,authenticated;
grant execute on function public.cc_push_recipient_ids(uuid) to service_role;
commit;

-- ===== messaging-plus-migration.sql =====
-- Church Connect: messaging safety layer. Run AFTER messaging-upgrade.sql (and every earlier file). Safe to run more than once.
-- Adds: "ask me first" message requests, youth rules with guardians (and a private date of birth), announcement pin / expiry /
-- "I've seen this", who is coming to an event (for administrators), and a fuller messaging health summary.
-- It builds on the blocking, "allow invitations" and push-delivery tables that messaging-upgrade.sql creates.

-- ------------------------------------------------------------------------------------------------
-- 1. Date of birth (private) and youth
-- ------------------------------------------------------------------------------------------------
create table if not exists public.cc_member_safety (
 user_id uuid primary key,
 church_id uuid not null default public.cc_my_church_id(),
 birth_date date,
 updated_at timestamptz not null default now()
);
alter table public.cc_member_safety enable row level security;
revoke all on public.cc_member_safety from anon, authenticated;
grant select on public.cc_member_safety to authenticated;
drop policy if exists cc_member_safety_read on public.cc_member_safety;
create policy cc_member_safety_read on public.cc_member_safety for select to authenticated
 using (church_id = public.cc_my_church_id() and (user_id = auth.uid() or public.cc_is_admin()));

-- A member can enter their own date of birth once. Only an administrator can change it afterwards (so a young member cannot simply edit it).
create or replace function public.cc_set_my_birth_date(p_date date) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if p_date is null or p_date > current_date or p_date < date '1900-01-01' then raise exception 'Enter a real date of birth'; end if;
 if exists(select 1 from public.cc_member_safety where user_id=auth.uid() and birth_date is not null) then
  raise exception 'Your date of birth is already saved. Ask a church administrator to change it.';
 end if;
 insert into public.cc_member_safety(user_id,church_id,birth_date) values(auth.uid(),public.cc_my_church_id(),p_date)
  on conflict (user_id) do update set birth_date=excluded.birth_date, updated_at=now();
end $$;
revoke all on function public.cc_set_my_birth_date(date) from public;
grant execute on function public.cc_set_my_birth_date(date) to authenticated;

create or replace function public.cc_admin_set_birth_date(p_user uuid, p_date date) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_same_church_user(p_user) then raise exception 'Member not found'; end if;
 if p_date is not null and (p_date > current_date or p_date < date '1900-01-01') then raise exception 'Enter a real date of birth'; end if;
 insert into public.cc_member_safety(user_id,church_id,birth_date) values(p_user,public.cc_my_church_id(),p_date)
  on conflict (user_id) do update set birth_date=excluded.birth_date, updated_at=now();
end $$;
revoke all on function public.cc_admin_set_birth_date(uuid,date) from public;
grant execute on function public.cc_admin_set_birth_date(uuid,date) to authenticated;

-- Youth = under 18 (a member with no date of birth saved is treated as an adult).
create or replace function public.cc_is_youth(u uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select s.birth_date > (current_date - interval '18 years')::date from public.cc_member_safety s where s.user_id=u),false);
$$;
revoke all on function public.cc_is_youth(uuid) from public;
grant execute on function public.cc_is_youth(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 2. Guardians (an administrator links a parent or guardian to a young member)
-- ------------------------------------------------------------------------------------------------
create table if not exists public.cc_guardians (
 youth_id uuid not null,
 guardian_id uuid not null,
 church_id uuid not null default public.cc_my_church_id(),
 created_at timestamptz not null default now(),
 primary key (youth_id, guardian_id),
 check (youth_id <> guardian_id)
);
alter table public.cc_guardians enable row level security;
revoke all on public.cc_guardians from anon, authenticated;
grant select on public.cc_guardians to authenticated;
drop policy if exists cc_guardians_read on public.cc_guardians;
create policy cc_guardians_read on public.cc_guardians for select to authenticated
 using (church_id = public.cc_my_church_id() and (guardian_id = auth.uid() or youth_id = auth.uid() or public.cc_is_admin()));

create or replace function public.cc_set_guardian(p_youth uuid, p_guardian uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_same_church_user(p_youth) or not public.cc_same_church_user(p_guardian) then raise exception 'Member not found'; end if;
 if p_on then
  insert into public.cc_guardians(youth_id,guardian_id,church_id) values(p_youth,p_guardian,public.cc_my_church_id()) on conflict do nothing;
 else
  delete from public.cc_guardians where youth_id=p_youth and guardian_id=p_guardian and church_id=public.cc_my_church_id();
 end if;
end $$;
revoke all on function public.cc_set_guardian(uuid,uuid,boolean) from public;
grant execute on function public.cc_set_guardian(uuid,uuid,boolean) to authenticated;

create or replace function public.cc_is_guardian_of(g uuid, y uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cc_guardians where guardian_id=g and youth_id=y);
$$;
revoke all on function public.cc_is_guardian_of(uuid,uuid) from public;
grant execute on function public.cc_is_guardian_of(uuid,uuid) to authenticated;

-- Adults and youth may not message each other privately unless one is the other's guardian.
create or replace function public.cc_youth_rule_ok(a uuid, b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.cc_is_youth(a) = public.cc_is_youth(b) or public.cc_is_guardian_of(a,b) or public.cc_is_guardian_of(b,a);
$$;
revoke all on function public.cc_youth_rule_ok(uuid,uuid) from public;
grant execute on function public.cc_youth_rule_ok(uuid,uuid) to authenticated;

create or replace function public.cc_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cc_message_blocks where (user_id=a and blocked_id=b) or (user_id=b and blocked_id=a));
$$;
revoke all on function public.cc_blocked_between(uuid,uuid) from public;
grant execute on function public.cc_blocked_between(uuid,uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 3. Who may start a private chat: "any member", "ask me first", or "no one" (groups still work)
-- ------------------------------------------------------------------------------------------------
alter table public.cc_messaging_settings add column if not exists request_first boolean not null default false;

create or replace function public.cc_set_chat_mode(p_mode text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if p_mode not in ('open','ask','off') then raise exception 'Choose open, ask or off'; end if;
 insert into public.cc_messaging_settings(user_id,allow_direct,request_first) values(auth.uid(), p_mode <> 'off', p_mode = 'ask')
  on conflict (user_id) do update set allow_direct = excluded.allow_direct, request_first = excluded.request_first;
end $$;
revoke all on function public.cc_set_chat_mode(text) from public;
grant execute on function public.cc_set_chat_mode(text) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 4. Message requests
-- ------------------------------------------------------------------------------------------------
alter table public.conversations add column if not exists status text not null default 'active';
alter table public.conversations add column if not exists requested_by uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='conversations_status_check') then
  alter table public.conversations add constraint conversations_status_check check (status in ('active','request'));
 end if;
end $$;

create or replace function public.start_direct_chat(recipient uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid; me uuid := auth.uid(); v_ask boolean; v_allow boolean;
begin
 if me is null or recipient=me or not public.is_approved_member(me) or not public.is_approved_member(recipient) then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(recipient) then raise exception 'Recipient is not available'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if not exists(select 1 from public.member_profiles where user_id=recipient and directory_visible=true) then raise exception 'Recipient is not available'; end if;
 if public.cc_blocked_between(me,recipient) then raise exception 'Recipient is not available'; end if;
 if not public.cc_youth_rule_ok(me,recipient) then raise exception 'Private messages between adults and youth are not available. Use a ministry group chat, or ask a guardian.'; end if;
 perform pg_advisory_xact_lock(hashtext(least(me::text,recipient::text)||greatest(me::text,recipient::text)));
 select c.id into cid from public.conversations c join public.conversation_members a on a.conversation_id=c.id and a.user_id=me
 join public.conversation_members b on b.conversation_id=c.id and b.user_id=recipient
 where c.kind='direct' and (select count(*) from public.conversation_members x where x.conversation_id=c.id)=2 limit 1;
 if cid is null then
  select coalesce((select allow_direct from public.cc_messaging_settings where user_id=recipient),true),
         coalesce((select request_first from public.cc_messaging_settings where user_id=recipient),false) into v_allow, v_ask;
  if not v_allow then raise exception 'This member is not accepting new private messages. You can still reach them in a ministry group.'; end if;
  insert into public.conversations(kind,church_id,status,requested_by)
   values('direct',public.cc_my_church_id(),case when v_ask then 'request' else 'active' end,case when v_ask then me end) returning id into cid;
  insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,recipient);
 end if;
 return cid;
end $$;

-- The person who was asked can accept, decline (removes the request), or block the sender.
create or replace function public.cc_respond_chat(p_conversation uuid, p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare v_by uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select requested_by into v_by from public.conversations
  where id=p_conversation and kind='direct' and status='request' and church_id=public.cc_my_church_id();
 if v_by is null then raise exception 'Request not found'; end if;
 if v_by = auth.uid() or not exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=auth.uid()) then raise exception 'Not authorized'; end if;
 if p_action = 'accept' then
  update public.conversations set status='active' where id=p_conversation;
 elsif p_action in ('decline','block') then
  if p_action = 'block' then
   insert into public.cc_message_blocks(user_id,blocked_id) values(auth.uid(),v_by) on conflict do nothing;
  end if;
  delete from public.conversations where id=p_conversation;  -- messages, members and read markers go with it
 else raise exception 'Choose accept, decline or block'; end if;
end $$;
revoke all on function public.cc_respond_chat(uuid,text) from public;
grant execute on function public.cc_respond_chat(uuid,text) to authenticated;

-- Checked by the database on every new message, whichever way it arrives: the youth rule, and "one message until accepted".
create or replace function public.cc_message_rules() returns trigger
language plpgsql security definer set search_path='' as $$
declare v record; v_other uuid;
begin
 select kind,status,requested_by into v from public.conversations where id=new.conversation_id;
 if v.kind is distinct from 'direct' then return new; end if;
 -- a re-sent copy of a message that already went through is not a new message
 if new.client_id is not null and exists(select 1 from public.messages where sender_id=new.sender_id and client_id=new.client_id) then return new; end if;
 select user_id into v_other from public.conversation_members where conversation_id=new.conversation_id and user_id<>new.sender_id limit 1;
 if v_other is not null and not public.cc_youth_rule_ok(new.sender_id,v_other) then raise exception 'Private messages between adults and youth are not available'; end if;
 if v.status='request' then
  if v.requested_by is distinct from new.sender_id or exists(select 1 from public.messages where conversation_id=new.conversation_id) then
   raise exception 'This message request is waiting to be accepted';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists cc_message_rules on public.messages;
create trigger cc_message_rules before insert on public.messages for each row execute function public.cc_message_rules();

-- ------------------------------------------------------------------------------------------------
-- 5. Guardians may READ (never write in) the conversations a young member they look after is part of
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_guardian_can_view(c uuid, u uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_approved_member(u) and exists(
  select 1 from public.cc_guardians g join public.conversations x on x.id=c
  where g.guardian_id=u and (
   (x.kind in ('direct','group') and exists(select 1 from public.conversation_members cm where cm.conversation_id=c and cm.user_id=g.youth_id))
   or (x.kind='ministry' and public.is_ministry_member(x.ministry_id,g.youth_id))));
$$;
revoke all on function public.cc_guardian_can_view(uuid,uuid) from public;
grant execute on function public.cc_guardian_can_view(uuid,uuid) to authenticated;
drop policy if exists cc_guardian_read_conversations on public.conversations;
create policy cc_guardian_read_conversations on public.conversations for select to authenticated using (public.cc_guardian_can_view(id, auth.uid()));
drop policy if exists cc_guardian_read_members on public.conversation_members;
create policy cc_guardian_read_members on public.conversation_members for select to authenticated using (public.cc_guardian_can_view(conversation_id, auth.uid()));
drop policy if exists cc_guardian_read_messages on public.messages;
create policy cc_guardian_read_messages on public.messages for select to authenticated using (public.cc_guardian_can_view(conversation_id, auth.uid()));

create or replace function public.cc_my_youth_conversations() returns table(conversation_id uuid, youth_id uuid, youth_name text, kind text, label text)
language sql stable security definer set search_path='' as $$
 select x.id, g.youth_id, p.display_name, x.kind,
  coalesce(x.title,(select mn.name from public.ministries mn where mn.id=x.ministry_id),
   (select string_agg(q.display_name,', ') from public.member_profiles q join public.conversation_members cm on cm.user_id=q.user_id and cm.conversation_id=x.id where q.user_id<>g.youth_id),'Conversation')
 from public.cc_guardians g
 join public.member_profiles p on p.user_id=g.youth_id
 join public.conversations x on (
  (x.kind in ('direct','group') and exists(select 1 from public.conversation_members cm where cm.conversation_id=x.id and cm.user_id=g.youth_id))
  or (x.kind='ministry' and public.is_ministry_member(x.ministry_id,g.youth_id)))
 where g.guardian_id=auth.uid() and public.is_approved_member(auth.uid());
$$;
revoke all on function public.cc_my_youth_conversations() from public;
grant execute on function public.cc_my_youth_conversations() to authenticated;

-- Names for the people in the conversations a guardian is reading.
create or replace function public.cc_guardian_people(p_conversation uuid) returns table(user_id uuid, display_name text)
language sql stable security definer set search_path='' as $$
 select p.user_id, p.display_name from public.member_profiles p
 where public.cc_guardian_can_view(p_conversation,auth.uid()) and p.approved=true and p.church_id=public.cc_my_church_id()
  and (exists(select 1 from public.conversation_members cm where cm.conversation_id=p_conversation and cm.user_id=p.user_id)
   or exists(select 1 from public.conversations x join public.ministry_members mm on mm.ministry_id=x.ministry_id where x.id=p_conversation and x.kind='ministry' and mm.user_id=p.user_id));
$$;
revoke all on function public.cc_guardian_people(uuid) from public;
grant execute on function public.cc_guardian_people(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 6. The directory, as it should look to me (who is hidden, who I can start a chat with, who I blocked)
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_directory_rules() returns table(user_id uuid, hidden boolean, can_message boolean, blocked_by_me boolean)
language sql stable security definer set search_path='' as $$
 select p.user_id,
  (exists(select 1 from public.cc_message_blocks b where b.user_id=p.user_id and b.blocked_id=auth.uid()) or not public.cc_youth_rule_ok(auth.uid(),p.user_id)),
  not (public.cc_blocked_between(auth.uid(),p.user_id) or not public.cc_youth_rule_ok(auth.uid(),p.user_id) or not coalesce((select s.allow_direct from public.cc_messaging_settings s where s.user_id=p.user_id),true)),
  exists(select 1 from public.cc_message_blocks b where b.user_id=auth.uid() and b.blocked_id=p.user_id)
 from public.member_profiles p
 where p.approved=true and p.church_id=public.cc_my_church_id() and p.user_id<>auth.uid() and public.is_approved_member(auth.uid());
$$;
revoke all on function public.cc_directory_rules() from public;
grant execute on function public.cc_directory_rules() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 7. Announcements: pin, expiry, and "I've seen this"
-- ------------------------------------------------------------------------------------------------
alter table public.member_updates add column if not exists pinned boolean not null default false;
alter table public.member_updates add column if not exists expires_at timestamptz;

drop function if exists public.cc_send_broadcast(text,text);
create or replace function public.cc_send_broadcast(p_title text, p_body text, p_pinned boolean default false, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_church uuid:=public.cc_my_church_id();
begin
 if not public.cc_can_broadcast() then raise exception 'Only administrators and pastors can send a church-wide broadcast'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 120 then raise exception 'Title must be 2–120 characters'; end if;
 if length(trim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Message must be 1–2000 characters'; end if;
 if p_expires_at is not null and p_expires_at <= now() then raise exception 'The expiration must be in the future'; end if;
 -- Abuse guard: a church-wide message goes to everyone, so cap how often it can be sent.
 if (select count(*) from public.member_updates u where u.church_id=v_church and u.ministry_id is null and u.created_at>now()-interval '1 hour')>=10 then
  raise exception 'Too many broadcasts in the last hour. Please wait before sending another.';
 end if;
 insert into public.member_updates(church_id,title,body,ministry_id,created_by,pinned,expires_at)
 values(v_church,trim(p_title),trim(p_body),null,auth.uid(),coalesce(p_pinned,false),p_expires_at) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cc_send_broadcast(text,text,boolean,timestamptz) from public;
grant execute on function public.cc_send_broadcast(text,text,boolean,timestamptz) to authenticated;

create table if not exists public.cc_update_acks (
 update_id uuid not null,
 user_id uuid not null,
 church_id uuid not null default public.cc_my_church_id(),
 acked_at timestamptz not null default now(),
 primary key (update_id, user_id)
);
alter table public.cc_update_acks enable row level security;
revoke all on public.cc_update_acks from anon, authenticated;
grant select on public.cc_update_acks to authenticated;
drop policy if exists cc_update_acks_read on public.cc_update_acks;
create policy cc_update_acks_read on public.cc_update_acks for select to authenticated using (user_id = auth.uid());

create or replace function public.cc_ack_update(p_update_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if not exists(select 1 from public.member_updates u where u.id=p_update_id and u.church_id=public.cc_my_church_id()
   and (u.ministry_id is null or public.is_ministry_member(u.ministry_id,auth.uid()))) then raise exception 'Update not found'; end if;
 insert into public.cc_update_acks(update_id,user_id,church_id) values(p_update_id,auth.uid(),public.cc_my_church_id()) on conflict do nothing;
end $$;
revoke all on function public.cc_ack_update(uuid) from public;
grant execute on function public.cc_ack_update(uuid) to authenticated;

-- Who has said "I've seen this" on the recent church-wide announcements (administrators and pastors only).
create or replace function public.cc_update_ack_summary() returns table(update_id uuid, title text, created_at timestamptz, acked bigint, total bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_can_broadcast() then raise exception 'Not authorized'; end if;
 return query
 select u.id, u.title, u.created_at,
  (select count(*) from public.cc_update_acks a where a.update_id=u.id),
  (select count(*) from public.member_profiles p where p.church_id=u.church_id and p.approved=true)
 from public.member_updates u
 where u.church_id=public.cc_my_church_id() and u.ministry_id is null
 order by u.created_at desc limit 10;
end $$;
revoke all on function public.cc_update_ack_summary() from public;
grant execute on function public.cc_update_ack_summary() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 8. Who is coming (administrators see the names; everyone else sees only their own answer)
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_event_rsvp_names(p_event uuid) returns table(display_name text, response text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 return query select coalesce(p.display_name,'A member'), r.response from public.cc_event_rsvps r
  join public.church_events e on e.id=r.event_id and e.church_id=public.cc_my_church_id()
  left join public.member_profiles p on p.user_id=r.user_id
  where r.event_id=p_event order by r.response, p.display_name;
end $$;
revoke all on function public.cc_event_rsvp_names(uuid) from public;
grant execute on function public.cc_event_rsvp_names(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 9. Messaging health: the earlier summary (reports, push states) plus who has notifications on, and requests waiting
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_messaging_health() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v_church uuid:=public.cc_my_church_id();
begin
 if not public.cc_is_admin() then raise exception 'Administrator required'; end if;
 select jsonb_build_object(
  'reports',coalesce((select jsonb_agg(row_to_json(q)) from (select r.id,r.reason,r.created_at,m.body,c.title from public.cc_message_reports r join public.messages m on m.id=r.message_id join public.conversations c on c.id=m.conversation_id where c.church_id=v_church order by r.created_at desc limit 50) q),'[]'::jsonb),
  'push',coalesce((select jsonb_object_agg(q.status,q.n) from (select a.status,count(*) n from public.cc_push_attempts a join public.member_push_subscriptions s on s.id=a.subscription_id join public.member_profiles p on p.user_id=s.user_id where p.church_id=v_church and a.attempted_at>now()-interval '7 days' group by a.status) q),'{}'::jsonb),
  'approved_members',(select count(*) from public.member_profiles p where p.church_id=v_church and p.approved=true),
  'members_with_devices',(select count(distinct s.user_id) from public.member_push_subscriptions s join public.member_profiles p on p.user_id=s.user_id and p.church_id=v_church and p.approved=true),
  'open_requests',(select count(*) from public.conversations c where c.church_id=v_church and c.status='request')
 ) into result;
 return result;
end $$;
revoke all on function public.cc_messaging_health() from public;
grant execute on function public.cc_messaging_health() to authenticated;

-- Same church-fence the older tables have: only my own church's rows.
do $$ declare t text; begin
 foreach t in array array['cc_member_safety','cc_guardians','cc_update_acks'] loop
  execute format('drop policy if exists cc_tenant_all on public.%I', t);
  execute format('create policy cc_tenant_all on public.%I as restrictive for all to authenticated using (church_id = public.cc_my_church_id()) with check (church_id = public.cc_my_church_id())', t);
 end loop;
end $$;

notify pgrst, 'reload schema';

-- ===== church-groups-migration.sql =====
-- Church Connect: the Whole Church group, ministry homes (schedule cards with files, RSVPs and a discussion), and the pastoral care channel.
-- Run AFTER messaging-upgrade.sql and messaging-plus-migration.sql. Safe to run more than once.

-- ------------------------------------------------------------------------------------------------
-- 1. Every ministry has its group chat (it is created automatically, and for ministries that do not have one yet)
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_ensure_ministry_conversation(p_ministry uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 select id into v_id from public.conversations where ministry_id=p_ministry and kind='ministry';
 if v_id is null then
  insert into public.conversations(kind,ministry_id,church_id)
   select 'ministry',m.id,m.church_id from public.ministries m where m.id=p_ministry
   on conflict do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.conversations where ministry_id=p_ministry and kind='ministry'; end if;
 end if;
 return v_id;
end $$;
revoke all on function public.cc_ensure_ministry_conversation(uuid) from public;

create or replace function public.cc_ministry_conversation_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform public.cc_ensure_ministry_conversation(new.id); return new; end $$;
drop trigger if exists cc_ministry_conversation on public.ministries;
create trigger cc_ministry_conversation after insert on public.ministries for each row execute function public.cc_ministry_conversation_trigger();
do $$ declare m record; begin for m in select id from public.ministries loop perform public.cc_ensure_ministry_conversation(m.id); end loop; end $$;

-- ------------------------------------------------------------------------------------------------
-- 2. Who can manage a chat: leaders and administrators, and the Whole Church group is also run by pastors.
--    Pastoral care conversations are confidential: nobody can add people to them or change them.
-- ------------------------------------------------------------------------------------------------
alter table public.conversations add column if not exists whole_church boolean not null default false;
alter table public.conversations add column if not exists confidential boolean not null default false;
create unique index if not exists cc_one_whole_church_per_church on public.conversations(church_id) where whole_church;

create or replace function public.cc_chat_manager(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_read_conversation(c,auth.uid()) and exists(select 1 from public.conversations x where x.id=c and not x.confidential and (
  x.owner_id=auth.uid() or public.cc_is_admin()
  or (x.whole_church and public.cc_can_broadcast())
  or exists(select 1 from public.ministry_members mm where mm.ministry_id=x.ministry_id and mm.user_id=auth.uid() and mm.is_leader)
  or exists(select 1 from public.conversations p join public.ministry_members mm on mm.ministry_id=p.ministry_id where p.id=x.parent_id and mm.user_id=auth.uid() and mm.is_leader)));
$$;
revoke all on function public.cc_chat_manager(uuid) from public;
grant execute on function public.cc_chat_manager(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 3. The Whole Church group: every approved member is in it automatically
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_ensure_whole_church(p_church uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 select id into v_id from public.conversations where church_id=p_church and whole_church;
 if v_id is null then
  insert into public.conversations(kind,church_id,title,whole_church,announcement_only)
   values('group',p_church,'Whole Church',true,false) on conflict do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.conversations where church_id=p_church and whole_church; end if;
 end if;
 return v_id;
end $$;
revoke all on function public.cc_ensure_whole_church(uuid) from public;

create or replace function public.cc_whole_church_member() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if new.church_id is null then return new; end if;
 if new.approved then
  v_id := public.cc_ensure_whole_church(new.church_id);
  insert into public.conversation_members(conversation_id,user_id) values(v_id,new.user_id) on conflict do nothing;
 elsif tg_op = 'UPDATE' then
  delete from public.conversation_members cm using public.conversations c where cm.conversation_id=c.id and c.whole_church and c.church_id=new.church_id and cm.user_id=new.user_id;
 end if;
 return new;
end $$;
drop trigger if exists cc_whole_church_member on public.member_profiles;
create trigger cc_whole_church_member after insert or update of approved on public.member_profiles for each row execute function public.cc_whole_church_member();
-- everyone who is already approved
do $$ declare p record; v uuid; begin
 for p in select distinct church_id from public.member_profiles where approved and church_id is not null loop
  v := public.cc_ensure_whole_church(p.church_id);
  insert into public.conversation_members(conversation_id,user_id)
   select v,mp.user_id from public.member_profiles mp where mp.church_id=p.church_id and mp.approved on conflict do nothing;
 end loop;
end $$;

-- ------------------------------------------------------------------------------------------------
-- 4. Pastoral care: a confidential request that clearly goes to named people
-- ------------------------------------------------------------------------------------------------
create table if not exists public.cc_care_team (
 user_id uuid primary key,
 church_id uuid not null default public.cc_my_church_id(),
 created_at timestamptz not null default now()
);
alter table public.cc_care_team enable row level security;
revoke all on public.cc_care_team from anon, authenticated;
grant select on public.cc_care_team to authenticated;
drop policy if exists cc_care_team_read on public.cc_care_team;
create policy cc_care_team_read on public.cc_care_team for select to authenticated using (church_id = public.cc_my_church_id() and public.cc_is_admin());

create or replace function public.cc_set_care_member(p_user uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_same_church_user(p_user) or not public.is_approved_member(p_user) then raise exception 'Member not found'; end if;
 if p_on then insert into public.cc_care_team(user_id,church_id) values(p_user,public.cc_my_church_id()) on conflict do nothing;
 else delete from public.cc_care_team where user_id=p_user and church_id=public.cc_my_church_id(); end if;
end $$;
revoke all on function public.cc_set_care_member(uuid,boolean) from public;
grant execute on function public.cc_set_care_member(uuid,boolean) to authenticated;

-- Who would receive a pastoral care message: the care team if one is set up, otherwise the church's pastors, otherwise its administrators.
create or replace function public.cc_care_recipients() returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path='' as $$
declare v_church uuid:=public.cc_my_church_id();
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if exists(select 1 from public.cc_care_team t where t.church_id=v_church) then
  return query select p.user_id,p.display_name from public.member_profiles p join public.cc_care_team t on t.user_id=p.user_id where p.approved and p.church_id=v_church and p.user_id<>auth.uid() order by p.display_name;
 elsif exists(select 1 from public.member_roles r join public.member_profiles p on p.user_id=r.user_id where r.role='pastor' and p.approved and p.church_id=v_church) then
  return query select p.user_id,p.display_name from public.member_profiles p where p.approved and p.church_id=v_church and p.user_id<>auth.uid() and exists(select 1 from public.member_roles r where r.user_id=p.user_id and r.role='pastor') order by p.display_name;
 else
  return query select p.user_id,p.display_name from public.member_profiles p join public.church_admins a on a.user_id=p.user_id where p.approved and p.church_id=v_church and p.user_id<>auth.uid() order by p.display_name;
 end if;
end $$;
revoke all on function public.cc_care_recipients() from public;
grant execute on function public.cc_care_recipients() to authenticated;

create or replace function public.cc_care_team_list() returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 return query select t.user_id,coalesce(p.display_name,'A member') from public.cc_care_team t left join public.member_profiles p on p.user_id=t.user_id where t.church_id=public.cc_my_church_id() order by 2;
end $$;
revoke all on function public.cc_care_team_list() from public;
grant execute on function public.cc_care_team_list() to authenticated;

create or replace function public.cc_send_pastoral_care(p_topic text, p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text; v_church uuid:=public.cc_my_church_id(); r record; n int:=0;
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if p_topic not in ('Prayer request','Counseling or advice','Hospital or home visit','Something else') then raise exception 'Choose what this is about'; end if;
 if length(trim(coalesce(p_body,''))) not between 1 and 4000 then raise exception 'Write a message of up to 4000 characters'; end if;
 if (select count(*) from public.conversations c where c.confidential and c.requested_by=auth.uid() and c.created_at>now()-interval '1 day')>=5 then
  raise exception 'You have sent several requests today. Please wait, or call the church office.';
 end if;
 select display_name into v_name from public.member_profiles where user_id=auth.uid();
 if not exists(select 1 from public.cc_care_recipients()) then raise exception 'No one is set up to receive pastoral care messages yet. Please contact the church office.'; end if;
 insert into public.conversations(kind,church_id,title,confidential,owner_id,requested_by) values('group',v_church,'Pastoral care: '||coalesce(v_name,'A member')||' ('||p_topic||')',true,null,auth.uid()) returning id into v_id;
 insert into public.conversation_members(conversation_id,user_id) values(v_id,auth.uid());
 for r in select user_id from public.cc_care_recipients() loop
  insert into public.conversation_members(conversation_id,user_id) values(v_id,r.user_id) on conflict do nothing; n:=n+1;
 end loop;
 insert into public.messages(conversation_id,sender_id,body) values(v_id,auth.uid(),trim(p_body));
 return v_id;
end $$;
revoke all on function public.cc_send_pastoral_care(text,text) from public;
grant execute on function public.cc_send_pastoral_care(text,text) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 5. Ministry schedule cards: RSVP, files, and a discussion for each activity
-- ------------------------------------------------------------------------------------------------
alter table public.ministry_activities add column if not exists conversation_id uuid references public.conversations(id) on delete set null;
alter table public.ministry_activities add column if not exists updated_at timestamptz not null default now();

create table if not exists public.cc_activity_rsvps (
 activity_id uuid not null references public.ministry_activities(id) on delete cascade,
 user_id uuid not null,
 response text not null check (response in ('going','maybe','unable')),
 updated_at timestamptz not null default now(),
 primary key (activity_id, user_id)
);
alter table public.cc_activity_rsvps enable row level security;
revoke all on public.cc_activity_rsvps from anon, authenticated;
grant select on public.cc_activity_rsvps to authenticated;
drop policy if exists cc_activity_rsvps_read on public.cc_activity_rsvps;
create policy cc_activity_rsvps_read on public.cc_activity_rsvps for select to authenticated using (user_id = auth.uid());

create table if not exists public.cc_activity_files (
 id uuid primary key default gen_random_uuid(),
 ministry_id uuid not null references public.ministries(id) on delete cascade,
 activity_id uuid references public.ministry_activities(id) on delete cascade,
 church_id uuid not null default public.cc_my_church_id(),
 path text not null,
 name text not null,
 mime text,
 size integer,
 uploaded_by uuid,
 created_at timestamptz not null default now()
);
create index if not exists cc_activity_files_ministry on public.cc_activity_files(ministry_id, created_at desc);
alter table public.cc_activity_files enable row level security;
revoke all on public.cc_activity_files from anon, authenticated;
grant select on public.cc_activity_files to authenticated;
drop policy if exists cc_activity_files_read on public.cc_activity_files;
create policy cc_activity_files_read on public.cc_activity_files for select to authenticated
 using (church_id = public.cc_my_church_id() and (public.is_ministry_member(ministry_id,auth.uid()) or public.cc_is_admin()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('ministry-files','ministry-files',false,15728640,
 array['image/jpeg','image/png','image/webp','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/webm','audio/ogg','video/mp4'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists cc_ministry_file_read on storage.objects;
create policy cc_ministry_file_read on storage.objects for select to authenticated using(bucket_id='ministry-files' and exists(
 select 1 from public.ministries m where m.id::text=(storage.foldername(name))[1] and m.church_id=public.cc_my_church_id() and (public.is_ministry_member(m.id,auth.uid()) or public.cc_is_admin())));
drop policy if exists cc_ministry_file_upload on storage.objects;
create policy cc_ministry_file_upload on storage.objects for insert to authenticated with check(bucket_id='ministry-files' and exists(
 select 1 from public.ministries m where m.id::text=(storage.foldername(name))[1] and m.church_id=public.cc_my_church_id() and public.is_ministry_leader(m.id,auth.uid()) and public.cc_church_writable(m.church_id)));
drop policy if exists cc_ministry_file_delete on storage.objects;
create policy cc_ministry_file_delete on storage.objects for delete to authenticated using(bucket_id='ministry-files' and exists(
 select 1 from public.ministries m where m.id::text=(storage.foldername(name))[1] and m.church_id=public.cc_my_church_id() and public.is_ministry_leader(m.id,auth.uid())));

-- Leaders (and administrators) create or change an activity. A change of time tells the group in its discussion, which also alerts their phones.
create or replace function public.cc_save_ministry_activity(p_id uuid, p_ministry uuid, p_title text, p_details text, p_starts_at timestamptz, p_notify boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=p_id; v_old public.ministry_activities; v_parent uuid; v_topic uuid; v_church uuid; v_when text;
begin
 if auth.uid() is null or not public.is_ministry_leader(p_ministry,auth.uid()) then raise exception 'Only ministry leaders can change the schedule'; end if;
 select church_id into v_church from public.ministries where id=p_ministry and church_id=public.cc_my_church_id();
 if v_church is null then raise exception 'Ministry not found'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 180 then raise exception 'Activity title must be 2–180 characters'; end if;
 if p_starts_at is null then raise exception 'Choose a date and time'; end if;
 v_parent := public.cc_ensure_ministry_conversation(p_ministry);
 v_when := to_char(p_starts_at at time zone coalesce((select events_timezone from public.churches where id=v_church),'America/New_York'),'FMDay, FMMon FMDD "at" FMHH12:MI AM');
 if v_id is null then
  insert into public.ministry_activities(ministry_id,title,details,starts_at) values(p_ministry,trim(p_title),coalesce(trim(p_details),''),p_starts_at) returning id into v_id;
  insert into public.conversations(kind,church_id,title,owner_id,parent_id) values('group',v_church,trim(p_title),auth.uid(),v_parent) returning id into v_topic;
  insert into public.conversation_members(conversation_id,user_id) select v_topic,mm.user_id from public.ministry_members mm where mm.ministry_id=p_ministry on conflict do nothing;
  insert into public.conversation_members(conversation_id,user_id) values(v_topic,auth.uid()) on conflict do nothing;
  update public.ministry_activities set conversation_id=v_topic where id=v_id;
  if p_notify then insert into public.messages(conversation_id,sender_id,body) values(v_topic,auth.uid(),'New: '||trim(p_title)||', '||v_when||'.'||case when coalesce(trim(p_details),'')<>'' then ' '||trim(p_details) else '' end); end if;
 else
  select * into v_old from public.ministry_activities where id=v_id and ministry_id=p_ministry;
  if not found then raise exception 'Activity not found'; end if;
  update public.ministry_activities set title=trim(p_title),details=coalesce(trim(p_details),''),starts_at=p_starts_at,updated_at=now() where id=v_id;
  v_topic := v_old.conversation_id;
  if v_topic is not null then update public.conversations set title=trim(p_title) where id=v_topic; end if;
  if p_notify and v_topic is not null and v_old.starts_at is distinct from p_starts_at then
   insert into public.messages(conversation_id,sender_id,body) values(v_topic,auth.uid(),'Time changed: '||trim(p_title)||' is now '||v_when||'.');
  end if;
 end if;
 return v_id;
end $$;
revoke all on function public.cc_save_ministry_activity(uuid,uuid,text,text,timestamptz,boolean) from public;
grant execute on function public.cc_save_ministry_activity(uuid,uuid,text,text,timestamptz,boolean) to authenticated;

-- Older activities have no discussion yet: a leader can start one.
create or replace function public.cc_ensure_activity_discussion(p_activity uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.ministry_activities; v_topic uuid; v_parent uuid; v_church uuid;
begin
 select * into a from public.ministry_activities where id=p_activity;
 if not found or auth.uid() is null or not public.is_ministry_leader(a.ministry_id,auth.uid()) then raise exception 'Only ministry leaders can do this'; end if;
 if a.conversation_id is not null then return a.conversation_id; end if;
 select church_id into v_church from public.ministries where id=a.ministry_id and church_id=public.cc_my_church_id();
 if v_church is null then raise exception 'Ministry not found'; end if;
 v_parent := public.cc_ensure_ministry_conversation(a.ministry_id);
 insert into public.conversations(kind,church_id,title,owner_id,parent_id) values('group',v_church,a.title,auth.uid(),v_parent) returning id into v_topic;
 insert into public.conversation_members(conversation_id,user_id) select v_topic,mm.user_id from public.ministry_members mm where mm.ministry_id=a.ministry_id on conflict do nothing;
 insert into public.conversation_members(conversation_id,user_id) values(v_topic,auth.uid()) on conflict do nothing;
 update public.ministry_activities set conversation_id=v_topic where id=p_activity;
 return v_topic;
end $$;
revoke all on function public.cc_ensure_activity_discussion(uuid) from public;
grant execute on function public.cc_ensure_activity_discussion(uuid) to authenticated;

create or replace function public.cc_delete_ministry_activity(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.ministry_activities;
begin
 select * into a from public.ministry_activities where id=p_id;
 if not found or auth.uid() is null or not public.is_ministry_leader(a.ministry_id,auth.uid()) or not exists(select 1 from public.ministries where id=a.ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Only ministry leaders can do this'; end if;
 if a.conversation_id is not null then update public.conversations set archived=true where id=a.conversation_id; end if;
 delete from public.ministry_activities where id=p_id;
end $$;
revoke all on function public.cc_delete_ministry_activity(uuid) from public;
grant execute on function public.cc_delete_ministry_activity(uuid) to authenticated;

-- A new ministry member joins the discussions of that ministry's activities (and leaves them when removed).
create or replace function public.cc_sync_ministry_topics() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_m uuid:=coalesce(new.ministry_id,old.ministry_id); v_u uuid:=coalesce(new.user_id,old.user_id);
begin
 if tg_op='INSERT' then
  insert into public.conversation_members(conversation_id,user_id)
   select a.conversation_id,v_u from public.ministry_activities a where a.ministry_id=v_m and a.conversation_id is not null on conflict do nothing;
 else
  delete from public.conversation_members cm using public.ministry_activities a where a.ministry_id=v_m and cm.conversation_id=a.conversation_id and cm.user_id=v_u;
 end if;
 return null;
end $$;
drop trigger if exists cc_sync_ministry_topics on public.ministry_members;
create trigger cc_sync_ministry_topics after insert or delete on public.ministry_members for each row execute function public.cc_sync_ministry_topics();

create or replace function public.cc_activity_rsvp(p_activity uuid, p_response text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.ministry_activities;
begin
 select * into a from public.ministry_activities where id=p_activity;
 if not found or auth.uid() is null or not public.is_ministry_member(a.ministry_id,auth.uid()) or not exists(select 1 from public.ministries where id=a.ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Activity unavailable'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if p_response is null then delete from public.cc_activity_rsvps where activity_id=p_activity and user_id=auth.uid();
 else
  if p_response not in ('going','maybe','unable') then raise exception 'Choose going, maybe or unable'; end if;
  insert into public.cc_activity_rsvps(activity_id,user_id,response) values(p_activity,auth.uid(),p_response)
   on conflict(activity_id,user_id) do update set response=excluded.response, updated_at=now();
 end if;
end $$;
revoke all on function public.cc_activity_rsvp(uuid,text) from public;
grant execute on function public.cc_activity_rsvp(uuid,text) to authenticated;

-- Totals for a ministry's activities (everyone in the ministry sees the counts; names are for leaders).
create or replace function public.cc_activity_overview(p_ministry uuid)
returns table(activity_id uuid, going bigint, maybe bigint, unable bigint, mine text)
language sql stable security definer set search_path='' as $$
 select a.id,
  count(r.user_id) filter (where r.response='going'), count(r.user_id) filter (where r.response='maybe'), count(r.user_id) filter (where r.response='unable'),
  max(r.response) filter (where r.user_id=auth.uid())
 from public.ministry_activities a
 left join public.cc_activity_rsvps r on r.activity_id=a.id
 where a.ministry_id=p_ministry and (public.is_ministry_member(p_ministry,auth.uid()) or public.cc_is_admin())
  and exists(select 1 from public.ministries m where m.id=p_ministry and m.church_id=public.cc_my_church_id())
 group by a.id;
$$;
revoke all on function public.cc_activity_overview(uuid) from public;
grant execute on function public.cc_activity_overview(uuid) to authenticated;

create or replace function public.cc_activity_rsvp_names(p_activity uuid) returns table(display_name text, response text)
language plpgsql stable security definer set search_path='' as $$
declare m uuid;
begin
 select ministry_id into m from public.ministry_activities where id=p_activity;
 if m is null or auth.uid() is null or not public.is_ministry_leader(m,auth.uid()) then raise exception 'Only ministry leaders can see who is coming'; end if;
 return query select coalesce(p.display_name,'A member'), r.response from public.cc_activity_rsvps r left join public.member_profiles p on p.user_id=r.user_id where r.activity_id=p_activity order by r.response, p.display_name;
end $$;
revoke all on function public.cc_activity_rsvp_names(uuid) from public;
grant execute on function public.cc_activity_rsvp_names(uuid) to authenticated;

-- Files for a ministry or one of its activities.
create or replace function public.cc_add_activity_file(p_ministry uuid, p_activity uuid, p_path text, p_name text, p_mime text, p_size integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.is_ministry_leader(p_ministry,auth.uid()) or not exists(select 1 from public.ministries where id=p_ministry and church_id=public.cc_my_church_id()) then raise exception 'Only ministry leaders can add files'; end if;
 if p_activity is not null and not exists(select 1 from public.ministry_activities where id=p_activity and ministry_id=p_ministry) then raise exception 'Activity not found'; end if;
 if p_path not like p_ministry::text||'/%' or not exists(select 1 from storage.objects where bucket_id='ministry-files' and name=p_path) then raise exception 'File not uploaded'; end if;
 insert into public.cc_activity_files(ministry_id,activity_id,church_id,path,name,mime,size,uploaded_by)
  values(p_ministry,p_activity,public.cc_my_church_id(),p_path,left(coalesce(p_name,'file'),200),p_mime,p_size,auth.uid()) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cc_add_activity_file(uuid,uuid,text,text,text,integer) from public;
grant execute on function public.cc_add_activity_file(uuid,uuid,text,text,text,integer) to authenticated;

create or replace function public.cc_remove_activity_file(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare f public.cc_activity_files;
begin
 select * into f from public.cc_activity_files where id=p_id;
 if not found or auth.uid() is null or not public.is_ministry_leader(f.ministry_id,auth.uid()) or f.church_id<>public.cc_my_church_id() then raise exception 'Only ministry leaders can remove files'; end if;
 delete from public.cc_activity_files where id=p_id;
 return f.path;
end $$;
revoke all on function public.cc_remove_activity_file(uuid) from public;
grant execute on function public.cc_remove_activity_file(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 6. Ministry members (for the Members tab of a ministry home)
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_ministry_roster(p_ministry uuid) returns table(user_id uuid, display_name text, is_leader boolean)
language sql stable security definer set search_path='' as $$
 select mm.user_id, p.display_name, mm.is_leader from public.ministry_members mm
 join public.member_profiles p on p.user_id=mm.user_id and p.approved
 where mm.ministry_id=p_ministry and (public.is_ministry_member(p_ministry,auth.uid()) or public.cc_is_admin())
  and exists(select 1 from public.ministries m where m.id=p_ministry and m.church_id=public.cc_my_church_id())
 order by mm.is_leader desc, p.display_name;
$$;
revoke all on function public.cc_ministry_roster(uuid) from public;
grant execute on function public.cc_ministry_roster(uuid) to authenticated;

-- Same church-fence the older tables have.
do $$ declare t text; begin
 foreach t in array array['cc_care_team','cc_activity_files'] loop
  execute format('drop policy if exists cc_tenant_all on public.%I', t);
  execute format('create policy cc_tenant_all on public.%I as restrictive for all to authenticated using (church_id = public.cc_my_church_id()) with check (church_id = public.cc_my_church_id())', t);
 end loop;
end $$;

-- A voice note can carry a written copy (transcript); keep the stored attachment details small.
do $$ begin
 if not exists(select 1 from pg_constraint where conname='cc_attachment_small') then
  alter table public.messages add constraint cc_attachment_small check (attachment is null or length(attachment::text) <= 12000) not valid;
 end if;
end $$;

notify pgrst, 'reload schema';

-- ===== the first church of this project =====
update public.churches set name = 'Church Connect' where name = 'Your Church';
