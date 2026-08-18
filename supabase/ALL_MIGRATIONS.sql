
-- ============================================================
-- 0001_init.sql
-- ============================================================

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

-- ============================================================
-- 0002_seed_cuisines.sql
-- ============================================================

-- 0002_seed_cuisines.sql
-- Cuisine reference/catalog data, ported from the reference Next.js project's
-- src/lib/cuisines.ts. The old `description` and `imageId` fields are not
-- carried over here since they are outside the target schema given for this
-- migration; cuisine artwork is expected to move to Supabase Storage keyed
-- by cuisine id in a later phase.

create table if not exists public.cuisines (
  id text primary key,
  name text not null,
  dishes text[] not null default '{}',
  dietary_tags text[] not null default '{}'
);

-- Reference data is public, read-only from the client's perspective: enable
-- RLS so anon/authenticated users can browse cuisines but cannot mutate the
-- catalog (writes are expected to happen via migrations / the dashboard).
alter table public.cuisines enable row level security;

create policy "cuisines: public read"
  on public.cuisines
  for select
  using (true);

insert into public.cuisines (id, name, dishes) values
  ('italian', 'Italian', ARRAY['Margherita Pizza', 'Carbonara', 'Lasagna', 'Risotto', 'Osso Buco']),
  ('mexican', 'Mexican', ARRAY['Tacos al Pastor', 'Guacamole', 'Enchiladas', 'Mole Poblano', 'Chiles Rellenos']),
  ('japanese', 'Japanese', ARRAY['Sushi Platter', 'Tonkotsu Ramen', 'Tempura', 'Udon Noodles', 'Okonomiyaki']),
  ('indian', 'Indian', ARRAY['Chicken Tikka Masala', 'Biryani', 'Samosa', 'Palak Paneer', 'Rogan Josh']),
  ('thai', 'Thai', ARRAY['Pad Thai', 'Tom Yum Goong', 'Green Curry', 'Massaman Curry', 'Som Tum']),
  ('greek', 'Greek', ARRAY['Moussaka', 'Gyro', 'Souvlaki', 'Spanakopita', 'Greek Salad']),
  ('french', 'French', ARRAY['Coq au Vin', 'Boeuf Bourguignon', 'Ratatouille', 'Souffle', 'Creme Brulee']),
  ('vietnamese', 'Vietnamese', ARRAY['Pho', 'Banh Mi', 'Goi Cuon (Spring Rolls)', 'Bun Cha', 'Cao Lau']),
  ('korean', 'Korean', ARRAY['Kimchi Jjigae', 'Bulgogi', 'Bibimbap', 'Tteokbokki', 'Japchae'])
on conflict (id) do update
  set name = excluded.name,
      dishes = excluded.dishes;

-- ============================================================
-- 0003_profile_trigger.sql
-- ============================================================

-- 0003_profile_trigger.sql
-- Creates a matching public.profiles row whenever a new auth.users row is
-- inserted, instead of relying on the client to insert its own profile row
-- right after signUp(). Doing it client-side is a race: the client's insert
-- can run before the session/JWT from signUp() is fully usable, or can simply
-- fail after the auth user was already created, leaving an orphaned
-- auth.users row with no profile. A database trigger is atomic with the
-- auth.users insert and can't be skipped by a flaky client.
--
-- display_name / phone come from `raw_user_meta_data`, which Postgres/Supabase
-- populates from the `options.data` object passed to
-- `supabase.auth.signUp({ email, password, options: { data: { display_name, phone } } })`.
-- This is the standard Supabase "handle_new_user" pattern.
--
-- is_guest / is_anonymous:
-- Supabase's auth.users table has a first-class `is_anonymous boolean`
-- column (added alongside the Anonymous Sign-ins feature) that is true for
-- users created via `supabase.auth.signInAnonymously()` and false for every
-- other sign-up path (password, OAuth, etc). This is the correct signal to
-- use here -- NOT "is email null", which would also misclassify phone-only
-- or OAuth-only accounts that never set a password/email as guests. Guests
-- created via signInAnonymously() pass no `options.data`, so display_name
-- falls back to 'Guest' since public.profiles.display_name is NOT NULL.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, phone, is_guest)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', 'Guest'),
    new.raw_user_meta_data ->> 'phone',
    coalesce(new.is_anonymous, false)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ============================================================
-- 0004_room_dietary_filter.sql
-- ============================================================

