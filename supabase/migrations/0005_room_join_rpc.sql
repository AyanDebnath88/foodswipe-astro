-- 0005_room_join_rpc.sql
-- Phase 2, Task 1 (room create/join): RPC that lets a user join a room by
-- its 4-letter code.
--
-- Why this can't be a plain client-side `.select()` + `.insert()`, the way
-- room creation is (see src/lib/rooms.ts): the "swipe_sessions: select if
-- participant" RLS policy from 0001_init.sql gates SELECT on
-- is_room_participant(id), which is only true once a room_participants row
-- exists for (room, user). A joiner doesn't have that row yet -- that's the
-- whole point of joining -- so they can't SELECT swipe_sessions by code to
-- even discover the room's id in the first place. Classic chicken-and-egg
-- RLS problem. The fix is the same one 0001_init.sql already established
-- for exposing co-participant data: a SECURITY DEFINER function that does
-- the lookup with elevated privilege, but only ever hands back a narrow,
-- safe result and performs one well-defined write (inserting the caller's
-- own room_participants row) -- see get_room_profiles() for the precedent.
--
-- Auto-transition to 'swiping' once a 2nd participant joins mirrors the old
-- Next.js app's db.joinRoom() behavior (room_participants.ts reference,
-- db.ts: "Automatically shift to swiping if we have 2 or more
-- participants"). This UPDATE runs under the same SECURITY DEFINER
-- privilege, which is required anyway since the "swipe_sessions: only
-- creator can update status" RLS policy would otherwise block a
-- non-creator joiner from flipping the room's status.
create or replace function public.join_room_by_code(p_code text)
returns table (
  id uuid,
  code text,
  creator_id uuid,
  status text,
  matched_cuisine_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_participant_count int;
begin
  if p_code is null or char_length(trim(p_code)) <> 4 then
    raise exception 'Room code must be exactly 4 letters.';
  end if;

  select s.id into v_room_id
  from public.swipe_sessions s
  where s.code = upper(trim(p_code));

  if v_room_id is null then
    raise exception 'Room "%" not found.', upper(trim(p_code));
  end if;

  insert into public.room_participants (room_id, user_id)
  values (v_room_id, auth.uid())
  on conflict (room_id, user_id) do nothing;

  select count(*) into v_participant_count
  from public.room_participants
  where room_id = v_room_id;

  update public.swipe_sessions
  set status = 'swiping'
  where swipe_sessions.id = v_room_id
    and status = 'waiting'
    and v_participant_count >= 2;

  return query
    select s.id, s.code, s.creator_id, s.status, s.matched_cuisine_id
    from public.swipe_sessions s
    where s.id = v_room_id;
end;
$$;

revoke all on function public.join_room_by_code(text) from public;
grant execute on function public.join_room_by_code(text) to authenticated;
