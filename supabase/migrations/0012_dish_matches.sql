-- 0012_dish_matches.sql
--
-- PRODUCT MODEL CHANGE: a table orders MORE THAN ONE DISH.
--
-- Until now check_dish_swipe_match() (0007, hardened in 0009) treated the
-- first unanimously-approved dish as the end of the session: it set
-- swipe_sessions.status = 'dish_matched' plus the scalar
-- matched_restaurant_name / matched_dish_name columns, and the UI rendered a
-- terminal "The group decided!" screen. Real two-user testing made the flaw
-- obvious -- a group sits down and orders a starter, two mains and a dessert,
-- so agreeing on one dish and then hard-stopping ends the session while the
-- table still has most of its order to decide. It also made the session
-- unrecoverable: nothing in the schema or the UI could move a room back out
-- of 'dish_matched'.
--
-- New model: a dish match is an APPENDED FACT, not a terminal state. Each
-- dish that reaches unanimity inserts a row into public.dish_matches and the
-- room carries on in whatever status it was already in, so the group keeps
-- swiping the rest of the menu and watches the agreed list grow live.
--
-- What this migration deliberately does NOT do:
--   * It does not drop swipe_sessions.matched_restaurant_name /
--     matched_dish_name, and it does not narrow the status check constraint
--     back down to exclude 'dish_matched'. Dropping columns and tightening
--     constraints on a live database is riskier than leaving them in place;
--     from here on the application simply stops reading and writing them
--     (see src/lib/rooms.ts, where RoomStatus no longer includes
--     'dish_matched' and RoomState no longer carries the two scalars).
--     Any pre-existing room already stuck in 'dish_matched' keeps its row;
--     the app treats that value as an unknown-but-harmless status rather
--     than a terminal screen.
--   * It does not backfill dish_matches from the old scalar columns. The
--     live project has no real user data worth migrating -- only test rooms
--     -- and a backfill would invent a matched_at timestamp that never
--     existed.
--
-- Migrations 0001-0011 are already applied to the live project and are
-- treated as immutable. Everything here is additive and re-runnable.

-- ===========================================================================
-- dish_matches
--
-- One row per (session, restaurant, dish) the whole room right-swiped. The
-- unique constraint is what makes the trigger's `on conflict do nothing`
-- idempotent: once a dish is agreed, any later re-swipe by any member
-- re-runs the unanimity check and tries to insert the same tuple again,
-- which must be a no-op rather than a duplicate or an error.
--
-- restaurant_name is plain text for the same reason it is on dish_swipes
-- (0007): restaurant data in this rebuild is ephemeral and API-sourced,
-- there is no restaurants table to point a foreign key at.
-- ===========================================================================
create table if not exists public.dish_matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.swipe_sessions(id) on delete cascade,
  restaurant_name text not null,
  dish_name text not null,
  matched_at timestamptz not null default now(),
  unique (session_id, restaurant_name, dish_name)
);

alter table public.dish_matches enable row level security;

-- SELECT via the existing is_room_participant() SECURITY DEFINER helper from
-- 0001_init.sql -- not a fresh self-joining policy. That helper exists
-- precisely so room-scoped policies don't have to re-derive membership by
-- querying room_participants inside a policy (which risks RLS recursion);
-- every room-scoped table in this schema uses it and this one is no
-- different.
drop policy if exists "dish_matches: select if participant of session" on public.dish_matches;
create policy "dish_matches: select if participant of session"
  on public.dish_matches
  for select
  using (public.is_room_participant(session_id));

-- No INSERT / UPDATE / DELETE policies on purpose. Rows here are a *server*
-- verdict on what the group agreed, so the only writer is the SECURITY
-- DEFINER trigger below, which bypasses RLS. A client INSERT policy would
-- let a single dishonest participant fabricate "the table agreed on this"
-- -- the same reasoning that made match detection a trigger in the first
-- place (see 0006/0007 and the build log's "server-side match/decision
-- triggers" pattern).
grant select on public.dish_matches to authenticated;

create index if not exists dish_matches_session_idx
  on public.dish_matches (session_id, restaurant_name);

-- ===========================================================================
-- check_dish_swipe_match(): append a match instead of ending the session
--
-- Unchanged from 0009: the >= 2 participant floor (a lone host must not
-- "unanimously" agree with themselves) and current-participants-only
-- counting of right swipes (a member who left must not keep inflating the
-- denominator, and their stale swipe must not count toward the numerator).
--
-- Changed: on unanimity this now INSERTs into dish_matches and leaves
-- swipe_sessions completely alone. The room stays 'matched' (or whatever it
-- was), so every client keeps its deck and simply appends the new dish to
-- the agreed list it renders from dish_matches.
--
-- Hand-trace, 3-participant room at "Test Bistro":
--   A right-swipes "Paneer Tikka"  -> participants 3, rights 1 -> no insert
--   B right-swipes "Paneer Tikka"  -> participants 3, rights 2 -> no insert
--   C right-swipes "Paneer Tikka"  -> participants 3, rights 3 -> INSERT #1
--   A right-swipes "Garlic Naan"   -> rights 1 for that dish   -> no insert
--   B, C right-swipe "Garlic Naan" -> rights 3                 -> INSERT #2
--   C re-swipes "Paneer Tikka" right again -> rights 3 -> conflict, no-op
--   Room status is 'matched' throughout; two agreed dishes, two rows.
-- ===========================================================================
create or replace function public.check_dish_swipe_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_count int;
  v_right_count int;
begin
  if new.direction = 'right' then
    select count(*) into v_participant_count
    from public.room_participants
    where room_id = new.session_id;

    select count(*) into v_right_count
    from public.dish_swipes ds
    where ds.session_id = new.session_id
      and ds.restaurant_name = new.restaurant_name
      and ds.dish_name = new.dish_name
      and ds.direction = 'right'
      and exists (
        select 1 from public.room_participants rp
        where rp.room_id = ds.session_id and rp.user_id = ds.user_id
      );

    if v_participant_count >= 2 and v_right_count >= v_participant_count then
      insert into public.dish_matches (session_id, restaurant_name, dish_name)
      values (new.session_id, new.restaurant_name, new.dish_name)
      on conflict (session_id, restaurant_name, dish_name) do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- The trigger itself is unchanged from 0007 (after insert or update, for
-- each row), re-asserted here so this migration is self-contained if it is
-- ever replayed onto a fresh project.
drop trigger if exists dish_swipes_check_match on public.dish_swipes;

create trigger dish_swipes_check_match
  after insert or update on public.dish_swipes
  for each row
  execute function public.check_dish_swipe_match();

-- ===========================================================================
-- Realtime
--
-- Both halves are required and the second one is the non-obvious one: 0009
-- established that Supabase evaluates RLS per subscriber before forwarding a
-- change, which needs the full row in the WAL, which only happens with
-- `replica identity full`. Publication membership on its own delivers
-- silently nothing. This table is the live feed the whole multi-dish UI is
-- built on, so getting only half of this right would look exactly like "the
-- feature doesn't work".
-- ===========================================================================
alter table public.dish_matches replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dish_matches'
  ) then
    alter publication supabase_realtime add table public.dish_matches;
  end if;
end $$;
