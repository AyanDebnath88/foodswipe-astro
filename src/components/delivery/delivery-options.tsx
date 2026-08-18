"use client";

// Delivery options for a chosen restaurant (Phase 5, monetization channel 1).
//
// Renders the real regional delivery search links from /api/delivery-links,
// records the two funnel events (shown, clicked), and -- only when a link
// really carries an affiliate tracking id -- shows the affiliate disclosure.
//
// Three rules this component exists to keep:
//
//  1. NO INVENTED NUMBERS. The reference app's delivery UI printed per-
//     service prices, delivery times and "X people ordered this" style
//     social proof, all of it fabricated by a hardcoded formula with no
//     pricing API behind it. None of that is here and none of it may come
//     back. If a number is not real, it is not on screen. What is on screen
//     is what is true: which services deliver in this region, and a search
//     link into each.
//  2. DISCLOSE WHEN THERE IS SOMETHING TO DISCLOSE. `affiliateDisclosure`
//     comes from the server and is true only if a tracking id was actually
//     applied to at least one link. With zero affiliate programs signed up
//     -- today's state -- no disclosure is shown, because there is no
//     commercial relationship to disclose and claiming one would be its own
//     small lie. The moment one is configured, the line appears without a
//     code change.
//  3. THE LINK COMES FIRST. Click tracking is fire-and-forget and never
//     awaited (see track-click.ts); the anchor is a real href with a real
//     target, so it works with JS mid-flight, with the tracking write
//     failing, and from the browser's own "open in new tab".
//
// Deliberately self-contained: this island is not yet mounted anywhere. The
// match/dish pages belong to another agent this phase -- the integration
// note is in the build log. It takes plain props and needs no context.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, MapPin, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordMonetizationEvent } from "./track-click";

interface DeliveryLink {
  serviceName: string;
  url: string;
  affiliate: boolean;
}

interface DeliveryLinksResponse {
  services: DeliveryLink[];
  region: string;
  affiliateDisclosure: boolean;
}

export interface DeliveryOptionsProps {
  restaurantName: string;
  /** From a real search result, when there was one -- see [restaurant].astro. Sharpens the Zomato/Swiggy/etc search query so the platform's OWN search is more likely to land on the right listing first. Never guarantees landing directly on that restaurant's menu page -- this app has no way to know a restaurant's real Zomato/Swiggy listing id without either their API (not available to us) or scraping their site (explicitly rejected, see clever-baking-map.md). It's a better search, not a direct link. */
  restaurantAddress?: string;
  /** Pass these when the page already knows them; otherwise the user is
   *  offered a "use my location" button rather than being geolocated
   *  unprompted. */
  latitude?: number;
  longitude?: number;
  /** Room id, for the funnel. Absent for solo browsing. */
  sessionId?: string;
  /** The matched cuisine, for the funnel breakdown. */
  cuisineId?: string;
}

type Status = "idle" | "locating" | "loading" | "ready" | "error";

