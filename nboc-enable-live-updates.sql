-- For the CHURCH'S project (the existing one): switches on live updates, so new messages, events and announcements appear without refreshing.
-- (An export showed this was not enabled.) Safe to run twice; if it says "already member of publication" that is fine.
do $$ begin
  alter publication supabase_realtime add table public.messages, public.church_events, public.church_announcements;
exception when duplicate_object then raise notice 'already enabled';
          when others then raise notice 'not enabled: %', sqlerrm;
end $$;
