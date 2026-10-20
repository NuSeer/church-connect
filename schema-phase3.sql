-- Phase 3: run AFTER schema.sql and schema-phase2.sql in Supabase SQL Editor.
create table if not exists public.member_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '', bio text not null default '',
 directory_visible boolean not null default false,
 directory_contact_visible boolean not null default false,
 contact_email text, approved boolean not null default false,
 created_at timestamptz not null default now());
create table if not exists public.member_roles (
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('pastor','administrator','ministry_leader','finance')),
 primary key(user_id,role));
create table if not exists public.ministries (
 id uuid primary key default gen_random_uuid(), name text not null, description text not null default '', created_at timestamptz default now());
create table if not exists public.ministry_members (
 ministry_id uuid not null references public.ministries(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 is_leader boolean not null default false,
 primary key(ministry_id,user_id));
create table if not exists public.ministry_activities (
 id uuid primary key default gen_random_uuid(), ministry_id uuid not null references public.ministries(id) on delete cascade,
 title text not null, details text not null default '', starts_at timestamptz not null,
 created_at timestamptz default now());
create table if not exists public.conversations (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('direct','ministry')),
 ministry_id uuid references public.ministries(id) on delete cascade,
 created_at timestamptz not null default now(),
 check((kind='direct' and ministry_id is null) or (kind='ministry' and ministry_id is not null)));
create unique index if not exists unique_ministry_conversation on public.conversations(ministry_id) where ministry_id is not null;
create table if not exists public.conversation_members (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(conversation_id,user_id));
create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid not null references auth.users(id), body text not null check(char_length(body) between 1 and 4000),
 created_at timestamptz not null default now());
create table if not exists public.member_updates (
 id uuid primary key default gen_random_uuid(), title text not null, body text not null default '',
 ministry_id uuid references public.ministries(id) on delete cascade,
 created_by uuid references auth.users(id), created_at timestamptz default now());
create table if not exists public.church_settings (
 id boolean primary key default true check(id), donation_history_enabled boolean not null default false);
insert into public.church_settings(id) values(true) on conflict do nothing;
create table if not exists public.donation_records (
 id uuid primary key default gen_random_uuid(), donor_id uuid not null references auth.users(id),
 amount numeric(12,2) not null check(amount>=0), currency text not null default 'USD',
 provider text not null, donated_at timestamptz not null, reference text);

create or replace function public.has_church_role(r text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.member_roles where user_id=(select auth.uid()) and role=r)
 or (r in ('administrator','pastor') and public.is_church_admin()); $$;
create or replace function public.is_approved_member(u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.member_profiles where user_id=u and approved=true); $$;
create or replace function public.is_ministry_member(m uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ministry_members where ministry_id=m and user_id=u); $$;
create or replace function public.is_ministry_leader(m uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ministry_members where ministry_id=m and user_id=u and is_leader=true)
 or public.has_church_role('administrator') or public.has_church_role('pastor'); $$;
