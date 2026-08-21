// POST /api/find-restaurants
//
//   body:     { cuisine: string, latitude: number, longitude: number }
//   response: { restaurants: Restaurant[], source: "cache" | "google" | "geoapify" | "mock" }
//
// Ported from the reference Next.js/Genkit flow
// (Food Swipe App/src/ai/flows/find-restaurants.ts): direct Geoapify Places
// API call (no Yelp path -- the reference project's YELP_API_KEY was never
// configured, and this phase's task only asked for Geoapify), same query
// shape and semantic cuisine-name matching/reordering as the original.
//
// Phase 6 Track A (C:\Users\ajitd\.claude\plans\clever-baking-map.md): real
// ratings + price level via Google Places, cached in Supabase
// (0018_restaurant_cache.sql) so a busy room doesn't spend a paid Places
// call on every search. Fallback chain, each step only reached if the one
// above genuinely can't answer: fresh cache -> live Google Places (writes
// back to the cache) -> Geoapify (no ratings, but real listings) -> the
// regional mock data. Every step keeps the same promise the rating-
// fabrication fix established: a number that isn't real is never shown.
import type { APIRoute } from "astro";
import {
  BadRequest,
  cleanText,
  errorResponse,
  finiteNumber,
  json,
  rateLimit,
  readJsonBody,
  tooManyRequests,
} from "@/lib/api/guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readRestaurantCache, writeRestaurantCache, type MenuPreviewItem } from "@/lib/restaurant-cache";
import { fetchFromGooglePlaces } from "@/lib/google-places";

export const prerender = false;

// Unauthenticated and backed by paid API keys, so the same size/rate caps as
// the Gemini routes apply. Coordinates are also range-checked now:
// `typeof NaN === "number"` and latitude 999 both used to sail through and
// become a live Geoapify query.
const MAX_CUISINE = 60;
const RATE_LIMIT_PER_WINDOW = 8;

export interface Restaurant {
  name: string;
  vicinity: string;
  /** Null whenever we have no genuine rating. Never invent one. */
  rating: number | null;
  reviewCount: number | null;
  /** 0-4, null when unknown. Render as ₹ symbols via google-places.ts's priceLevelToSymbol(). */
  priceLevel: number | null;
  website: string;
  /** Restaurant's own phone number, null when unknown. Never invented. */
  phone: string | null;
  /**
   * A real photo of THIS restaurant (proxied through /api/place-photo, see
   * photoUrlFor() below), null when Google has none on file. The UI's
   * fallback for null is the cuisine's own stock photo (getCuisineImageVariant
   * in match-reveal.tsx) -- never a claim that a generic shot is this
   * restaurant's own.
   */
  photoUrl: string | null;
  /** Up to 3 dishes pulled from the restaurant's own site (Track B, 0019). Empty when not yet enriched -- never fabricated. */
  menuPreview: MenuPreviewItem[];
}

/** Builds the app's own proxied photo URL from a Places API photo resource name -- see /api/place-photo.ts for why this can't just be Google's URL directly (it would carry the billed API key). */
function photoUrlFor(photoRef: string | null | undefined): string | null {
  return photoRef ? `/api/place-photo?ref=${encodeURIComponent(photoRef)}` : null;
}

