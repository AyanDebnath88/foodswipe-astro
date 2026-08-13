// Agreed-dish reads (supabase/migrations/0012_dish_matches.sql).
//
// A `dish_matches` row is the server's verdict that every current member of
// the room right-swiped the same dish. Clients only ever READ this table --
// there is no INSERT policy on it, by design, because the only trustworthy
// writer is the SECURITY DEFINER check_dish_swipe_match() trigger (a
// client-writable "we all agreed" table would be trivially forgeable by one
// dishonest participant).
//
// This replaces the old scalar swipe_sessions.matched_dish_name, which could
// only ever hold ONE dish and ended the session when it was set. Groups order
// several dishes, so the agreed set is a growing list, not a single value.
import { createSupabaseBrowserClient } from "./supabase/client";

export interface DishMatch {
  id: string;
  restaurantName: string;
  dishName: string;
  matchedAt: string;
}

function mapRow(row: Record<string, unknown>): DishMatch {
  return {
    id: row.id as string,
    restaurantName: row.restaurant_name as string,
    dishName: row.dish_name as string,
    matchedAt: row.matched_at as string,
  };
}

/**
 * Every dish this room has agreed on, oldest first (the order the table
 * decided them in, which is the order the UI lists them in).
 *
 * `restaurantName` is optional: omit it for the whole-session summary (the
 * group may have browsed more than one restaurant), pass it to scope the
 * list to the deck currently on screen.
 */
export async function fetchDishMatches(
  sessionId: string,
  restaurantName?: string
): Promise<DishMatch[]> {
  const supabase = createSupabaseBrowserClient();
  let query = supabase
    .from("dish_matches")
    .select("id, restaurant_name, dish_name, matched_at")
    .eq("session_id", sessionId);
  if (restaurantName !== undefined) query = query.eq("restaurant_name", restaurantName);

  const { data, error } = await query.order("matched_at", { ascending: true });
  // A missing table (migration 0012 not applied yet) or an RLS rejection
  // must not blank out the swipe deck -- the deck is still usable, the group
  // just won't see agreed dishes appear. Same "never let a read failure
  // block the UI" rule the AI fallback follows.
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapRow);
}
