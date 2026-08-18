-- 0018_restaurant_cache.sql
--
-- Phase 6, Track A (see clever-baking-map.md plan). find-restaurants.ts has
-- returned rating: null for every restaurant since the fabricated-ratings
-- fix (see 0015's integration-pass note) -- Geoapify, its data source, has
-- no rating field at all. This adds a real one via Google Places, cached
-- here so a busy room doesn't burn a paid Places call on every search.
--
-- Write model, deliberately NOT a service-role key: this app has no
-- service-role credential anywhere (only the anon key), and every other
-- "public read, privileged write" surface in this schema already solves
-- that with a SECURITY DEFINER function grantable to anon/authenticated
-- (create_room(), join_room_by_code()) rather than a second credential
-- type. upsert_restaurant_cache() below is the same pattern: the table has
-- no direct INSERT/UPDATE policy at all, so the only way in is through the
-- function, which runs with elevated privilege regardless of the caller's
-- own grants.

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  google_place_id text unique not null,
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  rating numeric,                -- null when Google genuinely has none -- never fabricated
  review_count integer,
  price_level smallint,          -- 0-4 (Google's PRICE_LEVEL_* enum, mapped to an int), null when unknown
  website text,
  maps_url text,
  cuisine_tags text[] not null default '{}',
  enrichment_status text not null default 'unstarted',
  last_synced_at timestamptz not null default now(),
  constraint restaurants_price_level_range check (price_level is null or price_level between 0 and 4),
  constraint restaurants_enrichment_status_values check (
    enrichment_status in ('unstarted', 'pending', 'done', 'no_menu_found', 'no_website')
  )
);

-- Read is public -- same trust level as the live Geoapify call this
-- replaces/augments, which had no auth check either. A bounding-box +
-- cuisine-tag scan is how find-restaurants.ts checks the cache before
-- spending a Places call; no PostGIS, this app's scale doesn't need it.
create index restaurants_lat_lng_idx on public.restaurants (latitude, longitude);
create index restaurants_cuisine_tags_idx on public.restaurants using gin (cuisine_tags);
create index restaurants_enrichment_status_idx on public.restaurants (enrichment_status)
  where enrichment_status = 'pending';

alter table public.restaurants enable row level security;

drop policy if exists "restaurants: public read" on public.restaurants;
create policy "restaurants: public read"
  on public.restaurants
  for select
  using (true);

-- No insert/update/delete policies at all -- see header. Only
-- upsert_restaurant_cache() (below) and, later, Track B's enrichment
-- script (via the same function pattern) may write here.
revoke insert, update, delete on public.restaurants from anon, authenticated;
grant select on public.restaurants to anon, authenticated;

-- ---------------------------------------------------------------------------
-- upsert_restaurant_cache(): the one write path into public.restaurants.
--
-- One row per call, keyed on google_place_id -- find-restaurants.ts calls
-- this once per restaurant Google Places returned, after already checking
-- the cache came back empty/stale. `unrestricted null` fields (rating,
-- price_level, website) simply overwrite whatever was there before: Google
-- is the source of truth here, not this cache, so a rating that
-- disappeared upstream should disappear here too on next sync rather than
-- linger.
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
begin
  if p_google_place_id is null or length(trim(p_google_place_id)) = 0 then
    raise exception 'google_place_id is required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  insert into public.restaurants (
    google_place_id, name, address, latitude, longitude,
    rating, review_count, price_level, website, maps_url, cuisine_tags,
    last_synced_at
  )
  values (
    p_google_place_id, p_name, p_address, p_latitude, p_longitude,
    p_rating, p_review_count, p_price_level, p_website, p_maps_url, coalesce(p_cuisine_tags, '{}'),
    now()
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
    -- Union, not overwrite -- the same restaurant can legitimately surface
    -- under more than one cuisine search (e.g. a multi-cuisine restaurant),
    -- and a later search shouldn't erase an earlier cuisine tag.
    cuisine_tags = (
      select array_agg(distinct tag)
      from unnest(public.restaurants.cuisine_tags || excluded.cuisine_tags) as tag
    ),
    last_synced_at = now();
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
