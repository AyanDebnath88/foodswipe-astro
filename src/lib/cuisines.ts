// Cuisine catalog reads, ported from the reference Next.js project's
// src/lib/cuisines.ts -- but that file was a static in-memory array; here
// the catalog lives in Postgres (supabase/migrations/0002_seed_cuisines.sql
// + 0004_room_dietary_filter.sql) and is fetched at runtime, since
// dietary_tags (used by src/lib/dietary.ts) needs to reflect the seeded
// data, not a copy hand-maintained in two places.
//
// `description` from the reference project's Cuisine type is intentionally
// not part of the schema (see 0002_seed_cuisines.sql's header comment), so
// short flavor-text copy lives here as UI-only decoration, keyed by
// cuisine id, rather than being stored as data.
import { createSupabaseBrowserClient } from "./supabase/client";
import { filterCuisinesByDietary } from "./dietary";

export interface Cuisine {
  id: string;
  name: string;
  dishes: string[];
  dietaryTags: string[];
}

export const CUISINE_DESCRIPTIONS: Record<string, string> = {
  italian: "Comforting and diverse, from rich pastas and pizzas to fresh Mediterranean flavors.",
  mexican: "Vibrant and festive, featuring a spectrum of chilies, corn, and fresh herbs.",
  japanese: "Elegant and precise, emphasizing seasonality and the natural taste of ingredients.",
  indian: "Aromatic and complex, with a masterful use of spices in curries, tandoori, and biryanis.",
  thai: "A harmonious blend of sweet, sour, salty, and spicy.",
  greek: "Fresh, wholesome Mediterranean flavors of olive oil, lemon, and herbs.",
  french: "Elegant, rich, and refined, the cornerstone of Western cuisine.",
  vietnamese: "Light and fragrant with fresh herbs, fish sauce, and contrasting textures.",
  korean: "Bold, spicy, and savory flavors, famous for kimchi, BBQ, and bibimbap.",
};

// A handful of large food emoji stand in for photography. Cuisine imagery
// was explicitly deferred to Supabase Storage in a later phase (see
// 0002_seed_cuisines.sql's header comment) -- rather than reach for an
// external image host (another network dependency, another thing that can
// 404 mid-swipe) for a placeholder that's getting replaced anyway, this
// keeps the card visual self-contained.
export const CUISINE_EMOJI: Record<string, string> = {
  italian: "🍝",
  mexican: "🌮",
  japanese: "🍣",
  indian: "🍛",
  thai: "🍜",
  greek: "🥙",
  french: "🥐",
  vietnamese: "🍲",
  korean: "🍱",
};

export async function fetchCuisines(): Promise<Cuisine[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("cuisines")
    .select("id, name, dishes, dietary_tags")
    .order("name", { ascending: true });

  if (error || !data) {
    console.error("Failed to fetch cuisines:", error);
    return [];
  }

  return data.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    dishes: (row.dishes as string[] | null) ?? [],
    dietaryTags: (row.dietary_tags as string[] | null) ?? [],
  }));
}

/**
 * Builds a synthetic Cuisine for a name returned by the AI fallback
 * (POST /api/suggest-cuisines, see src/lib/ai-suggestions.ts) that isn't
 * one of the 9 seeded rows.
 *
 * DANGER: the result has `dietaryTags: []`, which means it can never satisfy
 * filterCuisinesByDietary() for a non-empty restriction set -- and for a long
 * time that was worked around by simply not filtering these cards at all.
 * That defeated product guarantee #2 outright (see the build log): a room with
 * a halal + gluten-free member correctly narrowed its deck to Indian only,
 * then "Get AI Suggestions" appended an unvetted "Chinese" card and the room
 * matched on it. The stalled-room case is exactly when people press that
 * button, so the guarantee failed precisely when it mattered.
 *
 * Callers MUST NOT deal a synthetic card to a room that has any dietary
 * restrictions. Use resolveSuggestedCuisines() below rather than calling this
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
 *     whole point of the feature is that the promise holds.
 *   * in a room with NO restrictions there is nothing to violate, so a novel
 *     name is still dealt as a synthetic card. That keeps the stalled-room
 *     rescue working for the common case (and keeps the `ai-<slug>` cuisine_id
 *     path alive, which the security suite asserts must stay supported).
 *
 * Rejections are returned rather than silently swallowed so the UI can be
 * honest about *why* nothing new showed up.
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
    const name = rawName.trim();
    if (!name) continue;
    const lower = name.toLowerCase();

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
