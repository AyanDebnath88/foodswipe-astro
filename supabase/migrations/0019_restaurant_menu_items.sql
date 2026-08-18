-- 0019_restaurant_menu_items.sql
--
-- Phase 6/7, Track B (clever-baking-map.md plan): menu/price data pulled
-- from each restaurant's OWN website (not Zomato/Swiggy -- that route was
-- explicitly rejected on ToS/legal-risk grounds, see the plan), extracted
-- via Gemini since every restaurant site is shaped differently and a
-- bespoke parser per site doesn't scale. Populated by
-- scripts/enrich-restaurant-menus.mjs, run by hand -- neither Supabase's
-- nor Vercel's free tier has real cron, so this is deliberately not an
-- always-on job (see that script's header for the full reasoning).

create table public.restaurant_menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  dish_name text not null,
  price numeric,
  currency text not null default 'INR',
  source_url text,
  extracted_at timestamptz not null default now()
);

create index restaurant_menu_items_restaurant_id_idx on public.restaurant_menu_items (restaurant_id);
-- Case-insensitive dish-name lookup: find-restaurants.ts matches a room's
-- matched dish name against this table to rank "verified menu" restaurants
-- first (see record_enrichment_result()'s header and the plan's ranking
-- rules).
create index restaurant_menu_items_dish_name_lower_idx on public.restaurant_menu_items (lower(dish_name));

alter table public.restaurant_menu_items enable row level security;

drop policy if exists "restaurant_menu_items: public read" on public.restaurant_menu_items;
create policy "restaurant_menu_items: public read"
  on public.restaurant_menu_items
  for select
  using (true);

-- Same write model as 0018: no direct insert/update/delete policy, only
-- through record_enrichment_result() below.
revoke insert, update, delete on public.restaurant_menu_items from anon, authenticated;
grant select on public.restaurant_menu_items to anon, authenticated;

-- ---------------------------------------------------------------------------
-- upsert_restaurant_cache(): re-defined (CREATE OR REPLACE is safe to rerun
-- on an already-migrated DB, unlike CREATE TABLE) to seed enrichment_status
-- correctly instead of always leaving new rows at the table default
-- ('unstarted') forever. A restaurant with a website becomes a real
-- enrichment candidate ('pending'); one without is never going to have a
-- menu to pull ('no_website'). On conflict, a restaurant already 'done' or
-- 'no_menu_found' is left alone -- a routine cache refresh (the ratings
-- changed, say) must not silently reset real enrichment progress back to
-- square one.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_restaurant_cache(
  p_google_place_id text,
  p_name text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_rating numeric,
  p_review_count integer,
  p_price_level smallint,
  p_website text,
  p_maps_url text,
  p_cuisine_tags text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initial_status text;
begin
  if p_google_place_id is null or length(trim(p_google_place_id)) = 0 then
    raise exception 'google_place_id is required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  v_initial_status := case when p_website is not null then 'pending' else 'no_website' end;

  insert into public.restaurants (
    google_place_id, name, address, latitude, longitude,
    rating, review_count, price_level, website, maps_url, cuisine_tags,
    enrichment_status, last_synced_at
  )
  values (
    p_google_place_id, p_name, p_address, p_latitude, p_longitude,
    p_rating, p_review_count, p_price_level, p_website, p_maps_url, coalesce(p_cuisine_tags, '{}'),
    v_initial_status, now()
  )
  on conflict (google_place_id) do update set
    name = excluded.name,
    address = excluded.address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    rating = excluded.rating,
    review_count = excluded.review_count,
    price_level = excluded.price_level,
    website = excluded.website,
    maps_url = excluded.maps_url,
    cuisine_tags = (
      select array_agg(distinct tag)
      from unnest(public.restaurants.cuisine_tags || excluded.cuisine_tags) as tag
    ),
    enrichment_status = case
      when public.restaurants.enrichment_status in ('done', 'no_menu_found', 'pending') then public.restaurants.enrichment_status
      else v_initial_status
    end,
    last_synced_at = now();
end;
$$;

-- Backfill: rows written by 0018 before this migration all sat at the
-- table default ('unstarted') regardless of whether they have a website.
-- One-time correction so Track B has real candidates to enrich immediately
-- instead of waiting for every cached restaurant to be re-searched.
update public.restaurants
set enrichment_status = case when website is not null then 'pending' else 'no_website' end
where enrichment_status = 'unstarted';

-- ---------------------------------------------------------------------------
-- record_enrichment_result(): the one write path into
-- restaurant_menu_items, called once per restaurant by
-- scripts/enrich-restaurant-menus.mjs after it fetches the site and asks
-- Gemini to extract dish/price pairs.
--
-- p_items is a jsonb array of {dish_name, price, source_url} -- empty/null
-- means "fetched fine, no menu found" (p_status should be
-- 'no_menu_found'), not a transient failure (the script leaves those rows
-- at 'pending' instead of calling this at all, so they're retried next
-- run rather than marked permanently unenriched).
-- ---------------------------------------------------------------------------
create or replace function public.record_enrichment_result(
  p_restaurant_id uuid,
  p_status text,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('done', 'no_menu_found') then
    raise exception 'p_status must be done or no_menu_found, got %', p_status;
  end if;

  -- Replace, not append -- a re-run for a restaurant already enriched once
  -- should reflect the site's current menu, not accumulate stale rows
  -- forever.
  delete from public.restaurant_menu_items where restaurant_id = p_restaurant_id;

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    insert into public.restaurant_menu_items (restaurant_id, dish_name, price, source_url)
    select
      p_restaurant_id,
      trim(item->>'dish_name'),
      nullif(item->>'price', '')::numeric,
      item->>'source_url'
    from jsonb_array_elements(p_items) as item
    where item->>'dish_name' is not null and length(trim(item->>'dish_name')) > 0;
  end if;

  update public.restaurants set enrichment_status = p_status where id = p_restaurant_id;
end;
$$;

revoke all on function public.upsert_restaurant_cache(
  text, text, text, double precision, double precision,
  numeric, integer, smallint, text, text, text[]
) from public;
grant execute on function public.upsert_restaurant_cache(
  text, text, text, double precision, double precision,
  numeric, integer, smallint, text, text, text[]
) to anon, authenticated;

revoke all on function public.record_enrichment_result(uuid, text, jsonb) from public;
grant execute on function public.record_enrichment_result(uuid, text, jsonb) to anon, authenticated;
