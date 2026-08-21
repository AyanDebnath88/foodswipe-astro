// GET /api/place-photo?ref=places/ChIJ.../photos/AUy1...
//
// Resolves a Places API photo resource name (google-places.ts requests
// places.photos.name, cached in restaurants.photo_ref by 0021) into an
// actual image. This has to be a server proxy, not a direct client fetch to
// Google's media endpoint: that endpoint takes the API key as a URL query
// parameter, and this app's Places key is a real billed credential -- an
// <img src> pointed straight at it would put the key in every visitor's
// network tab. This route holds the key server-side and only ever returns
// image bytes to the browser.
//
// User feedback: the results grid showed the same generic cuisine stock
// photo for every restaurant card. find-restaurants.ts builds a real photo
// URL through this route when Google has one, falling back to the stock
// photo only when it doesn't -- never a fabricated claim that a photo is
// this restaurant's own when it isn't.
import type { APIRoute } from "astro";
import { errorResponse, rateLimit } from "@/lib/api/guard";

export const prerender = false;

const MAX_WIDTH_PX = 640;
const RATE_LIMIT_PER_WINDOW = 90;

// A real Places API (New) photo resource name, e.g.
// "places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/AUy1Y...". This route forwards
// `ref` straight into an outbound request built with our own billed key, so
// an unvalidated value would turn this into an open proxy for arbitrary
// Google Places API calls on our credential. Anything not shaped exactly
// like a real photo resource name is refused before it ever reaches fetch().
const PHOTO_REF_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

export const GET: APIRoute = async ({ request, url }) => {
  const limit = rateLimit(request, "place-photo", RATE_LIMIT_PER_WINDOW);
  if (!limit.ok) return errorResponse("Too many requests, slow down.", 429, { "Retry-After": "5" });

  const ref = url.searchParams.get("ref");
  if (!ref || !PHOTO_REF_PATTERN.test(ref)) {
    return errorResponse("A valid ref query parameter is required", 400);
  }

  const apiKey = import.meta.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return errorResponse("Photo service is not configured", 503);

  try {
    const googleRes = await fetch(
      `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=${MAX_WIDTH_PX}&key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!googleRes.ok || !googleRes.body) {
      return errorResponse("Could not load photo", 502);
    }
    return new Response(googleRes.body, {
      status: 200,
      headers: {
        "Content-Type": googleRes.headers.get("content-type") ?? "image/jpeg",
        // Photo refs are stable once cached -- cache hard so browsing the
        // same restaurant again doesn't re-spend a billed Places Photo call.
        "Cache-Control": "public, max-age=2592000, immutable",
      },
    });
  } catch {
    // Never echo the fetch error -- it can contain the request URL, and
    // the request URL contains the API key.
    return errorResponse("Could not load photo", 502);
  }
};
