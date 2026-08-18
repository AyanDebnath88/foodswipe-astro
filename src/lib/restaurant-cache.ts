// Supabase-backed cache for restaurant search results (Phase 6 Track A,
// supabase/migrations/0018_restaurant_cache.sql). Read is a plain RLS-public
// select; write goes through the upsert_restaurant_cache() SECURITY DEFINER
// function (see that migration's header for why this app uses that pattern
// instead of a service-role key).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GooglePlaceResult } from "./google-places";

export interface MenuPreviewItem {
  dishName: string;
  price: number | null;
}

export interface CachedRestaurant {
  name: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  website: string | null;
  mapsUrl: string;
  /** Up to 3 dishes from restaurant_menu_items, when Track B has enriched this restaurant. Empty otherwise -- absence, never a fabricated preview. */
  menuPreview: MenuPreviewItem[];
}

const CACHE_TTL_DAYS = 14;
// ~0.05 degrees of latitude is roughly 5.5km -- a loose bounding box, not a
// precise radius (no PostGIS in this schema, see the migration's header).
// Good enough for "has someone already searched near here recently".
const BOUNDING_BOX_DEGREES = 0.05;

/**
 * Fresh cache rows near (latitude, longitude) tagged with `cuisine`. Empty
 * array means "cache miss" to the caller -- go fetch from Google Places.
 *
 * Ranks restaurants with a Track B-verified menu (see 0019) above those
 * without one, real rating as the tiebreaker within each tier -- the
 * ranking rule from the plan, minus the "matched dish" tier: this app
 * doesn't know which dish a room wants until AFTER a restaurant is picked
 * (dish swiping happens per-restaurant, see dish-swipe-area.tsx), so
 * "verified menu exists at all" is the real signal available at search
 * time, not "verified for this exact dish."
 */
export async function readRestaurantCache(
  supabase: SupabaseClient,
  cuisine: string,
  latitude: number,
  longitude: number
): Promise<CachedRestaurant[]> {
  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, address, rating, review_count, price_level, website, maps_url, cuisine_tags")
    .gte("latitude", latitude - BOUNDING_BOX_DEGREES)
    .lte("latitude", latitude + BOUNDING_BOX_DEGREES)
    .gte("longitude", longitude - BOUNDING_BOX_DEGREES)
    .lte("longitude", longitude + BOUNDING_BOX_DEGREES)
    .contains("cuisine_tags", [cuisine.toLowerCase()])
    .gte("last_synced_at", cutoff)
    .order("rating", { ascending: false, nullsFirst: false })
    .limit(12);

  if (error || !data || data.length === 0) return [];

  const ids = data.map((row) => row.id as string);
  const menuByRestaurant = new Map<string, MenuPreviewItem[]>();
  const { data: menuRows } = await supabase
    .from("restaurant_menu_items")
    .select("restaurant_id, dish_name, price")
    .in("restaurant_id", ids);

  for (const row of menuRows ?? []) {
    const list = menuByRestaurant.get(row.restaurant_id as string) ?? [];
    if (list.length < 3) list.push({ dishName: row.dish_name as string, price: row.price as number | null });
    menuByRestaurant.set(row.restaurant_id as string, list);
  }

  const withMenus: CachedRestaurant[] = data.map((row) => ({
    name: row.name as string,
    address: row.address as string | null,
    rating: row.rating as number | null,
    reviewCount: row.review_count as number | null,
    priceLevel: row.price_level as number | null,
    website: row.website as string | null,
    mapsUrl: row.maps_url as string,
    menuPreview: menuByRestaurant.get(row.id as string) ?? [],
  }));

  return withMenus.sort((a, b) => {
    if (a.menuPreview.length > 0 !== b.menuPreview.length > 0) {
      return a.menuPreview.length > 0 ? -1 : 1;
    }
    return (b.rating ?? -1) - (a.rating ?? -1);
  });
}

/**
 * Upserts every result from a live Google Places call into the cache, one
 * RPC call per restaurant. Best-effort: a single row failing to write
 * (e.g. a transient network blip) is logged and skipped, never lets a cache
 * write failure take down the search response the user is waiting on --
 * the results already came back from Google, are already being returned to
 * the caller regardless of whether the cache write itself succeeds.
 */
export async function writeRestaurantCache(
  supabase: SupabaseClient,
  cuisine: string,
  results: GooglePlaceResult[]
): Promise<void> {
  const cuisineTag = cuisine.toLowerCase();
  await Promise.all(
    results.map(async (r) => {
      const { error } = await supabase.rpc("upsert_restaurant_cache", {
        p_google_place_id: r.googlePlaceId,
        p_name: r.name,
        p_address: r.address,
        p_latitude: r.latitude,
        p_longitude: r.longitude,
        p_rating: r.rating,
        p_review_count: r.reviewCount,
        p_price_level: r.priceLevel,
        p_website: r.website,
        p_maps_url: r.mapsUrl,
        p_cuisine_tags: [cuisineTag],
      });
      if (error) {
        console.error(`[restaurant-cache] upsert failed for ${r.name}:`, error.message);
      }
    })
  );
}
