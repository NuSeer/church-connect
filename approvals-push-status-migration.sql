-- Approvals page: lets administrators see which members of THEIR church have turned on phone notifications.
-- Returns only a yes/no per member (never the device addresses). Safe to run more than once.
create or replace function public.cc_member_push_status() returns table(user_id uuid,has_push boolean)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 return query
 select p.user_id, exists(select 1 from public.member_push_subscriptions s where s.user_id=p.user_id)
 from public.member_profiles p where p.church_id=public.cc_my_church_id();
end $$;
revoke all on function public.cc_member_push_status() from public;
grant execute on function public.cc_member_push_status() to authenticated;