-- 0004_room_dietary_filter.sql
-- Phase 2, Task 2 (dietary filter): seeds real dietary_tags onto the 9 rows
-- inserted by 0002_seed_cuisines.sql, which intentionally left dietary_tags
-- empty. Vocabulary (per build-log SKILL.md): vegetarian, vegan, halal,
-- gluten-free, nut-free, dairy-free, shellfish-free.
--
-- Semantics: dietary_tags is the set of restrictions a cuisine can
-- confidently satisfy (i.e. a diner following that restriction can find a
-- suitable dish in the cuisine without a fight). A room excludes a cuisine
-- from the swipeable deck when dietary_tags is NOT a superset of the union
-- of all participants' profiles.dietary_restrictions (see
-- src/lib/dietary.ts for where that comparison actually runs).
--
-- Tags below are honest, per-cuisine judgment calls about tradition/default
-- preparation, not a guarantee about any specific restaurant or dish. Where
-- a cuisine's defining, hard-to-substitute ingredients conflict with a
-- restriction (e.g. shrimp paste in Thai curry pastes, butter/cream as the
-- backbone of French sauces, pork in Vietnamese banh mi), that tag is left
-- off rather than assumed. `vegan` is only applied where it's also
-- accompanied by `vegetarian` and `dairy-free` (vegan dishes are trivially
-- both), so the tag set stays internally consistent for the filter's plain
-- string-membership check.
--
--   italian     - Rich vegetarian tradition (pizza margherita, risotto,
--                 caprese); not vegan/dairy-free by default (cheese/cream
--                 are structural, not garnish); not gluten-free by default
--                 (pasta/pizza dough are the cuisine's core starches); pork
--                 (prosciutto, pancetta) and wine are traditional enough
--                 that a blanket halal claim would be dishonest; pine nuts
--                 in pesto are avoidable, not structural, and seafood is
--                 optional regionally, not the cuisine's backbone -> nut-free
--                 and shellfish-free both included.
--   mexican     - Corn tortillas, beans, rice, and salsas give it genuine
--                 vegetarian/vegan/gluten-free/dairy-free range (cheese and
--                 sour cream are toppings, not structural); mole sauces
--                 commonly include peanuts/pumpkin seeds, so no nut-free;
--                 carnitas/chorizo (pork) are traditional staples, so no
--                 halal; coastal shellfish dishes are regional, not the
--                 default, so shellfish-free stays in.
--   japanese    - Vegetable tempura, agedashi tofu, and edamame keep
--                 vegetarian on the table, though bonito-based dashi
--                 underlies enough dishes that a blanket vegan claim would
--                 overreach; traditionally very light on dairy and tree
--                 nuts -> dairy-free/nut-free included; sushi/tempura are
--                 built around fish and shellfish, and pork ramen/sake are
--                 common, so no shellfish-free, no halal; wheat is in soy
--                 sauce and the noodle dishes (ramen, udon) that define a
--                 lot of the everyday menu, so no gluten-free.
--   indian      - The cuisine most famous for accommodating restrictions:
--                 deep vegetarian and vegan traditions (dal, chana masala,
--                 aloo gobi cooked in oil, not ghee), a large halal-observant
--                 culinary tradition (biryani, kebabs), and rice as the
--                 default starch alongside naturally gluten-free curries.
--                 Cashew/almond-thickened gravies (korma, several
--                 restaurant-style curries) are common enough that nut-free
--                 is left off; shrimp/fish curries are a regional subset,
--                 not the default, so shellfish-free stays in.
--   thai        - Genuine vegetarian menus are common (tofu pad thai,
--                 vegetable curries); fish sauce and shrimp paste are
--                 foundational to the base curry pastes and everyday
--                 seasoning (harder to substitute out than a single
--                 ingredient), so no vegan and no shellfish-free; rice and
--                 rice noodles are the primary starch (not wheat), so
--                 gluten-free stays in, as does dairy-free (coconut milk,
--                 not dairy, is the traditional richness); peanuts are
--                 structural to pad thai, satay, and many curries, so no
--                 nut-free; pork and fish sauce are pervasive enough that a
--                 halal claim would be dishonest.
--   greek       - Mediterranean mezze culture gives it real vegetarian and
--                 vegan range (dolmades, greek salad, hummus-adjacent dips)
--                 -> dairy-free included alongside vegan for the same
--                 internal-consistency reason noted above; walnuts/pistachios
--                 are confined to desserts (baklava) rather than savory
--                 mains, so nut-free stays in; shellfish (calamari, shrimp)
--                 is a regional coastal option, not the default, so
--                 shellfish-free stays in; phyllo/pita bread are too central
--                 for a gluten-free claim, and pork gyro plus wine are
--                 traditional enough to rule out halal.
--   french      - Classic vegetarian dishes exist (ratatouille, soufflé,
--                 salade niçoise minus the anchovy), but butter, cream, and
--                 cheese are the technique itself, not an optional
--                 ingredient, ruling out vegan/dairy-free; baguette, pastry,
--                 and roux-thickened sauces are just as structural, ruling
--                 out gluten-free; pork charcuterie and wine deglazing are
--                 traditional enough to rule out halal; nuts are confined to
--                 specific desserts (not savory cooking) and most classic
--                 dishes (coq au vin, boeuf bourguignon, ratatouille) have no
--                 shellfish, so nut-free and shellfish-free are included.
--   vietnamese  - "Chay" (vegetarian) versions of classic dishes are a real,
--                 widely available tradition -> vegetarian included; fish
--                 sauce is the default seasoning in most non-chay dishes, so
--                 no vegan; rice noodles, rice paper, and rice are the
--                 cuisine's primary starch (pho, goi cuon), a genuine
--                 strength for gluten-free; traditionally light on dairy
--                 (condensed-milk coffee is the exception, not the savory
--                 menu) -> dairy-free included; peanuts are a standard
--                 topping/dipping-sauce ingredient (goi cuon, bun cha), and
--                 pork (banh mi, cha lua) and shrimp are everyday proteins,
--                 so no nut-free, no halal, no shellfish-free.
--   korean      - Temple cuisine and tofu/vegetable-forward dishes (some
--                 bibimbap, japchae without meat) give it a real, if
--                 careful, vegetarian range; traditionally light on dairy
--                 -> dairy-free included; sesame/pine-nut garnishes are
--                 present but not structural -> nut-free included; core
--                 dishes like bulgogi, bibimbap, and japchae have no
--                 shellfish, even though seafood pancakes/some banchan do,
--                 so shellfish-free stays in; soy sauce/gochujang (wheat)
--                 season most everyday dishes, so no gluten-free; and pork
--                 (samgyeopsal) plus fish-sauce-based kimchi are traditional
--                 enough to rule out both vegan and halal.

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'nut-free', 'shellfish-free']
  where id = 'italian';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'shellfish-free']
  where id = 'mexican';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'dairy-free', 'nut-free']
  where id = 'japanese';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'vegan', 'halal', 'gluten-free', 'dairy-free', 'shellfish-free']
  where id = 'indian';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'gluten-free', 'dairy-free']
  where id = 'thai';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'vegan', 'dairy-free', 'nut-free', 'shellfish-free']
  where id = 'greek';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'nut-free', 'shellfish-free']
  where id = 'french';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'gluten-free', 'dairy-free']
  where id = 'vietnamese';

