-- Run after directory-ministry-migration.sql. Safe to rerun.
alter table public.ministries add column if not exists color text not null default '#64748b';
alter table public.ministries drop constraint if exists ministries_color_hex;
alter table public.ministries add constraint ministries_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$');
-- Admins may update ministry colors; other roles cannot update this column.
grant update(color) on public.ministries to authenticated;
drop policy if exists cc_ministry_admin_color_update on public.ministries;
create policy cc_ministry_admin_color_update on public.ministries for update to authenticated using(public.cc_is_admin()) with check(public.cc_is_admin());
