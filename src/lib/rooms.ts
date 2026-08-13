// Phase 2, Task 1 (room create/join) + Task 3 (Realtime sync).
//
// Talks directly to swipe_sessions/room_participants via the Supabase
// client, RLS-guarded -- no separate API route, per the "lightweight"
// direction of this rewrite (see .claude/skills/build-log/SKILL.md). This
// replaces the reference project's src/app/actions/rooms.ts server actions.
import { createSupabaseBrowserClient } from "./supabase/client";

export type RoomStatus = "waiting" | "swiping" | "matched" | "dish_matched";

export interface RoomState {
  id: string;
  code: string;
  creatorId: string | null;
  status: RoomStatus;
  matchedCuisineId: string | null;
  matchedRestaurantName: string | null;
  matchedDishName: string | null;
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
    matchedRestaurantName: (row.matched_restaurant_name as string | null) ?? null,
    matchedDishName: (row.matched_dish_name as string | null) ?? null,
  };
}

const ROOM_COLUMNS =
  "id, code, creator_id, status, matched_cuisine_id, matched_restaurant_name, matched_dish_name";

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
  if (error) throw error;
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

export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  // No explicit "leave room" RLS policy was added for this phase (no DELETE
  // policy exists on room_participants in 0001_init.sql or later
  // migrations), so this only clears the local cache -- matching the
  // reference app's handleLeaveRoom(), which was also purely a client-side
  // localStorage clear with no server-side leave call. A real "leave" that
  // removes the row (and correctly shrinks match-unanimity's denominator
  // for a live room) is left for a later phase.
  clearActiveRoom();
  void supabase;
  void roomId;
  void userId;
}

// ---------------------------------------------------------------------------
// Realtime (Task 3)
// ---------------------------------------------------------------------------
export interface RoomRealtimeHandlers {
  onSessionChange?: (room: RoomState) => void;
  onParticipantsChange?: () => void;
  onSwipeChange?: () => void;
  onDishSwipeChange?: () => void;
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
      { event: "*", schema: "public", table: "dish_swipes", filter: `session_id=eq.${roomId}` },
      () => handlers.onDishSwipeChange?.()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
