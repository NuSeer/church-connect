-- Church Connect: the Whole Church group, ministry homes (schedule cards with files, RSVPs and a discussion), and the pastoral care channel.
-- Run AFTER messaging-upgrade.sql and messaging-plus-migration.sql. Safe to run more than once.

-- ------------------------------------------------------------------------------------------------
-- 1. Every ministry has its group chat (it is created automatically, and for ministries that do not have one yet)
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_ensure_ministry_conversation(p_ministry uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 select id into v_id from public.conversations where ministry_id=p_ministry and kind='ministry';
 if v_id is null then
  insert into public.conversations(kind,ministry_id,church_id)
   select 'ministry',m.id,m.church_id from public.ministries m where m.id=p_ministry
   on conflict do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.conversations where ministry_id=p_ministry and kind='ministry'; end if;
 end if;
 return v_id;
end $$;
revoke all on function public.cc_ensure_ministry_conversation(uuid) from public;

create or replace function public.cc_ministry_conversation_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform public.cc_ensure_ministry_conversation(new.id); return new; end $$;
drop trigger if exists cc_ministry_conversation on public.ministries;
create trigger cc_ministry_conversation after insert on public.ministries for each row execute function public.cc_ministry_conversation_trigger();
do $$ declare m record; begin for m in select id from public.ministries loop perform public.cc_ensure_ministry_conversation(m.id); end loop; end $$;

-- ------------------------------------------------------------------------------------------------
-- 2. Who can manage a chat: leaders and administrators, and the Whole Church group is also run by pastors.
--    Pastoral care conversations are confidential: nobody can add people to them or change them.
-- ------------------------------------------------------------------------------------------------
alter table public.conversations add column if not exists whole_church boolean not null default false;
alter table public.conversations add column if not exists confidential boolean not null default false;
create unique index if not exists cc_one_whole_church_per_church on public.conversations(church_id) where whole_church;

create or replace function public.cc_chat_manager(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_read_conversation(c,auth.uid()) and exists(select 1 from public.conversations x where x.id=c and not x.confidential and (
  x.owner_id=auth.uid() or public.cc_is_admin()
  or (x.whole_church and public.cc_can_broadcast())
  or exists(select 1 from public.ministry_members mm where mm.ministry_id=x.ministry_id and mm.user_id=auth.uid() and mm.is_leader)
  or exists(select 1 from public.conversations p join public.ministry_members mm on mm.ministry_id=p.ministry_id where p.id=x.parent_id and mm.user_id=auth.uid() and mm.is_leader)));
$$;
revoke all on function public.cc_chat_manager(uuid) from public;
grant execute on function public.cc_chat_manager(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 3. The Whole Church group: every approved member is in it automatically
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_ensure_whole_church(p_church uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 select id into v_id from public.conversations where church_id=p_church and whole_church;
 if v_id is null then
  insert into public.conversations(kind,church_id,title,whole_church,announcement_only)
   values('group',p_church,'Whole Church',true,false) on conflict do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.conversations where church_id=p_church and whole_church; end if;
 end if;
 return v_id;
end $$;
revoke all on function public.cc_ensure_whole_church(uuid) from public;

create or replace function public.cc_whole_church_member() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if new.church_id is null then return new; end if;
 if new.approved then
  v_id := public.cc_ensure_whole_church(new.church_id);
  insert into public.conversation_members(conversation_id,user_id) values(v_id,new.user_id) on conflict do nothing;
 elsif tg_op = 'UPDATE' then
  delete from public.conversation_members cm using public.conversations c where cm.conversation_id=c.id and c.whole_church and c.church_id=new.church_id and cm.user_id=new.user_id;
 end if;
 return new;
end $$;
drop trigger if exists cc_whole_church_member on public.member_profiles;
create trigger cc_whole_church_member after insert or update of approved on public.member_profiles for each row execute function public.cc_whole_church_member();
-- everyone who is already approved
do $$ declare p record; v uuid; begin
 for p in select distinct church_id from public.member_profiles where approved and church_id is not null loop
  v := public.cc_ensure_whole_church(p.church_id);
  insert into public.conversation_members(conversation_id,user_id)
   select v,mp.user_id from public.member_profiles mp where mp.church_id=p.church_id and mp.approved on conflict do nothing;
 end loop;
end $$;

-- ------------------------------------------------------------------------------------------------
-- 4. Pastoral care: a confidential request that clearly goes to named people
-- ------------------------------------------------------------------------------------------------
create table if not exists public.cc_care_team (
 user_id uuid primary key,
 church_id uuid not null default public.cc_my_church_id(),
 created_at timestamptz not null default now()
);
alter table public.cc_care_team enable row level security;
revoke all on public.cc_care_team from anon, authenticated;
grant select on public.cc_care_team to authenticated;
drop policy if exists cc_care_team_read on public.cc_care_team;
create policy cc_care_team_read on public.cc_care_team for select to authenticated using (church_id = public.cc_my_church_id() and public.cc_is_admin());

create or replace function public.cc_set_care_member(p_user uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_same_church_user(p_user) or not public.is_approved_member(p_user) then raise exception 'Member not found'; end if;
 if p_on then insert into public.cc_care_team(user_id,church_id) values(p_user,public.cc_my_church_id()) on conflict do nothing;
 else delete from public.cc_care_team where user_id=p_user and church_id=public.cc_my_church_id(); end if;
end $$;
revoke all on function public.cc_set_care_member(uuid,boolean) from public;
grant execute on function public.cc_set_care_member(uuid,boolean) to authenticated;

-- Who would receive a pastoral care message: the care team if one is set up, otherwise the church's pastors, otherwise its administrators.
create or replace function public.cc_care_recipients() returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path='' as $$
declare v_church uuid:=public.cc_my_church_id();
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if exists(select 1 from public.cc_care_team t where t.church_id=v_church) then
  return query select p.user_id,p.display_name from public.member_profiles p join public.cc_care_team t on t.user_id=p.user_id where p.approved and p.church_id=v_church and p.user_id<>auth.uid() order by p.display_name;
 elsif exists(select 1 from public.member_roles r join public.member_profiles p on p.user_id=r.user_id where r.role='pastor' and p.approved and p.church_id=v_church) then
  return query select p.user_id,p.display_name from public.member_profiles p where p.approved and p.church_id=v_church and p.user_id<>auth.uid() and exists(select 1 from public.member_roles r where r.user_id=p.user_id and r.role='pastor') order by p.display_name;
 else
  return query select p.user_id,p.display_name from public.member_profiles p join public.church_admins a on a.user_id=p.user_id where p.approved and p.church_id=v_church and p.user_id<>auth.uid() order by p.display_name;
 end if;
end $$;
revoke all on function public.cc_care_recipients() from public;
grant execute on function public.cc_care_recipients() to authenticated;

create or replace function public.cc_care_team_list() returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 return query select t.user_id,coalesce(p.display_name,'A member') from public.cc_care_team t left join public.member_profiles p on p.user_id=t.user_id where t.church_id=public.cc_my_church_id() order by 2;
end $$;
revoke all on function public.cc_care_team_list() from public;
grant execute on function public.cc_care_team_list() to authenticated;

create or replace function public.cc_send_pastoral_care(p_topic text, p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text; v_church uuid:=public.cc_my_church_id(); r record; n int:=0;
begin
 if auth.uid() is null or not public.is_approved_member(auth.uid()) then raise exception 'Sign in first'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if p_topic not in ('Prayer request','Counseling or advice','Hospital or home visit','Something else') then raise exception 'Choose what this is about'; end if;
 if length(trim(coalesce(p_body,''))) not between 1 and 4000 then raise exception 'Write a message of up to 4000 characters'; end if;
 if (select count(*) from public.conversations c where c.confidential and c.requested_by=auth.uid() and c.created_at>now()-interval '1 day')>=5 then
  raise exception 'You have sent several requests today. Please wait, or call the church office.';
 end if;
 select display_name into v_name from public.member_profiles where user_id=auth.uid();
 if not exists(select 1 from public.cc_care_recipients()) then raise exception 'No one is set up to receive pastoral care messages yet. Please contact the church office.'; end if;
 insert into public.conversations(kind,church_id,title,confidential,owner_id,requested_by) values('group',v_church,'Pastoral care: '||coalesce(v_name,'A member')||' ('||p_topic||')',true,null,auth.uid()) returning id into v_id;
 insert into public.conversation_members(conversation_id,user_id) values(v_id,auth.uid());
 for r in select user_id from public.cc_care_recipients() loop
  insert into public.conversation_members(conversation_id,user_id) values(v_id,r.user_id) on conflict do nothing; n:=n+1;
 end loop;
 insert into public.messages(conversation_id,sender_id,body) values(v_id,auth.uid(),trim(p_body));
 return v_id;
end $$;
revoke all on function public.cc_send_pastoral_care(text,text) from public;
grant execute on function public.cc_send_pastoral_care(text,text) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 5. Ministry schedule cards: RSVP, files, and a discussion for each activity
-- ------------------------------------------------------------------------------------------------
alter table public.ministry_activities add column if not exists conversation_id uuid references public.conversations(id) on delete set null;
alter table public.ministry_activities add column if not exists updated_at timestamptz not null default now();

create table if not exists public.cc_activity_rsvps (
 activity_id uuid not null references public.ministry_activities(id) on delete cascade,
 user_id uuid not null,
 response text not null check (response in ('going','maybe','unable')),
 updated_at timestamptz not null default now(),
 primary key (activity_id, user_id)
);
alter table public.cc_activity_rsvps enable row level security;
revoke all on public.cc_activity_rsvps from anon, authenticated;
grant select on public.cc_activity_rsvps to authenticated;
drop policy if exists cc_activity_rsvps_read on public.cc_activity_rsvps;
create policy cc_activity_rsvps_read on public.cc_activity_rsvps for select to authenticated using (user_id = auth.uid());

create table if not exists public.cc_activity_files (
 id uuid primary key default gen_random_uuid(),
 ministry_id uuid not null references public.ministries(id) on delete cascade,
 activity_id uuid references public.ministry_activities(id) on delete cascade,
 church_id uuid not null default public.cc_my_church_id(),
 path text not null,
 name text not null,
 mime text,
 size integer,
 uploaded_by uuid,
 created_at timestamptz not null default now()
);
create index if not exists cc_activity_files_ministry on public.cc_activity_files(ministry_id, created_at desc);
alter table public.cc_activity_files enable row level security;
revoke all on public.cc_activity_files from anon, authenticated;
grant select on public.cc_activity_files to authenticated;
drop policy if exists cc_activity_files_read on public.cc_activity_files;
create policy cc_activity_files_read on public.cc_activity_files for select to authenticated
 using (church_id = public.cc_my_church_id() and (public.is_ministry_member(ministry_id,auth.uid()) or public.cc_is_admin()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('ministry-files','ministry-files',false,15728640,
 array['image/jpeg','image/png','image/webp','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/webm','audio/ogg','video/mp4'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists cc_ministry_file_read on storage.objects;
create policy cc_ministry_file_read on storage.objects for select to authenticated using(bucket_id='ministry-files' and exists(
 select 1 from public.ministries m where m.id::text=(storage.foldername(name))[1] and m.church_id=public.cc_my_church_id() and (public.is_ministry_member(m.id,auth.uid()) or public.cc_is_admin())));
drop policy if exists cc_ministry_file_upload on storage.objects;
create policy cc_ministry_file_upload on storage.objects for insert to authenticated with check(bucket_id='ministry-files' and exists(
 select 1 from public.ministries m where m.id::text=(storage.foldername(name))[1] and m.church_id=public.cc_my_church_id() and public.is_ministry_leader(m.id,auth.uid()) and public.cc_church_writable(m.church_id)));
drop policy if exists cc_ministry_file_delete on storage.objects;
create policy cc_ministry_file_delete on storage.objects for delete to authenticated using(bucket_id='ministry-files' and exists(
 select 1 from public.ministries m where m.id::text=(storage.foldername(name))[1] and m.church_id=public.cc_my_church_id() and public.is_ministry_leader(m.id,auth.uid())));

-- Leaders (and administrators) create or change an activity. A change of time tells the group in its discussion, which also alerts their phones.
create or replace function public.cc_save_ministry_activity(p_id uuid, p_ministry uuid, p_title text, p_details text, p_starts_at timestamptz, p_notify boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=p_id; v_old public.ministry_activities; v_parent uuid; v_topic uuid; v_church uuid; v_when text;
begin
 if auth.uid() is null or not public.is_ministry_leader(p_ministry,auth.uid()) then raise exception 'Only ministry leaders can change the schedule'; end if;
 select church_id into v_church from public.ministries where id=p_ministry and church_id=public.cc_my_church_id();
 if v_church is null then raise exception 'Ministry not found'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 180 then raise exception 'Activity title must be 2–180 characters'; end if;
 if p_starts_at is null then raise exception 'Choose a date and time'; end if;
 v_parent := public.cc_ensure_ministry_conversation(p_ministry);
 v_when := to_char(p_starts_at at time zone coalesce((select events_timezone from public.churches where id=v_church),'America/New_York'),'FMDay, FMMon FMDD "at" FMHH12:MI AM');
 if v_id is null then
  insert into public.ministry_activities(ministry_id,title,details,starts_at) values(p_ministry,trim(p_title),coalesce(trim(p_details),''),p_starts_at) returning id into v_id;
  insert into public.conversations(kind,church_id,title,owner_id,parent_id) values('group',v_church,trim(p_title),auth.uid(),v_parent) returning id into v_topic;
  insert into public.conversation_members(conversation_id,user_id) select v_topic,mm.user_id from public.ministry_members mm where mm.ministry_id=p_ministry on conflict do nothing;
  insert into public.conversation_members(conversation_id,user_id) values(v_topic,auth.uid()) on conflict do nothing;
  update public.ministry_activities set conversation_id=v_topic where id=v_id;
  if p_notify then insert into public.messages(conversation_id,sender_id,body) values(v_topic,auth.uid(),'New: '||trim(p_title)||', '||v_when||'.'||case when coalesce(trim(p_details),'')<>'' then ' '||trim(p_details) else '' end); end if;
 else
  select * into v_old from public.ministry_activities where id=v_id and ministry_id=p_ministry;
  if not found then raise exception 'Activity not found'; end if;
  update public.ministry_activities set title=trim(p_title),details=coalesce(trim(p_details),''),starts_at=p_starts_at,updated_at=now() where id=v_id;
  v_topic := v_old.conversation_id;
  if v_topic is not null then update public.conversations set title=trim(p_title) where id=v_topic; end if;
  if p_notify and v_topic is not null and v_old.starts_at is distinct from p_starts_at then
   insert into public.messages(conversation_id,sender_id,body) values(v_topic,auth.uid(),'Time changed: '||trim(p_title)||' is now '||v_when||'.');
  end if;
 end if;
 return v_id;
end $$;
revoke all on function public.cc_save_ministry_activity(uuid,uuid,text,text,timestamptz,boolean) from public;
grant execute on function public.cc_save_ministry_activity(uuid,uuid,text,text,timestamptz,boolean) to authenticated;

-- Older activities have no discussion yet: a leader can start one.
create or replace function public.cc_ensure_activity_discussion(p_activity uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.ministry_activities; v_topic uuid; v_parent uuid; v_church uuid;
begin
 select * into a from public.ministry_activities where id=p_activity;
 if not found or auth.uid() is null or not public.is_ministry_leader(a.ministry_id,auth.uid()) then raise exception 'Only ministry leaders can do this'; end if;
 if a.conversation_id is not null then return a.conversation_id; end if;
 select church_id into v_church from public.ministries where id=a.ministry_id and church_id=public.cc_my_church_id();
 if v_church is null then raise exception 'Ministry not found'; end if;
 v_parent := public.cc_ensure_ministry_conversation(a.ministry_id);
 insert into public.conversations(kind,church_id,title,owner_id,parent_id) values('group',v_church,a.title,auth.uid(),v_parent) returning id into v_topic;
 insert into public.conversation_members(conversation_id,user_id) select v_topic,mm.user_id from public.ministry_members mm where mm.ministry_id=a.ministry_id on conflict do nothing;
 insert into public.conversation_members(conversation_id,user_id) values(v_topic,auth.uid()) on conflict do nothing;
 update public.ministry_activities set conversation_id=v_topic where id=p_activity;
 return v_topic;
end $$;
revoke all on function public.cc_ensure_activity_discussion(uuid) from public;
grant execute on function public.cc_ensure_activity_discussion(uuid) to authenticated;

create or replace function public.cc_delete_ministry_activity(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.ministry_activities;
begin
 select * into a from public.ministry_activities where id=p_id;
 if not found or auth.uid() is null or not public.is_ministry_leader(a.ministry_id,auth.uid()) or not exists(select 1 from public.ministries where id=a.ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Only ministry leaders can do this'; end if;
 if a.conversation_id is not null then update public.conversations set archived=true where id=a.conversation_id; end if;
 delete from public.ministry_activities where id=p_id;
end $$;
revoke all on function public.cc_delete_ministry_activity(uuid) from public;
grant execute on function public.cc_delete_ministry_activity(uuid) to authenticated;

-- A new ministry member joins the discussions of that ministry's activities (and leaves them when removed).
create or replace function public.cc_sync_ministry_topics() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_m uuid:=coalesce(new.ministry_id,old.ministry_id); v_u uuid:=coalesce(new.user_id,old.user_id);
begin
 if tg_op='INSERT' then
  insert into public.conversation_members(conversation_id,user_id)
   select a.conversation_id,v_u from public.ministry_activities a where a.ministry_id=v_m and a.conversation_id is not null on conflict do nothing;
 else
  delete from public.conversation_members cm using public.ministry_activities a where a.ministry_id=v_m and cm.conversation_id=a.conversation_id and cm.user_id=v_u;
 end if;
 return null;
end $$;
drop trigger if exists cc_sync_ministry_topics on public.ministry_members;
create trigger cc_sync_ministry_topics after insert or delete on public.ministry_members for each row execute function public.cc_sync_ministry_topics();

create or replace function public.cc_activity_rsvp(p_activity uuid, p_response text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.ministry_activities;
begin
 select * into a from public.ministry_activities where id=p_activity;
 if not found or auth.uid() is null or not public.is_ministry_member(a.ministry_id,auth.uid()) or not exists(select 1 from public.ministries where id=a.ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Activity unavailable'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if p_response is null then delete from public.cc_activity_rsvps where activity_id=p_activity and user_id=auth.uid();
 else
  if p_response not in ('going','maybe','unable') then raise exception 'Choose going, maybe or unable'; end if;
  insert into public.cc_activity_rsvps(activity_id,user_id,response) values(p_activity,auth.uid(),p_response)
   on conflict(activity_id,user_id) do update set response=excluded.response, updated_at=now();
 end if;
end $$;
revoke all on function public.cc_activity_rsvp(uuid,text) from public;
grant execute on function public.cc_activity_rsvp(uuid,text) to authenticated;

-- Totals for a ministry's activities (everyone in the ministry sees the counts; names are for leaders).
create or replace function public.cc_activity_overview(p_ministry uuid)
returns table(activity_id uuid, going bigint, maybe bigint, unable bigint, mine text)
language sql stable security definer set search_path='' as $$
 select a.id,
  count(r.user_id) filter (where r.response='going'), count(r.user_id) filter (where r.response='maybe'), count(r.user_id) filter (where r.response='unable'),
  max(r.response) filter (where r.user_id=auth.uid())
 from public.ministry_activities a
 left join public.cc_activity_rsvps r on r.activity_id=a.id
 where a.ministry_id=p_ministry and (public.is_ministry_member(p_ministry,auth.uid()) or public.cc_is_admin())
  and exists(select 1 from public.ministries m where m.id=p_ministry and m.church_id=public.cc_my_church_id())
 group by a.id;
$$;
revoke all on function public.cc_activity_overview(uuid) from public;
grant execute on function public.cc_activity_overview(uuid) to authenticated;

create or replace function public.cc_activity_rsvp_names(p_activity uuid) returns table(display_name text, response text)
language plpgsql stable security definer set search_path='' as $$
declare m uuid;
begin
 select ministry_id into m from public.ministry_activities where id=p_activity;
 if m is null or auth.uid() is null or not public.is_ministry_leader(m,auth.uid()) then raise exception 'Only ministry leaders can see who is coming'; end if;
 return query select coalesce(p.display_name,'A member'), r.response from public.cc_activity_rsvps r left join public.member_profiles p on p.user_id=r.user_id where r.activity_id=p_activity order by r.response, p.display_name;
end $$;
revoke all on function public.cc_activity_rsvp_names(uuid) from public;
grant execute on function public.cc_activity_rsvp_names(uuid) to authenticated;

-- Files for a ministry or one of its activities.
create or replace function public.cc_add_activity_file(p_ministry uuid, p_activity uuid, p_path text, p_name text, p_mime text, p_size integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.is_ministry_leader(p_ministry,auth.uid()) or not exists(select 1 from public.ministries where id=p_ministry and church_id=public.cc_my_church_id()) then raise exception 'Only ministry leaders can add files'; end if;
 if p_activity is not null and not exists(select 1 from public.ministry_activities where id=p_activity and ministry_id=p_ministry) then raise exception 'Activity not found'; end if;
 if p_path not like p_ministry::text||'/%' or not exists(select 1 from storage.objects where bucket_id='ministry-files' and name=p_path) then raise exception 'File not uploaded'; end if;
 insert into public.cc_activity_files(ministry_id,activity_id,church_id,path,name,mime,size,uploaded_by)
  values(p_ministry,p_activity,public.cc_my_church_id(),p_path,left(coalesce(p_name,'file'),200),p_mime,p_size,auth.uid()) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cc_add_activity_file(uuid,uuid,text,text,text,integer) from public;
grant execute on function public.cc_add_activity_file(uuid,uuid,text,text,text,integer) to authenticated;

create or replace function public.cc_remove_activity_file(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare f public.cc_activity_files;
begin
 select * into f from public.cc_activity_files where id=p_id;
 if not found or auth.uid() is null or not public.is_ministry_leader(f.ministry_id,auth.uid()) or f.church_id<>public.cc_my_church_id() then raise exception 'Only ministry leaders can remove files'; end if;
 delete from public.cc_activity_files where id=p_id;
 return f.path;
end $$;
revoke all on function public.cc_remove_activity_file(uuid) from public;
grant execute on function public.cc_remove_activity_file(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 6. Ministry members (for the Members tab of a ministry home)
-- ------------------------------------------------------------------------------------------------
create or replace function public.cc_ministry_roster(p_ministry uuid) returns table(user_id uuid, display_name text, is_leader boolean)
language sql stable security definer set search_path='' as $$
 select mm.user_id, p.display_name, mm.is_leader from public.ministry_members mm
 join public.member_profiles p on p.user_id=mm.user_id and p.approved
 where mm.ministry_id=p_ministry and (public.is_ministry_member(p_ministry,auth.uid()) or public.cc_is_admin())
  and exists(select 1 from public.ministries m where m.id=p_ministry and m.church_id=public.cc_my_church_id())
 order by mm.is_leader desc, p.display_name;
$$;
revoke all on function public.cc_ministry_roster(uuid) from public;
grant execute on function public.cc_ministry_roster(uuid) to authenticated;

-- Same church-fence the older tables have.
do $$ declare t text; begin
 foreach t in array array['cc_care_team','cc_activity_files'] loop
  execute format('drop policy if exists cc_tenant_all on public.%I', t);
  execute format('create policy cc_tenant_all on public.%I as restrictive for all to authenticated using (church_id = public.cc_my_church_id()) with check (church_id = public.cc_my_church_id())', t);
 end loop;
end $$;

-- A voice note can carry a written copy (transcript); keep the stored attachment details small.
do $$ begin
 if not exists(select 1 from pg_constraint where conname='cc_attachment_small') then
  alter table public.messages add constraint cc_attachment_small check (attachment is null or length(attachment::text) <= 12000) not valid;
 end if;
end $$;

notify pgrst, 'reload schema';