update public.cuisines set dietary_tags = ARRAY['vegetarian', 'dairy-free', 'nut-free', 'shellfish-free']
  where id = 'korean';

-- ============================================================
-- 0005_room_join_rpc.sql
-- ============================================================

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

-- ============================================================
-- 0006_match_detection.sql
-- ============================================================

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

-- ============================================================
-- 0007_dish_swipes.sql
-- ============================================================

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

-- ============================================================
-- 0008_enable_realtime.sql
-- ============================================================

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
-- ============================================================
-- 0016_expand_cuisine_dishes.sql
-- ============================================================

-- 0016_expand_cuisine_dishes.sql
--
-- Expands each cuisine's dishes catalog from 5 to 10 entries. The extra 5
-- per cuisine were researched against what's actually served on Indian
-- restaurant menus for that cuisine today (Zomato/Swiggy-adjacent sources,
-- food-press coverage), not just generic Western-menu defaults -- e.g.
-- Indian cuisine's additions span North (Butter Chicken, Chole Bhature, Dal
-- Makhani) and South (Masala Dosa, Idli Sambar) rather than only adding
-- more North Indian dishes on top of the existing catalog.
--
-- Purely additive to the existing 5 per cuisine -- nothing removed, nothing
-- reordered at the front, so any code or content that assumed the original
-- 5-item lists (e.g. the first published asset manifest) still finds those
-- same dishes at the same names. dietary_tags is untouched by this
-- migration; a cuisine's dietary_tags describe the cuisine as a whole, not
-- any specific dish, so a longer dish list doesn't change what it means.
--
-- Companion asset manifest: public/images/ASSET-PROMPTS.md (99 images: 9
-- cuisine heroes + 90 dishes, 10 per cuisine matching this exact list).

