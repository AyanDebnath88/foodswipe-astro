// Phase 4 — post-meal feedback (supabase/migrations/0014_retention_loop.sql).
//
// The retention hook and the data flywheel in one table. Until now nothing
// in this app recorded whether the group actually went, or whether the thing
// they unanimously agreed on turned out to be any good — so there was no
// reason to reopen the app after a session ended, and no signal that could
// ever make an AI suggestion personal instead of generic.
//
// Contract notes that matter to callers:
//   * ONE ROW PER (session, member). `saveFeedback()` upserts on that pair,
//     so answering twice edits rather than duplicates. Never insert here.
//   * Reads are room-wide (every current participant can see the room's
//     feedback, per the RLS policy in 0014) — that is the product point:
//     "we went, it was a 5" is worth more to the group than to one person.
//   * Reads never throw. A missing table (0014 not applied yet) or an RLS
//     rejection returns an empty result, following the same rule
//     src/lib/dish-matches.ts follows: a read failure on a supplementary
//     panel must never blank out a page the user can otherwise use.
//   * Writes DO throw, so the UI can tell the user their answer did not
//     save rather than silently dropping it.
import { createSupabaseBrowserClient } from "./supabase/client";

export interface SessionFeedback {
  id: string;
  sessionId: string;
  userId: string;
  /** Did the group actually go? The only required answer. */
  didGo: boolean;
  /** 1–5, or null. Null is legal even when didGo is true — see saveFeedback. */
  rating: number | null;
  restaurantName: string | null;
  dishName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackInput {
  sessionId: string;
  userId: string;
  didGo: boolean;
  rating?: number | null;
  restaurantName?: string | null;
  dishName?: string | null;
  notes?: string | null;
}

const COLUMNS =
  "id, session_id, user_id, did_go, rating, restaurant_name, dish_name, notes, created_at, updated_at";

function mapRow(row: Record<string, unknown>): SessionFeedback {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    userId: row.user_id as string,
    didGo: Boolean(row.did_go),
    rating: (row.rating as number | null) ?? null,
    restaurantName: (row.restaurant_name as string | null) ?? null,
    dishName: (row.dish_name as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Field caps, mirroring the CHECK constraints in 0014 exactly. */
export const NOTES_MAX_LENGTH = 1000;
const NAME_MAX_LENGTH = 160;

/**
 * Everyone's feedback for one session, oldest first.
 *
 * Room-wide by design (see the module header). Returns `[]` rather than
 * throwing on any failure.
 */
export async function fetchSessionFeedback(sessionId: string): Promise<SessionFeedback[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("session_feedback")
    .select(COLUMNS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapRow);
}

/**
 * The same read for several sessions at once — what the history page needs,
 * so a list of a dozen past rooms costs one round trip instead of a dozen.
 * Keyed by session id.
 */
export async function fetchFeedbackForSessions(
  sessionIds: string[]
): Promise<Map<string, SessionFeedback[]>> {
  const bySession = new Map<string, SessionFeedback[]>();
  if (sessionIds.length === 0) return bySession;

  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("session_feedback")
    .select(COLUMNS)
    .in("session_id", sessionIds)
    .order("created_at", { ascending: true });
  if (error || !data) return bySession;

  for (const row of data as Record<string, unknown>[]) {
    const entry = mapRow(row);
    const list = bySession.get(entry.sessionId);
    if (list) list.push(entry);
    else bySession.set(entry.sessionId, [entry]);
  }
  return bySession;
}

/** This user's own row for a session, or null if they haven't answered. */
export async function fetchMyFeedback(
  sessionId: string,
  userId: string
): Promise<SessionFeedback | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("session_feedback")
    .select(COLUMNS)
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

/**
 * Files or edits this user's feedback for a session.
 *
 * `onConflict: "session_id,user_id"` is the whole reason 0014's unique
 * constraint is a plain two-column UNIQUE — PostgREST's upsert takes
 * conflict *columns*, so an expression index would not be usable from here.
 * Changing your mind therefore rewrites your row and never accumulates a
 * second opinion about the same dinner.
 *
 * Rating is nulled out when `didGo` is false, matching the
 * `session_feedback_rating_requires_visit` CHECK constraint: rating a meal
 * you didn't eat is noise in the flywheel this table exists to feed. Doing
 * it here rather than letting the constraint reject the write keeps the
 * "we never went" path a single tap, which is the point — the prompt must
 * never become a wall.
 *
 * Client-side truncation mirrors the DB caps rather than relying on them.
 * The constraint is the real boundary; this just means a user who pastes an
 * essay gets it trimmed instead of an error.
 */
export async function saveFeedback(input: FeedbackInput): Promise<SessionFeedback> {
  const supabase = createSupabaseBrowserClient();

  const rating = input.didGo ? normaliseRating(input.rating) : null;

  const { data, error } = await supabase
    .from("session_feedback")
    .upsert(
      {
        session_id: input.sessionId,
        user_id: input.userId,
        did_go: input.didGo,
        rating,
        restaurant_name: trimOrNull(input.restaurantName, NAME_MAX_LENGTH),
        dish_name: trimOrNull(input.dishName, NAME_MAX_LENGTH),
        notes: trimOrNull(input.notes, NOTES_MAX_LENGTH),
      },
      { onConflict: "session_id,user_id" }
    )
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

/**
 * Retracts this user's feedback. Feedback must never be a dead end: a member
 * who filed by accident, or who'd rather their opinion wasn't in the group's
 * view, can take it back (0014 grants a DELETE policy for exactly this).
 */
export async function deleteFeedback(sessionId: string, userId: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from("session_feedback")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", userId);
  if (error) throw error;
}

function normaliseRating(rating: number | null | undefined): number | null {
  if (rating === null || rating === undefined) return null;
  if (!Number.isFinite(rating)) return null;
  const rounded = Math.round(rating);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function trimOrNull(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, max);
}
