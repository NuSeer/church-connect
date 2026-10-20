-- Run once in Supabase SQL editor. Uses the existing church_admins authorization table.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('church-media','church-media',true,8388608,ARRAY['image/png','image/jpeg','image/webp'])
on conflict (id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "church_media_admin_upload" on storage.objects;
create policy "church_media_admin_upload" on storage.objects for insert to authenticated
with check (bucket_id='church-media' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.church_admins a where a.user_id=auth.uid()));

drop policy if exists "church_media_public_read" on storage.objects;
create policy "church_media_public_read" on storage.objects for select to public using (bucket_id='church-media');
