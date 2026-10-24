-- Run after the existing Church Connect migrations. Additive; preserves all records.
begin;
alter table public.conversations drop constraint if exists conversations_check;
alter table public.conversations add constraint conversations_check check((kind in ('direct','group') and ministry_id is null) or (kind='ministry' and ministry_id is not null));
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check(kind in ('direct','ministry','group'));
alter table public.conversations add column if not exists title text;
alter table public.conversations add column if not exists owner_id uuid references auth.users(id);
alter table public.conversations add column if not exists parent_id uuid references public.conversations(id);
alter table public.conversations add column if not exists announcement_only boolean not null default false;
alter table public.conversations add column if not exists archived boolean not null default false;
alter table public.messages add column if not exists reply_to uuid references public.messages(id);
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists attachment jsonb;
alter table public.messages add column if not exists poll jsonb;
alter table public.messages add column if not exists pinned boolean not null default false;
alter table public.messages add column if not exists client_id uuid;
create unique index if not exists cc_message_client on public.messages(sender_id,client_id) where client_id is not null;
create index if not exists cc_message_history on public.messages(conversation_id,created_at desc,id desc);
create table if not exists public.cc_chat_preferences(user_id uuid references auth.users(id) on delete cascade, conversation_id uuid references public.conversations(id) on delete cascade, muted boolean not null default false, primary key(user_id,conversation_id));
create table if not exists public.cc_message_marks(user_id uuid references auth.users(id) on delete cascade,message_id uuid references public.messages(id) on delete cascade,reaction text check(reaction in ('❤️','👍','🙏','🙌','✅')),saved boolean not null default false,acknowledged boolean not null default false, vote integer check(vote between 0 and 9),primary key(user_id,message_id));
create table if not exists public.cc_messaging_settings(user_id uuid primary key references auth.users(id) on delete cascade,allow_direct boolean not null default true,quiet_start integer check(quiet_start between 0 and 23),quiet_end integer check(quiet_end between 0 and 23),timezone text not null default 'America/New_York');
create table if not exists public.cc_message_blocks(user_id uuid references auth.users(id) on delete cascade,blocked_id uuid references auth.users(id) on delete cascade,primary key(user_id,blocked_id),check(user_id<>blocked_id));
create table if not exists public.cc_message_reports(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),message_id uuid references public.messages(id),reason text not null check(length(reason) between 3 and 1000),created_at timestamptz not null default now());
create or replace function public.can_read_conversation(c uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_approved_member(u) and exists(select 1 from public.conversations x join public.member_profiles p on p.user_id=u and p.church_id=x.church_id where x.id=c and (x.parent_id is null or public.can_read_conversation(x.parent_id,u)) and ((x.kind in ('direct','group') and exists(select 1 from public.conversation_members cm where cm.conversation_id=c and cm.user_id=u)) or (x.kind='ministry' and public.is_ministry_member(x.ministry_id,u))));
$$;
create or replace function public.cc_chat_manager(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_read_conversation(c,auth.uid()) and exists(select 1 from public.conversations x where x.id=c and (x.owner_id=auth.uid() or public.cc_is_admin() or exists(select 1 from public.ministry_members mm where mm.ministry_id=x.ministry_id and mm.user_id=auth.uid() and mm.is_leader)));
$$;
-- All writes pass through checked functions; read policies also require conversation access.
do $$ declare t text; begin foreach t in array array['cc_chat_preferences','cc_message_marks','cc_messaging_settings','cc_message_blocks','cc_message_reports'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop; end $$;
drop policy if exists cc_own on public.cc_chat_preferences;
create policy cc_own on public.cc_chat_preferences for select to authenticated using(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid()));
drop policy if exists cc_own on public.cc_message_marks;
create policy cc_own on public.cc_message_marks for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.messages m where m.id=message_id and public.can_read_conversation(m.conversation_id,auth.uid())));
drop policy if exists cc_own on public.cc_messaging_settings;
create policy cc_own on public.cc_messaging_settings for select to authenticated using(user_id=auth.uid());
drop policy if exists cc_own on public.cc_message_blocks;
create policy cc_own on public.cc_message_blocks for select to authenticated using(user_id=auth.uid());
drop policy if exists cc_own on public.cc_message_reports;
create policy cc_own on public.cc_message_reports for select to authenticated using(user_id=auth.uid() or (public.cc_is_admin() and exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=message_id and c.church_id=public.cc_my_church_id())));

