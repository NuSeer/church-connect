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
