-- Rolls Phase 11 (multichurch-migration.sql) back to the single-church database exported on 2026-10-20.
-- Use ONLY if no second church has been created; church-specific data would be merged. Safe to re-run.
-- Old function definitions below are copied verbatim from that export.

do $$ declare n int; begin
 if to_regclass('public.churches') is not null then
  execute 'select count(*) from public.churches' into n;
  if n>1 then raise exception 'More than one church exists. Remove the extra church(es) first (delete from public.churches where slug<>''default'') or this rollback would merge their data.'; end if;
 end if;
end $$;

do $$ declare r record; begin
 for r in select schemaname,tablename,policyname from pg_policies where schemaname='public' and (policyname like 'cc\_tenant\_%' or policyname like 'cc\_subscription\_%') loop
  execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename);
 end loop; end $$;
drop policy if exists cc_churches_read on public.churches; drop policy if exists cc_subscription_read on public.church_subscriptions;

-- broadcast + pastor access (broadcast-migration.sql) depend on the multi-church helpers
drop function if exists public.cc_can_broadcast(); drop function if exists public.cc_send_broadcast(text,text); drop function if exists public.cc_broadcast_sms_recipients(boolean);
drop function if exists public.cc_member_access(); drop function if exists public.cc_set_pastor_access(uuid,boolean);
-- website events sync (events-sync-migration.sql)
drop function if exists public.cc_set_events_feed(text,text);
drop index if exists public.church_events_website_uq;
alter table public.church_events drop column if exists source; alter table public.church_events drop column if exists external_id;
-- functions: drop the new signatures, then restore the originals
drop function if exists public.cc_public_website(uuid); drop function if exists public.create_my_profile(text,uuid);
drop function if exists public.cc_platform_create_church(text,text,uuid); drop function if exists public.cc_platform_set_subscription(uuid,text,text,timestamptz);

