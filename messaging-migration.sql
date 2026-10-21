-- Run after phase4-migration.sql. Per-user read markers; existing RLS still applies.
create table if not exists public.conversation_read_states (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 last_read_at timestamptz not null default now(),
 primary key(conversation_id,user_id));
alter table public.conversation_read_states enable row level security;
drop policy if exists "read own markers" on public.conversation_read_states;
create policy "read own markers" on public.conversation_read_states for select to authenticated using(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid()));
drop policy if exists "insert own markers" on public.conversation_read_states;
create policy "insert own markers" on public.conversation_read_states for insert to authenticated with check(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid()));
drop policy if exists "update own markers" on public.conversation_read_states;
create policy "update own markers" on public.conversation_read_states for update to authenticated using(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid())) with check(user_id=auth.uid() and public.can_read_conversation(conversation_id,auth.uid()));
create or replace function public.my_conversation_unread_counts()
returns table(conversation_id uuid,unread_count bigint)
language sql stable security invoker set search_path=''
as $$
 with accessible as (select c.id from public.conversations c where public.can_read_conversation(c.id,auth.uid()))
 select a.id,count(m.conversation_id)::bigint from accessible a
 left join public.conversation_read_states r on r.conversation_id=a.id and r.user_id=auth.uid()
 left join public.messages m on m.conversation_id=a.id and m.sender_id<>auth.uid() and m.created_at>coalesce(r.last_read_at,'1970-01-01'::timestamptz)
 group by a.id
$$;
revoke all on function public.my_conversation_unread_counts() from public;
grant execute on function public.my_conversation_unread_counts() to authenticated;
