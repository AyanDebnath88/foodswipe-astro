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

// The Cuisine shape lives in ./suggestion-safety (no browser dependencies,
// so Node test scripts can import it directly). Re-exported here so every
// existing caller keeps importing it from "@/lib/cuisines" and there is
// still exactly one definition.
export type { Cuisine } from "./suggestion-safety";

import type { Cuisine } from "./suggestion-safety";

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
