-- 0014_retention_loop.sql
--
-- Phase 4 -- the retention loop. Three product problems, one migration:
--
--   1. POST-MEAL FEEDBACK. Nothing in this app has ever recorded whether the
--      group actually went, or whether the thing they agreed on was any
--      good. That is both the reason to reopen the app after a session and
--      the only data that could ever make an AI suggestion personal rather
--      than generic. New table: public.session_feedback.
--
--   2. SOLO VALUE. Outside a live room the app offers nothing. Two halves:
--      saved/favourite restaurants (new table:
--      public.saved_restaurants) and a history of past sessions
--      (NO new table -- see block C for why, and what is queried instead).
--
--   3. ASYNC ROOMS. A room today assumes everybody is swiping at the same
--      moment. Making it work across a working day needs no schema at all
--      -- see block D for the derivation and why adding a `last_seen_at`
--      column was rejected.
--
-- Migrations 0001-0012 are applied and immutable. 0013 is written and
-- pending the user; this file is written to compose with it and does not
-- touch anything 0013 defines. Everything here is additive and re-runnable.
--
-- ===========================================================================
-- CONTENTS
--   A. session_feedback      -- did we go, was it good (one row per member)
--   B. saved_restaurants     -- solo favourites, owner-private
--   C. history               -- deliberately NO new table (rationale only)
--   D. async rooms           -- deliberately NO new table (rationale only)
--   E. supporting index for the "which rooms am I in" reverse lookup
-- ===========================================================================


-- ===========================================================================
-- A. session_feedback
--
-- One row per (session, member): the unique constraint is what makes this
-- EDITABLE rather than DUPLICABLE. A member who taps "we went, 4 stars" and
-- then wants to change their mind upserts onto the same row through
-- PostgREST's `on_conflict=session_id,user_id`; they never accumulate a
-- second opinion about the same dinner. That is also why the constraint is a
-- plain two-column UNIQUE rather than a partial or expression index --
-- PostgREST's upsert takes conflict *columns*, so an expression index would
-- be unusable from the client.
--
-- Shape notes:
--   * did_go is NOT NULL and is the only required answer. "We never went"
--     is a real, useful data point (the room decided and the plan died) and
--     must be recordable in one tap without a rating.
--   * rating is nullable and constrained to 1..5. It is also constrained to
--     require did_go: rating a meal you did not eat is not a data point, it
--     is noise in the flywheel this table exists to feed. Going without
--     rating stays legal (the prompt must never be a wall).
--   * restaurant_name / dish_name are nullable plain text for the same
--     reason they are on dish_swipes (0007) and dish_matches (0012): this
--     rebuild has no restaurants table, restaurant data is ephemeral and
--     API-sourced, so a text scope key is the deliberate stand-in. They are
--     denormalised on purpose -- a session can browse several restaurants,
--     and the feedback is about the one the group actually ate at, which
--     nothing else in the schema records.
--   * notes is bounded at 1000 chars. Unbounded free text in a row that
--     every co-participant can read was a real finding in the 0013 pass
--     (10k-char display_name / dish_name, all echoed room-wide); this table
--     is not going to reintroduce it.
--
-- Unlike 0013's constraints, these are NOT `not valid`. That flag exists to
-- avoid a full-table validation scan tripping over pre-existing junk on a
-- live table; this table is created empty in the same statement block, so
-- there is no history to trip over and a normally-validated constraint is
-- strictly better.
-- ===========================================================================
create table if not exists public.session_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.swipe_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  did_go boolean not null,
  rating smallint,
  restaurant_name text,
  dish_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, user_id),
  constraint session_feedback_rating_range
    check (rating is null or (rating between 1 and 5)),
  constraint session_feedback_rating_requires_visit
    check (rating is null or did_go),
  constraint session_feedback_restaurant_len
    check (restaurant_name is null or char_length(restaurant_name) between 1 and 160),
  constraint session_feedback_dish_len
    check (dish_name is null or char_length(dish_name) between 1 and 160),
  constraint session_feedback_notes_len
    check (notes is null or char_length(notes) <= 1000)
);

alter table public.session_feedback enable row level security;

-- SELECT: every current participant of the room can read the whole room's
-- feedback. That is the product point -- "we went, it was a 5" is worth more
-- to the group than to the individual -- and it is the same visibility the
-- room already has over swipes and dish_matches.
--
-- Routed through the existing is_room_participant() SECURITY DEFINER helper
-- from 0001_init.sql, NOT a fresh self-joining policy. That helper exists so
-- room-scoped policies never re-derive membership by querying
-- room_participants from inside a policy (RLS recursion risk); every
-- room-scoped table in this schema uses it and this one is no different.
drop policy if exists "session_feedback: select if participant" on public.session_feedback;
create policy "session_feedback: select if participant"
  on public.session_feedback
  for select
  using (public.is_room_participant(session_id));

