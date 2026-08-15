// Phase 2, Task 1 (room create/join) + Task 3 (Realtime sync).
//
// Talks directly to swipe_sessions/room_participants via the Supabase
// client, RLS-guarded -- no separate API route, per the "lightweight"
// direction of this rewrite (see .claude/skills/build-log/SKILL.md). This
// replaces the reference project's src/app/actions/rooms.ts server actions.
import { createSupabaseBrowserClient } from "./supabase/client";

/**
 * 'dish_matched' is deliberately absent.
 *
 * It used to be a terminal status set by check_dish_swipe_match() the moment
 * one dish reached unanimity, which ended the session after a single dish --
 * wrong product model, since a table orders several dishes together. As of
 * supabase/migrations/0012_dish_matches.sql a dish match appends a row to
 * `dish_matches` and leaves the room's status untouched, so the group keeps
 * swiping. The column value still exists in the database (dropping it from
 * the check constraint on a live project is riskier than ignoring it) and an
 * old room may still carry it; nothing in the app branches on it any more.
 */
export type RoomStatus = "waiting" | "swiping" | "matched";

export interface RoomState {
  id: string;
  code: string;
  creatorId: string | null;
  status: RoomStatus;
  matchedCuisineId: string | null;
  /**
   * Set only for rooms that matched on a cuisine with a refine layer (today:
   * 'indian' -- see supabase/migrations/0017_indian_subcuisines.sql) AND have
   * gone through it. Null for every other room, forever. check_subcuisine_
   * match() is the only thing that ever sets it; this is a read reflecting
   * that server verdict, same relationship matchedCuisineId has to
   * check_swipe_match().
   */
  matchedSubcuisineId: string | null;
}

export interface Participant {
  id: string;
  displayName: string;
  dietaryRestrictions: string[];
  isGuest: boolean;
}

const STORAGE_KEY = "foodswipe_active_room";

// ---------------------------------------------------------------------------
// localStorage convenience cache (Task 1's "waiting-room" resume UX, mirrors
// the reference app's `food_swipe_active_room` key). This is a cache only --
// every page that reads it re-verifies against the database (RLS protects
// against a stale/forged entry pointing at a room the user isn't actually
// in), it's never trusted as the source of truth.
// ---------------------------------------------------------------------------
export function saveActiveRoom(room: { id: string; code: string }) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(room));
}

export function loadActiveRoom(): { id: string; code: string } | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.id === "string" && typeof parsed?.code === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function clearActiveRoom() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Clears the cache ONLY if it currently points at `roomId`. Returns whether
 * it did.
 *
 * There is exactly one `foodswipe_active_room` key for the whole app, so the
 * unconditional clearActiveRoom() above is a blunt instrument: it wipes
 * whatever room is cached, regardless of which room the caller was acting on.
 * A QA pass turned that into real data loss -- with room ZJHM cached, visiting
 * /match/italian?room=ZZZZ and pressing "Leave" destroyed the ZJHM record
 * while leaving the user a participant of ZJHM server-side. There is no "my
 * rooms" list to recover from, so the room was simply gone for that user while
 * they kept counting toward its unanimity denominator.
 *
 * Every leave/close path uses this instead. clearActiveRoom() is reserved for
 * cases where the identity of the cached room is genuinely what's being
 * discarded (e.g. the cached room no longer resolves at all).
 */
