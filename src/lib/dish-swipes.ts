// Dish-level swipe reads/writes (Phase 2, Task 7 -- the P0 dish-level room
// sync fix). Same shape as src/lib/swipes.ts, one level down: scoped to
// (session_id, restaurant_name) instead of just session_id, since a room
// can browse dishes at more than one candidate restaurant. Match detection
// lives entirely in the check_dish_swipe_match() trigger
// (supabase/migrations/0007_dish_swipes.sql) -- this module only reads and
// writes rows.
import { createSupabaseBrowserClient } from "./supabase/client";

export type SwipeDirection = "left" | "right";

export interface DishSwipeRow {
  userId: string;
  dishName: string;
  direction: SwipeDirection;
}

export async function fetchDishSwipes(
  sessionId: string,
  restaurantName: string
): Promise<DishSwipeRow[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("dish_swipes")
    .select("user_id, dish_name, direction")
    .eq("session_id", sessionId)
    .eq("restaurant_name", restaurantName);
  if (error || !data) return [];
  return data.map((row) => ({
    userId: row.user_id as string,
    dishName: row.dish_name as string,
    direction: row.direction as SwipeDirection,
  }));
}

export async function submitDishSwipe(
  sessionId: string,
  userId: string,
  restaurantName: string,
  dishName: string,
  direction: SwipeDirection
): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from("dish_swipes")
    .upsert(
      { session_id: sessionId, user_id: userId, restaurant_name: restaurantName, dish_name: dishName, direction },
      { onConflict: "session_id,user_id,restaurant_name,dish_name" }
    );
  if (error) throw error;
}
