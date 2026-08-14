// One place that turns "something threw" into a message worth showing a user.
//
// Why this exists: every handler in this app used to write
//
//     err instanceof Error ? err.message : "Could not join the swipe room."
//
// which is wrong for the errors this app actually throws most often.
// supabase-js does NOT reject with an Error for a failed query -- PostgrestError
// is a plain object ({ message, details, hint, code }) with no Error in its
// prototype chain, and so is AuthError-ish JSON from some paths. `instanceof
// Error` is therefore false exactly when the real message is most useful, and
// a QA pass found the concrete symptom: joining with a bad code produced the
// perfectly good message `Room "QQQQ" not found.` and the UI replaced it with
// the generic "Could not join the swipe room."
//
// Order matters below: a real Error wins, then a PostgrestError-shaped object,
// then anything with a usable string `message`, then the caller's fallback.
// The fallback is never dropped -- an empty/whitespace message is treated as
// no message at all.

interface MessageLike {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
}

function usableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extracts the most specific human-readable message available from an unknown
 * thrown value, falling back to `fallback` when there genuinely isn't one.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return usableString(err.message) ?? fallback;
  if (typeof err === "string") return usableString(err) ?? fallback;

  if (err && typeof err === "object") {
    const candidate = err as MessageLike;
    const message = usableString(candidate.message);
    if (message) return message;
    // Some PostgREST failures put the substance in `details` and leave
    // `message` generic or empty.
    const details = usableString(candidate.details);
    if (details) return details;
  }

  return fallback;
}

/**
 * PostgREST/Postgres error code, when the thrown value carries one (e.g.
 * "PGRST116" for "0 rows where 1 was expected", "42501" for an RLS refusal).
 * Lets a caller branch on the specific failure instead of string-matching.
 */
export function errorCode(err: unknown): string | null {
  if (err && typeof err === "object") {
    return usableString((err as MessageLike).code);
  }
  return null;
}
