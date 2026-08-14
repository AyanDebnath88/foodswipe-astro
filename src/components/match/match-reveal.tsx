"use client";

// Phase 2, Task 8: match reveal page. Ported from the reference Next.js
// project's src/app/(app)/match/[cuisine]/page.tsx -- but ONLY the reveal
// moment (heading, "You all want X!" copy, meal-time heading logic). The
// restaurant-fetching logic (useLocation + findRestaurants AI flow in the
// reference) is explicitly out of scope for this phase per the task brief:
// that's the teammate's Phase 3 territory (their /api/find-restaurants.ts
// contract), even though it has since landed -- wiring the reveal page up
// to it is left for them to do, not assumed here. The section below is a
// clearly-marked stub.
import React, { useEffect, useState } from "react";
import { Heart, Sparkles, Utensils, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchRoomByCode, type RoomState } from "@/lib/rooms";
import { CUISINE_EMOJI } from "@/lib/cuisines";

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
  const emoji = CUISINE_EMOJI[cuisineId] ?? "🍽️";
  const cuisineName = titleCase(cuisineId.replace(/^ai-/, "").replace(/-/g, " "));

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

  const handleContinueToDishes = (e: React.FormEvent) => {
    e.preventDefault();
    if (restaurantNameInput.trim().length === 0) return;
    window.location.href = `/match/${cuisineId}/${encodeURIComponent(restaurantNameInput.trim())}?room=${roomCode}`;
  };

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
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 pb-12 pt-12">
      <div className="text-center mb-12">
        <div className="inline-block bg-primary/20 p-4 rounded-full mb-4">
          <Heart className="w-12 h-12 text-primary fill-current" />
        </div>
        <h1 className="text-4xl md:text-5xl font-headline">{mealTimeHeading()}</h1>
        <p className="text-2xl mt-2 text-muted-foreground">
          You all want <span className="font-bold text-primary">{cuisineName}</span> {emoji}!
        </p>
        {room && (
          <p className="text-sm text-muted-foreground mt-1 font-body">
            Room {room.code} &middot; {room.status === "matched" ? "Unanimous match" : "Match in progress"}
          </p>
        )}
      </div>

      <div className="mb-8">
        <h2 className="text-2xl md:text-3xl font-headline">
          Here are some great <span className="capitalize">{cuisineName}</span> spots nearby:
        </h2>
      </div>

      {/*
        STUB (Task 8): restaurant discovery is Phase 3 territory
        (POST /api/find-restaurants + geolocation UX from the reference
        project's location-handler.tsx). This phase intentionally does not
        fetch or render real restaurant results -- only a placeholder plus
        a manual "type a restaurant name" bridge so Task 7's dish-level
        room sync is reachable and testable ahead of that wiring landing.
      */}
      <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card/40 p-8 text-center mb-8">
        <Utensils className="h-8 w-8 text-primary mx-auto mb-3" />
        <p className="text-muted-foreground font-body">
          Real nearby restaurant results land here in Phase 3 (restaurant discovery + AI). For now, pick a
          restaurant manually to try the group dish-swiping flow below.
        </p>
        <Sparkles className="h-4 w-4 text-primary/60 mx-auto mt-3" />
      </div>

      <form onSubmit={handleContinueToDishes} className="max-w-sm mx-auto flex flex-col gap-3">
        <label htmlFor="restaurantName" className="font-body text-xs text-muted-foreground uppercase font-bold tracking-wider text-center">
          Restaurant Name (temporary manual entry)
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
    </div>
  );
}
