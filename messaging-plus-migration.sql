-- Church Connect: messaging safety layer. Run AFTER messaging-upgrade.sql (and every earlier file). Safe to run more than once.
-- Adds: "ask me first" message requests, youth rules with guardians (and a private date of birth), announcement pin / expiry /
-- "I've seen this", who is coming to an event (for administrators), and a fuller messaging health summary.
-- It builds on the blocking, "allow invitations" and push-delivery tables that messaging-upgrade.sql creates.

-- ------------------------------------------------------------------------------------------------
-- 1. Date of birth (private) and youth
-- ------------------------------------------------------------------------------------------------
create table if not exists public.cc_member_safety (
 user_id uuid primary key,
 church_id uuid not null default public.cc_my_church_id(),
 birth_date date,
 updated_at timestamptz not null default now()
);
alter table public.cc_member_safety enable row level security;
revoke all on public.cc_member_safety from anon, authenticated;
grant select on public.cc_member_safety to authenticated;
drop policy if exists cc_member_safety_read on public.cc_member_safety;
create policy cc_member_safety_read on public.cc_member_safety for select to authenticated
 using (church_id = public.cc_my_church_id() and (user_id = auth.uid() or public.cc_is_admin()));

-- A member can enter their own date of birth once. Only an administrator can change it afterwards (so a young member cannot simply edit it).
create or replace function public.cc_set_my_birth_date(p_date date) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if p_date is null or p_date > current_date or p_date < date '1900-01-01' then raise exception 'Enter a real date of birth'; end if;
 if exists(select 1 from public.cc_member_safety where user_id=auth.uid() and birth_date is not null) then
  raise exception 'Your date of birth is already saved. Ask a church administrator to change it.';
 end if;
 insert into public.cc_member_safety(user_id,church_id,birth_date) values(auth.uid(),public.cc_my_church_id(),p_date)
  on conflict (user_id) do update set birth_date=excluded.birth_date, updated_at=now();
end $$;
revoke all on function public.cc_set_my_birth_date(date) from public;
grant execute on function public.cc_set_my_birth_date(date) to authenticated;

create or replace function public.cc_admin_set_birth_date(p_user uuid, p_date date) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_same_church_user(p_user) then raise exception 'Member not found'; end if;
 if p_date is not null and (p_date > current_date or p_date < date '1900-01-01') then raise exception 'Enter a real date of birth'; end if;
 insert into public.cc_member_safety(user_id,church_id,birth_date) values(p_user,public.cc_my_church_id(),p_date)
  on conflict (user_id) do update set birth_date=excluded.birth_date, updated_at=now();
end $$;
revoke all on function public.cc_admin_set_birth_date(uuid,date) from public;
grant execute on function public.cc_admin_set_birth_date(uuid,date) to authenticated;

