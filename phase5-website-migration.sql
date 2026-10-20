-- Phase 5: single-church website content editor. Run after membership-migration.sql.
-- IMPORTANT: current Church Connect schema is single-church; this table is NOT tenant-isolated.
create table if not exists public.cc_website_content (
  id integer primary key check(id=1),
  enabled boolean not null default true,
  published jsonb not null default '{}'::jsonb,
  draft jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
alter table public.cc_website_content enable row level security;
drop policy if exists cc_website_public_read on public.cc_website_content;
create policy cc_website_public_read on public.cc_website_content for select to anon, authenticated using(true);
-- Public SELECT can see drafts in the table; therefore block direct table SELECT and expose only safe published fields through a view.
drop policy if exists cc_website_public_read on public.cc_website_content;
drop policy if exists cc_website_admin_read on public.cc_website_content;
create policy cc_website_admin_read on public.cc_website_content for select to authenticated using(public.cc_is_admin());
revoke all on public.cc_website_content from anon, authenticated;
grant select on public.cc_website_content to authenticated;
create or replace function public.cc_public_website()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when enabled then published else jsonb_build_object('enabled',false) end
  from public.cc_website_content where id=1;
$$;
revoke all on function public.cc_public_website() from public;
grant execute on function public.cc_public_website() to anon, authenticated;
create or replace function public.cc_save_website_draft(p_content jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if jsonb_typeof(p_content) <> 'object' or pg_column_size(p_content)>30000 then raise exception 'Invalid or oversized content'; end if;
 insert into public.cc_website_content(id,draft) values(1,p_content)
 on conflict(id) do update set draft=excluded.draft,updated_at=now();
end $$;
create or replace function public.cc_publish_website()
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 update public.cc_website_content set published=draft,published_at=now(),updated_at=now() where id=1;
 if not found then raise exception 'Save a draft first'; end if;
end $$;
create or replace function public.cc_toggle_website(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 insert into public.cc_website_content(id,enabled) values(1,p_enabled)
 on conflict(id) do update set enabled=excluded.enabled,updated_at=now();
end $$;
revoke all on function public.cc_save_website_draft(jsonb) from public;
revoke all on function public.cc_publish_website() from public;
revoke all on function public.cc_toggle_website(boolean) from public;
grant execute on function public.cc_save_website_draft(jsonb) to authenticated;
grant execute on function public.cc_publish_website() to authenticated;
grant execute on function public.cc_toggle_website(boolean) to authenticated;
