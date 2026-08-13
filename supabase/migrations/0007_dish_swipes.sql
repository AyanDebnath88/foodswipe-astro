-- 0007_dish_swipes.sql
-- Phase 2, Task 7 (dish-level room sync -- the P0 fix). The old app synced
-- the *cuisine* swipe across a room but let each person pick the final dish
-- solo (dish-swipe-area.tsx in the reference project has no room concept at
-- all). This migration extends the same group-swipe/unanimous-match
-- mechanics from `swipes` down to dish choice.
--
-- Restaurant identity: a matched cuisine's restaurant list comes from a
-- live Places API call (Phase 3, teammate's territory), not a table this
-- rebuild owns -- there is nowhere to put a restaurant foreign key yet, and
-- adding one would mean storing ephemeral, third-party-sourced data as if
-- it were our own catalog. Per the task brief, `restaurant_name text` is
-- the deliberately simple stand-in: enough to scope a dish deck to "this
-- group's current restaurant" without inventing a restaurants table this
-- phase has no real data model for. A later phase can promote this to a
-- foreign key if/when restaurant results start getting cached server-side.

create table if not exists public.dish_swipes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.swipe_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_name text not null,
  dish_name text not null,
  direction text not null check (direction in ('left', 'right')),
  created_at timestamptz not null default now(),
  unique (session_id, user_id, restaurant_name, dish_name)
);

alter table public.dish_swipes enable row level security;

-- Same RLS shape as `swipes` in 0001_init.sql: participants of the session
-- can read the whole session's dish swipes (needed for live progress),
-- everyone can only write their own row, and re-swiping the same dish
-- updates in place rather than duplicating (hence both an insert and an
-- update policy, matching the swipes table's upsert pattern).
create policy "dish_swipes: select if participant of session"
  on public.dish_swipes
  for select
  using (public.is_room_participant(session_id));

create policy "dish_swipes: insert own dish swipe as participant"
  on public.dish_swipes
  for insert
  with check (
    user_id = auth.uid()
    and public.is_room_participant(session_id)
  );

create policy "dish_swipes: update own dish swipe as participant"
  on public.dish_swipes
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_room_participant(session_id)
  );

-- swipe_sessions needs somewhere to record a dish-level match, and a status
-- value distinct from the cuisine-level 'matched' so the client can tell
-- the two apart. Widening the existing check constraint (rather than a new
-- table) keeps "what did this room decide" in one row, same as the
-- cuisine-match columns already there.
alter table public.swipe_sessions
  drop constraint if exists swipe_sessions_status_check;

alter table public.swipe_sessions
  add constraint swipe_sessions_status_check
  check (status in ('waiting', 'swiping', 'matched', 'dish_matched'));

alter table public.swipe_sessions
  add column if not exists matched_restaurant_name text;

alter table public.swipe_sessions
  add column if not exists matched_dish_name text;

-- Mirrors check_swipe_match() in 0006_match_detection.sql exactly, one
-- level down: unanimity is scoped to (restaurant_name, dish_name) instead
-- of just cuisine_id, since a room can browse dishes at more than one
-- candidate restaurant before its members settle on one. Same
-- current-participants-only counting, same SECURITY DEFINER rationale (a
-- non-creator's swipe is usually the one that completes the match, and
-- "only creator can update status" would otherwise block it), same
-- already-matched guard.
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

    if v_participant_count > 0 and v_right_count >= v_participant_count then
      update public.swipe_sessions
      set status = 'dish_matched',
          matched_restaurant_name = new.restaurant_name,
          matched_dish_name = new.dish_name
      where swipe_sessions.id = new.session_id
        and status <> 'dish_matched';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists dish_swipes_check_match on public.dish_swipes;

create trigger dish_swipes_check_match
  after insert or update on public.dish_swipes
  for each row
  execute function public.check_dish_swipe_match();
