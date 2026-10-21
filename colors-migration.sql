-- Church Connect: each church chooses its own colors (Administration Center -> Church settings -> Colors).
-- Safe to run more than once. Run on EVERY Church Connect Supabase project (your church's and the demo).
alter table public.churches add column if not exists brand_primary text;
alter table public.churches add column if not exists brand_accent text;
alter table public.churches drop constraint if exists churches_brand_primary_ck;
alter table public.churches drop constraint if exists churches_brand_accent_ck;
alter table public.churches add constraint churches_brand_primary_ck check (brand_primary is null or brand_primary ~ '^#[0-9a-f]{6}$');
alter table public.churches add constraint churches_brand_accent_ck check (brand_accent is null or brand_accent ~ '^#[0-9a-f]{6}$');

-- Blank = the standard Church Connect colors. The main color carries white text, so it must be dark enough to read.
create or replace function public.cc_update_church_colors(p_primary text, p_accent text) returns void
language plpgsql security definer set search_path='' as $$
declare v_p text := nullif(lower(trim(coalesce(p_primary,''))),''); v_a text := nullif(lower(trim(coalesce(p_accent,''))),''); v_lum numeric;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if v_p is not null then
  if v_p !~ '^#[0-9a-f]{6}$' then raise exception 'Colors must look like #4933a2'; end if;
  v_lum := (0.2126*('x'||substr(v_p,2,2))::bit(8)::int + 0.7152*('x'||substr(v_p,4,2))::bit(8)::int + 0.0722*('x'||substr(v_p,6,2))::bit(8)::int) / 255.0;
  if v_lum > 0.6 then raise exception 'The main color is too light for white text. Choose a darker one.'; end if;
 end if;
 if v_a is not null and v_a !~ '^#[0-9a-f]{6}$' then raise exception 'Colors must look like #e0ae66'; end if;
 update public.churches set brand_primary = v_p, brand_accent = v_a where id = public.cc_my_church_id();
end $$;
revoke all on function public.cc_update_church_colors(text,text) from public;
grant execute on function public.cc_update_church_colors(text,text) to authenticated;