export function clearActiveRoomIfMatches(roomId: string): boolean {
  const stored = loadActiveRoom();
  if (!stored || stored.id !== roomId) return false;
  clearActiveRoom();
  return true;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------
function mapRoomRow(row: Record<string, unknown>): RoomState {
  return {
    id: row.id as string,
    code: row.code as string,
    creatorId: (row.creator_id as string | null) ?? null,
    status: row.status as RoomStatus,
    matchedCuisineId: (row.matched_cuisine_id as string | null) ?? null,
    matchedSubcuisineId: (row.matched_subcuisine_id as string | null) ?? null,
  };
}

// matched_restaurant_name / matched_dish_name are intentionally NOT selected
// any more -- see the RoomStatus comment above. The agreed-dish list comes
// from the dish_matches table (src/lib/dish-matches.ts).
const ROOM_COLUMNS = "id, code, creator_id, status, matched_cuisine_id, matched_subcuisine_id";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
/**
 * Creates a room via the create_room() RPC
 * (supabase/migrations/0010_fix_create_room_codegen.sql).
 *
 * This used to be two separate client inserts -- swipe_sessions, then
 * room_participants -- with a client-generated uuid to dodge an RLS
 * read-back problem. scripts/test-e2e.mjs proved that leaks orphans against
 * the real database: if the second insert failed, the room row survived but
 * its creator could no longer SELECT it (the "select if participant" policy
 * needs the participant row that never got written), so the 4-letter code
 * was permanently consumed by a room nobody could see, join, or clean up.
 *
 * A PL/pgSQL function body is one transaction, so the RPC writes both rows
 * or neither. It also allocates the code server-side, where the uniqueness
 * check and the insert can't race another client, and returns the finished
 * row directly -- which sidesteps the original RLS read-back problem without
 * needing a client-generated id at all.
 */
export async function createRoom(_userId: string): Promise<RoomState> {
  const supabase = createSupabaseBrowserClient();

  const { data, error } = await supabase.rpc("create_room").single();
  if (error) throw error;
  if (!data) throw new Error("create_room() returned no row.");

  return mapRoomRow(data as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------
/**
 * Joins a room by its 4-letter code via the join_room_by_code() RPC
 * (supabase/migrations/0005_room_join_rpc.sql) rather than a direct
 * `.select()` on swipe_sessions -- see that migration's header comment for
 * why a direct select can't work for a not-yet-a-participant joiner.
 */
export async function joinRoomByCode(code: string): Promise<RoomState> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("join_room_by_code", { p_code: code.trim().toUpperCase() })
    .single();
  if (error) {
    // As of 0013_harden_rls_and_validation.sql the RPC reports "no such
    // room" by returning zero rows instead of raising: it has to commit the
    // failed-attempt row that the guess throttle counts, and a raised
    // exception would roll that write back (see that migration's block G).
    // PGRST116 is PostgREST's "0 rows where exactly 1 was requested", which
    // .single() produces from an empty result -- map it back to the message
    // this function has always thrown so nothing changes for the user.
    if (error.code === "PGRST116") throw new Error("Room not found.");
    throw error;
  }
  if (!data) throw new Error("Room not found.");
  return mapRoomRow(data as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
export async function fetchRoomById(roomId: string): Promise<RoomState | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("swipe_sessions")
    .select(ROOM_COLUMNS)
    .eq("id", roomId)
    .maybeSingle();
  if (error || !data) return null;
  return mapRoomRow(data as Record<string, unknown>);
}

/**
 * Looks a room up by its 4-letter code. This works for any caller who is
 * already a participant (RLS evaluates is_room_participant(id) per-row, not
 * per-query -- it doesn't care *how* the row was found), which covers every
 * page in this app that links via `?room=CODE` (the user always joined or
 * created the room first). It intentionally does NOT work for a stranger
 * who isn't a participant yet -- that's what join_room_by_code() is for.
 */
export async function fetchRoomByCode(code: string): Promise<RoomState | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("swipe_sessions")
    .select(ROOM_COLUMNS)
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  if (error || !data) return null;
  return mapRoomRow(data as Record<string, unknown>);
}

export async function fetchRoomParticipants(roomId: string): Promise<Participant[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_room_profiles", { p_room_id: roomId });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    displayName: row.display_name as string,
    dietaryRestrictions: (row.dietary_restrictions as string[] | null) ?? [],
    isGuest: Boolean(row.is_guest),
  }));
}

/**
 * Really leaves a room: deletes this user's `room_participants` row via the
 * "room_participants: leave own row" DELETE policy added in
 * 0009_fix_join_match_realtime.sql, and only then clears the local cache.
 *
 * This used to be a localStorage-only clear (as the reference app's
 * handleLeaveRoom() was), which left a GHOST PARTICIPANT behind: both match
 * triggers count `room_participants` rows as the unanimity denominator, so
 * someone who "left" still had to vote for the room to ever match again.
 * One person closing the tab could permanently deadlock a room.
 *
 * The order matters. The local cache is cleared only after the server-side
 * delete succeeds -- clearing first and then failing would hide the room
 * from the user's own UI while leaving them counted in the denominator,
 * which is precisely the un-fixable state this replaces. On failure the
 * caller gets the error and the user is still (correctly) in the room.
 *
 * A delete that removes 0 rows is not an error: it means the row was already
 * gone (double-click, or a second tab that already left).
 *
 * The cache clear is scoped to THIS room (clearActiveRoomIfMatches), not a
 * blanket clearActiveRoom(). Leaving room X must never evict room Y from the
 * one global cache key -- see that function's comment for the data loss the
 * blanket version caused.
 */
