-- Run in Supabase SQL Editor after messaging-migration.sql.
create table if not exists public.member_push_subscriptions (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 p256dh text not null,
 auth text not null,
 user_agent text,
 created_at timestamptz not null default now()
);
create index if not exists push_user_idx on public.member_push_subscriptions(user_id);
alter table public.member_push_subscriptions enable row level security;
revoke all on public.member_push_subscriptions from anon;
grant select,insert,update,delete on public.member_push_subscriptions to authenticated;
drop policy if exists push_self_select on public.member_push_subscriptions;
create policy push_self_select on public.member_push_subscriptions for select to authenticated using(user_id=auth.uid());
drop policy if exists push_self_insert on public.member_push_subscriptions;
create policy push_self_insert on public.member_push_subscriptions for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.member_profiles p where p.user_id=auth.uid() and p.approved=true));
drop policy if exists push_self_update on public.member_push_subscriptions;
create policy push_self_update on public.member_push_subscriptions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists push_self_delete on public.member_push_subscriptions;
create policy push_self_delete on public.member_push_subscriptions for delete to authenticated using(user_id=auth.uid());
-- service_role can read all subscriptions via RLS bypass. Never expose that key in client files.
