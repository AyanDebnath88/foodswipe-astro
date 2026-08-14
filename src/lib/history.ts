// Phase 4 — session history and async-room catch-up state.
//
// NO NEW TABLE BACKS ANY OF THIS, deliberately. Everything a user's history
// needs is already recorded by the tables the swipe flow writes as it runs:
//
//   which rooms was I in      room_participants (user_id = me), joined_at
//   what happened in them     swipe_sessions.status / matched_cuisine_id
//   which restaurant          dish_matches.restaurant_name
//   which dishes were agreed  dish_matches.dish_name, ordered by matched_at
//   how it went               session_feedback (0014, src/lib/feedback.ts)
//
// A `session_history` table would be a denormalised copy of all of that,
// trigger-maintained and wrong the first time a trigger was missed. The
// query wins on every axis here: the rows already exist, they are already
// RLS-correct for exactly the audience allowed to see them, and they cannot
// drift from themselves. See block C of 0014 for the same argument in SQL.
//
// The async-room panel (fetchRoomProgress) is derived for the same reason —
// "has Ben swiped yet" is `exists a swipes row for (room, Ben)`, and
// "when was he last active" is max(created_at) over those rows. Block D of
// 0014 records why a `last_seen_at` column on room_participants was
// considered and rejected.
//
// ONE HONEST LIMITATION (also in 0014 block C and the build log): history
// hangs off the room_participants row, and leaveRoom() hard-DELETEs that row
// — it has to, because both match triggers count participant rows as the
// unanimity denominator and a ghost member deadlocks a room forever. So
// leaving a room also erases it from your history. The fix is a soft leave
// (`left_at`), which changes both match triggers, and is out of scope here.
import { createSupabaseBrowserClient } from "./supabase/client";
import { fetchFeedbackForSessions, type SessionFeedback } from "./feedback";

export interface AgreedDish {
  restaurantName: string;
  dishName: string;
  matchedAt: string;
}

export interface SessionHistoryEntry {
  id: string;
  code: string;
  /**
   * Raw status text, not the app's narrowed RoomStatus union. An old room
   * may still carry the retired 'dish_matched' value (0012 deliberately did
   * not narrow the check constraint on a live database), and history is
   * exactly the surface that reads old rooms.
   */
  status: string;
  matchedCuisineId: string | null;
  createdAt: string;
  joinedAt: string;
  /** Members RIGHT NOW — not who was there on the night. See leaveRoom above. */
  participantCount: number;
  agreedDishes: AgreedDish[];
  /** Distinct restaurants the group agreed a dish at, in first-agreed order. */
  restaurants: string[];
  myFeedback: SessionFeedback | null;
  feedbackCount: number;
  /**
   * True while this room is still plausibly a live plan rather than a
   * memory. Rooms have no lifecycle end in this schema (nothing ever closes
   * or expires one — see the build log's "no TTL/cleanup sweep" note), so
   * this is a time window, not a stored flag.
   */
  isOpen: boolean;
}

/**
 * How long a room counts as "still happening".
 *
 * 24 hours, chosen to match the thing async rooms exist for: "let's sort out
 * dinner during the day" spans a working day, not a week. A room from today
 * is a plan you can still join in on; a room from last Tuesday is a memory
 * you might rate. Arbitrary but deliberate, and the only consequence of
 * getting it wrong is which of two lists a card appears in.
 */
export const OPEN_ROOM_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface MemberProgress {
  userId: string;
  displayName: string;
  isGuest: boolean;
  /** Cuisine cards this member has swiped in this room (either direction). */
  cuisineSwipes: number;
  /** Dish cards this member has swiped in this room (either direction). */
  dishSwipes: number;
  hasStarted: boolean;
  /** Most recent swipe of either kind, or null if they've never swiped here. */
  lastActiveAt: string | null;
  joinedAt: string | null;
}

export interface RoomProgress {
  sessionId: string;
  members: MemberProgress[];
  /** Members with at least one swipe of any kind. */
  startedCount: number;
  waitingOnNames: string[];
}

/**
 * Every session this user took part in, newest first.
 *
 * Five queries, not N+1: one for my membership rows, then one batched read
 * each for the sessions, the rosters, the agreed dishes and the feedback.
 * A history page must not cost a round trip per room.
 */