export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from("room_participants")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (error) throw error;
  clearActiveRoomIfMatches(roomId);
}

/**
 * Is this user actually a participant of this room right now?
 *
 * RLS makes this readable without a dedicated RPC: `room_participants` is
 * SELECT-able for rooms you belong to, so asking for your own row either
 * returns it or returns nothing. Used by the header to decide whether to offer
 * "Leave room" at all -- offering it on a room you aren't in is what let a
 * mistyped/stale `?room=` code destroy the record of a different room.
 */
export async function isRoomParticipant(roomId: string, userId: string): Promise<boolean> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("room_participants")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return data !== null;
}

// ---------------------------------------------------------------------------
// Realtime (Task 3)
// ---------------------------------------------------------------------------
export interface RoomRealtimeHandlers {
  onSessionChange?: (room: RoomState) => void;
  /**
   * The room itself was deleted (its creator closed it, or it was cleaned up).
   *
   * This used to be undeliverable. The swipe_sessions handler guarded on
   * `payload.new && "id" in payload.new`, and for a DELETE `payload.new` is
   * `{}` -- so the guard was false for exactly the one event that matters most
   * and every client kept rendering a room that no longer existed. Meanwhile
   * the dish_matches cascade fired, so the "agreed so far" list silently
   * emptied itself and nothing said why.
   *
   * Verified against the live project before relying on it: a participant's
   * channel really does receive the DELETE (payload.old carries `{ id }`),
   * even though their own room_participants row cascades away in the same
   * statement -- so this needs no polling fallback.
   */
  onSessionDeleted?: () => void;
  onParticipantsChange?: () => void;
  onSwipeChange?: () => void;
  /**
   * Live vote progress on the Indian refine layer (0017). The match result
   * itself (matched_subcuisine_id) arrives through onSessionChange like any
   * other swipe_sessions column -- this is only for "X of Y voted" style UI
   * while that vote is still in progress.
   */
  onSubcuisineSwipeChange?: () => void;
  onDishSwipeChange?: () => void;
  /**
   * A new dish just reached unanimity (an INSERT into dish_matches by the
   * check_dish_swipe_match() trigger). This is how every member's
   * agreed-dishes list grows live while the group keeps swiping -- it
   * replaces the old single `status = 'dish_matched'` session update.
   */
  onDishMatch?: () => void;
}

/**
 * One Realtime channel per room, replacing the reference app's 2-second
 * `setInterval` polls (rooms/page.tsx and swipe-area.tsx both had one).
 * Subscribes to the three/four tables the room UI cares about, scoped to
 * this room via Postgres changes filters so a busy room elsewhere doesn't
 * generate noise here. Returns an unsubscribe function for the caller's
 * `useEffect` cleanup.
 */
export function subscribeToRoom(roomId: string, handlers: RoomRealtimeHandlers): () => void {
  const supabase = createSupabaseBrowserClient();
  const channel = supabase
    .channel(`room:${roomId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "swipe_sessions", filter: `id=eq.${roomId}` },
      (payload) => {
        // DELETE first: its payload.new is {}, so the "id" in payload.new
        // test below is false for it and deletions were previously dropped
        // on the floor (see onSessionDeleted's comment).
        if (payload.eventType === "DELETE") {
          handlers.onSessionDeleted?.();
          return;
        }
        if (payload.new && "id" in payload.new) {
          handlers.onSessionChange?.(mapRoomRow(payload.new as Record<string, unknown>));
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "room_participants", filter: `room_id=eq.${roomId}` },
      () => handlers.onParticipantsChange?.()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "swipes", filter: `session_id=eq.${roomId}` },
      () => handlers.onSwipeChange?.()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "subcuisine_swipes", filter: `session_id=eq.${roomId}` },
      () => handlers.onSubcuisineSwipeChange?.()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "dish_swipes", filter: `session_id=eq.${roomId}` },
      () => handlers.onDishSwipeChange?.()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "dish_matches", filter: `session_id=eq.${roomId}` },
      () => handlers.onDishMatch?.()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
