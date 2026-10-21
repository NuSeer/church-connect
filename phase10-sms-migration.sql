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