export async function fetchMyHistory(userId: string): Promise<SessionHistoryEntry[]> {
  const supabase = createSupabaseBrowserClient();

  // 1. My rooms. room_participants' SELECT policy is is_room_participant(),
  //    so this returns my rows and nobody else's without any new policy.
  const { data: myRows, error: myErr } = await supabase
    .from("room_participants")
    .select("room_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });
  if (myErr || !myRows || myRows.length === 0) return [];

  const joinedAtByRoom = new Map<string, string>();
  for (const row of myRows as Record<string, unknown>[]) {
    joinedAtByRoom.set(row.room_id as string, row.joined_at as string);
  }
  const roomIds = [...joinedAtByRoom.keys()];

  // 2. The sessions themselves.
  const { data: sessions, error: sessionsErr } = await supabase
    .from("swipe_sessions")
    .select("id, code, status, matched_cuisine_id, created_at")
    .in("id", roomIds);
  if (sessionsErr || !sessions) return [];

  // 3. Rosters (current membership count per room).
  const { data: rosterRows } = await supabase
    .from("room_participants")
    .select("room_id, user_id")
    .in("room_id", roomIds);
  const memberCount = new Map<string, number>();
  for (const row of (rosterRows ?? []) as Record<string, unknown>[]) {
    const id = row.room_id as string;
    memberCount.set(id, (memberCount.get(id) ?? 0) + 1);
  }

  // 4. What the group agreed on. Ordered by matched_at so a card lists the
  //    order the way the table actually decided it.
  const { data: matchRows } = await supabase
    .from("dish_matches")
    .select("session_id, restaurant_name, dish_name, matched_at")
    .in("session_id", roomIds)
    .order("matched_at", { ascending: true });
  const dishesBySession = new Map<string, AgreedDish[]>();
  for (const row of (matchRows ?? []) as Record<string, unknown>[]) {
    const sessionId = row.session_id as string;
    const dish: AgreedDish = {
      restaurantName: row.restaurant_name as string,
      dishName: row.dish_name as string,
      matchedAt: row.matched_at as string,
    };
    const list = dishesBySession.get(sessionId);
    if (list) list.push(dish);
    else dishesBySession.set(sessionId, [dish]);
  }

  // 5. Feedback (returns an empty map if 0014 isn't applied yet — the whole
  //    history page still renders, it just can't offer the prompt's state).
  const feedbackBySession = await fetchFeedbackForSessions(roomIds);

  const now = Date.now();
  const entries: SessionHistoryEntry[] = (sessions as Record<string, unknown>[]).map((row) => {
    const id = row.id as string;
    const agreedDishes = dishesBySession.get(id) ?? [];
    const feedback = feedbackBySession.get(id) ?? [];
    const createdAt = row.created_at as string;

    const restaurants: string[] = [];
    for (const dish of agreedDishes) {
      if (!restaurants.includes(dish.restaurantName)) restaurants.push(dish.restaurantName);
    }

    return {
      id,
      code: row.code as string,
      status: row.status as string,
      matchedCuisineId: (row.matched_cuisine_id as string | null) ?? null,
      createdAt,
      joinedAt: joinedAtByRoom.get(id) ?? createdAt,
      participantCount: memberCount.get(id) ?? 1,
      agreedDishes,
      restaurants,
      myFeedback: feedback.find((f) => f.userId === userId) ?? null,
      feedbackCount: feedback.length,
      isOpen: now - new Date(createdAt).getTime() < OPEN_ROOM_WINDOW_MS,
    };
  });

  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return entries;
}

/**
 * Who in this room has swiped and who hasn't — the async-room question.
 *
 * COUNTS ONLY, never directions, even though "swipes: select if participant
 * of session" (0001) would happily return them. Showing "Ben liked Italian"
 * before the group has matched turns an independent vote into a bandwagon
 * and quietly breaks the unanimity model the whole app rests on. The read is
 * allowed; the render is not. (Same restraint is written into 0014 block D
 * so nobody "improves" this later.)
 *
 * Degrades to an empty roster rather than throwing: the async panel is
 * supplementary and must never take a room page down with it.
 */
export async function fetchRoomProgress(sessionId: string): Promise<RoomProgress> {
  const supabase = createSupabaseBrowserClient();
  const empty: RoomProgress = { sessionId, members: [], startedCount: 0, waitingOnNames: [] };

  // get_room_profiles() is the sanctioned way to read co-participants — a
  // raw SELECT policy on profiles would expose `phone` (0001's header
  // explains at length). Non-participants get zero rows, not an error.
  const { data: profileRows, error: profileErr } = await supabase.rpc("get_room_profiles", {
    p_room_id: sessionId,
  });
  if (profileErr || !profileRows) return empty;

  const [{ data: joinRows }, { data: swipeRows }, { data: dishSwipeRows }] = await Promise.all([
    supabase.from("room_participants").select("user_id, joined_at").eq("room_id", sessionId),
    supabase.from("swipes").select("user_id, created_at").eq("session_id", sessionId),
    supabase.from("dish_swipes").select("user_id, created_at").eq("session_id", sessionId),
  ]);

  const joinedAt = new Map<string, string>();
  for (const row of (joinRows ?? []) as Record<string, unknown>[]) {
    joinedAt.set(row.user_id as string, row.joined_at as string);
  }

  const cuisineCount = new Map<string, number>();
  const dishCount = new Map<string, number>();
  const lastActive = new Map<string, string>();

  const tally = (rows: Record<string, unknown>[], counter: Map<string, number>) => {
    for (const row of rows) {
      const uid = row.user_id as string;
      const at = row.created_at as string;
      counter.set(uid, (counter.get(uid) ?? 0) + 1);
      const previous = lastActive.get(uid);
      if (!previous || new Date(at).getTime() > new Date(previous).getTime()) {
        lastActive.set(uid, at);
      }
    }
  };
  tally((swipeRows ?? []) as Record<string, unknown>[], cuisineCount);
  tally((dishSwipeRows ?? []) as Record<string, unknown>[], dishCount);

  const members: MemberProgress[] = (profileRows as Record<string, unknown>[]).map((row) => {
    const userId = row.id as string;
    const cuisineSwipes = cuisineCount.get(userId) ?? 0;
    const dishSwipes = dishCount.get(userId) ?? 0;
    return {
      userId,
      displayName: (row.display_name as string) ?? "Guest",
      isGuest: Boolean(row.is_guest),
      cuisineSwipes,
      dishSwipes,
      hasStarted: cuisineSwipes + dishSwipes > 0,
      lastActiveAt: lastActive.get(userId) ?? null,
      joinedAt: joinedAt.get(userId) ?? null,
    };
  });

  // Stable, useful order: people the room is waiting on first.
  members.sort((a, b) => {
    if (a.hasStarted !== b.hasStarted) return a.hasStarted ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    sessionId,
    members,
    startedCount: members.filter((m) => m.hasStarted).length,
    waitingOnNames: members.filter((m) => !m.hasStarted).map((m) => m.displayName),
  };
}

/**
 * "2 hours ago" / "3 days ago". Small enough not to justify a date library,
 * and the project has none.
 */
export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}
