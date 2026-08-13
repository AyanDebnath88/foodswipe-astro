// POST /api/suggest-cuisines
//
// Contract (fixed -- Phase 2's match-fallback logic calls this exactly):
//   body:     { likedCuisines: string[], dislikedCuisines: string[], numberOfSuggestions?: number }
//   response: { suggestedCuisines: string[] }
//
// Ported from the reference Next.js/Genkit flow
// (Food Swipe App/src/ai/flows/suggest-alternative-cuisines.ts), but as a
// direct Gemini REST call per the build-log decision (no Genkit).
//
// Never hard-fails the caller: if Gemini is unreachable, misconfigured, or
// returns something unusable, we fall back to picking a few cuisines from
// the `cuisines` table that the caller hasn't already liked/disliked.
import type { APIRoute } from "astro";
import { generateGeminiJson, GeminiError } from "@/lib/ai/gemini";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const prerender = false;

interface RequestBody {
  likedCuisines?: unknown;
  dislikedCuisines?: unknown;
  numberOfSuggestions?: unknown;
}

interface GeminiSuggestOutput {
  suggestedCuisines: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

async function fallbackSuggestions(
  request: Request,
  cookies: import("astro").AstroCookies,
  exclude: string[],
  count: number
): Promise<string[]> {
  const excludeLower = new Set(exclude.map((c) => c.toLowerCase()));
  try {
    const supabase = createSupabaseServerClient(request, cookies);
    const { data, error } = await supabase.from("cuisines").select("name");
    if (error || !data) throw error ?? new Error("no data");
    const candidates = data
      .map((row) => row.name as string)
      .filter((name) => !excludeLower.has(name.toLowerCase()));
    if (candidates.length > 0) {
      return candidates.slice(0, count);
    }
  } catch {
    // Even the DB fallback failed (e.g. no live Supabase project configured
    // yet, per build-log's pending manual steps) -- fall through to a
    // hardcoded last-resort list so this endpoint truly never hard-fails.
  }
  const hardcoded = ["Italian", "Japanese", "Mexican", "Indian", "Thai", "Greek", "French", "Vietnamese", "Korean"];
  return hardcoded.filter((name) => !excludeLower.has(name.toLowerCase())).slice(0, count);
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const likedCuisines = isStringArray(body.likedCuisines) ? body.likedCuisines : [];
  const dislikedCuisines = isStringArray(body.dislikedCuisines) ? body.dislikedCuisines : [];
  const numberOfSuggestions =
    typeof body.numberOfSuggestions === "number" && body.numberOfSuggestions > 0
      ? Math.min(Math.floor(body.numberOfSuggestions), 10)
      : 3;

  try {
    const prompt = `Based on the cuisines that the users have liked and disliked, suggest ${numberOfSuggestions} alternative cuisines that they might enjoy.

Liked Cuisines: ${likedCuisines.join(", ") || "none"}
Disliked Cuisines: ${dislikedCuisines.join(", ") || "none"}

Return exactly ${numberOfSuggestions} cuisine names. Do not suggest anything already in the liked or disliked lists.`;

    const output = await generateGeminiJson<GeminiSuggestOutput>({
      prompt,
      responseSchema: {
        type: "OBJECT",
        properties: {
          suggestedCuisines: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["suggestedCuisines"],
      },
    });

    if (!isStringArray(output.suggestedCuisines) || output.suggestedCuisines.length === 0) {
      throw new GeminiError("Gemini returned an empty/invalid suggestedCuisines array");
    }

    return new Response(
      JSON.stringify({ suggestedCuisines: output.suggestedCuisines.slice(0, numberOfSuggestions) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[suggest-cuisines] Gemini call failed, using DB fallback:", err);
    const suggestedCuisines = await fallbackSuggestions(
      request,
      cookies,
      [...likedCuisines, ...dislikedCuisines],
      numberOfSuggestions
    );
    return new Response(JSON.stringify({ suggestedCuisines }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
};