create or replace function public.can_read_conversation(c uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_approved_member(u) and exists(
 select 1 from public.conversations x where x.id=c and (
 (x.kind='direct' and exists(select 1 from public.conversation_members cm where cm.conversation_id=c and cm.user_id=u))
 or (x.kind='ministry' and public.is_ministry_member(x.ministry_id,u)))); $$;
revoke all on function public.has_church_role(text),public.is_approved_member(uuid),public.is_ministry_member(uuid,uuid),public.is_ministry_leader(uuid,uuid),public.can_read_conversation(uuid,uuid) from public;
grant execute on function public.has_church_role(text),public.is_approved_member(uuid),public.is_ministry_member(uuid,uuid),public.is_ministry_leader(uuid,uuid),public.can_read_conversation(uuid,uuid) to authenticated;

-- Atomic creation prevents unauthorized participants and duplicate direct threads.
create or replace function public.start_direct_chat(recipient uuid) returns uuid language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function public.start_direct_chat(uuid) from public;
grant execute on function public.start_direct_chat(uuid) to authenticated;

-- Member sign-up defaults to pending and directory hidden. No client-side role grants.
create or replace function public.create_my_profile(n text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 insert into public.member_profiles(user_id,display_name) values(auth.uid(),left(trim(n),100)) on conflict(user_id) do nothing;
end $$;
revoke all on function public.create_my_profile(text) from public;
grant execute on function public.create_my_profile(text) to authenticated;

alter table public.member_profiles enable row level security;
alter table public.member_roles enable row level security;
alter table public.ministries enable row level security;
alter table public.ministry_members enable row level security;
alter table public.ministry_activities enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.member_updates enable row level security;
alter table public.church_settings enable row level security;
alter table public.donation_records enable row level security;

create policy "profiles readable by self, admins, or opted-in directory" on public.member_profiles for select to authenticated using (
 user_id=auth.uid() or public.has_church_role('administrator') or public.has_church_role('pastor')
 or (approved and directory_visible and public.is_approved_member(auth.uid())));
create policy "profile owner update" on public.member_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
-- Restrict self-edit to nonprivileged columns via grants (column UPDATE grants override broad table UPDATE).
revoke update on public.member_profiles from authenticated;
grant update(display_name,bio,directory_visible,directory_contact_visible,contact_email) on public.member_profiles to authenticated;
create policy "admins approve profiles" on public.member_profiles for update to authenticated using(public.has_church_role('administrator')) with check(public.has_church_role('administrator'));
-- Approval is performed using dedicated RPC, not client table UPDATE.
create or replace function public.set_member_approval(u uuid, v boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_church_role('administrator') then raise exception 'Not authorized'; end if;
 update public.member_profiles set approved=v where user_id=u;
end $$;
revoke all on function public.set_member_approval(uuid,boolean) from public;
grant execute on function public.set_member_approval(uuid,boolean) to authenticated;
create policy "roles read own or admin" on public.member_roles for select to authenticated using(user_id=auth.uid() or public.has_church_role('administrator'));
create policy "ministries read approved" on public.ministries for select to authenticated using(public.is_approved_member(auth.uid()) or public.has_church_role('administrator'));
create policy "ministries admin manage" on public.ministries for all to authenticated using(public.has_church_role('administrator')) with check(public.has_church_role('administrator'));
create policy "ministry members read their group or admin" on public.ministry_members for select to authenticated using(public.is_ministry_member(ministry_id,auth.uid()) or public.has_church_role('administrator'));
create policy "ministry members admin manage" on public.ministry_members for all to authenticated using(public.has_church_role('administrator')) with check(public.has_church_role('administrator'));
create policy "activities visible to group" on public.ministry_activities for select to authenticated using(public.is_ministry_member(ministry_id,auth.uid()) or public.has_church_role('administrator'));
create policy "activities leaders manage" on public.ministry_activities for all to authenticated using(public.is_ministry_leader(ministry_id,auth.uid())) with check(public.is_ministry_leader(ministry_id,auth.uid()));
create policy "conversations participant read" on public.conversations for select to authenticated using(public.can_read_conversation(id,auth.uid()));
create policy "conversation members participant read" on public.conversation_members for select to authenticated using(public.can_read_conversation(conversation_id,auth.uid()));
create policy "messages participants read" on public.messages for select to authenticated using(public.can_read_conversation(conversation_id,auth.uid()));
create policy "messages participants send" on public.messages for insert to authenticated with check(sender_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid()));
create policy "updates group read" on public.member_updates for select to authenticated using(public.is_approved_member(auth.uid()) and (ministry_id is null or public.is_ministry_member(ministry_id,auth.uid())));
create policy "updates leaders create" on public.member_updates for insert to authenticated with check(created_by=auth.uid() and (ministry_id is null and public.has_church_role('administrator') or ministry_id is not null and public.is_ministry_leader(ministry_id,auth.uid())));
create policy "settings admin read" on public.church_settings for select to authenticated using(public.has_church_role('administrator') or public.has_church_role('finance'));
create policy "donation read only authorized" on public.donation_records for select to authenticated using(
 exists(select 1 from public.church_settings where id=true and donation_history_enabled=true)
 and (donor_id=auth.uid() or public.has_church_role('finance') or public.has_church_role('administrator')));
create policy "donation finance write" on public.donation_records for insert to authenticated with check(public.has_church_role('finance') or public.has_church_role('administrator'));
-- Enable Realtime publications for new messages and updates in Supabase Dashboard > Database > Publications.