function mockRestaurants(cuisine: string, latitude: number, longitude: number): Restaurant[] {
  let mockPrefix = "Grand";
  let addressCity = "New York";

  // Coordinate check for India (Kolkata is around lat 22.49, lon 88.39)
  if (latitude >= 6.0 && latitude <= 37.0 && longitude >= 68.0 && longitude <= 97.0) {
    mockPrefix = "Swad";
    addressCity = latitude >= 18.0 && latitude <= 20.0 ? "Mumbai" : "Kolkata";
  } else if (latitude >= 49.0 && latitude <= 61.0 && longitude >= -8.0 && longitude <= 2.0) {
    mockPrefix = "Royal";
    addressCity = "London";
  }

  const capitalizedCuisine = cuisine.charAt(0).toUpperCase() + cuisine.slice(1);
  return [
    {
      name: `${mockPrefix} ${capitalizedCuisine} Kitchen`,
      vicinity: `1.5 km away, Park Street, ${addressCity}`,
      rating: null,
      reviewCount: null,
      priceLevel: null,
      phone: null,
      photoUrl: null,
      menuPreview: [],
      website: `https://www.google.com/search?q=${encodeURIComponent(mockPrefix + " " + cuisine + " restaurant " + addressCity)}`,
    },
    {
      name: `Tandoor & ${capitalizedCuisine} Bistro`,
      vicinity: `3.2 km away, Salt Lake Sector V, ${addressCity}`,
      rating: null,
      reviewCount: null,
      priceLevel: null,
      phone: null,
      photoUrl: null,
      menuPreview: [],
      website: `https://www.google.com/search?q=${encodeURIComponent(cuisine + " restaurant Salt Lake " + addressCity)}`,
    },
    {
      name: `Bukhara ${capitalizedCuisine} House`,
      vicinity: `5.4 km away, Gariahat Crossing, ${addressCity}`,
      rating: null,
      reviewCount: null,
      priceLevel: null,
      phone: null,
      photoUrl: null,
      menuPreview: [],
      website: `https://www.google.com/search?q=${encodeURIComponent("Bukhara " + cuisine + " restaurant " + addressCity)}`,
    },
  ];
}

