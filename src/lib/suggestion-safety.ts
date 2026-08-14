// The dietary safety gate for AI cuisine suggestions.
//
// WHY THIS IS ITS OWN FILE, and not just a function inside cuisines.ts:
// this is the code that keeps product guarantee #2 ("a room must never surface
// a cuisine that conflicts with any participant's stated restrictions" -- see
// the build log). A guarantee that nothing tests is a guarantee that is one
// refactor away from being false, and a QA pass proved that exactly: the deck
// correctly narrowed a halal + gluten-free room to Indian only, and then
// "Get AI Suggestions" appended an unvetted "Chinese" card that the room
// matched on.
//
// cuisines.ts can't be imported by the test suite -- it pulls in
// supabase/client.ts and therefore a browser client and `import.meta.env`.
// So the gate lives here instead, with exactly ONE dependency (./dietary.ts,
// which is pure), which lets scripts/test-dietary-safety.mjs import and
// exercise the real shipped function under Node's type stripping rather than
// asserting against a re-implementation that could drift from it.
//
// The `.ts` extension on the import below is deliberate and load-bearing:
// Node's ESM resolver requires it, and it is what makes this module directly
// importable from a .mjs test. tsconfig.json sets `allowImportingTsExtensions`
// for this. Don't "tidy" it away.
import { filterCuisinesByDietary } from "./dietary.ts";

/**
 * The catalog shape this gate needs. `cuisines.ts` re-exports this as its
 * `Cuisine` type so there is one definition, not two that can drift.
 */
export interface Cuisine {
  id: string;
  name: string;
  dishes: string[];
  dietaryTags: string[];
}

/**
 * Builds a synthetic Cuisine for a name returned by the AI fallback
 * (POST /api/suggest-cuisines, see src/lib/ai-suggestions.ts) that isn't one
 * of the seeded catalog rows.
 *
 * DANGER: the result has `dietaryTags: []`, which can never satisfy
 * filterCuisinesByDietary() for a non-empty restriction set -- and for a long
 * time that was "worked around" by simply not filtering these cards at all,
 * which is how the unvetted "Chinese" card reached a halal room.
 *
 * Callers MUST NOT deal a synthetic card into a room that has any dietary
 * restrictions. Use resolveSuggestedCuisines() rather than calling this
 * directly -- it enforces that rule in one place.
 */
export function syntheticCuisineFromName(name: string): Cuisine {
  return {
    id: `ai-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`,
    name,
    dishes: [],
    dietaryTags: [],
  };
}

export interface SuggestionResolution {
  /** Cards that are safe to deal into the deck. */
  accepted: Cuisine[];
  /** Names dropped because the room has restrictions and they aren't vetted. */
  rejectedUnvetted: string[];
  /** Catalog cuisines dropped because they fail a participant's restriction. */
  rejectedDietary: string[];
}

/**
 * The single gate between "the AI said these names" and "these cards enter the
 * deck". Every AI suggestion path must go through it.
 *
 * The rule, stated plainly:
 *   * a suggestion that resolves to a catalog row must still pass the room's
 *     dietary filter, exactly like a normal deck card;
 *   * a suggestion that resolves to NOTHING has no dietary metadata, so in a
 *     room with any restrictions it is unvettable and is dropped. There is no
 *     honest way to show it: `dietaryTags: []` isn't "unknown, probably fine",
 *     it's "we cannot promise this is halal/gluten-free/nut-free", and the
 *     whole point of the feature is that the promise holds;
 *   * in a room with NO restrictions there is nothing to violate, so a novel
 *     name is still dealt as a synthetic card. That keeps the stalled-room
 *     rescue working for the common case (and keeps the `ai-<slug>` cuisine_id
 *     path alive, which the security suite asserts must stay supported).
 *
 * This is the SECOND of two independent gates. The first is server-side, in
 * /api/suggest-cuisines, which is told the room's vetted candidate names and
 * drops anything outside them. That one is a quality measure: the endpoint is
 * unauthenticated, it lives on the far side of a network call, and a model can
 * paraphrase or be talked around. This one is the boundary that actually has
 * to hold, because it runs in the same process as the deck it protects.
 *
 * Rejections are returned rather than silently swallowed so the UI can be
 * honest about *why* nothing new showed up. Silently adding nothing and
 * silently adding something unsafe look identical to a user; neither is
 * acceptable.
 */
export function resolveSuggestedCuisines(
  names: string[],
  catalog: Cuisine[],
  requiredRestrictions: string[],
  alreadyKnownIds: Set<string> = new Set()
): SuggestionResolution {
  const accepted: Cuisine[] = [];
  const rejectedUnvetted: string[] = [];
  const rejectedDietary: string[] = [];
  const seenIds = new Set(alreadyKnownIds);
  const restricted = requiredRestrictions.length > 0;

  for (const rawName of names) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) continue;
    const lower = name.toLowerCase();

    // Exact, case-insensitive resolution against the catalog only. A near-miss
    // is a miss on purpose: "Northern Indian" is not the row whose dietary_tags
    // were vetted, so treating it as that row would be inventing a promise.
    const catalogMatch = catalog.find(
      (c) => c.name.toLowerCase() === lower || c.id.toLowerCase() === lower
    );

    if (catalogMatch) {
      if (filterCuisinesByDietary([catalogMatch], requiredRestrictions).length === 0) {
        rejectedDietary.push(catalogMatch.name);
        continue;
      }
      if (seenIds.has(catalogMatch.id)) continue;
      seenIds.add(catalogMatch.id);
      accepted.push(catalogMatch);
      continue;
    }

    if (restricted) {
      rejectedUnvetted.push(name);
      continue;
    }

    const synthetic = syntheticCuisineFromName(name);
    if (!synthetic.id || synthetic.id === "ai-" || seenIds.has(synthetic.id)) continue;
    seenIds.add(synthetic.id);
    accepted.push(synthetic);
  }

  return { accepted, rejectedUnvetted, rejectedDietary };
}
