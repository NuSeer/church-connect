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
