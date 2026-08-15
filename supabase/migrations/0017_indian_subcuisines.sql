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
