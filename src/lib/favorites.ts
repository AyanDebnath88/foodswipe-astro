// Phase 4 — saved restaurants (supabase/migrations/0014_retention_loop.sql).
//
// The solo half of the retention loop. `saved_restaurants` is the only table
// in this schema that is NOT room-scoped: it belongs to one user, it outlives
// every room they were ever in, and no co-participant can read it. So it is
// also the only one whose policies do NOT go through is_room_participant() —
// ownership is the entire policy (see 0014 block B).
//
// Same error contract as src/lib/feedback.ts: reads degrade to empty, writes
// throw so the UI can say the save didn't land.
import { createSupabaseBrowserClient } from "./supabase/client";

export interface SavedRestaurant {
  id: string;
  restaurantName: string;
  cuisineId: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  /** The room this was saved from, if any. Provenance for the UI, not an access grant. */
  sourceSessionId: string | null;
  createdAt: string;
}

export interface SaveRestaurantInput {
  userId: string;
  restaurantName: string;
  cuisineId?: string | null;
  address?: string | null;
  website?: string | null;
  notes?: string | null;
  sourceSessionId?: string | null;
}

const COLUMNS =
  "id, restaurant_name, cuisine_id, address, website, notes, source_session_id, created_at";

export const NAME_MAX_LENGTH = 160;
export const NOTES_MAX_LENGTH = 500;
const CUISINE_MAX_LENGTH = 64;
const ADDRESS_MAX_LENGTH = 240;
const WEBSITE_MAX_LENGTH = 500;

function mapRow(row: Record<string, unknown>): SavedRestaurant {
  return {
    id: row.id as string,
    restaurantName: row.restaurant_name as string,
    cuisineId: (row.cuisine_id as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    sourceSessionId: (row.source_session_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** This user's favourites, newest first. RLS already scopes it to them. */
export async function fetchFavorites(): Promise<SavedRestaurant[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("saved_restaurants")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapRow);
}

/**
 * Saves (or updates) a favourite. Idempotent per (user, restaurant name)
 * via `onConflict` — pressing "Save" twice on the same place updates the
 * row rather than erroring or duplicating, which is why 0014's unique
 * constraint is a plain two-column UNIQUE and not a `lower(name)`
 * expression index (PostgREST's upsert takes conflict *columns*).
 *
 * `website` is validated here as well as in the CHECK constraint, and the
 * reason is not tidiness: this value is rendered as an `<a href>`, and a
 * `javascript:` or `data:` URL in an href the app writes into the DOM is a
 * stored-XSS shape. The data comes from a third-party places API, so it is
 * not ours to trust. Anything that isn't http(s) is dropped rather than
 * rejected — a restaurant with a junk website is still worth saving.
 */
export async function saveFavorite(input: SaveRestaurantInput): Promise<SavedRestaurant> {
  const supabase = createSupabaseBrowserClient();

  const restaurantName = input.restaurantName.trim().slice(0, NAME_MAX_LENGTH);
  if (restaurantName === "") throw new Error("A saved restaurant needs a name.");

  const { data, error } = await supabase
    .from("saved_restaurants")
    .upsert(
      {
        user_id: input.userId,
        restaurant_name: restaurantName,
        cuisine_id: trimOrNull(input.cuisineId, CUISINE_MAX_LENGTH),
        address: trimOrNull(input.address, ADDRESS_MAX_LENGTH),
        website: safeWebUrl(input.website),
        notes: trimOrNull(input.notes, NOTES_MAX_LENGTH),
        source_session_id: input.sourceSessionId ?? null,
      },
      { onConflict: "user_id,restaurant_name" }
    )
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

/** Edits the note on an existing favourite (the only editable field). */
export async function updateFavoriteNotes(id: string, notes: string | null): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from("saved_restaurants")
    .update({ notes: trimOrNull(notes, NOTES_MAX_LENGTH) })
    .eq("id", id);
  if (error) throw error;
}

export async function removeFavorite(id: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("saved_restaurants").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Which of these restaurant names this user has already saved, lowercased
 * for comparison. Lets a "Save"/"Saved" toggle render correctly next to a
 * list of restaurants without one query per row.
 *
 * Lowercased on purpose even though the unique constraint is
 * case-SENSITIVE: the constraint's casing behaviour is a storage detail the
 * UI shouldn't inherit — showing "Save" next to a place the user already
 * saved under different capitalisation would just look broken.
 */
export async function fetchSavedNameSet(): Promise<Set<string>> {
  const favorites = await fetchFavorites();
  return new Set(favorites.map((f) => f.restaurantName.trim().toLowerCase()));
}

function trimOrNull(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, max);
}

/**
 * Returns the URL only if it is a plain http(s) URL, else null. Mirrors
 * 0014's `saved_restaurants_website_scheme` CHECK so a junk value is
 * silently dropped client-side instead of failing the whole save.
 */
export function safeWebUrl(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value, WEBSITE_MAX_LENGTH);
  if (trimmed === null) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}
