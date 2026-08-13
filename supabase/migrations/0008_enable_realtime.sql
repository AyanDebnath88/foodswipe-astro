-- 0008_enable_realtime.sql
-- Phase 2, Task 3 (Realtime sync, replaces the old app's 2-second poll).
-- Supabase Realtime only broadcasts postgres_changes for tables explicitly
-- added to the `supabase_realtime` publication -- RLS on the table alone
-- doesn't enable it. Every table the swipe/room UI subscribes to
-- (src/components/rooms/*, src/components/swipe/*,
-- src/components/dishes/*) needs to be added here.
--
-- Wrapped in a guard against pg_publication_tables instead of a bare
-- `alter publication ... add table`, so this migration can be re-run
-- (e.g. against a project where a table was already added via the
-- dashboard) without erroring on "relation is already member of
-- publication".
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'swipe_sessions'
  ) then
    alter publication supabase_realtime add table public.swipe_sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_participants'
  ) then
    alter publication supabase_realtime add table public.room_participants;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'swipes'
  ) then
    alter publication supabase_realtime add table public.swipes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dish_swipes'
  ) then
    alter publication supabase_realtime add table public.dish_swipes;
  end if;
end $$;
