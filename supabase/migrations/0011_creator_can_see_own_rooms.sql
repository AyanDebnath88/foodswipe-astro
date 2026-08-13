-- 0011_creator_can_see_own_rooms.sql
--
-- Bug (found by scripts/test-e2e.mjs section 13): the "creator can delete"
-- policy added in 0009 never actually deleted anything -- a creator's DELETE
-- against a room whose participant row was missing reported 0 rows affected,
-- and a SECURITY DEFINER probe confirmed the row survived.
--
-- Cause: swipe_sessions' only SELECT policy is
--   using (is_room_participant(id))
-- i.e. visibility requires a room_participants row. A creator whose
-- participant row is missing therefore cannot SELECT the room they created.
-- PostgREST issues a DELETE ... RETURNING, and RETURNING is subject to the
-- SELECT policy, so the statement is filtered down to zero rows and the
-- delete is effectively a no-op.
--
-- Fix at the root rather than patching the delete path: a creator should
-- always be able to see the rooms they created, participant row or not. That
-- is true independently of this bug -- it's what makes "my rooms" listable,
-- makes a half-created room recoverable instead of stranded, and lets the
-- 0009 delete policy do its job.
--
-- Note this widens visibility only to the room's own creator (creator_id =
-- auth.uid()); it does not expose rooms to anyone else. Non-participants are
-- still fully locked out (verified by the suite's section 10 RLS tests).
drop policy if exists "swipe_sessions: select if participant" on public.swipe_sessions;

create policy "swipe_sessions: select if participant or creator"
  on public.swipe_sessions
  for select
  using (
    public.is_room_participant(id)
    or creator_id = auth.uid()
  );
