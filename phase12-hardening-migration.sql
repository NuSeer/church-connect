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
