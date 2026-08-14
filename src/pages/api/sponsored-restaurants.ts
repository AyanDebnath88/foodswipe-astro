// POST /api/sponsored-restaurants
//
//   body:     { cuisine: string,            // the ALREADY-MATCHED cuisine
//               latitude?: number,
//               longitude?: number,
//               countryCode?: string,       // ISO-3166 alpha-2, if known
//               limit?: number }
//   response: { sponsored: SponsoredRestaurant[] }
//
//   SponsoredRestaurant = {
//     isSponsored: true, sponsorshipLabel: "Featured", placementId,
//     name, address, website, advertiserName
//   }
//
// =========================================================================
// GUARDRAIL: this endpoint answers ONE question -- "given that a room has
// ALREADY matched on cuisine X, which restaurants near them are paid
// placements?". It cannot answer, and must never be extended to answer,
// anything about which cuisine a room should see or match on. Sponsorship
// must never touch the swipe deck or the match algorithm; see the long
// version in src/lib/sponsored.ts and supabase/migrations/0015_monetization.sql.
//
// `cuisine` being REQUIRED is the structural expression of that rule: there
// is no way to call this without naming a decision the group already made.
// =========================================================================
//
// Every entry comes back flagged and labelled, so the caller cannot blend
// paid results into organic ones without deliberately stripping fields. The
// route never returns organic restaurants itself -- merging is the caller's
// step (see mergeSponsoredFirst() in src/lib/sponsored.ts), which keeps the
// paid and organic sources separately auditable.
//
// Returns 200 with an empty list on any internal failure, including the
// migration not being applied yet: monetization must never be able to break
// the restaurant results the user actually came for.
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
import { fetchSponsoredPlacements } from "@/lib/sponsored";

export const prerender = false;

// No paid upstream here -- one indexed Postgres read -- so the limit matches
// /api/delivery-links' looser bucket rather than the Gemini routes'.
const RATE_LIMIT_PER_WINDOW = 25;
const MAX_CUISINE = 120;
const MAX_COUNTRY_CODE = 2;

export const POST: APIRoute = async ({ request, cookies }) => {
  const limit = rateLimit(request, "sponsored-restaurants", RATE_LIMIT_PER_WINDOW);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return errorResponse(err instanceof BadRequest ? err.message : "Invalid JSON body", 400);
  }

  const cuisine = cleanText(body.cuisine, MAX_CUISINE);
  if (!cuisine) {
    return errorResponse("cuisine (string) is required -- it is the cuisine the room already matched on", 400);
  }

  // Coordinates are optional (a placement may be untargeted), but if present
  // they must be real. finiteNumber() rejects NaN/Infinity/strings, which is
  // the check that stopped `latitude: 999` reaching a live upstream in the
  // security pass.
  const latitude = finiteNumber(body.latitude, -90, 90);
  const longitude = finiteNumber(body.longitude, -180, 180);

  const rawCountry = cleanText(body.countryCode, MAX_COUNTRY_CODE);
  const countryCode = rawCountry && /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : null;

  const requestedLimit = finiteNumber(body.limit, 1, 10);

  const supabase = createSupabaseServerClient(request, cookies);

  const sponsored = await fetchSponsoredPlacements(supabase, {
    matchedCuisineId: cuisine,
    latitude,
    longitude,
    countryCode,
    limit: requestedLimit ?? undefined,
  });

  return json({ sponsored });
};
