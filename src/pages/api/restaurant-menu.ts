// POST /api/restaurant-menu
//
//   body:     { restaurantName: string, cuisine: string, restaurantWebsite?: string }
//   response: { menu: Dish[], source: "gemini" | "fallback" }
//
// Ported from the reference Next.js/Genkit flow
// (Food Swipe App/src/ai/flows/get-restaurant-menu.ts): direct Gemini REST
// call (no Genkit/SDK) asking for a plausible 7-10 dish menu with 2-3 dishes
// flagged as top picks.
//
// Preserves the reference file's local-fallback behavior for when
// GEMINI_API_KEY is missing or the call fails: deterministic dishes sourced
// from the `cuisines` table (falls back further to a generic hardcoded
// dish list if the cuisine isn't found in the DB either, e.g. no live
// Supabase project configured yet).
import type { APIRoute } from "astro";
import { generateGeminiJson, GeminiError } from "@/lib/ai/gemini";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const prerender = false;

interface Dish {
  name: string;
  description: string;
  isTopPick: boolean;
}

interface RequestBody {
  restaurantName?: unknown;
  cuisine?: unknown;
  restaurantWebsite?: unknown;
}

interface GeminiMenuOutput {
  menu: Dish[];
}

async function localFallbackMenu(
  request: Request,
  cookies: import("astro").AstroCookies,
  cuisine: string
): Promise<Dish[]> {
  let baseDishes: string[] | null = null;

  try {
    const supabase = createSupabaseServerClient(request, cookies);
    const { data } = await supabase
      .from("cuisines")
      .select("dishes")
      .or(`id.eq.${cuisine.toLowerCase()},name.ilike.${cuisine}`)
      .limit(1)
      .maybeSingle();
    if (data?.dishes && Array.isArray(data.dishes) && data.dishes.length > 0) {
      baseDishes = data.dishes as string[];
    }
  } catch {
    // No live Supabase project configured yet, or lookup failed -- fall
    // through to the hardcoded generic list below.
  }

  if (!baseDishes) {
    baseDishes = [
      "House Special Combo",
      "Authentic Chef's Signature Dish",
      "Classic Fresh Salad",
      "Homemade Sweet Dessert",
      "Traditional Warm Starter",
    ];
  }

  return baseDishes.map((dishName, idx) => ({
    name: dishName,
    description: `Our signature preparation of ${dishName}, crafted with freshly imported ingredients, delicate spices, and served piping hot.`,
    isTopPick: idx === 0 || idx === 2,
  }));
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const restaurantName =
    typeof body.restaurantName === "string" && body.restaurantName.trim() ? body.restaurantName.trim() : null;
  const cuisine = typeof body.cuisine === "string" && body.cuisine.trim() ? body.cuisine.trim() : null;
  const restaurantWebsite = typeof body.restaurantWebsite === "string" ? body.restaurantWebsite : undefined;

  if (!restaurantName || !cuisine) {
    return new Response(JSON.stringify({ error: "restaurantName and cuisine (strings) are required" }), {
      status: 400,
    });
  }

  try {
    const prompt = `You are a helpful assistant that generates plausible restaurant menus.
Your task is to:
1. Create a realistic menu of 7-10 dishes for "${restaurantName}", which serves ${cuisine} food. The restaurant's website is ${restaurantWebsite || "not provided"}.
2. For each dish, provide a name and a short, appealing description.
3. Based on simulated analysis of online reviews and popularity for this type of restaurant, identify 2-3 of the most popular dishes and mark them as top picks by setting isTopPick to true.
4. Return the menu as JSON.`;

    const output = await generateGeminiJson<GeminiMenuOutput>({
      prompt,
      responseSchema: {
        type: "OBJECT",
        properties: {
          menu: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                description: { type: "STRING" },
                isTopPick: { type: "BOOLEAN" },
              },
              required: ["name", "description", "isTopPick"],
            },
          },
        },
        required: ["menu"],
      },
      timeoutMs: 12000,
    });

    if (!Array.isArray(output.menu) || output.menu.length === 0) {
      throw new GeminiError("Gemini returned an empty/invalid menu array");
    }

    return new Response(JSON.stringify({ menu: output.menu, source: "gemini" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[restaurant-menu] Gemini call failed, using local fallback:", err);
    const menu = await localFallbackMenu(request, cookies, cuisine);
    return new Response(JSON.stringify({ menu, source: "fallback" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
};
