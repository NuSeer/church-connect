-- Events from the church's existing website. Run AFTER broadcast-migration.sql. Safe to re-run.
-- A church can point Church Connect at its website's events feed; the `sync-website-events` Edge Function reads that feed
-- (read-only) and keeps matching rows in church_events up to date. Church Connect never writes to the website.

alter table public.churches add column if not exists events_feed_url text;
alter table public.churches add column if not exists events_timezone text not null default 'America/New_York';
alter table public.churches add column if not exists events_synced_at timestamptz;
alter table public.churches add column if not exists events_sync_status text;

-- Rows that came from the website are marked so they can be refreshed without touching events typed in by hand.
alter table public.church_events add column if not exists source text;
alter table public.church_events add column if not exists external_id text;
-- Not a partial index on purpose: the Edge Function upserts with ON CONFLICT (church_id, source, external_id).
-- Hand-made events have NULL source/external_id, and NULLs never collide, so they are unaffected.
create unique index if not exists church_events_website_uq on public.church_events(church_id, source, external_id);

-- Administrators set (or clear) the feed address. Only a plain public https address is accepted.
create or replace function public.cc_set_events_feed(p_url text, p_timezone text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_url text:=nullif(trim(coalesce(p_url,'')),''); v_host text;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if v_url is not null then
  if length(v_url)>500 or v_url !~* '^https://[a-z0-9.-]+(:[0-9]+)?(/[^\s]*)?$' then raise exception 'Use a full https:// web address'; end if;
  v_host:=lower(substring(v_url from '^https://([^/:]+)'));
  if v_host !~ '\.' or v_host ~ '^[0-9.]+$' or v_host in ('localhost') or v_host ~ '\.(local|internal|localhost)$' then raise exception 'Use the public address of your church website'; end if;
 end if;
 if p_timezone is not null and not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Unknown time zone'; end if;
 update public.churches set events_feed_url=v_url, events_timezone=coalesce(p_timezone,events_timezone),
  events_sync_status=case when v_url is null then null else 'Waiting for first sync' end, events_synced_at=null
 where id=public.cc_my_church_id();
end $$;
revoke all on function public.cc_set_events_feed(text,text) from public;
grant execute on function public.cc_set_events_feed(text,text) to authenticated;
