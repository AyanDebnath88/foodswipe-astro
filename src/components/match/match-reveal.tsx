"use client";

// Match reveal page. Ported from the reference Next.js project's
// src/app/(app)/match/[cuisine]/page.tsx -- the reveal moment (heading,
// "You all want X!" copy, meal-time heading logic) plus real restaurant
// discovery via /api/find-restaurants, sponsored placements merged in via
// /api/sponsored-restaurants (see src/lib/sponsored.ts for the guardrail:
// sponsorship can only affect which restaurants surface after a cuisine is
// already matched, never the match itself), and a manual "type a name"
// fallback for when geolocation isn't available or nothing nearby matches.
import React, { useEffect, useState } from "react";
import { Heart, Utensils, UtensilsCrossed, Loader2, MapPin, Star, ExternalLink, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchRoomByCode, type RoomState } from "@/lib/rooms";
import { CUISINE_EMOJI } from "@/lib/cuisines";
import { fetchSubcuisines } from "@/lib/subcuisine";
import { mergeSponsoredFirst, type SponsoredRestaurant } from "@/lib/sponsored";
import { priceLevelToSymbol } from "@/lib/google-places";
import { getCuisineImageVariant } from "@/lib/dish-images";
import type { Restaurant } from "@/pages/api/find-restaurants";

// Cuisines with enough real internal breadth to get a second narrowing
// swipe layer before restaurant discovery (0017_indian_subcuisines.sql).
// A set, not a boolean flag on the cuisine row, so adding a second one later
// (e.g. Chinese regional cuisines) is a one-line change here plus a new
// cuisine_subcategories seed -- no schema change needed.
const CUISINES_WITH_REFINE_LAYER = new Set(["indian"]);

interface MatchRevealProps {
  cuisineId: string;
  roomCode: string;
}

function mealTimeHeading(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "Breakfast is Decided!";
  if (hour < 12) return "Brunch is Decided!";
  if (hour < 17) return "Lunch is Decided!";
  return "Dinner is Decided!";
}

function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * A cuisine id this page is willing to render.
 *
 * The slug arrives from the URL, so it is untrusted text. Without this check
 * `/match/not-a-real-cuisine-🍕?room=X` rendered "You all want Not a real
 * cuisine 🍕!" -- the page was a machine for putting arbitrary words in the
 * app's mouth, and the words it chose were a claim about what the group had
 * decided. Catalog ids and the AI fallback's `ai-<slug>` ids are the only two
 * shapes the app ever produces.
 */
function isPlausibleCuisineId(id: string): boolean {
  return /^(ai-)?[a-z0-9]+(-[a-z0-9]+)*$/.test(id) && id.length <= 64;
}

