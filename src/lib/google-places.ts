// Google Places API (New) integration -- Phase 6 Track A
// (C:\Users\ajitd\.claude\plans\clever-baking-map.md).
//
// Text Search (New), not Nearby Search + separate Place Details per result:
// a cuisine-aware query ("italian restaurants near me") biased to a point
// returns rating/userRatingCount/priceLevel/websiteUri in the SAME response
// when asked for via the field mask, so this is one paid call per search
// instead of one-plus-N. That's what keeps this affordable on the free
// monthly credit at this app's scale.
const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Field mask -- Places API (New) bills partly by which fields you ask for,
// so this lists exactly what find-restaurants.ts and the cache need, not
// the default "everything".
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.nationalPhoneNumber",
  "places.photos.name",
].join(",");

export interface GooglePlaceResult {
  googlePlaceId: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  rating: number | null;
  reviewCount: number | null;
  /** 0-4, null when Google has no price signal for this place. */
  priceLevel: number | null;
  website: string | null;
  mapsUrl: string;
  /** Restaurant's own phone number, null when Google has none on file. Never invented. */
  phone: string | null;
  /**
   * Places API "resource name" of the restaurant's own first photo (e.g.
   * "places/ChIJ.../photos/AUy1..."), null when Google has none. This is NOT
   * a fetchable URL by itself -- it's fed to /api/place-photo, which resolves
   * it server-side (see that route for why: resolving it directly would put
   * the billed API key in a client-visible URL).
   */
  photoRef: string | null;
}

// Google's PRICE_LEVEL_* string enum -> the 0-4 int this app stores/renders.
// PRICE_LEVEL_UNSPECIFIED and anything unrecognised map to null -- "unknown"
// must stay distinct from "free", which is a real (if rare) value for a
// restaurant.
const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** `priceLevel` -> "₹"/"₹₹"/"₹₹₹"/"₹₹₹₹", or null when there's nothing to show. */
export function priceLevelToSymbol(priceLevel: number | null): string | null {
  if (priceLevel === null || priceLevel <= 0) return null;
  return "₹".repeat(Math.min(priceLevel, 4));
}

export async function fetchFromGooglePlaces(
  cuisine: string,
  latitude: number,
  longitude: number,
  apiKey: string
): Promise<GooglePlaceResult[]> {
  const response = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: `${cuisine} restaurants`,
      locationBias: {
        circle: {
          center: { latitude, longitude },
          radius: 10000, // metres -- matches the existing Geoapify search radius
        },
      },
      maxResultCount: 12,
    }),
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) {
    // Never include the response body in a thrown message -- Google's error
    // payloads can echo request details, and this error is logged, not
    // returned to the caller (same rule find-restaurants.ts already
    // follows for Geoapify, for the same reason: don't let a key or a
    // request URL leak through an error path).
    throw new Error(`Google Places Text Search returned HTTP status ${response.status}`);
  }

  const data = await response.json();
  const places: unknown[] = Array.isArray(data.places) ? data.places : [];

  const results: GooglePlaceResult[] = [];
  for (const raw of places) {
    const place = raw as Record<string, unknown>;
    const id = typeof place.id === "string" ? place.id : null;
    const displayName = place.displayName as { text?: string } | undefined;
    const name = displayName?.text;
    const location = place.location as { latitude?: number; longitude?: number } | undefined;
    if (!id || !name || typeof location?.latitude !== "number" || typeof location?.longitude !== "number") {
      continue;
    }

    const priceLevelRaw = typeof place.priceLevel === "string" ? place.priceLevel : null;
    const photos = Array.isArray(place.photos) ? place.photos : [];
    const firstPhoto = photos[0] as { name?: string } | undefined;
    const photoRef = typeof firstPhoto?.name === "string" ? firstPhoto.name : null;

    results.push({
      googlePlaceId: id,
      name,
      address: typeof place.formattedAddress === "string" ? place.formattedAddress : null,
      latitude: location.latitude,
      longitude: location.longitude,
      rating: typeof place.rating === "number" ? place.rating : null,
      reviewCount: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
      priceLevel: priceLevelRaw ? (PRICE_LEVEL_MAP[priceLevelRaw] ?? null) : null,
      website: typeof place.websiteUri === "string" ? place.websiteUri : null,
      phone: typeof place.nationalPhoneNumber === "string" ? place.nationalPhoneNumber : null,
      photoRef,
      mapsUrl:
        typeof place.googleMapsUri === "string"
          ? place.googleMapsUri
          : `https://www.google.com/maps/place/?q=place_id:${id}`,
    });
  }

  return results;
}