create or replace function public.cc_chat_people(c uuid) returns table(user_id uuid,display_name text,photo_path text,photo_visible boolean,gender text) language sql stable security definer set search_path='' as $$
 select p.user_id,p.display_name,case when p.photo_visible then p.photo_path end,p.photo_visible,p.gender from public.member_profiles p where public.can_read_conversation(c,auth.uid()) and p.approved and p.church_id=public.cc_my_church_id() and (exists(select 1 from public.conversation_members cm where cm.conversation_id=c and cm.user_id=p.user_id) or exists(select 1 from public.conversations x join public.ministry_members mm on mm.ministry_id=x.ministry_id where x.id=c and x.kind='ministry' and mm.user_id=p.user_id));
$$;
create or replace function public.cc_chat_list() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row_to_json(q) order by q.last_at desc nulls last),'[]'::jsonb) from (select c.*,public.cc_chat_manager(c.id) as can_manage,coalesce(pr.muted,false) as muted,(select m.body from public.messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1) as preview,(select max(m.created_at) from public.messages m where m.conversation_id=c.id) as last_at,coalesce(c.title,(select mn.name from public.ministries mn where mn.id=c.ministry_id),(select string_agg(p.display_name,', ') from public.cc_chat_people(c.id) p where p.user_id<>auth.uid()),'Conversation') as label from public.conversations c left join public.cc_chat_preferences pr on pr.conversation_id=c.id and pr.user_id=auth.uid() where public.can_read_conversation(c.id,auth.uid())) q;
$$;
create or replace function public.cc_chat_action(c uuid,a text,p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare x public.conversations; m public.messages; mid uuid; v uuid; opts jsonb; target uuid; parent public.conversations;
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Approved membership required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'Church is read-only'; end if;
 if a='settings' then
  if not exists(select 1 from pg_timezone_names where name=coalesce(p->>'timezone','America/New_York')) then raise exception 'Invalid time zone'; end if;
  insert into public.cc_messaging_settings(user_id,allow_direct,quiet_start,quiet_end,timezone) values(auth.uid(),coalesce((p->>'allow_direct')::boolean,true),(p->>'quiet_start')::integer,(p->>'quiet_end')::integer,coalesce(p->>'timezone','America/New_York')) on conflict(user_id) do update set allow_direct=excluded.allow_direct,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,timezone=excluded.timezone; return '{}'::jsonb;
 end if;
 if a='block' then
  target:=(p->>'user_id')::uuid;
  if not public.cc_same_church_user(target) then raise exception 'Member unavailable'; end if;
  if coalesce((p->>'enabled')::boolean,true) then insert into public.cc_message_blocks values(auth.uid(),target) on conflict do nothing; else delete from public.cc_message_blocks where user_id=auth.uid() and blocked_id=target; end if; return '{}'::jsonb;
 end if;
 if a='create' then
  if length(trim(coalesce(p->>'title',''))) not between 2 and 100 then raise exception 'Use a group name of 2–100 characters'; end if;
  if (p->>'parent_id') is not null then select * into parent from public.conversations where id=(p->>'parent_id')::uuid; if not public.cc_chat_manager(parent.id) or parent.kind='direct' then raise exception 'Only group leaders can create topics'; end if; end if;
  insert into public.conversations(kind,church_id,title,owner_id,parent_id,announcement_only) values('group',public.cc_my_church_id(),trim(p->>'title'),auth.uid(),parent.id,coalesce((p->>'announcement_only')::boolean,false)) returning id into v;
  insert into public.conversation_members values(v,auth.uid());
  if parent.id is not null then insert into public.conversation_members select v,q.user_id from public.cc_chat_people(parent.id) q on conflict do nothing;
  else for target in select value::text::uuid from jsonb_array_elements_text(coalesce(p->'members','[]'::jsonb)) loop
   if not public.cc_same_church_user(target) or not public.is_approved_member(target) or exists(select 1 from public.cc_message_blocks b where (b.user_id=target and b.blocked_id=auth.uid()) or (b.user_id=auth.uid() and b.blocked_id=target)) then raise exception 'Member unavailable'; end if;
   if exists(select 1 from public.cc_messaging_settings s where s.user_id=target and not s.allow_direct) then raise exception 'Member is not accepting invitations'; end if;
   insert into public.conversation_members values(v,target) on conflict do nothing;
  end loop; end if;
  return jsonb_build_object('id',v);
 end if;
 select * into x from public.conversations where id=c for update;
 if not found or not public.can_read_conversation(c,auth.uid()) then raise exception 'Conversation unavailable'; end if;
 if a='preferences' then insert into public.cc_chat_preferences values(auth.uid(),c,coalesce((p->>'muted')::boolean,false)) on conflict(user_id,conversation_id) do update set muted=excluded.muted; return '{}'::jsonb; end if;
 if a='unread' then insert into public.conversation_read_states values(c,auth.uid(),coalesce((select max(created_at)-interval '1 microsecond' from public.messages where conversation_id=c),'1970-01-01')) on conflict(conversation_id,user_id) do update set last_read_at=excluded.last_read_at; return '{}'::jsonb; end if;
 if a='manage' then
  if not public.cc_chat_manager(c) then raise exception 'Leader access required'; end if;
  if p ? 'title' and length(trim(coalesce(p->>'title',''))) not between 2 and 100 then raise exception 'Use a group name of 2–100 characters'; end if;
  update public.conversations set title=coalesce(p->>'title',title),archived=coalesce((p->>'archived')::boolean,archived),announcement_only=coalesce((p->>'announcement_only')::boolean,announcement_only) where id=c;
  if p ? 'member_id' then
   target:=(p->>'member_id')::uuid;
   if x.kind<>'group' then raise exception 'Manage ministry membership in Administration'; end if;
   if target=x.owner_id then raise exception 'Transfer leadership before removing the owner'; end if;
   if (p->>'remove')::boolean then delete from public.conversation_members where conversation_id=c and user_id=target;
   else if not public.cc_same_church_user(target) or not public.is_approved_member(target) or exists(select 1 from public.cc_messaging_settings where user_id=target and not allow_direct) or exists(select 1 from public.cc_message_blocks b where (b.user_id=target and b.blocked_id=auth.uid()) or (b.user_id=auth.uid() and b.blocked_id=target)) then raise exception 'Member unavailable'; end if; insert into public.conversation_members values(c,target) on conflict do nothing; end if;
  end if;
  if p ? 'owner_id' then target:=(p->>'owner_id')::uuid; if x.kind<>'group' or not exists(select 1 from public.conversation_members where conversation_id=c and user_id=target) then raise exception 'Choose an existing participant'; end if; update public.conversations set owner_id=target where id=c; end if;
  return '{}'::jsonb;
 end if;
 if a='send' then
  if x.archived or (x.announcement_only and not public.cc_chat_manager(c)) then raise exception 'Only leaders may post here'; end if;
  if (p->>'body') ~* '@(everyone|all)\y' and not public.cc_chat_manager(c) then raise exception 'Only leaders can mention the whole group'; end if;
  if x.kind='direct' and exists(select 1 from public.conversation_members cm join public.cc_message_blocks b on (b.user_id=cm.user_id and b.blocked_id=auth.uid()) or (b.blocked_id=cm.user_id and b.user_id=auth.uid()) where cm.conversation_id=c) then raise exception 'This private conversation is blocked'; end if;
  if p ? 'reply_to' and not exists(select 1 from public.messages where id=(p->>'reply_to')::uuid and conversation_id=c) then raise exception 'Reply unavailable'; end if;
  if p ? 'poll' then opts:=p->'poll'->'options'; if jsonb_typeof(opts)<>'array' or jsonb_array_length(opts) not between 2 and 10 or length(p->'poll'->>'question') not between 1 and 300 then raise exception 'A poll needs a question and 2–10 options'; end if; if exists(select 1 from jsonb_array_elements_text(opts) o where length(o) not between 1 and 200) then raise exception 'Poll options must be 1–200 characters'; end if; end if;
  if p ? 'attachment' then if not ((p->'attachment'->>'path') like c::text||'/'||auth.uid()::text||'/%') or not exists(select 1 from storage.objects where bucket_id='chat-files' and name=p->'attachment'->>'path') then raise exception 'Attachment unavailable'; end if; end if;
  insert into public.messages(conversation_id,sender_id,body,reply_to,attachment,poll,client_id) values(c,auth.uid(),trim(p->>'body'),(p->>'reply_to')::uuid,p->'attachment',p->'poll',(p->>'client_id')::uuid) on conflict(sender_id,client_id) where client_id is not null do update set client_id=excluded.client_id returning id into mid;
  return jsonb_build_object('id',mid);
 end if;
 select * into m from public.messages where id=(p->>'message_id')::uuid and conversation_id=c for update;
 if not found then raise exception 'Message unavailable'; end if;
 if a in ('edit','delete') then
  if m.sender_id<>auth.uid() and not (a='delete' and public.cc_chat_manager(c)) then raise exception 'Cannot change this message'; end if;
  if m.deleted_at is not null then raise exception 'Message already deleted'; end if;
  if a='edit' then update public.messages set body=trim(p->>'body'),edited_at=now() where id=m.id;
  else update public.messages set body='Message deleted',deleted_at=now(),attachment=null,poll=null,pinned=false where id=m.id; end if;
 elsif a='pin' then if not public.cc_chat_manager(c) then raise exception 'Leader access required'; end if; update public.messages set pinned=not pinned where id=m.id;
 elsif a='report' then insert into public.cc_message_reports(user_id,message_id,reason) values(auth.uid(),m.id,p->>'reason');
 elsif a='mark' then
  if p ? 'vote' and (m.poll is null or (p->>'vote')::integer<0 or (p->>'vote')::integer>=jsonb_array_length(m.poll->'options')) then raise exception 'Invalid poll option'; end if;
  insert into public.cc_message_marks(user_id,message_id) values(auth.uid(),m.id) on conflict do nothing;
  update public.cc_message_marks set saved=case when p ? 'saved' then (p->>'saved')::boolean else saved end,reaction=case when p ? 'reaction' then p->>'reaction' else reaction end,acknowledged=case when p ? 'acknowledged' then (p->>'acknowledged')::boolean else acknowledged end,vote=case when p ? 'vote' then (p->>'vote')::integer else vote end where user_id=auth.uid() and message_id=m.id;
 else raise exception 'Unknown action'; end if;
 return '{}'::jsonb;
end $$;
-- Existing clients cannot bypass the checked send action.
revoke insert,update,delete on public.messages from authenticated;
drop function if exists public.cc_message_activity(uuid);
create or replace function public.cc_message_activity(c uuid,p_ids uuid[] default null) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('message_id',m.id,'reactions',(select coalesce(jsonb_object_agg(r.reaction,r.n),'{}'::jsonb) from (select mk.reaction,count(*) n from public.cc_message_marks mk where mk.message_id=m.id and mk.reaction is not null group by mk.reaction) r),'votes',(select coalesce(jsonb_object_agg(v.vote,v.n),'{}'::jsonb) from (select mk.vote,count(*) n from public.cc_message_marks mk where mk.message_id=m.id and mk.vote is not null group by mk.vote) v),'acknowledged',(select count(*) from public.cc_message_marks mk where mk.message_id=m.id and mk.acknowledged),'mine',(select row_to_json(mk) from public.cc_message_marks mk where mk.message_id=m.id and mk.user_id=auth.uid()))),'[]'::jsonb) from public.messages m where m.conversation_id=c and public.can_read_conversation(c,auth.uid()) and (p_ids is null or m.id=any(p_ids));
$$;
-- Guard direct-message invitations independently of directory listing, retaining the existing RPC.
create or replace function public.cc_guard_direct() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.conversations where id=new.conversation_id and kind='direct') and new.user_id<>auth.uid() and (exists(select 1 from public.cc_messaging_settings where user_id=new.user_id and not allow_direct) or exists(select 1 from public.cc_message_blocks b where (b.user_id=new.user_id and b.blocked_id=auth.uid()) or (b.user_id=auth.uid() and b.blocked_id=new.user_id))) then raise exception 'Member is not accepting private messages'; end if;
 return new;
