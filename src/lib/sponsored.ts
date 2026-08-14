// Sponsored restaurant placement -- read path (Phase 5, channel 2 groundwork).
//
// =========================================================================
// GUARDRAIL -- the one rule this whole file exists to obey
// =========================================================================
// Sponsored placement may ONLY affect which RESTAURANTS surface AFTER a
// cuisine has already been matched. It must NEVER influence the cuisine
// swipe deck or the match algorithm.
//
// Food Swipe's promise to a group is "swipe to decide fairly". If money can
// tilt what the group appears to agree on, that promise is a lie and the app
// is manipulating a decision between friends. Showing a clearly-labelled
// paid restaurant to a group that has already decided it wants Thai is a
// normal ad. Making a group want Thai because someone paid is not.
//
// How this file enforces it, structurally:
//
//   * fetchSponsoredPlacements() REQUIRES an already-matched cuisine id as
//     input. There is no call shape that asks it "what should this room
//     see?" -- it can only answer "given that the room already chose X,
//     which restaurants are paid?".
//   * It returns restaurants. There is no code path in this module that
//     returns, ranks, scores or orders a cuisine, so it cannot be wired
//     into a deck even by accident.
//   * Nothing on the matching path imports it. src/components/swipe/**,
//     src/lib/cuisines.ts, src/lib/ai-suggestions.ts, src/lib/dietary.ts and
//     /api/suggest-cuisines must never reference sponsorship;
//     scripts/test-monetization.mjs asserts exactly that, permanently, so
//     the guardrail fails a test run rather than relying on memory.
//   * The database half of the same rule is documented in
//     supabase/migrations/0015_monetization.sql -- no reference of any kind
//     runs from the matching tables/triggers to sponsored_placements.
//
// Every result is flagged `isSponsored: true` and carries a label. Sponsored
// entries must be structurally distinguishable from organic ones at every
// layer -- never silently blended into an organic list, because a paid
// result the user cannot identify as paid is the actual harm here.
// =========================================================================
//
// Server-side only: called from src/pages/api/sponsored-restaurants.ts with
// a Supabase server client. No fabricated data of any kind -- there are no
// invented ratings, prices, distances or "popular with 200 people" strings.
// A field that is not in the row is simply absent.
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A paid restaurant placement, in the shape the UI renders.
 *
 * `isSponsored` is a literal `true` rather than a boolean so that TypeScript
 * itself keeps sponsored and organic results distinguishable: a
 * SponsoredRestaurant can never be silently assigned into an organic
 * restaurant type that lacks the flag.
 */
export interface SponsoredRestaurant {
  isSponsored: true;
  /** What the UI must show next to the entry. Not optional. */
  sponsorshipLabel: "Featured";
  placementId: string;
  name: string;
  address: string | null;
  website: string | null;
  /** Who paid for the placement, when recorded -- part of the disclosure. */
  advertiserName: string | null;
}

export interface SponsoredQuery {
  /**
   * The cuisine the room ALREADY matched on. Required. The whole guardrail
   * rests on this argument existing: this function is only answerable after
   * a match has happened.
   */
  matchedCuisineId: string;
  latitude?: number | null;
  longitude?: number | null;
  /** ISO-3166 alpha-2, when the caller knows it. See countryCode note below. */
  countryCode?: string | null;
  limit?: number;
}

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

interface PlacementRow {
  id: string;
  restaurant_name: string;
  restaurant_address: string | null;
  restaurant_website: string | null;
  cuisine_id: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_km: number | null;
  starts_at: string;
  priority: number;
  advertiser_name: string | null;
}

const COLUMNS =
  "id, restaurant_name, restaurant_address, restaurant_website, cuisine_id, country_code, latitude, longitude, radius_km, starts_at, priority, advertiser_name";

/** Great-circle distance in km. Used to honour a placement's radius. */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Is this placement allowed to serve at the caller's location?
 *
 * Both targeting dimensions fail CLOSED. A placement that targets a country
 * we can't confirm, or a radius around a point we don't have, is not served
 * -- an untargetable ad is skipped rather than shown everywhere. Serving a
 * local restaurant's paid placement to someone in another country is both
 * useless to the user and something the advertiser did not buy.
 */
