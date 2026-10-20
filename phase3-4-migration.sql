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