update public.cuisines set dishes = ARRAY['Margherita Pizza', 'Carbonara', 'Lasagna', 'Risotto', 'Osso Buco', 'Penne Arrabbiata', 'Fettuccine Alfredo', 'Fusilli Pesto', 'Spaghetti Aglio e Olio', 'Garlic Bread with Cheese'] where id = 'italian';
update public.cuisines set dishes = ARRAY['Tacos al Pastor', 'Guacamole', 'Enchiladas', 'Mole Poblano', 'Chiles Rellenos', 'Fajitas', 'Quesadillas', 'Nachos', 'Burrito Bowl', 'Tamales'] where id = 'mexican';
update public.cuisines set dishes = ARRAY['Sushi Platter', 'Tonkotsu Ramen', 'Tempura', 'Udon Noodles', 'Okonomiyaki', 'Gyoza', 'Katsu Curry', 'Teriyaki Chicken', 'Miso Soup', 'Dynamite Sushi Roll'] where id = 'japanese';
update public.cuisines set dishes = ARRAY['Chicken Tikka Masala', 'Biryani', 'Samosa', 'Palak Paneer', 'Rogan Josh', 'Butter Chicken', 'Masala Dosa', 'Idli Sambar', 'Chole Bhature', 'Dal Makhani'] where id = 'indian';
update public.cuisines set dishes = ARRAY['Pad Thai', 'Tom Yum Goong', 'Green Curry', 'Massaman Curry', 'Som Tum', 'Tom Kha Soup', 'Khao Suey', 'Pad Krapow (Thai Basil Stir Fry)', 'Mango Sticky Rice', 'Thai Spring Rolls'] where id = 'thai';
update public.cuisines set dishes = ARRAY['Moussaka', 'Gyro', 'Souvlaki', 'Spanakopita', 'Greek Salad', 'Dolmades', 'Baklava', 'Hummus with Pita', 'Tzatziki Dip', 'Loukoumades'] where id = 'greek';
update public.cuisines set dishes = ARRAY['Coq au Vin', 'Boeuf Bourguignon', 'Ratatouille', 'Souffle', 'Creme Brulee', 'French Onion Soup', 'Croque Monsieur', 'Quiche Lorraine', 'Chocolate Eclair', 'Macarons'] where id = 'french';
update public.cuisines set dishes = ARRAY['Pho', 'Banh Mi', 'Goi Cuon (Spring Rolls)', 'Bun Cha', 'Cao Lau', 'Bun Bo Hue', 'Banh Xeo', 'Cha Gio (Fried Spring Rolls)', 'Bun Thit Nuong', 'Com Tam (Broken Rice)'] where id = 'vietnamese';
update public.cuisines set dishes = ARRAY['Kimchi Jjigae', 'Bulgogi', 'Bibimbap', 'Tteokbokki', 'Japchae', 'Korean Fried Chicken', 'Kimchi Fried Rice', 'Galbi (Korean BBQ Short Ribs)', 'Kimbap', 'Sundubu Jjigae'] where id = 'korean';


-- ============================================================
-- 0017_indian_subcuisines.sql
-- ============================================================

