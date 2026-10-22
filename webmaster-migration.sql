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