end $$;
drop trigger if exists cc_guard_direct on public.conversation_members;
create trigger cc_guard_direct before insert on public.conversation_members for each row execute function public.cc_guard_direct();
-- Private file paths bind both conversation and uploader; access is checked again on every download.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('chat-files','chat-files',false,15728640,array['image/jpeg','image/png','image/webp','application/pdf','text/plain','audio/webm','audio/ogg','audio/mp4','video/mp4']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists cc_chat_file_read on storage.objects;
create policy cc_chat_file_read on storage.objects for select to authenticated using(bucket_id='chat-files' and exists(select 1 from public.conversations c where c.id::text=(storage.foldername(name))[1] and public.can_read_conversation(c.id,auth.uid())));
drop policy if exists cc_chat_file_upload on storage.objects;
create policy cc_chat_file_upload on storage.objects for insert to authenticated with check(bucket_id='chat-files' and (storage.foldername(name))[2]=auth.uid()::text and exists(select 1 from public.conversations c where c.id::text=(storage.foldername(name))[1] and public.can_read_conversation(c.id,auth.uid()) and not c.archived and public.cc_church_writable(c.church_id) and (not c.announcement_only or public.cc_chat_manager(c.id))));
do $$ declare f record; begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cc_chat_manager','cc_chat_people','cc_chat_list','cc_chat_action','cc_message_activity') loop execute format('revoke all on function %s from public',f.sig);execute format('grant execute on function %s to authenticated',f.sig);end loop;end $$;
-- (Subscription ids in this app are numbers, not uuids.)
-- Per-device delivery receipts allow partial failures to be retried without duplicating successful pushes.
create table if not exists public.cc_push_attempts(message_id uuid not null,subscription_id bigint not null,status text not null default 'pending',attempted_at timestamptz not null default now(),primary key(message_id,subscription_id));
alter table public.cc_push_attempts enable row level security;
revoke all on public.cc_push_attempts from public,anon,authenticated;
grant all on public.cc_push_attempts to service_role;
drop function if exists public.cc_claim_push(uuid,uuid);
create or replace function public.cc_claim_push(p_message uuid,p_subscription bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into public.cc_push_attempts(message_id,subscription_id,status) values(p_message,p_subscription,'sending') on conflict(message_id,subscription_id) do update set status='sending',attempted_at=now() where cc_push_attempts.status='pending' or (cc_push_attempts.status='sending' and cc_push_attempts.attempted_at<now()-interval '5 minutes');
 get diagnostics n=row_count;return n>0;
end $$;
revoke all on function public.cc_claim_push(uuid,bigint) from public,anon,authenticated;
grant execute on function public.cc_claim_push(uuid,bigint) to service_role;
create table if not exists public.cc_event_rsvps(event_id uuid references public.church_events(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,response text not null check(response in ('going','maybe','unable')),primary key(event_id,user_id));
alter table public.cc_event_rsvps enable row level security;
revoke all on public.cc_event_rsvps from public,anon,authenticated;
grant select on public.cc_event_rsvps to authenticated;
drop policy if exists cc_event_rsvp_read on public.cc_event_rsvps;
create policy cc_event_rsvp_read on public.cc_event_rsvps for select to authenticated using(user_id=auth.uid() or (public.cc_is_admin() and exists(select 1 from public.church_events e where e.id=event_id and e.church_id=public.cc_my_church_id())));
create or replace function public.cc_event_rsvp(p_event uuid,p_response text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_approved_member(auth.uid()) or not public.cc_church_writable(public.cc_my_church_id()) or not exists(select 1 from public.church_events where id=p_event and church_id=public.cc_my_church_id() and published) then raise exception 'Event unavailable'; end if;
 insert into public.cc_event_rsvps values(p_event,auth.uid(),p_response) on conflict(event_id,user_id) do update set response=excluded.response;
end $$;
revoke all on function public.cc_event_rsvp(uuid,text) from public;
grant execute on function public.cc_event_rsvp(uuid,text) to authenticated;
create or replace function public.cc_messaging_health() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.cc_is_admin() then raise exception 'Administrator required'; end if;
 select jsonb_build_object('reports',coalesce((select jsonb_agg(row_to_json(q)) from (select r.id,r.reason,r.created_at,m.body,c.title from public.cc_message_reports r join public.messages m on m.id=r.message_id join public.conversations c on c.id=m.conversation_id where c.church_id=public.cc_my_church_id() order by r.created_at desc limit 50) q),'[]'::jsonb),'push',coalesce((select jsonb_object_agg(q.status,q.n) from (select a.status,count(*) n from public.cc_push_attempts a join public.member_push_subscriptions s on s.id=a.subscription_id join public.member_profiles p on p.user_id=s.user_id where p.church_id=public.cc_my_church_id() and a.attempted_at>now()-interval '7 days' group by a.status) q),'{}'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.cc_messaging_health() from public;
grant execute on function public.cc_messaging_health() to authenticated;
create or replace function public.cc_push_recipient_ids(p_conversation uuid) returns table(user_id uuid) language sql stable security definer set search_path='' as $$
 select p.user_id from public.member_profiles p where public.can_read_conversation(p_conversation,p.user_id);
$$;
revoke all on function public.cc_push_recipient_ids(uuid) from public,anon,authenticated;
grant execute on function public.cc_push_recipient_ids(uuid) to service_role;
commit;