-- Youth = under 18 (a member with no date of birth saved is treated as an adult).
create or replace function public.cc_is_youth(u uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select s.birth_date > (current_date - interval '18 years')::date from public.cc_member_safety s where s.user_id=u),false);
$$;
revoke all on function public.cc_is_youth(uuid) from public;
grant execute on function public.cc_is_youth(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 2. Guardians (an administrator links a parent or guardian to a young member)
-- ------------------------------------------------------------------------------------------------
create table if not exists public.cc_guardians (
 youth_id uuid not null,
 guardian_id uuid not null,
 church_id uuid not null default public.cc_my_church_id(),
 created_at timestamptz not null default now(),
 primary key (youth_id, guardian_id),
 check (youth_id <> guardian_id)
);
alter table public.cc_guardians enable row level security;
revoke all on public.cc_guardians from anon, authenticated;
grant select on public.cc_guardians to authenticated;
drop policy if exists cc_guardians_read on public.cc_guardians;
create policy cc_guardians_read on public.cc_guardians for select to authenticated
 using (church_id = public.cc_my_church_id() and (guardian_id = auth.uid() or youth_id = auth.uid() or public.cc_is_admin()));

create or replace function public.cc_set_guardian(p_youth uuid, p_guardian uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_same_church_user(p_youth) or not public.cc_same_church_user(p_guardian) then raise exception 'Member not found'; end if;
 if p_on then
  insert into public.cc_guardians(youth_id,guardian_id,church_id) values(p_youth,p_guardian,public.cc_my_church_id()) on conflict do nothing;
 else
  delete from public.cc_guardians where youth_id=p_youth and guardian_id=p_guardian and church_id=public.cc_my_church_id();
 end if;
end $$;
revoke all on function public.cc_set_guardian(uuid,uuid,boolean) from public;
grant execute on function public.cc_set_guardian(uuid,uuid,boolean) to authenticated;

create or replace function public.cc_is_guardian_of(g uuid, y uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cc_guardians where guardian_id=g and youth_id=y);
$$;
revoke all on function public.cc_is_guardian_of(uuid,uuid) from public;
grant execute on function public.cc_is_guardian_of(uuid,uuid) to authenticated;

-- Adults and youth may not message each other privately unless one is the other's guardian.
create or replace function public.cc_youth_rule_ok(a uuid, b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.cc_is_youth(a) = public.cc_is_youth(b) or public.cc_is_guardian_of(a,b) or public.cc_is_guardian_of(b,a);
$$;
revoke all on function public.cc_youth_rule_ok(uuid,uuid) from public;
grant execute on function public.cc_youth_rule_ok(uuid,uuid) to authenticated;

create or replace function public.cc_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cc_message_blocks where (user_id=a and blocked_id=b) or (user_id=b and blocked_id=a));
$$;
revoke all on function public.cc_blocked_between(uuid,uuid) from public;
grant execute on function public.cc_blocked_between(uuid,uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 3. Who may start a private chat: "any member", "ask me first", or "no one" (groups still work)
-- ------------------------------------------------------------------------------------------------
alter table public.cc_messaging_settings add column if not exists request_first boolean not null default false;

create or replace function public.cc_set_chat_mode(p_mode text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if p_mode not in ('open','ask','off') then raise exception 'Choose open, ask or off'; end if;
 insert into public.cc_messaging_settings(user_id,allow_direct,request_first) values(auth.uid(), p_mode <> 'off', p_mode = 'ask')
  on conflict (user_id) do update set allow_direct = excluded.allow_direct, request_first = excluded.request_first;
end $$;
revoke all on function public.cc_set_chat_mode(text) from public;
grant execute on function public.cc_set_chat_mode(text) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 4. Message requests
-- ------------------------------------------------------------------------------------------------
alter table public.conversations add column if not exists status text not null default 'active';
alter table public.conversations add column if not exists requested_by uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='conversations_status_check') then
  alter table public.conversations add constraint conversations_status_check check (status in ('active','request'));
 end if;
end $$;

create or replace function public.start_direct_chat(recipient uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid; me uuid := auth.uid(); v_ask boolean; v_allow boolean;
begin
 if me is null or recipient=me or not public.is_approved_member(me) or not public.is_approved_member(recipient) then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(recipient) then raise exception 'Recipient is not available'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if not exists(select 1 from public.member_profiles where user_id=recipient and directory_visible=true) then raise exception 'Recipient is not available'; end if;
 if public.cc_blocked_between(me,recipient) then raise exception 'Recipient is not available'; end if;
 if not public.cc_youth_rule_ok(me,recipient) then raise exception 'Private messages between adults and youth are not available. Use a ministry group chat, or ask a guardian.'; end if;
 perform pg_advisory_xact_lock(hashtext(least(me::text,recipient::text)||greatest(me::text,recipient::text)));
 select c.id into cid from public.conversations c join public.conversation_members a on a.conversation_id=c.id and a.user_id=me
 join public.conversation_members b on b.conversation_id=c.id and b.user_id=recipient
 where c.kind='direct' and (select count(*) from public.conversation_members x where x.conversation_id=c.id)=2 limit 1;
 if cid is null then
  select coalesce((select allow_direct from public.cc_messaging_settings where user_id=recipient),true),
         coalesce((select request_first from public.cc_messaging_settings where user_id=recipient),false) into v_allow, v_ask;
  if not v_allow then raise exception 'This member is not accepting new private messages. You can still reach them in a ministry group.'; end if;
  insert into public.conversations(kind,church_id,status,requested_by)
   values('direct',public.cc_my_church_id(),case when v_ask then 'request' else 'active' end,case when v_ask then me end) returning id into cid;
  insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,recipient);
 end if;
 return cid;
end $$;

-- The person who was asked can accept, decline (removes the request), or block the sender.
create or replace function public.cc_respond_chat(p_conversation uuid, p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare v_by uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select requested_by into v_by from public.conversations
  where id=p_conversation and kind='direct' and status='request' and church_id=public.cc_my_church_id();
 if v_by is null then raise exception 'Request not found'; end if;
 if v_by = auth.uid() or not exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=auth.uid()) then raise exception 'Not authorized'; end if;
 if p_action = 'accept' then
  update public.conversations set status='active' where id=p_conversation;
 elsif p_action in ('decline','block') then
  if p_action = 'block' then
   insert into public.cc_message_blocks(user_id,blocked_id) values(auth.uid(),v_by) on conflict do nothing;
  end if;
  delete from public.conversations where id=p_conversation;  -- messages, members and read markers go with it
 else raise exception 'Choose accept, decline or block'; end if;
end $$;
revoke all on function public.cc_respond_chat(uuid,text) from public;
grant execute on function public.cc_respond_chat(uuid,text) to authenticated;

-- Checked by the database on every new message, whichever way it arrives: the youth rule, and "one message until accepted".
create or replace function public.cc_message_rules() returns trigger
language plpgsql security definer set search_path='' as $$
declare v record; v_other uuid;
begin
 select kind,status,requested_by into v from public.conversations where id=new.conversation_id;
 if v.kind is distinct from 'direct' then return new; end if;
 -- a re-sent copy of a message that already went through is not a new message
 if new.client_id is not null and exists(select 1 from public.messages where sender_id=new.sender_id and client_id=new.client_id) then return new; end if;
 select user_id into v_other from public.conversation_members where conversation_id=new.conversation_id and user_id<>new.sender_id limit 1;
 if v_other is not null and not public.cc_youth_rule_ok(new.sender_id,v_other) then raise exception 'Private messages between adults and youth are not available'; end if;
 if v.status='request' then
  if v.requested_by is distinct from new.sender_id or exists(select 1 from public.messages where conversation_id=new.conversation_id) then
   raise exception 'This message request is waiting to be accepted';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists cc_message_rules on public.messages;
create trigger cc_message_rules before insert on public.messages for each row execute function public.cc_message_rules();

-- ------------------------------------------------------------------------------------------------
-- 5. Guardians may READ (never write in) the conversations a young member they look after is part of
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_guardian_can_view(c uuid, u uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_approved_member(u) and exists(
  select 1 from public.cc_guardians g join public.conversations x on x.id=c
  where g.guardian_id=u and (
   (x.kind in ('direct','group') and exists(select 1 from public.conversation_members cm where cm.conversation_id=c and cm.user_id=g.youth_id))
   or (x.kind='ministry' and public.is_ministry_member(x.ministry_id,g.youth_id))));
$$;
revoke all on function public.cc_guardian_can_view(uuid,uuid) from public;
grant execute on function public.cc_guardian_can_view(uuid,uuid) to authenticated;
drop policy if exists cc_guardian_read_conversations on public.conversations;
create policy cc_guardian_read_conversations on public.conversations for select to authenticated using (public.cc_guardian_can_view(id, auth.uid()));
drop policy if exists cc_guardian_read_members on public.conversation_members;
create policy cc_guardian_read_members on public.conversation_members for select to authenticated using (public.cc_guardian_can_view(conversation_id, auth.uid()));
drop policy if exists cc_guardian_read_messages on public.messages;
create policy cc_guardian_read_messages on public.messages for select to authenticated using (public.cc_guardian_can_view(conversation_id, auth.uid()));

create or replace function public.cc_my_youth_conversations() returns table(conversation_id uuid, youth_id uuid, youth_name text, kind text, label text)
language sql stable security definer set search_path='' as $$
 select x.id, g.youth_id, p.display_name, x.kind,
  coalesce(x.title,(select mn.name from public.ministries mn where mn.id=x.ministry_id),
   (select string_agg(q.display_name,', ') from public.member_profiles q join public.conversation_members cm on cm.user_id=q.user_id and cm.conversation_id=x.id where q.user_id<>g.youth_id),'Conversation')
 from public.cc_guardians g
 join public.member_profiles p on p.user_id=g.youth_id
 join public.conversations x on (
  (x.kind in ('direct','group') and exists(select 1 from public.conversation_members cm where cm.conversation_id=x.id and cm.user_id=g.youth_id))
  or (x.kind='ministry' and public.is_ministry_member(x.ministry_id,g.youth_id)))
 where g.guardian_id=auth.uid() and public.is_approved_member(auth.uid());
$$;
revoke all on function public.cc_my_youth_conversations() from public;
grant execute on function public.cc_my_youth_conversations() to authenticated;

-- Names for the people in the conversations a guardian is reading.
create or replace function public.cc_guardian_people(p_conversation uuid) returns table(user_id uuid, display_name text)
language sql stable security definer set search_path='' as $$
 select p.user_id, p.display_name from public.member_profiles p
 where public.cc_guardian_can_view(p_conversation,auth.uid()) and p.approved=true and p.church_id=public.cc_my_church_id()
  and (exists(select 1 from public.conversation_members cm where cm.conversation_id=p_conversation and cm.user_id=p.user_id)
   or exists(select 1 from public.conversations x join public.ministry_members mm on mm.ministry_id=x.ministry_id where x.id=p_conversation and x.kind='ministry' and mm.user_id=p.user_id));
$$;
revoke all on function public.cc_guardian_people(uuid) from public;
grant execute on function public.cc_guardian_people(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 6. The directory, as it should look to me (who is hidden, who I can start a chat with, who I blocked)
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_directory_rules() returns table(user_id uuid, hidden boolean, can_message boolean, blocked_by_me boolean)
language sql stable security definer set search_path='' as $$
 select p.user_id,
  (exists(select 1 from public.cc_message_blocks b where b.user_id=p.user_id and b.blocked_id=auth.uid()) or not public.cc_youth_rule_ok(auth.uid(),p.user_id)),
  not (public.cc_blocked_between(auth.uid(),p.user_id) or not public.cc_youth_rule_ok(auth.uid(),p.user_id) or not coalesce((select s.allow_direct from public.cc_messaging_settings s where s.user_id=p.user_id),true)),
  exists(select 1 from public.cc_message_blocks b where b.user_id=auth.uid() and b.blocked_id=p.user_id)
 from public.member_profiles p
 where p.approved=true and p.church_id=public.cc_my_church_id() and p.user_id<>auth.uid() and public.is_approved_member(auth.uid());
$$;
revoke all on function public.cc_directory_rules() from public;
grant execute on function public.cc_directory_rules() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 7. Announcements: pin, expiry, and "I've seen this"
-- ------------------------------------------------------------------------------------------------
alter table public.member_updates add column if not exists pinned boolean not null default false;
alter table public.member_updates add column if not exists expires_at timestamptz;

drop function if exists public.cc_send_broadcast(text,text);
create or replace function public.cc_send_broadcast(p_title text, p_body text, p_pinned boolean default false, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_church uuid:=public.cc_my_church_id();
begin
 if not public.cc_can_broadcast() then raise exception 'Only administrators and pastors can send a church-wide broadcast'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 120 then raise exception 'Title must be 2–120 characters'; end if;
 if length(trim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Message must be 1–2000 characters'; end if;
 if p_expires_at is not null and p_expires_at <= now() then raise exception 'The expiration must be in the future'; end if;
 -- Abuse guard: a church-wide message goes to everyone, so cap how often it can be sent.
 if (select count(*) from public.member_updates u where u.church_id=v_church and u.ministry_id is null and u.created_at>now()-interval '1 hour')>=10 then
  raise exception 'Too many broadcasts in the last hour. Please wait before sending another.';
 end if;
 insert into public.member_updates(church_id,title,body,ministry_id,created_by,pinned,expires_at)
 values(v_church,trim(p_title),trim(p_body),null,auth.uid(),coalesce(p_pinned,false),p_expires_at) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cc_send_broadcast(text,text,boolean,timestamptz) from public;
grant execute on function public.cc_send_broadcast(text,text,boolean,timestamptz) to authenticated;

create table if not exists public.cc_update_acks (
 update_id uuid not null,
 user_id uuid not null,
 church_id uuid not null default public.cc_my_church_id(),
 acked_at timestamptz not null default now(),
 primary key (update_id, user_id)
);
alter table public.cc_update_acks enable row level security;
revoke all on public.cc_update_acks from anon, authenticated;
grant select on public.cc_update_acks to authenticated;
drop policy if exists cc_update_acks_read on public.cc_update_acks;
create policy cc_update_acks_read on public.cc_update_acks for select to authenticated using (user_id = auth.uid());

create or replace function public.cc_ack_update(p_update_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if not exists(select 1 from public.member_updates u where u.id=p_update_id and u.church_id=public.cc_my_church_id()
   and (u.ministry_id is null or public.is_ministry_member(u.ministry_id,auth.uid()))) then raise exception 'Update not found'; end if;
 insert into public.cc_update_acks(update_id,user_id,church_id) values(p_update_id,auth.uid(),public.cc_my_church_id()) on conflict do nothing;
end $$;
revoke all on function public.cc_ack_update(uuid) from public;
grant execute on function public.cc_ack_update(uuid) to authenticated;

-- Who has said "I've seen this" on the recent church-wide announcements (administrators and pastors only).
create or replace function public.cc_update_ack_summary() returns table(update_id uuid, title text, created_at timestamptz, acked bigint, total bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_can_broadcast() then raise exception 'Not authorized'; end if;
 return query
 select u.id, u.title, u.created_at,
  (select count(*) from public.cc_update_acks a where a.update_id=u.id),
  (select count(*) from public.member_profiles p where p.church_id=u.church_id and p.approved=true)
 from public.member_updates u
 where u.church_id=public.cc_my_church_id() and u.ministry_id is null
 order by u.created_at desc limit 10;
end $$;
revoke all on function public.cc_update_ack_summary() from public;
grant execute on function public.cc_update_ack_summary() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 8. Who is coming (administrators see the names; everyone else sees only their own answer)
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_event_rsvp_names(p_event uuid) returns table(display_name text, response text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 return query select coalesce(p.display_name,'A member'), r.response from public.cc_event_rsvps r
  join public.church_events e on e.id=r.event_id and e.church_id=public.cc_my_church_id()
  left join public.member_profiles p on p.user_id=r.user_id
  where r.event_id=p_event order by r.response, p.display_name;
end $$;
revoke all on function public.cc_event_rsvp_names(uuid) from public;
grant execute on function public.cc_event_rsvp_names(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 9. Messaging health: the earlier summary (reports, push states) plus who has notifications on, and requests waiting
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_messaging_health() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v_church uuid:=public.cc_my_church_id();
begin
 if not public.cc_is_admin() then raise exception 'Administrator required'; end if;
 select jsonb_build_object(
  'reports',coalesce((select jsonb_agg(row_to_json(q)) from (select r.id,r.reason,r.created_at,m.body,c.title from public.cc_message_reports r join public.messages m on m.id=r.message_id join public.conversations c on c.id=m.conversation_id where c.church_id=v_church order by r.created_at desc limit 50) q),'[]'::jsonb),
  'push',coalesce((select jsonb_object_agg(q.status,q.n) from (select a.status,count(*) n from public.cc_push_attempts a join public.member_push_subscriptions s on s.id=a.subscription_id join public.member_profiles p on p.user_id=s.user_id where p.church_id=v_church and a.attempted_at>now()-interval '7 days' group by a.status) q),'{}'::jsonb),
  'approved_members',(select count(*) from public.member_profiles p where p.church_id=v_church and p.approved=true),
  'members_with_devices',(select count(distinct s.user_id) from public.member_push_subscriptions s join public.member_profiles p on p.user_id=s.user_id and p.church_id=v_church and p.approved=true),
  'open_requests',(select count(*) from public.conversations c where c.church_id=v_church and c.status='request')
 ) into result;
 return result;
end $$;
revoke all on function public.cc_messaging_health() from public;
grant execute on function public.cc_messaging_health() to authenticated;

-- Same church-fence the older tables have: only my own church's rows.
do $$ declare t text; begin
 foreach t in array array['cc_member_safety','cc_guardians','cc_update_acks'] loop
  execute format('drop policy if exists cc_tenant_all on public.%I', t);
  execute format('create policy cc_tenant_all on public.%I as restrictive for all to authenticated using (church_id = public.cc_my_church_id()) with check (church_id = public.cc_my_church_id())', t);
 end loop;
end $$;

notify pgrst, 'reload schema';
