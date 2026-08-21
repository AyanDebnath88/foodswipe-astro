-- 0021_restaurant_photo.sql
--
-- User feedback: the results grid showed the same handful of generic
-- cuisine stock photos for every restaurant card (getCuisineImageVariant()
-- in match-reveal.tsx), while Google's own listing for the exact same
-- restaurant has a real photo. This caches the Places API's photo resource
-- name (google-places.ts now requests places.photos.name) so
-- find-restaurants.ts can build a real photo for a card when Google has
-- one, falling back to the cuisine stock photo only when it doesn't.
--
-- The photo resource name is NOT a fetchable URL by itself -- resolving it
-- to actual image bytes needs the billed API key, which never reaches the
-- client (see src/pages/api/place-photo.ts).

alter table public.restaurants add column if not exists photo_ref text;

drop function if exists public.upsert_restaurant_cache(
  text, text, text, double precision, double precision,
  numeric, integer, smallint, text, text, text[], text
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
  p_phone text default null,
  p_photo_ref text default null
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
    rating, review_count, price_level, website, maps_url, phone, photo_ref, cuisine_tags,
    last_synced_at
  )
  values (
    p_google_place_id, p_name, p_address, p_latitude, p_longitude,
    p_rating, p_review_count, p_price_level, p_website, p_maps_url, p_phone, p_photo_ref,
    coalesce(p_cuisine_tags, '{}'),
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
    photo_ref = excluded.photo_ref,
    cuisine_tags = (
      select array_agg(distinct tag)
      from unnest(public.restaurants.cuisine_tags || excluded.cuisine_tags) as tag
    ),
    last_synced_at = now();
end;
$$;

revoke all on function public.upsert_restaurant_cache(
  text, text, text, double precision, double precision,
  numeric, integer, smallint, text, text, text[], text, text
) from public;
grant execute on function public.upsert_restaurant_cache(
  text, text, text, double precision, double precision,
  numeric, integer, smallint, text, text, text[], text, text
) to anon, authenticated;