function targetingMatches(row: PlacementRow, query: SponsoredQuery): boolean {
  if (row.country_code) {
    const caller = query.countryCode?.toUpperCase();
    if (!caller || caller !== row.country_code) return false;
  }

  if (row.latitude !== null && row.longitude !== null && row.radius_km !== null) {
    const { latitude, longitude } = query;
    if (typeof latitude !== "number" || typeof longitude !== "number") return false;
    if (distanceKm(latitude, longitude, row.latitude, row.longitude) > row.radius_km) return false;
  }

  return true;
}

function toSponsored(row: PlacementRow): SponsoredRestaurant {
  return {
    isSponsored: true,
    sponsorshipLabel: "Featured",
    placementId: row.id,
    name: row.restaurant_name,
    address: row.restaurant_address,
    website: row.restaurant_website,
    advertiserName: row.advertiser_name,
  };
}

/**
 * Live sponsored placements for an already-matched cuisine at a location.
 *
 * The "is it live right now" half (is_active + start/end window) is enforced
 * by the RLS policy in 0015, not by a WHERE clause here -- an expired
 * campaign is not merely filtered out of this query, it is invisible to the
 * caller's role entirely, so a future second reader cannot forget the check.
 *
 * Two queries instead of one `.or()` on purpose. PostgREST's `.or()` takes a
 * filter *expression* string, so interpolating a user-supplied cuisine id
 * into it is the exact injection this project already found and fixed once
 * in /api/restaurant-menu (a payload containing `,` and `.` stopped being a
 * value and became more query, returning the whole table). `.is()` and
 * `.eq()` pass their arguments as values.
 *
 * Never throws: a monetization read failing must not break the restaurant
 * results the user actually came for. Any error returns an empty list, which
 * is also what an unapplied migration looks like.
 */
export async function fetchSponsoredPlacements(
  supabase: SupabaseClient,
  query: SponsoredQuery
): Promise<SponsoredRestaurant[]> {
  const cuisineId = query.matchedCuisineId?.trim();
  if (!cuisineId) {
    // Refuse rather than fall back to "all placements". A caller with no
    // matched cuisine is, by definition, not past the match yet -- and this
    // function must never be answerable before the match.
    return [];
  }

  const limit = Math.min(Math.max(1, Math.trunc(query.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);

  try {
    const [targeted, universal] = await Promise.all([
      supabase.from("sponsored_placements").select(COLUMNS).eq("cuisine_id", cuisineId),
      supabase.from("sponsored_placements").select(COLUMNS).is("cuisine_id", null),
    ]);

    if (targeted.error && universal.error) return [];

    const rows = [
      ...((targeted.data ?? []) as unknown as PlacementRow[]),
      ...((universal.data ?? []) as unknown as PlacementRow[]),
    ];

    const seen = new Set<string>();
    const eligible = rows.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return targetingMatches(row, query);
    });

    // Ranking: priority first, then the campaign that has been waiting
    // longest, then id. The last tiebreak is what makes the order stable --
    // results that reshuffle between reloads look broken and make a paid
    // placement's position meaningless.
    eligible.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const at = Date.parse(a.starts_at);
      const bt = Date.parse(b.starts_at);
      if (at !== bt) return at - bt;
      return a.id.localeCompare(b.id);
    });

    return eligible.slice(0, limit).map(toSponsored);
  } catch {
    return [];
  }
}

/**
 * Merges sponsored placements into an already-computed organic list.
 *
 * Called by the UI AFTER matching and AFTER the organic restaurant search
 * has returned -- it takes the organic results as input and cannot influence
 * how they were produced. Sponsored entries go first (that is what the
 * placement buys) but keep their `isSponsored` flag and label, and any
 * organic duplicate of a sponsored restaurant is dropped so the same place
 * is not listed twice.
 *
 * Generic over the organic type so this module never has to import the
 * restaurant type from the match path -- the dependency runs one way only.
 */
export function mergeSponsoredFirst<T extends { name: string }>(
  sponsored: SponsoredRestaurant[],
  organic: T[]
): Array<SponsoredRestaurant | T> {
  const sponsoredNames = new Set(sponsored.map((s) => s.name.trim().toLowerCase()));
  const deduped = organic.filter((r) => !sponsoredNames.has(r.name.trim().toLowerCase()));
  return [...sponsored, ...deduped];
}
