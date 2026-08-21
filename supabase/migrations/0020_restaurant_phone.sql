-- 0020_restaurant_phone.sql
--
-- Bug fix, not a new feature: once a room reached the "order this restaurant"
-- screen, the only options offered were generic Zomato/Swiggy SEARCH links --
-- this app has no way to know a restaurant's real listing id on those
-- platforms (see delivery-links.ts's own comment), so the search often
-- landed on the wrong result or a blank query box. Real, honest options this
-- app CAN offer -- the restaurant's own website (already fetched from Google
-- Places, just never threaded past the results grid) and its real phone
-- number (not fetched at all until now) -- were missing. This adds the
-- phone column so it can be cached and threaded through the same way
-- website already is.
--
-- google-places.ts now requests places.nationalPhoneNumber in the field
-- mask; find-restaurants.ts passes it to upsert_restaurant_cache() below.

alter table public.restaurants add column if not exists phone text;

-- Function signature changes (new trailing param) -- Postgres identifies a
-- function by name + argument TYPES, so adding a parameter creates a new
-- overload rather than replacing the old one; drop the old 11-arg signature
-- explicitly so it doesn't linger as dead, separately-privileged code.
drop function if exists public.upsert_restaurant_cache(
  text, text, text, double precision, double precision,
  numeric, integer, smallint, text, text, text[]
);

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
  p_cuisine_tags text[],
  p_phone text default null
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
    rating, review_count, price_level, website, maps_url, phone, cuisine_tags,
    last_synced_at
  )
  values (
    p_google_place_id, p_name, p_address, p_latitude, p_longitude,
    p_rating, p_review_count, p_price_level, p_website, p_maps_url, p_phone, coalesce(p_cuisine_tags, '{}'),
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
    phone = excluded.phone,
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
  numeric, integer, smallint, text, text, text[], text
) from public;
grant execute on function public.upsert_restaurant_cache(
  text, text, text, double precision, double precision,
  numeric, integer, smallint, text, text, text[], text
) to anon, authenticated;