async function fetchFromGeoapify(
  cuisine: string,
  latitude: number,
  longitude: number,
  apiKey: string
): Promise<Restaurant[]> {
  const cleanCuisine = cuisine.toLowerCase();
  const url = `https://api.geoapify.com/v2/places?categories=catering.restaurant&filter=circle:${longitude},${latitude},10000&bias=proximity:${longitude},${latitude}&limit=12&apiKey=${apiKey}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) {
    throw new Error(`Geoapify Places API returned HTTP status ${response.status}`);
  }

  const data = await response.json();
  if (!data.features || data.features.length === 0) {
    return [];
  }

  const matches: Restaurant[] = [];
  const generals: Restaurant[] = [];

  for (const feat of data.features) {
    const props = feat.properties;
    if (!props || !props.name) continue;

    const name: string = props.name;
    const vicinity = props.formatted || props.street || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
    // Geoapify does not supply customer review ratings or price level. The
    // reference project filled the gap with `4.1 + Math.random() * 0.8` --
    // a randomly invented number rendered to users as a customer rating,
    // the same class of fabrication as the old app's hardcoded "delivery
    // prices" (removed for exactly this reason). This path is now only
    // reached when Google Places itself failed, so real ratings are still
    // possible via the cache/Google steps above it -- but Geoapify's own
    // results stay honest: null, not invented.
    const rating = null;
    const website = props.website || `https://www.google.com/search?q=${encodeURIComponent(name + " restaurant")}`;
    // Geoapify sometimes carries a real phone under properties.contact --
    // real when present, never invented when absent.
    const phone: string | null = typeof props.contact?.phone === "string" ? props.contact.phone : null;

    const record: Restaurant = {
      name,
      vicinity,
      rating,
      reviewCount: null,
      priceLevel: null,
      phone,
      photoUrl: null,
      menuPreview: [],
      website,
    };

    const lowerName = name.toLowerCase();
    const tags = props.catering?.cuisine?.toLowerCase() || "";

    if (lowerName.includes(cleanCuisine) || tags.includes(cleanCuisine)) {
      matches.push(record);
    } else {
      generals.push(record);
    }
  }

  const combined = [...matches];
  for (const g of generals) {
    if (combined.length >= 6) break;
    const capitalizedCuisine = cuisine.charAt(0).toUpperCase() + cuisine.slice(1);
    combined.push({
      name: g.name.toLowerCase().includes(cleanCuisine) ? g.name : `${g.name} (${capitalizedCuisine} Choice)`,
      vicinity: g.vicinity,
      rating: g.rating,
      reviewCount: g.reviewCount,
      priceLevel: g.priceLevel,
      phone: g.phone,
      photoUrl: g.photoUrl,
      menuPreview: g.menuPreview,
      website: g.website,
    });
  }

  return combined.slice(0, 6);
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const limit = rateLimit(request, "find-restaurants", RATE_LIMIT_PER_WINDOW);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return errorResponse(err instanceof BadRequest ? err.message : "Invalid JSON body", 400);
  }

  const cuisine = cleanText(body.cuisine, MAX_CUISINE);
  const latitude = finiteNumber(body.latitude, -90, 90);
  const longitude = finiteNumber(body.longitude, -180, 180);

  if (!cuisine || latitude === null || longitude === null) {
    return errorResponse(
      "cuisine (string), latitude (number, -90..90), longitude (number, -180..180) are required",
      400
    );
  }

  // Step 1: the cache. A hit here is free -- no paid API call at all.
  // Wrapped in try/catch because migration 0018 may not be applied yet on
  // some environments (same "never let optional infra take down the real
  // feature" rule sponsored-restaurants.ts follows) -- an unrecognised
  // table/function just falls through to Google Places as if the cache
  // were empty.
  const supabase = createSupabaseServerClient(request, cookies);
  try {
    const cached = await readRestaurantCache(supabase, cuisine, latitude, longitude);
    if (cached.length >= 3) {
      const restaurants: Restaurant[] = cached.map((r) => ({
        name: r.name,
        vicinity: r.address ?? `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
        rating: r.rating,
        reviewCount: r.reviewCount,
        priceLevel: r.priceLevel,
        phone: r.phone,
        photoUrl: photoUrlFor(r.photoRef),
        menuPreview: r.menuPreview,
        website: r.website ?? r.mapsUrl,
      }));
      return json({ restaurants, source: "cache" });
    }
  } catch (err) {
    console.error("[find-restaurants] cache read failed, continuing to Google Places:", err);
  }

  // Step 2: live Google Places, the real-ratings source. Writes back to the
  // cache (best-effort, never blocks the response -- see writeRestaurantCache).
  const googleKey = import.meta.env.GOOGLE_PLACES_API_KEY;
  if (googleKey) {
    try {
      const places = await fetchFromGooglePlaces(cuisine, latitude, longitude, googleKey);
      if (places.length > 0) {
        void writeRestaurantCache(supabase, cuisine, places).catch((err) => {
          console.error("[find-restaurants] cache write failed:", err);
        });
        const restaurants: Restaurant[] = places
          .map((p) => ({
            name: p.name,
            vicinity: p.address ?? `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
            rating: p.rating,
            reviewCount: p.reviewCount,
            priceLevel: p.priceLevel,
            phone: p.phone,
            photoUrl: photoUrlFor(p.photoRef),
            menuPreview: [] as Restaurant["menuPreview"], // fresh from Google -- Track B enrichment hasn't run for this restaurant yet
            website: p.website ?? p.mapsUrl,
          }))
          // Places' Text Search order is relevance, not rating -- sort by
          // real rating (review count as tiebreaker) so "sorted by rank"
          // holds regardless of source, same as the cache path already does.
          .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
        return json({ restaurants, source: "google" });
      }
    } catch (err) {
      // Never surfaced to the caller: an error message here could carry
      // request details. Logged only, same rule as the Geoapify path below.
      console.error("[find-restaurants] Google Places search failed, falling back to Geoapify:", err);
    }
  } else {
    console.warn("[find-restaurants] GOOGLE_PLACES_API_KEY not configured, falling back to Geoapify");
  }

  // Step 3: Geoapify -- real listings, no ratings (see fetchFromGeoapify's
  // own comment). Only reached if Google Places is unconfigured or failed.
  const geoapifyKey = import.meta.env.GEOAPIFY_API_KEY;
  if (geoapifyKey) {
    try {
      const restaurants = await fetchFromGeoapify(cuisine, latitude, longitude, geoapifyKey);
      if (restaurants.length > 0) {
        return json({ restaurants, source: "geoapify" });
      }
    } catch (err) {
      console.error("[find-restaurants] Geoapify search failed, using mock fallback:", err);
    }
  } else {
    console.warn("[find-restaurants] GEOAPIFY_API_KEY not configured, using mock fallback");
  }

  // Step 4: the mock data. Every step above failed or is unconfigured --
  // this is what keeps the endpoint from ever hard-failing the caller.
  return json({ restaurants: mockRestaurants(cuisine, latitude, longitude), source: "mock" });
};
