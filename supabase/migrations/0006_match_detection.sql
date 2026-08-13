-- 0006_match_detection.sql
-- Phase 2, Task 4 (server-side match detection). The old Next.js app
-- computed matches in trusted server-action code (db.submitSwipe in the
-- reference project's src/lib/db.ts). There's no equivalent trusted server
-- step in this rewrite's swipe flow -- clients write directly to `swipes`
-- via RLS -- so computing "everyone swiped right" on the client and having
-- the client report the result would let any participant just claim a
-- match. This trigger moves that decision into the database itself: it's
-- the only thing that ever sets swipe_sessions.status = 'matched', and it
-- runs as SECURITY DEFINER so it isn't blocked by the "swipe_sessions: only
-- creator can update status" RLS policy (the participant who happens to
-- fire the winning swipe is usually not the room creator).
--
-- Unanimity check: after every insert/update on `swipes`, if the new row is
-- a 'right' swipe, count how many *current* room_participants have a
-- 'right' swipe on that same cuisine_id, and compare to the current
-- participant count. The `swipes` unique constraint
-- (session_id, user_id, cuisine_id) guarantees at most one row per
-- participant per cuisine, so "count of matching right-swipe rows whose
-- user_id is a current participant" is exactly "count of current
-- participants who have swiped right on this cuisine" -- no need for a
-- separate DISTINCT.
--
-- Filtering the right-swipe count by current room_participants membership
-- (rather than just counting all right swipes ever recorded for the
-- cuisine) matters for correctness if someone leaves a room after swiping:
-- their vote shouldn't keep counting toward the denominator OR the
-- numerator once they're gone, since the requirement is unanimity among
-- *current* participants, not a running tally of everyone historical.
--
-- Manual trace (3-participant room A/B/C, cuisine 'italian'):
--   A swipes right -> right_count=1, participant_count=3 -> no match.
--   B swipes right -> right_count=2, participant_count=3 -> no match.
--   C swipes right -> right_count=3, participant_count=3 -> match! status
--     flips to 'matched', matched_cuisine_id='italian'.
--   (If C had swiped left instead, right_count stays 2 forever for this
--   cuisine and the room stalls on it -- exactly the case Task 5's
--   match-fallback AI trigger exists to unstick.)
-- The `and status <> 'matched'` guard makes the UPDATE a no-op once a room
-- has already matched, so a late re-swipe (e.g. a stale duplicate insert)
-- can't stomp on an already-decided matched_cuisine_id.
create or replace function public.check_swipe_match()
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
    from public.swipes sw
    where sw.session_id = new.session_id
      and sw.cuisine_id = new.cuisine_id
      and sw.direction = 'right'
      and exists (
        select 1 from public.room_participants rp
        where rp.room_id = sw.session_id and rp.user_id = sw.user_id
      );

    if v_participant_count > 0 and v_right_count >= v_participant_count then
      update public.swipe_sessions
      set status = 'matched',
          matched_cuisine_id = new.cuisine_id
      where swipe_sessions.id = new.session_id
        and status <> 'matched';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists swipes_check_match on public.swipes;

create trigger swipes_check_match
  after insert or update on public.swipes
  for each row
  execute function public.check_swipe_match();
