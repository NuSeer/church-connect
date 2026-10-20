-- Run AFTER phase4-migration.sql and membership-migration.sql.
-- Staff-entered people do not require Supabase Auth accounts.
-- They are NOT automatically authorized to read private app messages.
create table if not exists public.cc_directory_members (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check(length(trim(full_name)) between 2 and 150),
 phone text, email text, courtesy_title text not null default 'Sis.' check(courtesy_title in ('Bro.','Sis.')),
 church_titles text[] not null default '{}',
 primary_title text,
 notes text,
 sms_consent boolean not null default false,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint cc_directory_primary_title check(primary_title is null or primary_title=any(church_titles)),
 constraint cc_directory_contact check(phone is null or length(phone)<=30),
 constraint cc_directory_email check(email is null or length(email)<=254)
);
create table if not exists public.cc_directory_ministries (
 member_id uuid not null references public.cc_directory_members(id) on delete cascade,
 ministry_id uuid not null references public.ministries(id) on delete cascade,
 is_leader boolean not null default false,
 primary key(member_id,ministry_id)
);
alter table public.cc_directory_members enable row level security;
alter table public.cc_directory_ministries enable row level security;
drop policy if exists "cc_directory_admin_read" on public.cc_directory_members;
create policy "cc_directory_admin_read" on public.cc_directory_members for select to authenticated using(public.cc_is_admin());
drop policy if exists "cc_directory_ministries_admin_read" on public.cc_directory_ministries;
create policy "cc_directory_ministries_admin_read" on public.cc_directory_ministries for select to authenticated using(public.cc_is_admin());
-- Writes are only allowed through tightly scoped, admin-checked functions.
revoke insert,update,delete on public.cc_directory_members from anon,authenticated;
revoke insert,update,delete on public.cc_directory_ministries from anon,authenticated;
create or replace function public.cc_save_directory_member(
 p_id uuid, p_name text, p_phone text, p_email text, p_courtesy text,
 p_titles text[], p_primary text, p_notes text, p_sms_consent boolean,
 p_ministry_ids uuid[], p_active boolean default true
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; allowed text[]:=array['Pastor','First Lady','Minister','Elder','Missionary','Mother','Evangelist','Deacon','Deaconess'];
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 150 then raise exception 'Name must be 2–150 characters'; end if;
 if p_courtesy not in ('Bro.','Sis.') then raise exception 'Invalid courtesy title'; end if;
 if exists(select 1 from unnest(coalesce(p_titles,'{}'::text[])) t where not t=any(allowed)) then raise exception 'Invalid church title'; end if;
 if p_primary is not null and not p_primary=any(coalesce(p_titles,'{}'::text[])) then raise exception 'Primary title must be selected'; end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Notes too long'; end if;
 if length(coalesce(p_phone,''))>30 or length(coalesce(p_email,''))>254 then raise exception 'Contact information too long'; end if;
 if exists(select 1 from unnest(coalesce(p_ministry_ids,'{}'::uuid[])) m where not exists(select 1 from public.ministries where id=m)) then raise exception 'Invalid ministry'; end if;
 if p_id is null then
  insert into public.cc_directory_members(full_name,phone,email,courtesy_title,church_titles,primary_title,notes,sms_consent,active)
  values(trim(p_name),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_email,'')),''),p_courtesy,coalesce(p_titles,'{}'::text[]),p_primary,nullif(trim(coalesce(p_notes,'')),''),coalesce(p_sms_consent,false),coalesce(p_active,true)) returning id into v_id;
 else
  update public.cc_directory_members set full_name=trim(p_name),phone=nullif(trim(coalesce(p_phone,'')),''),email=nullif(trim(coalesce(p_email,'')),''),courtesy_title=p_courtesy,church_titles=coalesce(p_titles,'{}'::text[]),primary_title=p_primary,notes=nullif(trim(coalesce(p_notes,'')),''),sms_consent=coalesce(p_sms_consent,false),active=coalesce(p_active,true),updated_at=now() where id=p_id returning id into v_id;
  if v_id is null then raise exception 'Directory member not found'; end if;
 end if;
 delete from public.cc_directory_ministries where member_id=v_id and ministry_id<>all(coalesce(p_ministry_ids,'{}'::uuid[]));
 insert into public.cc_directory_ministries(member_id,ministry_id)
 select v_id,m from (select distinct unnest(coalesce(p_ministry_ids,'{}'::uuid[])) m) x
 on conflict do nothing;
 return v_id;
end $$;
revoke all on function public.cc_save_directory_member(uuid,text,text,text,text,text[],text,text,boolean,uuid[],boolean) from public;
grant execute on function public.cc_save_directory_member(uuid,text,text,text,text,text[],text,text,boolean,uuid[],boolean) to authenticated;

-- Organization settings: each church can choose terminology, without forced parent groups.
drop policy if exists "cc_org_admin_update" on public.church_organization_preferences;
create policy "cc_org_admin_update" on public.church_organization_preferences for update to authenticated using(public.cc_is_admin()) with check(public.cc_is_admin());
grant update(group_term) on public.church_organization_preferences to authenticated;
-- Safe ministry creation/editing, without assuming a fixed list of departments.
create or replace function public.cc_manage_ministry(p_id uuid,p_name text,p_action text default 'save')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_action='save' then
  if length(trim(coalesce(p_name,''))) not between 2 and 100 then raise exception 'Name must be 2–100 characters'; end if;
  if p_id is null then insert into public.ministries(name) values(trim(p_name)) returning id into v_id;
  else update public.ministries set name=trim(p_name) where id=p_id returning id into v_id;
  end if;
  if v_id is null then raise exception 'Ministry not found'; end if;
  return v_id;
 else raise exception 'Unsupported ministry action'; end if;
end $$;
revoke all on function public.cc_manage_ministry(uuid,text,text) from public;
grant execute on function public.cc_manage_ministry(uuid,text,text) to authenticated;
