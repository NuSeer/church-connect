-- Church Connect: each church chooses its own colors (Administration Center -> Church colors).
-- Safe to run more than once. Run on EVERY Church Connect Supabase project (your church's and the demo).
alter table public.churches add column if not exists brand_primary text;
alter table public.churches add column if not exists brand_accent text;
alter table public.churches add column if not exists brand_text text;
alter table public.churches drop constraint if exists churches_brand_primary_ck;
alter table public.churches drop constraint if exists churches_brand_accent_ck;
alter table public.churches drop constraint if exists churches_brand_text_ck;
alter table public.churches add constraint churches_brand_primary_ck check (brand_primary is null or brand_primary ~ '^#[0-9a-f]{6}$');
alter table public.churches add constraint churches_brand_accent_ck check (brand_accent is null or brand_accent ~ '^#[0-9a-f]{6}$');
alter table public.churches add constraint churches_brand_text_ck check (brand_text is null or brand_text in ('white','black'));

-- Blank colors = the standard Church Connect colors. p_text is the lettering on the main color: 'white', 'black', or blank for
-- automatic (the app picks whichever is easier to read).
drop function if exists public.cc_update_church_colors(text,text);
create or replace function public.cc_update_church_colors(p_primary text, p_accent text, p_text text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_p text := nullif(lower(trim(coalesce(p_primary,''))),''); v_a text := nullif(lower(trim(coalesce(p_accent,''))),''); v_t text := nullif(lower(trim(coalesce(p_text,''))),'');
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if v_p is not null and v_p !~ '^#[0-9a-f]{6}$' then raise exception 'Colors must look like #4933a2'; end if;
 if v_a is not null and v_a !~ '^#[0-9a-f]{6}$' then raise exception 'Colors must look like #e0ae66'; end if;
 if v_t = 'auto' then v_t := null; end if;
 if v_t is not null and v_t not in ('white','black') then raise exception 'Lettering must be white or black'; end if;
 update public.churches set brand_primary = v_p, brand_accent = v_a, brand_text = v_t where id = public.cc_my_church_id();
end $$;
revoke all on function public.cc_update_church_colors(text,text,text) from public;
grant execute on function public.cc_update_church_colors(text,text,text) to authenticated;