export function DeliveryOptions({
  restaurantName,
  restaurantAddress,
  latitude,
  longitude,
  sessionId,
  cuisineId,
}: DeliveryOptionsProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<DeliveryLinksResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // One "shown" event per mounted restaurant, not one per re-render.
  const shownRef = useRef(false);

  const load = useCallback(
    async (lat: number, lon: number) => {
      setStatus("loading");
      setMessage(null);
      try {
        const res = await fetch("/api/delivery-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurantName, area: restaurantAddress, latitude: lat, longitude: lon }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as DeliveryLinksResponse;
        if (!body?.services?.length) {
          setStatus("error");
          setMessage("No delivery services found for this area.");
          return;
        }
        setData(body);
        setStatus("ready");
      } catch {
        // Same posture as every other cross-route call in this project: a
        // failure degrades to a message, never an exception into the page.
        setStatus("error");
        setMessage("Couldn't load delivery options right now.");
      }
    },
    [restaurantName, restaurantAddress]
  );

  useEffect(() => {
    if (typeof latitude === "number" && typeof longitude === "number") {
      void load(latitude, longitude);
    }
  }, [latitude, longitude, load]);

  // Funnel stage 2: the links were actually rendered to a human.
  useEffect(() => {
    if (status !== "ready" || !data || shownRef.current) return;
    shownRef.current = true;
    recordMonetizationEvent({
      eventType: "delivery_links_shown",
      sessionId,
      restaurantName,
      cuisineId,
      region: data.region,
      affiliateTagged: data.services.some((s) => s.affiliate),
    });
  }, [status, data, sessionId, restaurantName, cuisineId]);

  const requestLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      setMessage("This browser can't share your location.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => void load(pos.coords.latitude, pos.coords.longitude),
      () => {
        setStatus("error");
        setMessage("Location permission is needed to find delivery services near you.");
      },
      { timeout: 10_000 }
    );
  };

  // Funnel stage 3. Fire-and-forget, then let the browser do what it was
  // always going to do -- no preventDefault, no window.open, no await.
  const handleClick = (link: DeliveryLink) => {
    recordMonetizationEvent({
      eventType: "delivery_link_clicked",
      sessionId,
      serviceName: link.serviceName,
      restaurantName,
      cuisineId,
      region: data?.region ?? null,
      affiliateTagged: link.affiliate,
    });
  };

  if (status === "idle") {
    return (
      <div className="rounded-[var(--fs-r-lg)] border border-[var(--fs-line)] bg-card/40 p-6 text-center">
        <Truck className="h-6 w-6 text-primary mx-auto mb-3" />
        <p className="font-body text-muted-foreground mb-4">
          See which delivery apps carry {restaurantName}.
        </p>
        <Button onClick={requestLocation} className="rounded-2xl h-11 px-6">
          <MapPin className="h-4 w-4" />
          Use my location
        </Button>
      </div>
    );
  }

  if (status === "locating" || status === "loading") {
    return (
      <p className="font-body text-muted-foreground text-center py-6">
        {status === "locating" ? "Getting your location..." : "Finding delivery options..."}
      </p>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="rounded-[var(--fs-r-lg)] border border-[var(--fs-line)] bg-card/40 p-6 text-center">
        <p className="font-body text-muted-foreground mb-4">{message ?? "Couldn't load delivery options."}</p>
        <Button variant="outline" onClick={requestLocation} className="rounded-2xl">
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--fs-r-lg)] border border-[var(--fs-line)] bg-card/40 p-6">
      <h3 className="font-headline text-xl mb-1">Order {restaurantName}</h3>
      <p className="font-body text-sm text-muted-foreground mb-4">
        Search for this restaurant on the delivery apps available in your area.
      </p>

      <ul className="flex flex-col gap-2">
        {data.services.map((link) => (
          <li key={link.serviceName}>
            <a
              href={link.url}
              target="_blank"
              // rel="sponsored" is the honest HTML annotation for a link that
              // may earn a commission, and it is applied per-link rather than
              // to the whole list -- an untagged link is not sponsored and
              // must not say it is.
              rel={link.affiliate ? "sponsored nofollow noopener noreferrer" : "noopener noreferrer"}
              onClick={() => handleClick(link)}
              className="flex items-center justify-between rounded-xl border border-input bg-background px-4 py-3 font-body transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span>{link.serviceName}</span>
              <ExternalLink className="h-4 w-4 opacity-60" />
            </a>
          </li>
        ))}
      </ul>

      {data.affiliateDisclosure && (
        <p className="font-body text-xs text-muted-foreground mt-4">
          Some of these are affiliate links: if you order through one, Food Swipe may earn a
          commission. It costs you nothing extra, and it never changes which restaurants or
          cuisines you're shown.
        </p>
      )}
    </div>
  );
}

export default DeliveryOptions;
