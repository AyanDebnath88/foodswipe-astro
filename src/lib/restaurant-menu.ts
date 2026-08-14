// Client for POST /api/restaurant-menu (Phase 3).
//
//   body:     { restaurantName: string, cuisine: string, restaurantWebsite?: string }
//   response: { menu: { name, description, isTopPick }[], source: "gemini" | "fallback" }
//
// Why the dish deck needs this at all: the deck used to be built from
// `cuisines.find(c => c.id === cuisineId)?.dishes ?? []`, which had two
// problems. The fatal one is that an AI-suggested cuisine has an `ai-<slug>`
// id that matches no catalog row, so the deck was `[]` and a group that
// matched on an AI suggestion hit "That's the whole menu" forever with nothing
// to swipe -- a dead end at the end of the happy path. The quieter one is that
// even for a catalog cuisine, every restaurant showed the same 5 generic
// dishes, so "what to eat at <restaurant>" was the same list everywhere.
//
// Unlike src/lib/ai-suggestions.ts, this one does NOT swallow failures into an
// empty result: an empty dish deck is itself the dead end being fixed here, so
// the caller has to be able to tell "no menu" from "menu of nothing" and
// decide (fall back to catalog dishes, offer a retry, or say so plainly).

export interface MenuDish {
  name: string;
  description: string;
  isTopPick: boolean;
}

export type MenuSource = "gemini" | "fallback";

export interface RestaurantMenu {
  menu: MenuDish[];
  source: MenuSource;
}

/**
 * The route is per-IP rate limited (src/lib/api/guard.ts: 6 requests / 15s),
 * and a whole room opening the same restaurant at once can genuinely trip it.
 * Surfaced as its own error type so the UI can say "try again in N seconds"
 * instead of the generic failure, and so a retry can be timed sensibly.
 */
export class MenuRateLimitedError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Rate limited. Try again in ${retryAfterSeconds}s.`);
    this.name = "MenuRateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class MenuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuUnavailableError";
  }
}

function parseRetryAfter(response: Response): number {
  const header = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(header) && header > 0) return Math.min(Math.ceil(header), 120);
  return 15;
}

export async function fetchRestaurantMenu(
  restaurantName: string,
  cuisine: string,
  restaurantWebsite?: string
): Promise<RestaurantMenu> {
  let response: Response;
  try {
    response = await fetch("/api/restaurant-menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantName,
        cuisine,
        ...(restaurantWebsite ? { restaurantWebsite } : {}),
      }),
    });
  } catch (err) {
    throw new MenuUnavailableError(
      err instanceof Error ? `Couldn't reach the menu service: ${err.message}` : "Couldn't reach the menu service."
    );
  }

  if (response.status === 429) {
    throw new MenuRateLimitedError(parseRetryAfter(response));
  }
  if (!response.ok) {
    throw new MenuUnavailableError(`The menu service returned ${response.status}.`);
  }

  let data: Partial<RestaurantMenu>;
  try {
    data = (await response.json()) as Partial<RestaurantMenu>;
  } catch {
    throw new MenuUnavailableError("The menu service returned something unreadable.");
  }

  if (!Array.isArray(data.menu)) {
    throw new MenuUnavailableError("The menu service returned no menu.");
  }

  const menu: MenuDish[] = [];
  for (const dish of data.menu) {
    const name = typeof dish?.name === "string" ? dish.name.trim() : "";
    if (!name) continue;
    menu.push({
      name,
      description: typeof dish?.description === "string" ? dish.description.trim() : "",
      isTopPick: dish?.isTopPick === true,
    });
  }

  if (menu.length === 0) {
    throw new MenuUnavailableError("The menu came back empty.");
  }

  return { menu, source: data.source === "gemini" ? "gemini" : "fallback" };
}
