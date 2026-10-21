-- Member photos (with generic avatars) + a SECURITY FIX. Run AFTER events-sync-migration.sql. Safe to re-run.
--
-- SECURITY FIX: until now any signed-in member could change ANY column of their own profile, including `approved`
-- (so they could approve themselves) and `church_id`. Members may now change only the columns listed below;
-- approvals still go through the administrator-only functions.
--
-- PHOTOS: stored privately in Supabase Storage. A member's photo is visible to other approved members of the same church only if
-- the member turned "show my photo" on; administrators can always see/remove photos. Staff-entered members (no account) get their
-- photos added by administrators and are visible to administrators only.

-- 1. columns -------------------------------------------------------------------------------------------------------------
alter table public.member_profiles add column if not exists gender text;
alter table public.member_profiles add column if not exists photo_path text;
alter table public.member_profiles add column if not exists photo_visible boolean not null default false;
alter table public.cc_directory_members add column if not exists gender text;
alter table public.cc_directory_members add column if not exists photo_path text;
alter table public.cc_directory_members add column if not exists photo_visible boolean not null default false;

alter table public.member_profiles drop constraint if exists member_profiles_gender_ck;
alter table public.member_profiles add constraint member_profiles_gender_ck check (gender is null or gender in ('female','male'));
alter table public.member_profiles drop constraint if exists member_profiles_photo_path_ck;
alter table public.member_profiles add constraint member_profiles_photo_path_ck check (photo_path is null or photo_path = church_id::text || '/' || user_id::text || '.jpg');
alter table public.cc_directory_members drop constraint if exists cc_directory_gender_ck;
alter table public.cc_directory_members add constraint cc_directory_gender_ck check (gender is null or gender in ('female','male'));
alter table public.cc_directory_members drop constraint if exists cc_directory_photo_path_ck;
alter table public.cc_directory_members add constraint cc_directory_photo_path_ck check (photo_path is null or photo_path = church_id::text || '/dir-' || id::text || '.jpg');

-- 2. the security fix: members may edit only these columns of their profile ---------------------------------------------
revoke update on public.member_profiles from authenticated;
grant update (display_name, bio, directory_visible, directory_contact_visible, contact_email, gender, photo_path, photo_visible)
  on public.member_profiles to authenticated;

-- 3. private photo storage ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Who may touch a photo file? Path is  <church id>/<user id>.jpg  (member)  or  <church id>/dir-<directory id>.jpg  (staff-entered).
create or replace function public.cc_photo_access(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid := auth.uid(); v_file text; v_id uuid; v_dir boolean;
begin
 if v_uid is null then return false; end if;
 if (storage.foldername(p_name))[1] is distinct from public.cc_my_church_id()::text then return false; end if;
 v_file := regexp_replace(storage.filename(p_name), '\.(jpg|jpeg|png|webp)$', '');
 v_dir := v_file like 'dir-%';
 begin v_id := (case when v_dir then substr(v_file, 5) else v_file end)::uuid; exception when others then return false; end;
 if v_dir then
  return public.cc_is_admin() and exists(select 1 from public.cc_directory_members d where d.id = v_id and d.church_id = public.cc_my_church_id());
 end if;
 if not exists(select 1 from public.member_profiles p where p.user_id = v_id and p.church_id = public.cc_my_church_id()) then return false; end if;
 if v_uid = v_id then return true; end if;                       -- your own photo: read, replace, delete
 if public.cc_is_admin() then return true; end if;               -- administrators: read, replace, delete
 if p_write then return false; end if;                           -- nobody else may change it
 return public.is_approved_member(v_uid)                         -- other members: only if shared and both approved
    and exists(select 1 from public.member_profiles p where p.user_id = v_id and p.photo_visible and p.approved);
end $$;
revoke all on function public.cc_photo_access(text, boolean) from public;
grant execute on function public.cc_photo_access(text, boolean) to authenticated;

drop policy if exists cc_photo_read on storage.objects;
create policy cc_photo_read on storage.objects for select to authenticated using (bucket_id = 'member-photos' and public.cc_photo_access(name, false));
drop policy if exists cc_photo_insert on storage.objects;
create policy cc_photo_insert on storage.objects for insert to authenticated with check (bucket_id = 'member-photos' and public.cc_photo_access(name, true));
drop policy if exists cc_photo_update on storage.objects;
create policy cc_photo_update on storage.objects for update to authenticated using (bucket_id = 'member-photos' and public.cc_photo_access(name, true)) with check (bucket_id = 'member-photos' and public.cc_photo_access(name, true));
drop policy if exists cc_photo_delete on storage.objects;
create policy cc_photo_delete on storage.objects for delete to authenticated using (bucket_id = 'member-photos' and public.cc_photo_access(name, true));

-- 4. staff-entered members: gender / photo (administrators only) -------------------------------------------------------
create or replace function public.cc_set_directory_profile(p_id uuid, p_gender text, p_photo_path text, p_photo_visible boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_church uuid := public.cc_my_church_id();
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_gender is not null and p_gender not in ('female','male') then raise exception 'Gender must be female or male'; end if;
 if p_photo_path is not null and p_photo_path <> v_church::text || '/dir-' || p_id::text || '.jpg' then raise exception 'Invalid photo location'; end if;
 update public.cc_directory_members set gender = p_gender, photo_path = p_photo_path, photo_visible = (p_photo_path is not null and coalesce(p_photo_visible, false)), updated_at = now()
  where id = p_id and church_id = v_church;
 if not found then raise exception 'Directory member not found'; end if;
end $$;
revoke all on function public.cc_set_directory_profile(uuid, text, text, boolean) from public;
grant execute on function public.cc_set_directory_profile(uuid, text, text, boolean) to authenticated;