-- 0017_indian_subcuisines.sql
--
-- Adds a second swipe layer for Indian cuisine specifically: after a room
-- unanimously matches on "Indian" (still one card among the 9 in the main
-- deck, unchanged), the group swipes again on WHICH Indian regional/style
-- category they want (North Indian, South Indian, Mughlai, Biryani, Bengali,
-- Gujarati, Rajasthani, Street Food & Chaat, Tandoor & Kebabs, Hyderabadi)
-- before proceeding to restaurant discovery. This is both how "expand
-- Indian to its max" and "one more layer of swiping" get solved by the same
-- design: Indian cuisine has enough real breadth (confirmed by researching
-- Zomato/Swiggy's actual category taxonomy) that flattening it into one
-- long dish list would be worse UX than a second genuine narrowing step,
-- the same way the top-level 9-cuisine deck itself is a narrowing step.
--
-- Table names are deliberately generic (cuisine_subcategories /
-- subcuisine_swipes, not indian_-prefixed) so a future cuisine with the same
-- kind of real internal breadth (e.g. Chinese regional cuisines) can reuse
-- this exact mechanism without a new migration inventing a second pattern.
--
-- Everything here mirrors an existing, already-verified-against-a-live-
-- database pattern:
--   - cuisine_subcategories mirrors `cuisines` (0002_seed_cuisines.sql):
--     public read-only RLS, `dishes text[]`.
--   - subcuisine_swipes mirrors `swipes` (0001_init.sql): participant-scoped
--     RLS, upsert-friendly unique constraint, added to the realtime
--     publication WITH replica identity full (the lesson from 0009 -- RLS-
--     checked Realtime delivery silently drops changes without it).
--   - check_subcuisine_match() mirrors check_swipe_match()
--     (0006_match_detection.sql, ported forward through 0009's >= 2
--     participant fix) exactly, one level down: unanimity scoped to
--     subcuisine_id instead of cuisine_id, SECURITY DEFINER for the same
--     reason (a non-creator's swipe usually completes the match), same
--     already-matched guard.
--
-- Known simplification, stated rather than hidden: subcuisine dietary
-- compatibility is NOT separately re-checked here. The room already only
-- reached this layer because "Indian" passed the cuisine-level dietary
-- filter for every participant (src/lib/dietary.ts, checked against
-- `cuisines.dietary_tags`), and no dietary_tags column exists on
-- cuisine_subcategories. This is imperfect (e.g. a vegetarian participant
-- could still see Rajasthani, whose researched dish list includes Laal
-- Maas, a meat dish) -- acceptable for this pass since dish-level swiping
-- after this point is still real-dish-by-real-dish, right/left, so nobody
-- is served anything without individually agreeing to it. A future pass
-- could add per-subcategory dietary_tags and reuse
-- filterCuisinesByDietary()'s exact logic if this proves not to be enough.

create table if not exists public.cuisine_subcategories (
  id text primary key,
  cuisine_id text not null references public.cuisines(id) on delete cascade,
  name text not null,
  dishes text[] not null default '{}'
);

alter table public.cuisine_subcategories enable row level security;

create policy "cuisine_subcategories: public read"
  on public.cuisine_subcategories
  for select
  using (true);

-- ---------------------------------------------------------------------------
-- Seed: 10 Indian subcategories, researched against real Zomato/Swiggy
-- category taxonomy and 2024-2025 most-ordered-dish data (biryani is India's
-- #1 most-ordered dish on both platforms for 9 consecutive years running --
-- it gets its own category rather than being buried inside North Indian or
-- Hyderabadi). 8 dishes each, chosen to be genuinely distinct from the 10
-- dishes already in the flat `cuisines.dishes` catalog for 'indian'
-- (0016_expand_cuisine_dishes.sql) -- no overlap, so a group that goes
-- through this second layer sees entirely new dishes, not repeats.
-- ---------------------------------------------------------------------------
insert into public.cuisine_subcategories (id, cuisine_id, name, dishes) values
  ('indian-north', 'indian', 'North Indian', ARRAY['Paneer Butter Masala', 'Rajma Chawal', 'Amritsari Kulcha', 'Sarson ka Saag with Makki Roti', 'Malai Kofta', 'Kadhai Paneer', 'Aloo Paratha', 'Paneer Tikka']),
  ('indian-south', 'indian', 'South Indian', ARRAY['Uttapam', 'Rava Dosa', 'Medu Vada', 'Pongal', 'Chettinad Chicken Curry', 'Appam with Stew', 'Rasam Rice', 'Curd Rice']),
  ('indian-mughlai', 'indian', 'Mughlai', ARRAY['Mutton Korma', 'Shahi Paneer', 'Nihari', 'Chicken Rezala', 'Galouti Kebab', 'Nawabi Biryani', 'Sheermal', 'Murgh Musallam']),
  ('indian-biryani', 'indian', 'Biryani & Rice', ARRAY['Hyderabadi Chicken Biryani', 'Mutton Biryani', 'Veg Dum Biryani', 'Kolkata Biryani', 'Lucknowi Biryani', 'Ambur Biryani', 'Tehri', 'Prawn Biryani']),
  ('indian-bengali', 'indian', 'Bengali', ARRAY['Shorshe Ilish', 'Chingri Malai Curry', 'Kosha Mangsho', 'Aloo Posto', 'Luchi with Aloo Dum', 'Fish Kabiraji', 'Cholar Dal', 'Mishti Doi']),
  ('indian-gujarati', 'indian', 'Gujarati', ARRAY['Dhokla', 'Undhiyu', 'Khandvi', 'Gujarati Kadhi', 'Thepla', 'Handvo', 'Fafda with Jalebi', 'Gujarati Dal']),
  ('indian-rajasthani', 'indian', 'Rajasthani', ARRAY['Dal Baati Churma', 'Laal Maas', 'Gatte ki Sabji', 'Ker Sangri', 'Pyaaz Kachori', 'Mirchi Vada', 'Rajasthani Kadhi', 'Bajre ki Roti with Lehsun Chutney']),
  ('indian-street-food', 'indian', 'Street Food & Chaat', ARRAY['Pani Puri', 'Pav Bhaji', 'Sev Puri', 'Vada Pav', 'Bhel Puri', 'Aloo Tikki Chaat', 'Dahi Puri', 'Misal Pav']),
  ('indian-tandoor', 'indian', 'Tandoor & Kebabs', ARRAY['Tandoori Chicken', 'Seekh Kebab', 'Chicken Malai Tikka', 'Hariyali Paneer Tikka', 'Reshmi Kebab', 'Tandoori Prawns', 'Mutton Seekh Kebab', 'Fish Tikka']),
  ('indian-hyderabadi', 'indian', 'Hyderabadi', ARRAY['Haleem', 'Baghara Baingan', 'Mirchi ka Salan', 'Double ka Meetha', 'Hyderabadi Khichdi', 'Bagara Rice', 'Boti Kebab', 'Qubani ka Meetha'])
on conflict (id) do update
  set name = excluded.name,
      dishes = excluded.dishes;

-- ---------------------------------------------------------------------------
-- swipe_sessions gains a second match-result column, same shape as
-- matched_cuisine_id. Nullable, only ever set for rooms that matched on
-- 'indian' and then went through the refine layer -- every other room's
-- value stays null forever, which is exactly how matched_restaurant_name/
-- matched_dish_name already behave for rooms that never dish-swiped.
-- ---------------------------------------------------------------------------
alter table public.swipe_sessions
  add column if not exists matched_subcuisine_id text;

-- ---------------------------------------------------------------------------
-- subcuisine_swipes -- one row per (session, user, subcuisine), mirrors
-- `swipes` exactly.
-- ---------------------------------------------------------------------------
create table if not exists public.subcuisine_swipes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.swipe_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subcuisine_id text not null,
  direction text not null check (direction in ('left', 'right')),
  created_at timestamptz not null default now(),
  unique (session_id, user_id, subcuisine_id)
);

alter table public.subcuisine_swipes enable row level security;

create policy "subcuisine_swipes: select if participant of session"
  on public.subcuisine_swipes
  for select
  using (public.is_room_participant(session_id));

create policy "subcuisine_swipes: insert own swipe as participant"
  on public.subcuisine_swipes
  for insert
  with check (
    user_id = auth.uid()
    and public.is_room_participant(session_id)
  );

create policy "subcuisine_swipes: update own swipe as participant"
  on public.subcuisine_swipes
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_room_participant(session_id)
  );

