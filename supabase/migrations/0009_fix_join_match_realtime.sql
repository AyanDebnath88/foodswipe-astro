-- 0009_fix_join_match_realtime.sql
--
-- Fixes for bugs found by scripts/test-e2e.mjs, the first time migrations
-- 0001-0008 were ever executed against a real Postgres instance. Migrations
-- 0001-0008 have already been applied to the live project and are therefore
-- treated as immutable; everything here is corrective and re-runnable.
--
-- ===========================================================================
-- BUG 1 (critical): join_room_by_code() always failed with
--   [42702] column reference "status" is ambiguous
-- ...which meant NOBODY COULD EVER JOIN A ROOM. Every multi-user behaviour
-- downstream (participant lists, co-participant profiles, the dietary union,
-- group matching) was untestable/broken as a consequence.
--
-- Cause: the function is declared RETURNS TABLE (..., status text, ...).
-- Those output columns are in scope as PL/pgSQL variables inside the body,
-- so the bare `and status = 'waiting'` in the UPDATE's WHERE clause is
-- genuinely ambiguous between the OUT variable and swipe_sessions.status.
-- (The `set status = ...` on the left of SET is fine -- that position is
-- unambiguously a column.) Fix: schema-qualify the column reference.
-- ===========================================================================
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
    and swipe_sessions.status = 'waiting'   -- was: `status = 'waiting'` (ambiguous)
    and v_participant_count >= 2;

  return query
    select s.id, s.code, s.creator_id, s.status, s.matched_cuisine_id
    from public.swipe_sessions s
    where s.id = v_room_id;
end;
$$;

revoke all on function public.join_room_by_code(text) from public;
grant execute on function public.join_room_by_code(text) to authenticated;

-- ===========================================================================
-- BUG 2: a room with ONE participant matched on the very first right-swipe.
--
-- Both match triggers gated on `v_participant_count > 0`, so a host swiping
-- alone in the waiting room (participant_count = 1, right_count = 1)
-- satisfied unanimity instantly and the room jumped to 'matched' before
-- anyone else had even joined. Food Swipe is a *group* decision tool; a
-- match is only meaningful once at least two people are in the room.
--
-- Fix: require at least 2 participants. Solo swiping is a separate Phase 4
-- feature and will not go through this trigger.
-- ===========================================================================
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

    -- was: v_participant_count > 0
    if v_participant_count >= 2 and v_right_count >= v_participant_count then
      update public.swipe_sessions
      set status = 'matched',
          matched_cuisine_id = new.cuisine_id
      where swipe_sessions.id = new.session_id
        and swipe_sessions.status not in ('matched', 'dish_matched');
    end if;
  end if;

  return new;
end;
$$;

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

    -- was: v_participant_count > 0
    if v_participant_count >= 2 and v_right_count >= v_participant_count then
      update public.swipe_sessions
      set status = 'dish_matched',
          matched_restaurant_name = new.restaurant_name,
          matched_dish_name = new.dish_name
      where swipe_sessions.id = new.session_id
        and swipe_sessions.status <> 'dish_matched';
    end if;
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- BUG 3: room creation was two separate client-side inserts (swipe_sessions,
-- then room_participants) with a client-generated uuid. If the second insert
-- failed, the room row survived but its creator could no longer SELECT it
-- (the "select if participant" policy needs the participant row that never
-- got written) and could not delete it (no DELETE policy). The 4-letter code
-- was then permanently consumed by a row nobody could see, join, or remove.
-- The e2e test reproduced exactly this.
--
-- Fix: one SECURITY DEFINER RPC that performs both writes in a single
-- transaction (a function body is atomic -- any error rolls back both), and
-- generates the code server-side with a uniqueness retry loop, so two clients
-- racing on the same random code can't collide.
-- ===========================================================================
create or replace function public.create_room()
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
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_code text;
  v_attempts int := 0;
begin
  if v_uid is null then
    raise exception 'Must be signed in to create a room.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := upper(
      substr(translate(encode(gen_random_bytes(8), 'base64'), '0123456789+/=', 'ABCDEFGHIJKLM'), 1, 4)
    );

    exit when not exists (select 1 from public.swipe_sessions s where s.code = v_code);

    if v_attempts >= 20 then
      raise exception 'Could not allocate a unique room code, please retry.';
    end if;
  end loop;

  insert into public.swipe_sessions (code, creator_id, status)
  values (v_code, v_uid, 'waiting')
  returning swipe_sessions.id into v_room_id;

  insert into public.room_participants (room_id, user_id)
  values (v_room_id, v_uid);

  return query
    select s.id, s.code, s.creator_id, s.status, s.matched_cuisine_id
    from public.swipe_sessions s
    where s.id = v_room_id;
end;
$$;

revoke all on function public.create_room() from public;
grant execute on function public.create_room() to authenticated;

-- Let a creator clean up a room they made (there was no DELETE policy at all,
-- which is what made the orphaned row unrecoverable). Cascades to
-- room_participants/swipes/dish_swipes via their existing FK on delete cascade.
drop policy if exists "swipe_sessions: creator can delete" on public.swipe_sessions;
create policy "swipe_sessions: creator can delete"
  on public.swipe_sessions
  for delete
  using (creator_id = auth.uid());

-- Allow a participant to leave a room (no DELETE policy existed here either,
-- so "Leave Room" could only ever be a client-side localStorage clear).
drop policy if exists "room_participants: leave own row" on public.room_participants;
create policy "room_participants: leave own row"
  on public.room_participants
  for delete
  using (user_id = auth.uid());

-- ===========================================================================
-- BUG 4: Realtime delivered ZERO events -- a subscriber reached SUBSCRIBED
-- but never received another user's swipe or the resulting match, so the
-- entire live-sync feature (the thing that replaced the old app's 2s poll)
-- was silently dead.
--
-- Supabase evaluates RLS per subscriber before forwarding a change. To do
-- that on UPDATE/DELETE it needs the full previous row, which Postgres only
-- puts in the WAL when the table's replica identity is FULL. With the
-- default (primary key only), RLS-checked changes get dropped rather than
-- delivered. 0008 added the tables to the publication but never set this.
-- ===========================================================================
alter table public.swipe_sessions replica identity full;
alter table public.room_participants replica identity full;
alter table public.swipes replica identity full;
alter table public.dish_swipes replica identity full;

-- Re-assert publication membership idempotently, in case 0008's DO block was
-- skipped or partially applied.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'swipe_sessions') then
    alter publication supabase_realtime add table public.swipe_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_participants') then
    alter publication supabase_realtime add table public.room_participants;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'swipes') then
    alter publication supabase_realtime add table public.swipes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dish_swipes') then
    alter publication supabase_realtime add table public.dish_swipes;
  end if;
end $$;