export function MatchReveal({ cuisineId, roomCode }: MatchRevealProps) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomState, setRoomState] = useState<"loading" | "ok" | "missing" | "no-match" | "bad-slug">(
    "loading"
  );
  const [restaurantNameInput, setRestaurantNameInput] = useState("");
  const [locationStatus, setLocationStatus] = useState<"idle" | "locating" | "done" | "error">("idle");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [places, setPlaces] = useState<Array<SponsoredRestaurant | Restaurant>>([]);
  const [resultSource, setResultSource] = useState<string | null>(null);
  const [subcuisineName, setSubcuisineName] = useState<string | null>(null);
  // Client-only: read once on mount, not from Astro props, since this is the
  // one-tab "I gave up waiting for consensus" bypass set by
  // subcuisine-swipe-area.tsx's skip links -- it deliberately does not touch
  // the room's real matched_subcuisine_id, so it must not be treated as
  // server truth anywhere else this component reasons about the room.
  const [skipRefine, setSkipRefine] = useState(false);
  const emoji = CUISINE_EMOJI[cuisineId] ?? "🍽️";
  const cuisineName = titleCase(cuisineId.replace(/^ai-/, "").replace(/-/g, " "));
  const needsRefine = CUISINES_WITH_REFINE_LAYER.has(cuisineId);

  useEffect(() => {
    setSkipRefine(new URLSearchParams(window.location.search).get("skipRefine") === "1");
  }, []);

  // Resolve the matched subcategory's real display name (e.g. "Street Food
  // & Chaat") from its id (e.g. "indian-street-food") -- the id alone isn't
  // presentable, and titleCase()'s cuisine-id-shaped stripping can't recover
  // names with "&" in them.
  useEffect(() => {
    if (!needsRefine || !room?.matchedSubcuisineId) return;
    let cancelled = false;
    fetchSubcuisines(cuisineId).then((subs) => {
      if (cancelled) return;
      const match = subs.find((s) => s.id === room.matchedSubcuisineId);
      if (match) setSubcuisineName(match.name);
    });
    return () => {
      cancelled = true;
    };
  }, [needsRefine, cuisineId, room?.matchedSubcuisineId]);

  useEffect(() => {
    let cancelled = false;
    if (!isPlausibleCuisineId(cuisineId)) {
      setRoomState("bad-slug");
      return;
    }
    fetchRoomByCode(roomCode).then((r) => {
      if (cancelled) return;
      setRoom(r);
      if (!r) {
        setRoomState("missing");
        return;
      }
      // THE CHECK THIS PAGE WAS MISSING. It used to render the full reveal
      // for any room it could read, so a shared link to a waiting, zero-swipe
      // room announced a decision that had never happened -- and a link to
      // /match/japanese?room=X for a room that actually matched on Italian
      // announced the wrong one. A match is a server verdict (the
      // check_swipe_match() trigger sets status + matched_cuisine_id); this
      // page's job is to REPORT that verdict, never to assert one.
      if (r.status !== "matched" || r.matchedCuisineId !== cuisineId) {
        setRoomState("no-match");
        return;
      }
      setRoomState("ok");
    });
    return () => {
      cancelled = true;
    };
  }, [roomCode, cuisineId]);

  const goToDishes = (name: string, address?: string | null, website?: string | null, phone?: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let url = `/match/${cuisineId}/${encodeURIComponent(trimmed)}?room=${roomCode}`;
    if (address) url += `&address=${encodeURIComponent(address)}`;
    // Carried to the order screen (delivery-options.tsx) so it can offer the
    // restaurant's own site/phone instead of only a generic delivery-app
    // search -- see 0020_restaurant_phone.sql for why phone exists at all.
    if (website) url += `&website=${encodeURIComponent(website)}`;
    if (phone) url += `&phone=${encodeURIComponent(phone)}`;
    window.location.href = url;
  };

  const handleContinueToDishes = (e: React.FormEvent) => {
    e.preventDefault();
    goToDishes(restaurantNameInput);
  };

  // Restaurant discovery. Geolocation is only requested on an explicit tap
  // (see the button below) -- an unprompted permission dialog is the fastest
  // route to a permanent denial, which the user can only undo in browser
  // settings.
  const findNearby = () => {
    if (!navigator.geolocation) {
      setLocationError("This browser can't share your location. Type a restaurant name instead.");
      setLocationStatus("error");
      return;
    }
    setLocationStatus("locating");
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          // Prefer the narrowed-down subcategory name when one was agreed on
          // (e.g. "Hyderabadi" beats generic "Indian" for restaurant search
          // relevance) -- this is the product payoff of the refine layer,
          // not just a UX detour.
          const searchTerm = subcuisineName ?? cuisineName;
          const res = await fetch("/api/find-restaurants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cuisine: searchTerm, latitude, longitude }),
          });
          if (res.status === 429) {
            setLocationError("Too many searches at once. Give it a few seconds and try again.");
            setLocationStatus("error");
            return;
          }
          if (!res.ok) throw new Error(`find-restaurants returned ${res.status}`);
          const data: { restaurants: Restaurant[]; source: string } = await res.json();

          // Sponsored placements are fetched only now -- after a real match,
          // for that matched cuisine. mergeSponsoredFirst() keeps them
          // structurally distinct so they always render with their label.
          let sponsored: SponsoredRestaurant[] = [];
          try {
            const sRes = await fetch("/api/sponsored-restaurants", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cuisine: cuisineId, latitude, longitude }),
            });
            if (sRes.ok) sponsored = (await sRes.json()).sponsored ?? [];
          } catch {
            // Sponsorship is never load-bearing: organic results stand alone.
          }

          setPlaces(mergeSponsoredFirst(sponsored, data.restaurants ?? []));
          setResultSource(data.source ?? null);
          setLocationStatus("done");
        } catch (err) {
          console.error("Restaurant search failed:", err);
          setLocationError("Couldn't load nearby restaurants just now.");
          setLocationStatus("error");
        }
      },
      (err) => {
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "Location access was denied, so we can't look up places near you."
            : "Couldn't work out where you are."
        );
        setLocationStatus("error");
      },
      { timeout: 10000 }
    );
  };

  // Auto-trigger the search the moment the group lands here needing it --
  // requesting geolocation is still tied to this same real user action (the
  // celebration reveal itself), not a bare page-load with nothing else
  // happening, so this isn't the "unprompted dialog" case findNearby()'s own
  // comment warns about; it's exactly the moment a location prompt is
  // contextually expected. Guarded on locationStatus === "idle" so it fires
  // exactly once, and only once the refine gate (if any) has cleared.
  useEffect(() => {
    if (roomState !== "ok") return;
    if (needsRefine && !room?.matchedSubcuisineId && !skipRefine) return;
    if (locationStatus !== "idle") return;
    findNearby();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState, needsRefine, room?.matchedSubcuisineId, skipRefine, locationStatus]);

  // Dead-end fix: this page used to render its full reveal + "type a
  // restaurant name" form even when the room didn't exist or the user wasn't
  // a participant of it (fetchRoomByCode() is RLS-guarded and returns null
  // for both). Continuing from there just bounced off the dish page's own
  // redirect with no explanation. Say so, and offer a way out.
  if (roomState === "loading") {
    return (
      <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="font-body text-sm text-muted-foreground">Checking what your group decided...</p>
      </div>
    );
  }

  if (roomState === "missing") {
    return (
      <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-headline">This room isn't available</h1>
        <p className="font-body text-muted-foreground max-w-md">
          Room {roomCode} either no longer exists or you're not a member of it any more. Head back and join
          or host a room to keep swiping.
        </p>
        <Button asChild className="rounded-2xl h-11 px-8">
          <a href="/rooms">Back to rooms</a>
        </Button>
      </div>
    );
  }

  // An unrecognised slug is never rendered as a decision. Saying "that isn't
  // a cuisine we know" is the honest answer; echoing it back as "You all want
  // <arbitrary text>!" is not.
  if (roomState === "bad-slug") {
    return (
      <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-headline">That's not a cuisine we recognise</h1>
        <p className="font-body text-muted-foreground max-w-md">
          This link points at something Food Swipe never matched on. Head back to your room to see what
          your group actually decided.
        </p>
        <Button asChild className="rounded-2xl h-11 px-8">
          <a href={`/swipe?room=${roomCode}`}>Back to the room</a>
        </Button>
      </div>
    );
  }

  // The room exists and we can read it, but it has NOT agreed on this cuisine.
  // Either nobody has matched yet, or they matched on something else -- both
  // get an honest answer plus a way to the real state, never a fabricated
  // celebration.
  if (roomState === "no-match") {
    const matchedElsewhere = room?.status === "matched" && room.matchedCuisineId;
    return (
      <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-headline">
          {matchedElsewhere ? "Your group picked something else" : "No decision yet"}
        </h1>
        <p className="font-body text-muted-foreground max-w-md">
          {matchedElsewhere
            ? `Room ${roomCode} agreed on ${titleCase(
                String(room?.matchedCuisineId).replace(/^ai-/, "").replace(/-/g, " ")
              )}, not ${cuisineName}. This link is out of date.`
            : `Room ${roomCode} hasn't agreed on ${cuisineName} -- everyone still has to swipe right on the same cuisine before it's decided.`}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {matchedElsewhere && (
            <Button asChild className="rounded-2xl h-11 px-8">
              <a href={`/match/${room?.matchedCuisineId}?room=${roomCode}`}>See what they picked</a>
            </Button>
          )}
          <Button asChild variant={matchedElsewhere ? "outline" : "default"} className="rounded-2xl h-11 px-8">
            <a href={`/swipe?room=${roomCode}`}>Back to swiping</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 pb-[140px] lg:pb-12 pt-12">
      {/*
        The signature celebration moment: the one deliberately bold, bounded
        dark takeover in an otherwise light/bright app. Design system v2
        folds this into the everyday ink/terracotta/gold palette instead of a
        separate void scope (design-language-v2.md, rationale.md #9) -- ink
        IS the celebration ground now, no indirection needed. Staggered
        entrance, not a simultaneous fade: backdrop first, then the heart
        badge (glow baked into its own pop-in), then heading, then subtext,
        each via --stagger-delay on the same two keyframe classes.
      */}
      <div className="relative overflow-hidden rounded-[var(--fs-r-xl)] bg-[var(--fs-ink)] px-6 py-12 sm:py-16 text-center mb-12 animate-celebration-backdrop">
        <div
          className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-b from-[var(--fs-terracotta-lift)] to-[var(--fs-terracotta-deep)] mb-4 animate-celebration-heart"
          style={{ "--stagger-delay": "0.15s" } as React.CSSProperties}
        >
          <Heart className="w-10 h-10 text-[var(--fs-on-ink)] fill-current" />
        </div>
        <p
          className="font-display text-[length:var(--fs-t-label)] font-bold uppercase tracking-[var(--fs-tracking-eyebrow)] text-[var(--fs-gold)] animate-celebration-rise"
          style={{ "--stagger-delay": "0.3s" } as React.CSSProperties}
        >
          Unanimous
        </p>
        <h1
          className="mt-2 font-display text-4xl md:text-5xl font-extrabold uppercase tracking-[-.03em] text-[var(--fs-on-ink)] animate-celebration-rise"
          style={{ "--stagger-delay": "0.35s" } as React.CSSProperties}
        >
          {mealTimeHeading()}
        </h1>
        <p
          className="text-2xl mt-2 text-[var(--fs-on-dark-2)] animate-celebration-rise"
          style={{ "--stagger-delay": "0.5s" } as React.CSSProperties}
        >
          You all want{" "}
          <span className="font-headline font-semibold text-[var(--fs-gold)]">{cuisineName}</span> {emoji}!
        </p>
        {room && (
          <p
            className="text-sm text-[var(--fs-on-dark-4)] mt-1 font-body animate-celebration-rise"
            style={{ "--stagger-delay": "0.65s" } as React.CSSProperties}
          >
            Room {room.code} &middot; {room.status === "matched" ? "Unanimous match" : "Match in progress"}
          </p>
        )}
      </div>

      {/*
        Refine layer gate (0017_indian_subcuisines.sql): a cuisine with real
        internal breadth gets one more swipe before restaurant discovery.
        Bypassed once matched_subcuisine_id is set (server verdict, applies
        to the whole room) OR once this tab's own ?skipRefine=1 bypass is
        present (personal, not synced -- see the skipRefine state comment).
      */}
      {needsRefine && !room?.matchedSubcuisineId && !skipRefine ? (
        <div className="rounded-2xl border-2 border-primary/30 bg-card/60 backdrop-blur-md p-8 text-center max-w-md mx-auto">
          <p className="font-body text-muted-foreground mb-6">
            India's got a lot of ground to cover. Swipe on the regional styles your group is up for, and
            we'll find you real spots for exactly that.
          </p>
          <Button asChild className="h-12 rounded-2xl px-8">
            <a href={`/match/${cuisineId}/refine?room=${roomCode}`}>Let's narrow it down</a>
          </Button>
          <div className="mt-3">
            <a
              href={`/match/${cuisineId}?room=${roomCode}&skipRefine=1`}
              className="font-body text-xs text-muted-foreground hover:text-foreground underline"
            >
              Skip -- just show me {cuisineName} restaurants
            </a>
          </div>
        </div>
      ) : (
        <>
      <div className="mb-8">
        <h2 className="text-2xl md:text-3xl font-headline">
          Here are some great{" "}
          <span className="capitalize">{subcuisineName ?? cuisineName}</span> spots nearby:
        </h2>
        {subcuisineName && (
          <p className="font-body text-sm text-muted-foreground mt-1">
            Narrowed down from {cuisineName} to {subcuisineName} by your group.
          </p>
        )}
      </div>

      {/*
        Restaurant discovery. Geolocation is requested on an explicit tap, not
        on mount -- a permission prompt the user didn't ask for is the fastest
        way to get it denied permanently, and a denial here is unrecoverable
        without digging through browser settings.

        Sponsored placements are merged in AFTER the organic results return
        and only ever for an already-matched cuisine. See src/lib/sponsored.ts:
        paid placement must never be able to influence what a group agrees on,
        only which restaurants surface once they've already agreed.
      */}
      {locationStatus === "idle" && (
        <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card/40 p-8 text-center mb-8">
          <Utensils className="h-8 w-8 text-primary mx-auto mb-3" />
          <p className="text-muted-foreground font-body mb-4">
            Find {cuisineName} places near you, or type a restaurant in yourself.
          </p>
          <Button onClick={findNearby} className="h-11 rounded-2xl">
            <MapPin className="h-4 w-4" />
            Find restaurants near me
          </Button>
        </div>
      )}

      {locationStatus === "locating" && (
        <div className="rounded-2xl border border-primary/20 bg-card/40 p-8 text-center mb-8">
          <Loader2 className="h-6 w-6 text-primary mx-auto mb-3 animate-spin" />
          <p className="text-muted-foreground font-body text-sm">
            {places.length === 0 ? "Getting your location..." : "Looking for places..."}
          </p>
        </div>
      )}

      {locationStatus === "error" && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center mb-8">
          <p className="text-foreground font-body text-sm">{locationError}</p>
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            <Button variant="outline" onClick={findNearby} className="rounded-2xl">
              Try again
            </Button>
          </div>
          <p className="text-muted-foreground font-body text-xs mt-3">
            You can still type a restaurant name below.
          </p>
        </div>
      )}

      {locationStatus === "done" && (
        <div className="mb-8">
          {resultSource === "mock" && (
            <p className="text-muted-foreground font-body text-xs mb-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
              We couldn't reach the restaurant service, so these are example places, not real nearby
              results. Type a restaurant name below if you already have somewhere in mind.
            </p>
          )}
          {/*
            Full-bleed photo cards (user feedback: the old white cards with a
            cropped 28px photo strip felt "dry, no images, no excitement").
            Real Google Places photo first (place.photoUrl, proxied through
            /api/place-photo -- see find-restaurants.ts) since Google's own
            listing for THIS exact restaurant is more honest than a generic
            cuisine shot; getCuisineImageVariant only backs it up when Google
            has no photo on file, never claimed as the restaurant's own.
            Smaller/denser grid (was 3 cols of tall cards, now up to 4 of
            short ones) and every field lives on the photo behind a scrim,
            same full-bleed-photography language as the swipe deck itself
            rather than a flat white card bolted onto the celebration.
          */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {places.map((place, i) => {
              const sponsored = "isSponsored" in place;
              const address = sponsored ? place.address : place.vicinity;
              // Only a real Restaurant carries a phone -- an advertiser's
              // sponsored placement (0015_monetization.sql) has never asked
              // for one, so it stays absent there rather than guessed.
              const phone = sponsored ? null : place.phone;
              // The client-side `website` field already collapses to
              // `real site ?? Google Maps link` at the API layer (see
              // find-restaurants.ts) -- this just tells the two apart for
              // honest labelling below and for what gets carried forward to
              // the order screen.
              const isMapsFallback = !sponsored && place.website?.includes("maps.google");
              const realPhoto = sponsored ? null : place.photoUrl;
              const cardImage = realPhoto ?? getCuisineImageVariant(cuisineId, place.name);
              return (
                <div
                  key={`${place.name}-${i}`}
                  className="group relative aspect-[3/4] overflow-hidden rounded-[var(--fs-r-xl)] bg-[var(--fs-ink)] shadow-[var(--fs-e-1)] animate-page-load"
                  style={{ "--stagger-delay": `${Math.min(i, 8) * 0.05}s` } as React.CSSProperties}
                >
                  {cardImage ? (
                    <img
                      src={cardImage}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <UtensilsCrossed className="h-8 w-8 text-[var(--fs-on-ink)]/60" aria-hidden="true" />
                    </div>
                  )}
                  <div className="absolute inset-0" style={{ background: "var(--fs-scrim-card)" }} />

                  {sponsored && (
                    <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1">
                      <Badge variant="glass">{place.sponsorshipLabel}</Badge>
                      {/* Disclosure, not decoration -- see delivery-options.tsx's affiliate note for the same rule: a paid placement must always say who paid. */}
                      {place.advertiserName && (
                        <span className="rounded-[var(--fs-r-pill)] bg-[var(--fs-glass)] px-2 py-0.5 text-[10px] text-[var(--fs-on-dark-3)] backdrop-blur-[6px]">
                          Paid by {place.advertiserName}
                        </span>
                      )}
                    </div>
                  )}
                  {!sponsored && (place.rating !== null || place.priceLevel !== null) && (
                    <div className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-[var(--fs-r-pill)] bg-[var(--fs-glass)] px-2 py-1 text-[11px] font-body backdrop-blur-[6px]">
                      {place.rating !== null && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-[var(--fs-on-ink)]">
                          <Star className="h-3 w-3 fill-[var(--fs-gold)] text-[var(--fs-gold)]" />
                          {place.rating.toFixed(1)}
                        </span>
                      )}
                      {priceLevelToSymbol(place.priceLevel) && (
                        <span className="text-[var(--fs-on-dark-3)]">{priceLevelToSymbol(place.priceLevel)}</span>
                      )}
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 p-3 text-[var(--fs-on-ink)]">
                    <h3 className="font-headline text-sm font-semibold leading-tight line-clamp-1">{place.name}</h3>
                    {address && <p className="mt-0.5 text-[11px] text-[var(--fs-on-dark-3)] line-clamp-1">{address}</p>}
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => goToDishes(place.name, address, place.website, phone)}
                        className="flex-1 rounded-[var(--fs-r-pill)] bg-[var(--fs-on-ink)] px-2.5 py-1.5 text-center font-body text-[11px] font-semibold text-[var(--fs-text)] transition-shadow hover:shadow-[var(--fs-e-primary)]"
                      >
                        Swipe dishes here
                      </button>
                      {place.website && (
                        <a
                          href={place.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={isMapsFallback ? "View on Google Maps" : "View details"}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--fs-glass)] backdrop-blur-[6px] hover:bg-[var(--fs-glass-line)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                      {phone && (
                        <a
                          href={`tel:${phone}`}
                          aria-label={`Call ${phone}`}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--fs-glass)] backdrop-blur-[6px] hover:bg-[var(--fs-glass-line)]"
                        >
                          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {places.length === 0 && (
            <p className="text-muted-foreground font-body text-sm text-center">
              No {cuisineName} places found nearby. Try typing a restaurant name below.
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleContinueToDishes} className="max-w-sm mx-auto flex flex-col gap-3">
        <label htmlFor="restaurantName" className="font-body text-xs text-muted-foreground uppercase font-bold tracking-wider text-center">
          Or enter a restaurant name
        </label>
        <Input
          id="restaurantName"
          placeholder="e.g. Golden Dragon"
          value={restaurantNameInput}
          onChange={(e) => setRestaurantNameInput(e.target.value)}
          className="h-12 rounded-2xl text-center"
        />
        <Button type="submit" disabled={restaurantNameInput.trim().length === 0} className="h-12 rounded-2xl">
          Swipe dishes together at this restaurant
        </Button>
        {/*
          Dead-end fix: this page had no backward action at all -- the only
          control was a form you couldn't submit until you'd typed a
          restaurant name, so a user with no restaurant in mind was stuck.
        */}
        <Button asChild variant="link" className="text-muted-foreground">
          <a href={`/swipe?room=${roomCode}`}>Back to the room</a>
        </Button>
      </form>
        </>
      )}
    </div>
  );
}