-- WRITE: your own row, in a room you are actually in. Both halves matter.
-- `user_id = auth.uid()` alone would let anyone with a room uuid write
-- feedback into a stranger's session; `is_room_participant()` alone would
-- let a member file feedback in a co-participant's name, which is exactly
-- the "one dishonest participant fabricates the group's verdict" shape that
-- made match detection a trigger in the first place.
drop policy if exists "session_feedback: insert own row as participant" on public.session_feedback;
create policy "session_feedback: insert own row as participant"
  on public.session_feedback
  for insert
  with check (
    user_id = auth.uid()
    and public.is_room_participant(session_id)
  );

-- UPDATE is required, not optional: the unique constraint means "change my
-- answer" is an UPDATE, and an upsert needs the UPDATE policy to land.
drop policy if exists "session_feedback: update own row as participant" on public.session_feedback;
create policy "session_feedback: update own row as participant"
  on public.session_feedback
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_room_participant(session_id)
  );

-- DELETE own row: feedback must never be a dead end. A member who filed by
-- accident, or who wants their opinion out of the group's view, can retract
-- it. Deliberately different from `swipes`, which has no DELETE policy at
-- all (0013's notes) -- a swipe is a vote in a live tally that re-swiping
-- overwrites in place, whereas feedback is a personal statement about a
-- meal and withdrawing it is a legitimate action with no effect on anyone
-- else's state.
drop policy if exists "session_feedback: delete own row" on public.session_feedback;
create policy "session_feedback: delete own row"
  on public.session_feedback
  for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.session_feedback to authenticated;

create index if not exists session_feedback_session_idx
  on public.session_feedback (session_id);
create index if not exists session_feedback_user_idx
  on public.session_feedback (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- session_feedback guard trigger
--
-- RLS is ROW-level, so a policy can say WHO may update a row and never WHICH
-- COLUMNS -- the lesson 0013 block B had to learn the hard way when a room
-- creator turned out to be able to rewrite the group's match. The same rule
-- applies here in a much smaller way: without a guard, a member could UPDATE
-- their own feedback row's session_id to point at a different room, which
-- would move a row they own into a room whose participants never saw it
-- written, and (worse) could smuggle a row into a room they have since
-- left, since the USING clause only re-checks `user_id = auth.uid()`.
--
-- It also normalises: empty free text becomes NULL rather than '' (so "did
-- they write anything" is one IS NULL check everywhere instead of two), and
-- updated_at is server-set so a client cannot backdate an edit.
-- ---------------------------------------------------------------------------
create or replace function public.guard_session_feedback_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.restaurant_name := nullif(btrim(coalesce(new.restaurant_name, '')), '');
  new.dish_name       := nullif(btrim(coalesce(new.dish_name, '')), '');
  new.notes           := nullif(btrim(coalesce(new.notes, '')), '');

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
  else
    -- Server-owned identity columns. Freezing rather than raising keeps a
    -- clumsy client working (an upsert that resends the whole row is normal)
    -- while making the tamper impossible.
    new.id         := old.id;
    new.session_id := old.session_id;
    new.user_id    := old.user_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists session_feedback_guard_write on public.session_feedback;

create trigger session_feedback_guard_write
  before insert or update on public.session_feedback
  for each row
  execute function public.guard_session_feedback_write();

-- ---------------------------------------------------------------------------
-- Realtime for session_feedback
--
-- BOTH halves are required and the second is the non-obvious one (0009/0012
-- established this the hard way): Supabase evaluates RLS per subscriber
-- before forwarding a change, which needs the full row in the WAL, which
-- only happens under `replica identity full`. Publication membership alone
-- delivers silently nothing.
--
-- Worth it here because feedback is inherently async -- one member fills it
-- in on the walk home and the rest of the group should see "3 of 4 answered"
-- appear without a refresh, which is the same live-list behaviour
-- dish_matches already provides.
-- ---------------------------------------------------------------------------
alter table public.session_feedback replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_feedback'
  ) then
    alter publication supabase_realtime add table public.session_feedback;
  end if;
end $$;


-- ===========================================================================
-- B. saved_restaurants
--
-- Per-user favourites. This is the one table in the schema that is NOT
-- room-scoped: it is the user's own list, it outlives every room they were
-- ever in, and no co-participant has any business reading it. So it is the
-- one table that does NOT go through is_room_participant() -- ownership is
-- the whole policy.
--
-- source_session_id is a nullable, ON DELETE SET NULL back-reference to the
-- room the restaurant was saved from. Nullable and SET NULL both matter:
-- favourites must survive the room being deleted (a creator closing a room
-- must not silently delete other people's saved restaurants -- 0012's
-- cascade behaviour is right for room-scoped data and would be wrong here),
-- and a user must be able to save a restaurant with no room involved at all,
-- which is the entire point of "solo value".
--
-- Note there is deliberately NO is_room_participant() check on
-- source_session_id. It is provenance for the UI ("saved from your Tuesday
-- room"), not an access grant; a stale or even bogus uuid there grants
-- nothing, and requiring live membership would mean a favourite stopped
-- being saveable the moment someone left the room it came from.
--
-- website is constrained to http(s). That is not tidiness: this column is
-- rendered as an <a href>, and `javascript:` / `data:` in an href that the
-- app itself writes into the DOM is a stored-XSS shape. The restaurant data
-- it comes from is third-party (Geoapify/OSM-backed), i.e. not ours to
-- trust. Cheapest possible place to close it is the column.
--
-- The UNIQUE is (user_id, restaurant_name) rather than a
-- lower(restaurant_name) expression index, for the same PostgREST reason as
-- block A: `on_conflict` takes columns, so an expression index could not be
-- used to make "save" idempotent from the client. Consequence, stated
-- plainly: "Bistro X" and "bistro x" can both be saved by the same user.
-- The names all arrive from one API for one place, so this is rare rather
-- than impossible, and a duplicate favourite is a cosmetic annoyance the
-- user can delete -- worth it to keep save-is-idempotent on the happy path.
-- ===========================================================================
create table if not exists public.saved_restaurants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_name text not null,
  cuisine_id text,
  address text,
  website text,
  notes text,
  source_session_id uuid references public.swipe_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, restaurant_name),
  constraint saved_restaurants_name_len
    check (char_length(restaurant_name) between 1 and 160),
  constraint saved_restaurants_cuisine_len
    check (cuisine_id is null or char_length(cuisine_id) between 1 and 64),
  constraint saved_restaurants_address_len
    check (address is null or char_length(address) <= 240),
  constraint saved_restaurants_website_len
    check (website is null or char_length(website) <= 500),
  constraint saved_restaurants_website_scheme
    check (website is null or website ~* '^https?://'),
  constraint saved_restaurants_notes_len
    check (notes is null or char_length(notes) <= 500)
);

alter table public.saved_restaurants enable row level security;

-- Four owner-only policies. `using` on SELECT/UPDATE/DELETE and `with check`
-- on INSERT/UPDATE are all required: without the UPDATE `with check` a user
-- could reassign their own row's user_id to somebody else and plant a
-- favourite in a stranger's list.
drop policy if exists "saved_restaurants: select own" on public.saved_restaurants;
create policy "saved_restaurants: select own"
  on public.saved_restaurants
  for select
  using (user_id = auth.uid());

drop policy if exists "saved_restaurants: insert own" on public.saved_restaurants;
create policy "saved_restaurants: insert own"
  on public.saved_restaurants
  for insert
  with check (user_id = auth.uid());

drop policy if exists "saved_restaurants: update own" on public.saved_restaurants;
create policy "saved_restaurants: update own"
  on public.saved_restaurants
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "saved_restaurants: delete own" on public.saved_restaurants;
create policy "saved_restaurants: delete own"
  on public.saved_restaurants
  for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.saved_restaurants to authenticated;

create index if not exists saved_restaurants_user_idx
  on public.saved_restaurants (user_id, created_at desc);

-- Normalising guard, same reasoning as block A's: trim, empty-string to
-- NULL, and freeze the identity columns on UPDATE so a row cannot be
-- re-homed onto another account (which the `with check` above already
-- blocks, but this makes it structural rather than policy-dependent).
--
-- restaurant_name is trimmed BEFORE the unique constraint sees it, which is
-- the point -- otherwise "Bistro X" and "Bistro X " are two favourites.
create or replace function public.guard_saved_restaurant_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.restaurant_name := btrim(coalesce(new.restaurant_name, ''));
  if new.restaurant_name = '' then
    raise exception 'A saved restaurant needs a name.';
  end if;

  new.cuisine_id := nullif(btrim(coalesce(new.cuisine_id, '')), '');
  new.address    := nullif(btrim(coalesce(new.address, '')), '');
  new.website    := nullif(btrim(coalesce(new.website, '')), '');
  new.notes      := nullif(btrim(coalesce(new.notes, '')), '');

  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.id         := old.id;
    new.user_id    := old.user_id;
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

drop trigger if exists saved_restaurants_guard_write on public.saved_restaurants;

create trigger saved_restaurants_guard_write
  before insert or update on public.saved_restaurants
  for each row
  execute function public.guard_saved_restaurant_write();

-- No Realtime for this table, deliberately. It is single-user, single-tab
-- data with no second writer to sync against; publishing it would put every
-- favourite change in the WAL for a subscriber that will never exist.


-- ===========================================================================
-- C. HISTORY -- no table, on purpose
--
-- The brief asked for "whatever is needed to render a user's past sessions"
-- and to check whether the existing tables already carry it. They do, in
-- full:
--
--   which rooms was I in     -> room_participants (user_id = auth.uid()),
--                               with joined_at as the "when"
--   what happened in them    -> swipe_sessions.status / matched_cuisine_id
--                               / created_at
--   which restaurant         -> dish_matches.restaurant_name
--   which dishes were agreed -> dish_matches.dish_name (+ matched_at, which
--                               orders the meal the way the table decided it)
--   how it went              -> session_feedback, from block A
--
-- A `session_history` table would be a denormalised copy of all of that,
-- kept in sync by triggers, and wrong the moment one of them was missed. A
-- query is strictly better here: the source rows already exist, are already
-- RLS-correct for exactly the audience that should see them, and cannot
-- drift from themselves.
--
-- The RLS story needs no new policy either. `room_participants`' SELECT
-- policy is is_room_participant(room_id), so `where user_id = auth.uid()`
-- returns my rooms and nobody else's; swipe_sessions is participant-or-
-- creator (0011); dish_matches is participant-only (0012). A user sees
-- exactly the sessions they took part in, which is the requirement.
--
-- ONE HONEST LIMITATION, worth stating rather than hiding: history is
-- carried by the room_participants row, and leaveRoom() DELETEs that row
-- (0009's policy, src/lib/rooms.ts). So leaving a room erases it from your
-- history. That is correct for the unanimity denominator -- a ghost
-- participant deadlocks a room forever, which is why the hard delete exists
-- -- but it is the wrong lifetime for a history feature. The right fix is a
-- soft leave (`left_at timestamptz` on room_participants, policies and both
-- match triggers counting only rows where left_at is null), which changes
-- the match triggers and is therefore a schema change with real blast
-- radius across code this phase does not own. It is deliberately NOT done
-- here; it is written up in the build log as the next schema change this
-- feature wants.
--
-- (Nothing to execute in this block -- see block E for the one index the
-- history query actually needs.)


-- ===========================================================================
-- D. ASYNC ROOMS -- no table, on purpose
--
-- "Who has swiped and who hasn't" is a question the existing rows already
-- answer, per member, without storing anything new:
--
--   the roster        -> room_participants + get_room_profiles(room_id)
--   has X swiped      -> exists a swipes row with (session_id, user_id = X)
--   how far along     -> count of those rows vs. the deck size
--   dish stage        -> same shape over dish_swipes
--   last active       -> max(created_at) over that member's swipes
--   what to catch up on -> swipe_sessions.status / matched_cuisine_id and
--                        the dish_matches list, both already live over
--                        Realtime for every subscriber
--
-- All of these read through policies that already exist ("swipes: select if
-- participant of session", 0001), so a late arriver opening the room sees
-- the current state with no new grant.
--
-- CONSIDERED AND REJECTED: a `last_seen_at` / `last_active_at` column on
-- room_participants. It would need a client UPDATE policy on
-- room_participants, and RLS cannot restrict that to one column -- so the
-- policy would also hand every member a writable handle on their own
-- membership row, which 0013 block C spent a whole section taking away.
-- Guarding it back down means another BEFORE UPDATE trigger on the table
-- that is the key to every other policy in the schema. That is a lot of new
-- attack surface for a "last seen" timestamp that max(swipes.created_at)
-- already approximates, and approximates more honestly: it reports when
-- somebody last actually DID something, not when a tab was left open.
--
-- ONE DELIBERATE UI RESTRAINT that belongs with the schema note: the async
-- panel surfaces per-member COUNTS only, never swipe DIRECTIONS, even
-- though the RLS policy would happily return them. Showing "Ben liked
-- Italian" before the group has matched turns an independent vote into a
-- bandwagon and quietly breaks the unanimity model. The read is allowed;
-- the render is not.
--
-- (Nothing to execute in this block.)


-- ===========================================================================
-- E. Supporting index for the "which rooms am I in" reverse lookup
--
-- room_participants' primary key is (room_id, user_id), so it indexes the
-- room -> members direction only. Every query in blocks C and D starts from
-- the other end -- member -> rooms -- which until now has had no index at
-- all. It never mattered before because nothing in the app asked that
-- question: rooms were always reached by code or by localStorage, never by
-- "list mine". The history page asks it on every load.
-- ===========================================================================
create index if not exists room_participants_user_idx
  on public.room_participants (user_id, joined_at desc);
