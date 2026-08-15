// Second-layer swipe reads/writes, for cuisines with enough real internal
// breadth to deserve a narrowing step after the top-level cuisine match --
// today that's just Indian (see supabase/migrations/0017_indian_subcuisines.sql
// for why: real Zomato/Swiggy category taxonomy, not an invented split).
// Mirrors src/lib/cuisines.ts + src/lib/swipes.ts exactly, one level down.
// Match detection is NOT done here -- check_subcuisine_match() in 0017 is
// the only thing that ever sets swipe_sessions.matched_subcuisine_id; the UI
// just reacts to that via Realtime (src/lib/rooms.ts's subscribeToRoom).
import { createSupabaseBrowserClient } from "./supabase/client";

export interface Subcuisine {
  id: string;
  cuisineId: string;
  name: string;
  dishes: string[];
}

export async function fetchSubcuisines(cuisineId: string): Promise<Subcuisine[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("cuisine_subcategories")
    .select("id, cuisine_id, name, dishes")
    .eq("cuisine_id", cuisineId)
    .order("name", { ascending: true });

  if (error || !data) {
    console.error("Failed to fetch subcuisines:", error);
    return [];
  }

  return data.map((row) => ({
    id: row.id as string,
    cuisineId: row.cuisine_id as string,
    name: row.name as string,
    dishes: (row.dishes as string[] | null) ?? [],
  }));
}

export type SubcuisineSwipeDirection = "left" | "right";

export interface SubcuisineSwipeRow {
  userId: string;
  subcuisineId: string;
  direction: SubcuisineSwipeDirection;
}

export async function fetchSubcuisineSwipesForSession(sessionId: string): Promise<SubcuisineSwipeRow[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("subcuisine_swipes")
    .select("user_id, subcuisine_id, direction")
    .eq("session_id", sessionId);
  if (error || !data) return [];
  return data.map((row) => ({
    userId: row.user_id as string,
    subcuisineId: row.subcuisine_id as string,
    direction: row.direction as SubcuisineSwipeDirection,
  }));
}

export async function submitSubcuisineSwipe(
  sessionId: string,
  userId: string,
  subcuisineId: string,
  direction: SubcuisineSwipeDirection
): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from("subcuisine_swipes")
    .upsert(
      { session_id: sessionId, user_id: userId, subcuisine_id: subcuisineId, direction },
      { onConflict: "session_id,user_id,subcuisine_id" }
    );
  if (error) throw error;
}

// Placeholder art, same reasoning as CUISINE_EMOJI in src/lib/cuisines.ts --
// real photography lands in Phase C of the design pass alongside the rest
// of the cards, not before. Keys match cuisine_subcategories.id in 0017.
export const SUBCUISINE_EMOJI: Record<string, string> = {
  "indian-north": "🧈",
  "indian-south": "🥞",
  "indian-mughlai": "👑",
  "indian-biryani": "🍚",
  "indian-bengali": "🐟",
  "indian-gujarati": "🌿",
  "indian-rajasthani": "🐪",
  "indian-street-food": "🥟",
  "indian-tandoor": "🍢",
  "indian-hyderabadi": "🍲",
};
