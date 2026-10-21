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
