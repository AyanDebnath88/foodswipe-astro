// The shared Cuisine shape.
//
// This used to also house the AI-suggestion dietary safety gate
// (syntheticCuisineFromName/resolveSuggestedCuisines) -- the AI "suggest more
// cuisines" feature (POST /api/suggest-cuisines, the deck's stalled-room
// fallback) was removed at the user's request, and that gate only existed to
// protect it, so it went with it. What's left is just the type: cuisines.ts
// can't be imported by Node test scripts (it pulls in supabase/client.ts and
// `import.meta.env`), so the shape still lives in this dependency-free file
// rather than there, with cuisines.ts re-exporting it as its `Cuisine` type
// so there is one definition, not two that can drift.
export interface Cuisine {
  id: string;
  name: string;
  dishes: string[];
  dietaryTags: string[];
}
