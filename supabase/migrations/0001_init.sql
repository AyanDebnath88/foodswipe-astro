-- 0001_init.sql
-- Foundation schema for Food Swipe (Astro + Supabase rewrite).
--
-- Auth model: every participant in a room -- guest or registered -- is a
-- real row in auth.users. Guests are created via
-- supabase.auth.signInAnonymously() on the client, which issues a normal
-- auth.uid(). There is no separate parallel guest-id scheme; `profiles.is_guest`
-- is just a display-layer flag distinguishing anonymous accounts from ones
-- that later added an email/phone, mirroring auth.users.is_anonymous.

-- gen_random_uuid() ships in pgcrypto; Supabase projects have it available,
-- but enable it explicitly so this migration is portable/idempotent.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone text,
  dietary_restrictions text[] not null default '{}',
  is_guest boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own row"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "profiles: insert own row"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "profiles: update own row"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- swipe_sessions (rooms)
-- ---------------------------------------------------------------------------
create table if not exists public.swipe_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) = 4),
  creator_id uuid references auth.users(id) on delete set null,
  status text not null default 'waiting'
    check (status in ('waiting', 'swiping', 'matched')),
  matched_cuisine_id text,
  created_at timestamptz not null default now()
);

alter table public.swipe_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- room_participants (join table; replaces the old participantIds array)
-- ---------------------------------------------------------------------------
create table if not exists public.room_participants (
  room_id uuid not null references public.swipe_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_participants enable row level security;

-- ---------------------------------------------------------------------------
-- swipes
-- ---------------------------------------------------------------------------
create table if not exists public.swipes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.swipe_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cuisine_id text not null,
  direction text not null check (direction in ('left', 'right')),
  created_at timestamptz not null default now(),
  unique (session_id, user_id, cuisine_id)
);

alter table public.swipes enable row level security;

-- ---------------------------------------------------------------------------
-- Helper: is the current user a participant of the given room?
--
-- SECURITY DEFINER so the membership check itself bypasses RLS on
-- room_participants -- this avoids writing a self-referencing RLS policy on
-- room_participants (which is a well-known footgun/recursion risk) and lets
-- swipe_sessions / room_participants / swipes all share one definition.
-- ---------------------------------------------------------------------------
create or replace function public.is_room_participant(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.room_participants rp
    where rp.room_id = p_room_id
      and rp.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- swipe_sessions policies
-- ---------------------------------------------------------------------------
create policy "swipe_sessions: select if participant"
  on public.swipe_sessions
  for select
  using (public.is_room_participant(id));

create policy "swipe_sessions: creator can insert"
  on public.swipe_sessions
  for insert
  with check (creator_id = auth.uid());

create policy "swipe_sessions: only creator can update status"
  on public.swipe_sessions
  for update
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

-- ---------------------------------------------------------------------------
-- room_participants policies
-- ---------------------------------------------------------------------------
create policy "room_participants: select if participant of same room"
  on public.room_participants
  for select
  using (public.is_room_participant(room_id));

create policy "room_participants: insert own participant row"
  on public.room_participants
  for insert
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- swipes policies
-- ---------------------------------------------------------------------------
create policy "swipes: select if participant of session"
  on public.swipes
  for select
  using (public.is_room_participant(session_id));

create policy "swipes: insert own swipe as participant"
  on public.swipes
  for insert
  with check (
    user_id = auth.uid()
    and public.is_room_participant(session_id)
  );

-- Re-swiping the same cuisine updates rather than duplicates (see the
-- unique constraint above), so upserts need an UPDATE policy too.
create policy "swipes: update own swipe as participant"
  on public.swipes
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_room_participant(session_id)
  );

-- ---------------------------------------------------------------------------
-- profiles: let room co-participants see a safe subset of each other's data
--
-- The room UI needs every participant's display_name visible to everyone
-- else in the room (waiting-room list, "who's swiped" indicator), but the
-- "profiles: select own row" policy above only lets a user see their own row.
--
-- The straightforward fix -- add a second SELECT policy such as
-- "co-participants can view profiles, using is_room_participant-style logic"
-- -- is NOT used here. Postgres RLS is ROW-level, not column-level: any
-- policy that makes a co-participant's `profiles` row visible makes *every*
-- column on that row visible through it, including `phone`. That's a real
-- PII leak beyond what the UI needs, not a hypothetical one, since `phone`
-- has no product reason to be shown to other participants.
--
-- Instead, expose a SECURITY DEFINER function that returns only the columns
-- the room UI actually needs, gated by the same room-membership check used
-- elsewhere. `phone` and `created_at` never appear in its return type, so
-- there is no code path -- direct table query or RPC -- through which a
-- co-participant can read another user's phone number; the base table's
-- own-row-only SELECT policy is untouched and still the only way to reach
-- `phone` at all.
--
-- Column choices:
--   - display_name: the whole reason for this function (participant list).
--   - dietary_restrictions: made visible to the group on purpose -- the
--     product plan's room-level dietary filter needs to see everyone's
--     restrictions, not just the owner's, so this one can't stay private.
--   - is_guest: low-sensitivity, useful for a "Guest" badge in the UI.
--   - phone, created_at: kept private; no UI need to justify exposing them.
-- ---------------------------------------------------------------------------
create or replace function public.get_room_profiles(p_room_id uuid)
returns table (
  id uuid,
  display_name text,
  dietary_restrictions text[],
  is_guest boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.display_name, p.dietary_restrictions, p.is_guest
  from public.profiles p
  join public.room_participants rp on rp.user_id = p.id
  where rp.room_id = p_room_id
    -- Gate the whole result set on the caller actually being a participant
    -- of p_room_id; non-participants get zero rows back, not an error,
    -- consistent with how the RLS policies elsewhere in this file behave.
    and public.is_room_participant(p_room_id);
$$;

revoke all on function public.get_room_profiles(uuid) from public;
grant execute on function public.get_room_profiles(uuid) to authenticated;
