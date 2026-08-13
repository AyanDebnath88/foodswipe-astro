-- 0013_harden_rls_and_validation.sql
--
-- Security / abuse-resistance hardening pass. Everything here is corrective
-- and re-runnable; migrations 0001-0012 are already applied to the live
-- project and are treated as immutable.
--
-- Each block below fixes something that was REPRODUCED against the live
-- project through the anon key by scripts/test-security.mjs (the observed
-- "before" output is quoted in each header). Nothing here is theoretical.
--
-- ===========================================================================
-- CONTENTS
--   A. trusted-write flag + version probe (infrastructure for the guards)
--   B. swipe_sessions guard trigger  -- creator could FORGE THE GROUP'S MATCH
--   C. room_participants INSERT policy dropped -- anyone could join any room
--      by uuid, bypassing the code entirely
--   D. swipe_sessions INSERT policy dropped -- direct room inserts allowed
--      malformed/squatted 4-char codes
--   E. profiles guard trigger -- is_guest was self-settable, display_name
--      was unbounded (''/10k chars), dietary_restrictions unbounded
--   F. length / shape constraints on the room + swipe tables
--   G. join_room_by_code(): require a signed-in caller (closes an
--      UNAUTHENTICATED room-code oracle) + throttle failed guesses
--   H. create_room(): per-creator hourly cap (room-code space exhaustion)
-- ===========================================================================


-- ===========================================================================
-- A. Trusted-write flag + schema version probe
--
-- The guard triggers below have to block CLIENT writes to columns that the
-- SECURITY DEFINER match/join functions must still be able to write. RLS
-- can't express that (it is row-level, not column-level, and a definer
-- function bypasses it entirely), and triggers fire for definer functions
-- too -- so the trusted paths announce themselves with a transaction-local
-- GUC that only a definer function can set.
--
-- `set_config(..., true)` is transaction-scoped, and every trusted function
-- clears it again the moment it is done, so the flag can never outlive the
-- one statement that needed it. PostgREST runs one client statement per
-- transaction, so there is no window in which a client could piggyback on a
-- flag another statement set.
-- ===========================================================================
create or replace function public.foodswipe_schema_version()
returns int language sql immutable as $$ select 13 $$;

grant execute on function public.foodswipe_schema_version() to anon, authenticated;

create or replace function public.foodswipe_trusted_write()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.foodswipe_trusted', true), 'off') = 'on';
$$;


-- ===========================================================================
-- B. swipe_sessions: a guard trigger on UPDATE
--
-- OBSERVED BEFORE THIS FIX (user A, room creator, anon key, no swipes cast
-- by anyone at all):
--
--   A forces the whole room to 'matched' on japanese with zero swipes
--       OK  written
--   ...what B (the victim) now sees
--       OK  [{"status":"matched","matched_cuisine_id":"japanese"}]
--
--   A (creator) rewrites the room code
--       OK  [{"id":"f43d98de-...","code":"ZQXJ"}]
--
-- The whole "a match is a server verdict, never a client claim" guarantee
-- (build log: "server-side match/decision triggers") was defeated by the one
-- participant most likely to want to defeat it. 0001's
-- "only creator can update status" policy is row-level: it says WHO may
-- update the row, and nothing about WHICH COLUMNS or WHICH VALUES -- so the
-- creator could write matched_cuisine_id / status / code directly and every
-- other member's UI faithfully rendered the forged decision over Realtime.
-- Rewriting `code` additionally invalidates every share link already handed
-- out for that room and lets a creator squat a code someone else is using.
--
-- Fix: a BEFORE UPDATE trigger. Client updates may now only move status
-- between 'waiting' and 'swiping' (the lobby transitions); the match columns,
-- the code, the creator and the id are server-owned.
-- ===========================================================================
create or replace function public.guard_swipe_session_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- create_room() / join_room_by_code() / check_swipe_match() announce
  -- themselves here; they are the only writers allowed past this point.
  --
  -- pg_trigger_depth() > 1 is a deliberate belt-and-braces second condition:
  -- it is true only for an UPDATE issued from inside another trigger, which
  -- in this schema means check_swipe_match() and nothing else (no
  -- client-definable trigger exists). If the GUC ever fails to take, match
  -- detection keeps working rather than breaking for every user -- a guard
  -- that silently kills the core feature is worse than the hole it closes.
  if public.foodswipe_trusted_write() or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'A room id cannot be changed.';
  end if;

  if new.code is distinct from old.code then
    raise exception 'A room code cannot be changed (it is already shared with the group).';
  end if;

  if new.creator_id is distinct from old.creator_id then
    raise exception 'A room creator cannot be changed.';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'A room''s created_at cannot be changed.';
  end if;

  if new.matched_cuisine_id is distinct from old.matched_cuisine_id
     or new.matched_restaurant_name is distinct from old.matched_restaurant_name
     or new.matched_dish_name is distinct from old.matched_dish_name then
    raise exception 'What the group matched on is decided by the server, not by a client.';
  end if;

  -- 'matched' / 'dish_matched' are verdicts, so they may only be reached
  -- through the match trigger. The lobby transitions stay client-writable
  -- because join_room_by_code() is not the only thing that legitimately
  -- moves a room between waiting and swiping.
  if new.status is distinct from old.status
     and (new.status not in ('waiting', 'swiping') or old.status not in ('waiting', 'swiping')) then
    raise exception 'Room status % -> % is not a client-settable transition.', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists swipe_sessions_guard_update on public.swipe_sessions;

