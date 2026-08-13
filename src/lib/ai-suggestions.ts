// Phase 2, Task 5: match fallback.
//
// Calls the teammate's Phase 3 endpoint per the agreed HTTP contract:
//   POST /api/suggest-cuisines
//   body: { likedCuisines, dislikedCuisines, numberOfSuggestions? }
//   response: { suggestedCuisines: string[] }
// (that route now exists -- see the build-log's Phase 3 entry -- but this
// call is written to succeed or fail gracefully regardless of whether it's
// deployed/reachable, per the phase brief: a failure here must never block
// the swipe UI.)
export interface SuggestCuisinesResult {
  suggestedCuisines: string[];
}

export async function suggestCuisines(
  likedCuisines: string[],
  dislikedCuisines: string[],
  numberOfSuggestions = 3
): Promise<string[]> {
  try {
    const response = await fetch("/api/suggest-cuisines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ likedCuisines, dislikedCuisines, numberOfSuggestions }),
    });

    if (!response.ok) {
      console.warn(`suggest-cuisines returned ${response.status}; skipping AI fallback.`);
      return [];
    }

    const data = (await response.json()) as Partial<SuggestCuisinesResult>;
    return Array.isArray(data.suggestedCuisines) ? data.suggestedCuisines : [];
  } catch (error) {
    // Network error, route not deployed yet, etc. -- non-fatal by design.
    console.warn("suggest-cuisines call failed (non-fatal):", error);
    return [];
  }
}