CREATE OR REPLACE FUNCTION public.cc_manage_member(p_user_id uuid, p_action text, p_ministry_id uuid DEFAULT NULL::uuid, p_leader boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end; $function$;

CREATE OR REPLACE FUNCTION public.cc_verify_titles(p_user_id uuid, p_titles text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare permitted text[] := array['Pastor','First Lady','Minister','Elder','Missionary','Mother','Evangelist','Deacon','Deaconess'];
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Not authorized'; end if;
 if exists(select 1 from unnest(coalesce(p_titles,'{}'::text[])) t where not t=any(permitted)) then raise exception 'Invalid title'; end if;
 insert into public.member_church_titles(user_id,verified_titles) values(p_user_id,coalesce(p_titles,'{}'::text[]))
 on conflict(user_id) do update set verified_titles=excluded.verified_titles;
end; $function$;

CREATE OR REPLACE FUNCTION public.cc_set_staff_delegation(p_user_id uuid, p_permission text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_permission not in ('membership_view','membership_manage','ministry_view','ministry_manage','events_manage','announcements_manage','trustees_view') then raise exception 'Unknown permission'; end if;
 if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true) then raise exception 'Select an approved registered member'; end if;
 if p_enabled then
  insert into public.cc_staff_delegations(user_id,permission,granted_by) values(p_user_id,p_permission,auth.uid()) on conflict(user_id,permission) do nothing;
 else
  delete from public.cc_staff_delegations where user_id=p_user_id and permission=p_permission;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION public.cc_save_directory_member(p_id uuid, p_name text, p_phone text, p_email text, p_courtesy text, p_titles text[], p_primary text, p_notes text, p_sms_consent boolean, p_ministry_ids uuid[], p_active boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.cc_manage_ministry(p_id uuid, p_name text, p_action text DEFAULT 'save'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.cc_create_ministry_activity(p_ministry_id uuid, p_title text, p_details text, p_starts_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 180 then raise exception 'Activity title must be 2–180 characters'; end if;
 if length(coalesce(p_details,''))>2000 then raise exception 'Details too long'; end if;
 if p_starts_at is null then raise exception 'Start date is required'; end if;
 insert into public.ministry_activities(ministry_id,title,details,starts_at)
 values(p_ministry_id,trim(p_title),nullif(trim(coalesce(p_details,'')),''),p_starts_at) returning id into v_id;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.cc_set_directory_ministry_leader(p_member_id uuid, p_ministry_id uuid, p_is_leader boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 update public.cc_directory_ministries set is_leader=coalesce(p_is_leader,false)
 where member_id=p_member_id and ministry_id=p_ministry_id;
 if not found then raise exception 'Directory assignment not found'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.cc_save_website_draft(p_content jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if jsonb_typeof(p_content) <> 'object' or pg_column_size(p_content)>30000 then raise exception 'Invalid or oversized content'; end if;
 insert into public.cc_website_content(id,draft) values(1,p_content)
 on conflict(id) do update set draft=excluded.draft,updated_at=now();
end $function$;

CREATE OR REPLACE FUNCTION public.cc_publish_website()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 update public.cc_website_content set published=draft,published_at=now(),updated_at=now() where id=1;
 if not found then raise exception 'Save a draft first'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.cc_toggle_website(p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 insert into public.cc_website_content(id,enabled) values(1,p_enabled)
 on conflict(id) do update set enabled=excluded.enabled,updated_at=now();
end $function$;

CREATE OR REPLACE FUNCTION public.cc_public_website()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when enabled then published else jsonb_build_object('enabled',false) end
  from public.cc_website_content where id=1;
$function$;

CREATE OR REPLACE FUNCTION public.set_member_approval(u uuid, v boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.has_church_role('administrator') then raise exception 'Not authorized'; end if;
 update public.member_profiles set approved=v where user_id=u;
end $function$;

CREATE OR REPLACE FUNCTION public.start_direct_chat(recipient uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cid uuid; me uuid := auth.uid();
begin
 if me is null or recipient=me or not public.is_approved_member(me) or not public.is_approved_member(recipient) then raise exception 'Not authorized'; end if;
 -- Members must be visible in the directory to receive new direct-chat invitations.
 if not exists(select 1 from public.member_profiles where user_id=recipient and directory_visible=true) then raise exception 'Recipient is not available'; end if;
 perform pg_advisory_xact_lock(hashtext(least(me::text,recipient::text)||greatest(me::text,recipient::text)));
 select c.id into cid from public.conversations c join public.conversation_members a on a.conversation_id=c.id and a.user_id=me
 join public.conversation_members b on b.conversation_id=c.id and b.user_id=recipient
 where c.kind='direct' and (select count(*) from public.conversation_members x where x.conversation_id=c.id)=2 limit 1;
 if cid is null then
 insert into public.conversations(kind) values('direct') returning id into cid;
 insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,recipient);
 end if;
 return cid;
end $function$;

CREATE OR REPLACE FUNCTION public.create_my_profile(n text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 insert into public.member_profiles(user_id,display_name) values(auth.uid(),left(trim(n),100)) on conflict(user_id) do nothing;
end $function$;

-- settings tables go back to one row per site
do $$ declare t text; c text; begin
 foreach t in array array['church_settings','church_organization_preferences','cc_website_content'] loop
  select conname into c from pg_constraint where conrelid=('public.'||t)::regclass and contype='p';
  if c is not null then execute format('alter table public.%I drop constraint %I',t,c); end if;
  execute format('alter table public.%I add primary key (id)',t);
 end loop; end $$;

do $$ declare t text; begin
 foreach t in array array['church_admins','member_profiles','member_roles','ministries','conversations','church_events','church_announcements','church_giving_links','church_settings','church_organization_preferences','donation_records','cc_directory_members','cc_website_content','member_updates','cc_staff_delegations'] loop
  execute format('alter table public.%I drop column if exists church_id cascade',t);
 end loop; end $$;

drop function if exists public.cc_my_church_id() cascade; drop function if exists public.cc_same_church_user(uuid) cascade; drop function if exists public.cc_church_writable(uuid) cascade; drop function if exists public.cc_is_platform_admin() cascade;
drop table if exists public.church_subscriptions; drop table if exists public.cc_platform_admins; drop table if exists public.churches;