create trigger swipe_sessions_guard_update
  before update on public.swipe_sessions
  for each row
  execute function public.guard_swipe_session_update();


-- ===========================================================================
-- C. room_participants: drop the client INSERT policy
--
-- OBSERVED BEFORE THIS FIX (user D, not invited, never told the room code,
-- knowing only the room's uuid):
--
--   D inserts her own participant row into A's room       OK  written
--   ...D can now read the room                            OK  [{"code":"LBIC","status":"swiping"}]
--   ...D can now read the participant list                OK  [3 rows]
--   ...D can now read co-participant profiles             OK  [display_name + dietary_restrictions of all 3]
--   ...D can now swipe in the room                        OK  written
--
-- 0001's policy was `with check (user_id = auth.uid())` -- "you may add
-- YOURSELF" -- with no check that the caller knows the room code or was
-- invited. Membership is the key to every other policy in this schema
-- (is_room_participant() gates swipe_sessions, swipes, dish_swipes,
-- dish_matches and get_room_profiles), so self-insertion is a
-- self-service grant of the entire room, plus a permanent match block: an
-- uninvited body counts in the unanimity denominator and never votes.
--
-- (Note: the first probe of this ran `.insert().select()` and got a 42501,
-- which reads exactly like a policy rejection. It wasn't -- Postgres applies
-- SELECT policies to the RETURNING clause and reports that with the SAME
-- message as a WITH CHECK violation. Dropping the RETURNING clause revealed
-- the insert had been legal all along. Worth remembering when probing RLS.)
--
-- Fix: no client INSERT path at all. Both legitimate writers are SECURITY
-- DEFINER functions that bypass RLS -- create_room() (adds the creator) and
-- join_room_by_code() (adds a joiner who proved they know the code). Nothing
-- in src/ inserts this table directly; the app has used the RPCs since 0009.
-- ===========================================================================
drop policy if exists "room_participants: insert own participant row" on public.room_participants;


-- ===========================================================================
-- D. swipe_sessions: drop the client INSERT policy
--
-- OBSERVED BEFORE THIS FIX (direct inserts by user A):
--
--   code "ab1!"      OK  [{"code":"ab1!"}]
--   code "abcd"      OK  [{"code":"abcd"}]
--   code "  z "      OK  [{"code":"  z "}]
--   code "日本語人"   OK  [{"code":"日本語人"}]
--
-- ...and join_room_by_code('日本語人') then really joined that room, while a
-- lowercase-coded room can never be joined at all (the RPC upper()s its
-- input), permanently consuming a code nobody can use. 0001's only shape
-- check was char_length(code) = 4.
--
-- Room creation has gone through the atomic create_room() RPC since 0009
-- (see src/lib/rooms.ts) precisely because the two-insert client path could
-- strand rooms; leaving the raw INSERT policy in place kept the stranding
-- AND the code-squatting available to anyone with the anon key. The RPC is
-- SECURITY DEFINER, so dropping this policy does not affect it.
-- ===========================================================================
drop policy if exists "swipe_sessions: creator can insert" on public.swipe_sessions;


-- ===========================================================================
-- E. profiles: normalise + guard on write
--
-- OBSERVED BEFORE THIS FIX (user A editing her own row):
--
--   A sets own is_guest = true                    OK  [{"is_guest":true}]
--   A sets display_name = '' (empty)              OK  [{"display_name":""}]
--   A sets display_name to 10,000 chars           OK  written
--   A sets dietary_restrictions to 500 junk       OK  written
--
-- Cross-user impact, not just self-harm: get_room_profiles() publishes
-- display_name / is_guest / dietary_restrictions to every co-participant, so
-- an empty or 10k-char name lands in everybody else's participant list, and
-- is_guest is exactly the flag the UI's "Guest" badge trusts -- a real
-- account could pose as a guest, or an anonymous account could shed the
-- badge. 500 junk dietary restrictions is a room-wide deck wipe, since the
-- dietary filter requires a cuisine to satisfy the UNION of everyone's
-- restrictions.
--
-- display_name is normalised rather than rejected: handle_new_user() only
-- coalesces a NULL display_name to 'Guest', so a signup passing
-- display_name: "" would hard-fail against a CHECK constraint. Trimming,
-- defaulting and truncating cannot break a signup.
--
-- NOT fixed here (accepted): a *plausible-looking* set of dietary
-- restrictions can still empty the deck for the whole room. That is
-- indistinguishable from an honest user with genuinely hard requirements,
-- which is a product question (the room should offer an override), not an
-- access-control one.
-- ===========================================================================
create or replace function public.guard_profile_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.display_name := btrim(coalesce(new.display_name, ''));
  if new.display_name = '' then
    new.display_name := 'Guest';
  end if;
  if char_length(new.display_name) > 60 then
    new.display_name := left(new.display_name, 60);
  end if;

  if new.phone is not null and char_length(new.phone) > 32 then
    raise exception 'Phone number is too long.';
  end if;

  if new.dietary_restrictions is null then
    new.dietary_restrictions := '{}'::text[];
  end if;
  if coalesce(array_length(new.dietary_restrictions, 1), 0) > 12 then
    raise exception 'At most 12 dietary restrictions.';
  end if;
  -- `as t(tag)` matters: `unnest(...) t` alone makes a bare `t` a whole-row
  -- record reference, and char_length(record) does not exist.
  if exists (
    select 1 from unnest(new.dietary_restrictions) as t(tag) where char_length(t.tag) > 40
  ) then
    raise exception 'A dietary restriction may be at most 40 characters.';
  end if;

  if tg_op = 'UPDATE' then
    -- Server-owned columns. handle_new_user() sets is_guest from
    -- auth.users.is_anonymous on INSERT; nothing may move it afterwards.
    new.id := old.id;
    new.created_at := old.created_at;
    if not public.foodswipe_trusted_write() then
      new.is_guest := old.is_guest;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_write on public.profiles;

create trigger profiles_guard_write
  before insert or update on public.profiles
  for each row
  execute function public.guard_profile_write();


-- ===========================================================================
-- F. Length / shape constraints
--
-- OBSERVED BEFORE THIS FIX: a 10,000-character cuisine_id, restaurant_name
-- and dish_name were all accepted, and every one of those strings is echoed
-- to every other member of the room (dish_swipes and dish_matches are
-- readable room-wide). Unbounded text in a shared row is both a storage
-- amplification vector and a way to wreck a co-participant's UI.
--
-- All constraints are added NOT VALID on purpose: this is a live database
-- and a full-table validation scan that trips over one pre-existing junk row
-- would abort the whole migration. NOT VALID enforces the rule on every new
-- and updated row -- which is what matters -- without re-checking history.
-- (The junk rows here are the probe's own; the room-code cleanup below
-- removes the malformed ones so the codes get reclaimed.)
--
-- Deliberately NOT added: a foreign key from swipes.cuisine_id to
-- cuisines.id. It looks like an obvious missing FK, but the AI match-fallback
-- (src/lib/cuisines.ts syntheticCuisineFromName) deliberately deals cards for
-- cuisines that are NOT in the catalog, with synthetic `ai-<slug>` ids, and
-- the group must be able to match on one. An FK would break the feature that
-- exists specifically to rescue a stalled room. A bogus cuisine_id is also
-- not an attack: every participant has to right-swipe the same one for it to
-- matter, and a room that unanimously agrees on a nonsense card has agreed.
-- ===========================================================================
alter table public.swipes drop constraint if exists swipes_cuisine_id_len;
alter table public.swipes
  add constraint swipes_cuisine_id_len
  check (char_length(cuisine_id) between 1 and 64) not valid;

alter table public.dish_swipes drop constraint if exists dish_swipes_names_len;
alter table public.dish_swipes
  add constraint dish_swipes_names_len
  check (
    char_length(restaurant_name) between 1 and 160
    and char_length(dish_name) between 1 and 160
  ) not valid;

alter table public.dish_matches drop constraint if exists dish_matches_names_len;
alter table public.dish_matches
  add constraint dish_matches_names_len
  check (
    char_length(restaurant_name) between 1 and 160
    and char_length(dish_name) between 1 and 160
  ) not valid;

alter table public.swipe_sessions drop constraint if exists swipe_sessions_matched_cuisine_len;
alter table public.swipe_sessions
  add constraint swipe_sessions_matched_cuisine_len
  check (matched_cuisine_id is null or char_length(matched_cuisine_id) between 1 and 64) not valid;

-- Reclaim the malformed codes (lowercase / punctuation / unicode / padded)
-- that the dropped INSERT policy allowed in. A room whose code does not
-- match ^[A-Z]{4}$ cannot be joined through join_room_by_code() anyway --
-- it is dead weight holding a code hostage. Only probe rooms exist here.
delete from public.swipe_sessions where code !~ '^[A-Z]{4}$';

alter table public.swipe_sessions drop constraint if exists swipe_sessions_code_shape;
alter table public.swipe_sessions
  add constraint swipe_sessions_code_shape
  check (code ~ '^[A-Z]{4}$') not valid;


-- ===========================================================================
-- G. join_room_by_code(): authentication + a guess throttle
--
-- OBSERVED BEFORE THIS FIX, from a SIGNED-OUT client holding nothing but the
-- public anon key:
--
--   anon join_room_by_code with a REAL code
--       ERR [23502] null value in column "user_id" of relation "room_participants" violates not-null constraint
--   anon join_room_by_code with a FAKE code
--       ERR [P0001] Room "QQQQ" not found.
--
-- Two different errors = an oracle. The function checked membership nowhere
-- and auth.uid() nowhere; it looked the room up first and only fell over
-- later, when it tried to insert a NULL participant. So a client with no
-- account at all could ask "does room XXXX exist?" 456,976 times.
--
-- And measured with a real account:
--   25 guesses in 2515ms (9.9/s sequential, no throttle observed)
--   => full 26^4 sweep ~= 12.8 h single-threaded, far less in parallel
-- ...where every hit AUTO-JOINS the guesser (this RPC's whole job), which
-- exposes the group's display names and dietary restrictions and blocks
-- every future match by inflating the unanimity denominator.
--
-- RISK, honestly: this is not a credential leak or a data breach -- the
-- contents of a food room are display names, dietary tags, and what people
-- want for dinner. But "sweep the entire code space overnight and land in
-- every live room" is a real griefing/scraping capability, and it was
-- available anonymously. The proper fix is a bigger code space; that is a
-- product change (the 4-letter code is all over the UI and the share links),
-- so what this migration does instead is make sweeping expensive:
--   * signed-in callers only  -- kills the anonymous oracle outright;
--   * 12 FAILED lookups per user per minute -- a legitimate user mistypes a
--     code once or twice, an enumerator now needs ~24 days per account for
--     one sweep instead of 13 hours.
-- Only misses are counted and only misses are blocked, so a real user who
-- has the right code is never throttled.
--
-- ONE CONTRACT CHANGE, and the reason for it: the "no such room" branch now
-- RETURNS ZERO ROWS instead of raising. It has to. `raise exception` aborts
-- the transaction, which would roll back the very row that records the
-- failed attempt -- the throttle would have counted nothing, forever, while
-- looking entirely correct. PL/pgSQL has no autonomous transactions to work
-- around that with, so the miss path commits its record and reports the miss
-- as an empty result set instead.
--
-- Callers already treat that as an error: both src/lib/rooms.ts and the test
-- harness request the row with .single(), which turns zero rows into
-- PostgREST error PGRST116. src/lib/rooms.ts maps that code back to the same
-- "Room not found." message it always showed, so nothing changes for the
-- user. The other three refusals (not signed in, malformed code, throttled)
-- still raise, because none of them needs to write anything first.
-- ===========================================================================
create table if not exists public.room_join_attempts (
  id bigserial primary key,
  user_id uuid not null,
  code text,
  attempted_at timestamptz not null default now()
);

alter table public.room_join_attempts enable row level security;

-- No policies, deliberately: only the SECURITY DEFINER function below reads
-- or writes this, and a client must never be able to read (or clear) its own
-- throttle counter.
create index if not exists room_join_attempts_user_time_idx
  on public.room_join_attempts (user_id, attempted_at desc);

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
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_participant_count int;
  v_recent_misses int;
begin
  -- Before anything else, including the lookup: no account, no answer.
  if v_uid is null then
    raise exception 'Must be signed in to join a room.';
  end if;

  if p_code is null or char_length(trim(p_code)) <> 4 then
    raise exception 'Room code must be exactly 4 letters.';
  end if;

  select count(*) into v_recent_misses
  from public.room_join_attempts a
  where a.user_id = v_uid
    and a.attempted_at > now() - interval '1 minute';

  if v_recent_misses >= 12 then
    raise exception 'Too many incorrect room codes. Wait a minute and try again.';
  end if;

  select s.id into v_room_id
  from public.swipe_sessions s
  where s.code = upper(trim(p_code));

  if v_room_id is null then
    -- Opportunistic pruning: misses are rare in normal use, and frequent
    -- only while someone is enumerating -- exactly when the table needs it.
    delete from public.room_join_attempts where attempted_at < now() - interval '1 hour';
    insert into public.room_join_attempts (user_id, code) values (v_uid, upper(trim(p_code)));
    -- Zero rows, NOT `raise exception` -- see the header. Raising here would
    -- roll back the insert on the line above and the throttle would never
    -- count a single miss.
    return;
  end if;

  insert into public.room_participants (room_id, user_id)
  values (v_room_id, v_uid)
  on conflict (room_id, user_id) do nothing;

  select count(*) into v_participant_count
  from public.room_participants
  where room_id = v_room_id;

  -- 0013: the guard trigger from block B blocks client status writes, and
  -- this update is not one -- announce the trusted path, then close it
  -- again immediately so it covers nothing else.
  perform set_config('app.foodswipe_trusted', 'on', true);
  update public.swipe_sessions
  set status = 'swiping'
  where swipe_sessions.id = v_room_id
    and swipe_sessions.status = 'waiting'
    and v_participant_count >= 2;
  perform set_config('app.foodswipe_trusted', 'off', true);

  return query
    select s.id, s.code, s.creator_id, s.status, s.matched_cuisine_id
    from public.swipe_sessions s
    where s.id = v_room_id;
end;
$$;

revoke all on function public.join_room_by_code(text) from public;
grant execute on function public.join_room_by_code(text) to authenticated;


-- ===========================================================================
-- G2. check_swipe_match(): same trusted-path announcement
--
-- Unchanged in behaviour from 0009 (>= 2 participant floor, current
-- participants only, no re-firing once matched). It only needs the flag so
-- the block-B guard lets the SERVER's verdict through while still refusing
-- the creator's hand-written one.
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

    if v_participant_count >= 2 and v_right_count >= v_participant_count then
      perform set_config('app.foodswipe_trusted', 'on', true);
      update public.swipe_sessions
      set status = 'matched',
          matched_cuisine_id = new.cuisine_id
      where swipe_sessions.id = new.session_id
        and swipe_sessions.status not in ('matched', 'dish_matched');
      perform set_config('app.foodswipe_trusted', 'off', true);
    end if;
  end if;

  return new;
end;
$$;


-- ===========================================================================
-- H. create_room(): a per-creator hourly cap
--
-- There are only 26^4 = 456,976 room codes and nothing ever deletes a room,
-- so room creation is an exhaustion vector: create enough rooms and
-- create_room()'s 20-attempt uniqueness loop starts failing for everybody.
-- Unlimited creation is also free unbounded storage.
--
-- 100 rooms/hour/account is deliberately far above real use (the live test
-- suite, which is much busier than a person, creates ~10 per run) and is a
-- speed bump, not a wall -- an attacker with many accounts still gets
-- through. The real fixes are a larger code space and a TTL sweep of dead
-- rooms; both are product changes and are noted in the build log instead.
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
  v_recent int;
begin
  if v_uid is null then
    raise exception 'Must be signed in to create a room.';
  end if;

  select count(*) into v_recent
  from public.swipe_sessions s
  where s.creator_id = v_uid
    and s.created_at > now() - interval '1 hour';

  if v_recent >= 100 then
    raise exception 'Too many rooms created in the last hour. Try again later.';
  end if;

  -- Code generator is 0010's, verbatim: plain built-in SQL, NOT pgcrypto's
  -- gen_random_bytes() -- that is what 0010 had to fix, since pgcrypto lives
  -- in the `extensions` schema and this function is `set search_path = public`.
  loop
    v_attempts := v_attempts + 1;

    select string_agg(chr(65 + floor(random() * 26)::int), '')
      into v_code
      from generate_series(1, 4);

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
