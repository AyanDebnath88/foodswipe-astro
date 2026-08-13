// Cuisine-level swipe reads/writes. Match detection itself is NOT done
// here (Task 4) -- these are dumb inserts; the check_swipe_match() trigger
// in supabase/migrations/0006_match_detection.sql is the only thing that
// ever decides a match, and the UI just reacts to swipe_sessions changing
// via Realtime (see src/lib/rooms.ts's subscribeToRoom).
import { createSupabaseBrowserClient } from "./supabase/client";

export type SwipeDirection = "left" | "right";

export interface SwipeRow {
  userId: string;
  cuisineId: string;
  direction: SwipeDirection;
}

export async function fetchSwipesForSession(sessionId: string): Promise<SwipeRow[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("swipes")
    .select("user_id, cuisine_id, direction")
    .eq("session_id", sessionId);
  if (error || !data) return [];
  return data.map((row) => ({
    userId: row.user_id as string,
    cuisineId: row.cuisine_id as string,
    direction: row.direction as SwipeDirection,
  }));
}

/**
 * Upsert rather than insert: re-swiping the same cuisine (e.g. after an AI
 * fallback re-adds a card the user previously left-swiped) updates the
 * existing row in place, per the unique (session_id, user_id, cuisine_id)
 * constraint and the "swipes: update own swipe as participant" RLS policy
 * from 0001_init.sql.
 */
export async function submitSwipe(
  sessionId: string,
  userId: string,
  cuisineId: string,
  direction: SwipeDirection
): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from("swipes")
    .upsert(
      { session_id: sessionId, user_id: userId, cuisine_id: cuisineId, direction },
      { onConflict: "session_id,user_id,cuisine_id" }
    );
  if (error) throw error;
}
