// Phase 2, Task 2: dietary filter.
//
// Implementation choice: client-side filter over two already-fetched
// arrays, not a Postgres function. Both inputs it needs -- the cuisine
// catalog (9-ish rows from src/lib/cuisines.ts, fetched once per swipe
// session) and the room's participant list with dietary_restrictions (from
// get_room_profiles(), already fetched for the waiting-room/participant UI)
// -- are already sitting in the swipe UI's React state before any deck
// renders. Adding a Postgres function to recompute the same
// small-set intersection the client can do in a couple of `.every()` calls
// over single-digit row counts would be a network round trip for no
// accuracy or security benefit: dietary_tags and dietary_restrictions
// aren't sensitive data, and which cards appear in the deck is a UX
// convenience, not an access-control boundary the server needs to enforce
// (nothing about RLS or the match trigger relies on the deck contents --
// a participant can still technically POST a swipe row for a filtered-out
// cuisine id, the filter just keeps it out of the UI). A client-side
// `useMemo` recomputes this any time the participant list changes
// (Realtime keeps that list live -- see src/components/swipe/swipe-area.tsx),
// satisfying "recompute as participants join" without a server round trip.
export interface DietaryProfile {
  dietaryRestrictions: string[];
}

export function unionDietaryRestrictions(participants: DietaryProfile[]): string[] {
  const union = new Set<string>();
  for (const participant of participants) {
    for (const restriction of participant.dietaryRestrictions) {
      union.add(restriction);
    }
  }
  return [...union];
}

export function filterCuisinesByDietary<T extends { dietaryTags: string[] }>(
  cuisines: T[],
  requiredRestrictions: string[]
): T[] {
  if (requiredRestrictions.length === 0) return cuisines;
  return cuisines.filter((cuisine) =>
    requiredRestrictions.every((restriction) => cuisine.dietaryTags.includes(restriction))
  );
}
