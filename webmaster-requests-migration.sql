-- Church Connect: "Message to the webmaster" requests, plus a safety net so members can always save their own profile.
-- Safe to run more than once. Run on EVERY Church Connect Supabase project.

-- 1. Members can edit these columns of their OWN profile (nothing else), phone and text preferences, and church titles.
revoke update on public.member_profiles from authenticated;
grant update (display_name, bio, directory_visible, directory_contact_visible, contact_email, gender, photo_path, photo_visible)
  on public.member_profiles to authenticated;
do $$ begin
 if to_regclass('public.member_sms_preferences') is not null then
  grant select, insert, update on public.member_sms_preferences to authenticated;
 end if;
 if to_regclass('public.member_church_titles') is not null then
  grant update (title_mode, titles, primary_title, courtesy_title, updated_at) on public.member_church_titles to authenticated;
  grant insert (user_id, title_mode, titles, primary_title, courtesy_title, updated_at) on public.member_church_titles to authenticated;
 end if;
end $$;

-- 2. Who is a webmaster? A church administrator, or a member given the Webmaster permission (Administration Center).
create or replace function public.cc_is_webmaster() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
  public.cc_is_admin()
  or exists(select 1 from public.cc_staff_delegations d where d.user_id=auth.uid() and d.permission='website_manage' and d.church_id=public.cc_my_church_id())
 );
$$;
revoke all on function public.cc_is_webmaster() from public;
grant execute on function public.cc_is_webmaster() to authenticated;

-- 3. The requests.
create table if not exists public.cc_webmaster_requests (
 id uuid primary key default gen_random_uuid(),
 church_id uuid not null references public.churches(id) on delete cascade,
 requested_by uuid not null,
 kind text not null check (kind in ('event','event_change','photo','other')),
 event_id uuid,
 message text not null default '' check (char_length(message) <= 1500),
 status text not null default 'open' check (status in ('open','done')),
 created_at timestamptz not null default now(),
 done_at timestamptz,
 done_by uuid
);
create index if not exists cc_webmaster_requests_church_idx on public.cc_webmaster_requests(church_id, status, created_at desc);
alter table public.cc_webmaster_requests enable row level security;
revoke all on public.cc_webmaster_requests from anon, authenticated;
grant select on public.cc_webmaster_requests to authenticated;
drop policy if exists cc_webmaster_requests_read on public.cc_webmaster_requests;
create policy cc_webmaster_requests_read on public.cc_webmaster_requests for select to authenticated
 using (church_id = public.cc_my_church_id() and (requested_by = auth.uid() or public.cc_is_webmaster()));

-- Send a request. Administrators and webmasters only.
create or replace function public.cc_send_webmaster_request(p_kind text, p_event_id uuid, p_message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_msg text := left(trim(coalesce(p_message,'')),1500);
begin
 if auth.uid() is null or not public.cc_is_webmaster() then raise exception 'Administrator access required'; end if;
 if p_kind not in ('event','event_change','photo','other') then raise exception 'Choose what the request is about'; end if;
 if p_kind in ('photo','other') and v_msg = '' then raise exception 'Please add a short message'; end if;
 if p_kind = 'event_change' and p_event_id is null then raise exception 'Choose the event to change'; end if;
 if p_event_id is not null and not exists(select 1 from public.church_events where id=p_event_id and church_id=public.cc_my_church_id()) then raise exception 'That event was not found'; end if;
 insert into public.cc_webmaster_requests(church_id, requested_by, kind, event_id, message)
  values (public.cc_my_church_id(), auth.uid(), p_kind, p_event_id, v_msg) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cc_send_webmaster_request(text,uuid,text) from public;
grant execute on function public.cc_send_webmaster_request(text,uuid,text) to authenticated;

-- Mark a request done (webmasters only).
create or replace function public.cc_finish_webmaster_request(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_webmaster() then raise exception 'Webmaster access required'; end if;
 update public.cc_webmaster_requests set status='done', done_at=now(), done_by=auth.uid()
  where id=p_id and church_id=public.cc_my_church_id() and status='open';
end $$;
revoke all on function public.cc_finish_webmaster_request(uuid) from public;
grant execute on function public.cc_finish_webmaster_request(uuid) to authenticated;

notify pgrst, 'reload schema';
