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