-- ---------------------------------------------------------------------------
-- Match detection -- mirrors check_swipe_match() exactly (0006, as amended
-- by 0009's >= 2 participant fix), one level down. Sets matched_subcuisine_id
-- only; deliberately does NOT touch `status` -- the room is already
-- 'matched' from the cuisine-level trigger, and this is a refinement within
-- that state, not a new stage needing its own status value (the same
-- reasoning 0012 already established for why dish matches don't touch
-- status either).
-- ---------------------------------------------------------------------------
create or replace function public.check_subcuisine_match()
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
    from public.subcuisine_swipes sw
    where sw.session_id = new.session_id
      and sw.subcuisine_id = new.subcuisine_id
      and sw.direction = 'right'
      and exists (
        select 1 from public.room_participants rp
        where rp.room_id = sw.session_id and rp.user_id = sw.user_id
      );

    if v_participant_count >= 2 and v_right_count >= v_participant_count then
      update public.swipe_sessions
      set matched_subcuisine_id = new.subcuisine_id
      where swipe_sessions.id = new.session_id
        and matched_subcuisine_id is null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists subcuisine_swipes_check_match on public.subcuisine_swipes;

create trigger subcuisine_swipes_check_match
  after insert or update on public.subcuisine_swipes
  for each row
  execute function public.check_subcuisine_match();

-- ---------------------------------------------------------------------------
-- Realtime -- both membership in the publication AND replica identity full
-- are required, per the lesson recorded in 0009's header comment (RLS-
-- checked UPDATE/DELETE delivery silently drops changes without the latter).
-- ---------------------------------------------------------------------------
alter table public.subcuisine_swipes replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subcuisine_swipes'
  ) then
    alter publication supabase_realtime add table public.subcuisine_swipes;
  end if;
end $$;


