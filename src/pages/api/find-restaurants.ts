// POST /api/find-restaurants
//
//   body:     { cuisine: string, latitude: number, longitude: number }
//   response: { restaurants: Restaurant[], source: "geoapify" | "mock" }
//
// Ported from the reference Next.js/Genkit flow
// (Food Swipe App/src/ai/flows/find-restaurants.ts): direct Geoapify Places
// API call (no Yelp path -- the reference project's YELP_API_KEY was never
// configured, and this phase's task only asked for Geoapify), same query
// shape and semantic cuisine-name matching/reordering as the original.
//
// Keeps the reference file's regional mock-fallback behavior for when
// Geoapify is unreachable, unconfigured, or returns nothing -- still useful
// as a degraded-mode fallback so this endpoint never hard-fails the caller.
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

export const prerender = false;

// Unauthenticated and backed by a paid Geoapify key, so the same size/rate
// caps as the Gemini routes apply. Coordinates are also range-checked now:
// `typeof NaN === "number"` and latitude 999 both used to sail through and
// become a live Geoapify query.
const MAX_CUISINE = 60;
const RATE_LIMIT_PER_WINDOW = 8;

export interface Restaurant {
  name: string;
  vicinity: string;
  /** Null whenever we have no genuine rating. Never invent one. */
  rating: number | null;
  website: string;
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
      website: `https://www.google.com/search?q=${encodeURIComponent(mockPrefix + " " + cuisine + " restaurant " + addressCity)}`,
    },
    {
      name: `Tandoor & ${capitalizedCuisine} Bistro`,
      vicinity: `3.2 km away, Salt Lake Sector V, ${addressCity}`,
      rating: null,
      website: `https://www.google.com/search?q=${encodeURIComponent(cuisine + " restaurant Salt Lake " + addressCity)}`,
    },
    {
      name: `Bukhara ${capitalizedCuisine} House`,
      vicinity: `5.4 km away, Gariahat Crossing, ${addressCity}`,
      rating: null,
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
    // Geoapify does not supply customer review ratings. The reference project
    // filled the gap with `4.1 + Math.random() * 0.8` -- a randomly invented
    // number rendered to users as a customer rating, which is the same class
    // of fabrication as the old app's hardcoded "delivery prices" (removed for
    // exactly this reason). A real restaurant judged by a dice roll is worse
    // than no rating at all, so this is null and the UI omits the field.
    const rating = null;
    const website = props.website || `https://www.google.com/search?q=${encodeURIComponent(name + " restaurant")}`;

    const record: Restaurant = { name, vicinity, rating, website };

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
      website: g.website,
    });
  }

  return combined.slice(0, 6);
}

export const POST: APIRoute = async ({ request }) => {
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

  const apiKey = import.meta.env.GEOAPIFY_API_KEY;
  if (apiKey) {
    try {
      const restaurants = await fetchFromGeoapify(cuisine, latitude, longitude, apiKey);
      if (restaurants.length > 0) {
        return json({ restaurants, source: "geoapify" });
      }
    } catch (err) {
      // Never surfaced to the caller: the thrown message can carry the
      // Geoapify request URL, and that URL carries the API key.
      console.error("[find-restaurants] Geoapify search failed, using mock fallback:", err);
    }
  } else {
    console.warn("[find-restaurants] GEOAPIFY_API_KEY not configured, using mock fallback");
  }

  return json({ restaurants: mockRestaurants(cuisine, latitude, longitude), source: "mock" });
};
