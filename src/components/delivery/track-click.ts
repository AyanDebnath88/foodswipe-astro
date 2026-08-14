// Client-side monetization instrumentation (supabase/migrations/0015).
//
// Records the delivery funnel -- links shown, links clicked -- into
// public.monetization_events through the ordinary RLS-guarded browser
// client, the same way every other write in this app happens. No API route,
// no third-party analytics SDK, no pixel, no cookie beyond the app's own
// auth session.
//
// Privacy, concretely:
//   * The only identifier written is the app's own auth user id, and it is
//     not even sent by this code -- the column defaults to auth.uid() on the
//     server and the RLS policy requires it to equal the caller, so a client
//     can neither omit nor forge it.
//   * No IP, no user agent, no screen size, no device id, no location. The
//     region string is the coarse IN/UK/EU/GLOBAL bucket the delivery
//     endpoint already computed, not coordinates.
//   * Events cascade away with the user row, so deleting an account really
//     deletes its analytics.
//
// MUST NOT BLOCK NAVIGATION. Nothing here is awaited by the caller and
// nothing here can throw into a click handler: the outbound link is the
// thing the user asked for, and an analytics write is never allowed to
// delay it, let alone prevent it. The insert is fire-and-forget; the link
// opens in a new tab, so this page stays alive long enough for the request
// to finish, and if it doesn't, we lose an event and the user still gets
// their food.
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type MonetizationEventType =
  | "delivery_links_shown"
  | "delivery_link_clicked"
  | "sponsored_shown"
  | "sponsored_clicked";

export interface MonetizationEventInput {
  eventType: MonetizationEventType;
  /** Room id, when the user is in one. Solo browsing has none. */
  sessionId?: string | null;
  serviceName?: string | null;
  restaurantName?: string | null;
  cuisineId?: string | null;
  region?: string | null;
  /** Whether the clicked link actually carried a tracking id. */
  affiliateTagged?: boolean;
  sponsoredPlacementId?: string | null;
}

/**
 * Fire-and-forget event write. Returns void, never a promise, so a caller
 * physically cannot await it and accidentally serialise a navigation behind
 * an analytics round trip.
 */
export function recordMonetizationEvent(input: MonetizationEventInput): void {
  try {
    const supabase = createSupabaseBrowserClient();

    // user_id is deliberately omitted -- see the header.
    void supabase
      .from("monetization_events")
      .insert({
        event_type: input.eventType,
        session_id: input.sessionId ?? null,
        service_name: input.serviceName ?? null,
        restaurant_name: input.restaurantName ?? null,
        cuisine_id: input.cuisineId ?? null,
        region: input.region ?? null,
        affiliate_tagged: input.affiliateTagged ?? false,
        sponsored_placement_id: input.sponsoredPlacementId ?? null,
      })
      .then(
        () => undefined,
        // Swallowed on purpose, and it covers a real, expected case: before
        // migration 0015 is applied the table does not exist, and a signed-
        // out visitor cannot insert at all. Neither is a reason to make
        // noise at a user who is trying to order dinner.
        () => undefined
      );
  } catch {
    // Client construction failed (no env, no browser). Same answer.
  }
}
