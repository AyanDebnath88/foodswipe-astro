"use client";

// Phase 2, Tasks 3/4/5/6 (cuisine swipe deck, wired to Realtime instead of
// the reference app's 2-second poll; server-side match detection via
// supabase/migrations/0006_match_detection.sql; automatic + manual AI
// match-fallback). Ported from the reference Next.js project's
// src/components/swipe/swipe-area.tsx, but the room-mode branch is now the
// *only* mode -- solo swiping (no room) is out of scope for this phase (see
// build-log SKILL.md's Phase 4 "solo mode" line item) and /swipe now always
// requires ?room=CODE.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CuisineCard } from "./cuisine-card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { X, Heart, Sparkles, Loader2, Users, DoorClosed } from "lucide-react";
import { fetchCuisines, resolveSuggestedCuisines, type Cuisine } from "@/lib/cuisines";
import { filterCuisinesByDietary, unionDietaryRestrictions } from "@/lib/dietary";
import { suggestCuisines } from "@/lib/ai-suggestions";
import { fetchSwipesForSession, submitSwipe, type SwipeRow } from "@/lib/swipes";
import {
  fetchRoomByCode,
  fetchRoomParticipants,
  subscribeToRoom,
  clearActiveRoomIfMatches,
  saveActiveRoom,
  type Participant,
  type RoomState,
} from "@/lib/rooms";
import { getCurrentUser } from "@/lib/guest-auth";
import { errorMessage } from "@/lib/errors";
import { currentPathForRedirect, redirectWithNotice } from "@/lib/notices";

// Reasonable-threshold decision (Task 5): the deck auto-refills with AI
// suggestions the moment it empties with no match. To avoid hammering
// /api/suggest-cuisines forever in a room whose members simply reject
// everything (including the AI's picks), auto-refill is capped at 2 rounds
// per room; after that the manual "Stuck? Get AI suggestions" button (still
// present per the task) is the only way to pull more cards.
const MAX_AUTO_FALLBACK_ATTEMPTS = 2;

interface SwipeAreaProps {
  roomCode: string;
}

function buildRoomSwipeMap(rows: SwipeRow[]): Map<string, Map<string, "left" | "right">> {
  const map = new Map<string, Map<string, "left" | "right">>();
  for (const row of rows) {
    if (!map.has(row.cuisineId)) map.set(row.cuisineId, new Map());
    map.get(row.cuisineId)!.set(row.userId, row.direction);
  }
  return map;
}

export function SwipeArea({ roomCode }: SwipeAreaProps) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [allCuisines, setAllCuisines] = useState<Cuisine[]>([]);
  const [extraCuisines, setExtraCuisines] = useState<Cuisine[]>([]);
  const [localDeck, setLocalDeck] = useState<Cuisine[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [roomSwipes, setRoomSwipes] = useState<Map<string, Map<string, "left" | "right">>>(new Map());
  const [aiLoading, setAiLoading] = useState(false);
  // Set when the room is deleted out from under us (Realtime DELETE). Until
  // this existed the deck just kept rendering a room that no longer existed.
  const [roomClosed, setRoomClosed] = useState(false);
  // Last honest explanation of why an AI refill added nothing, shown in the
  // empty-deck state so "no new cards" never looks like a silent failure.
  const [suggestionNote, setSuggestionNote] = useState<string | null>(null);

  const fallbackAttemptsRef = useRef(0);
  const initializedRef = useRef(false);

  const currentCuisine = localDeck[0] ?? null;

  const cuisinesById = useMemo(() => {
    const map = new Map<string, Cuisine>();
    for (const c of [...allCuisines, ...extraCuisines]) map.set(c.id, c);
    return map;
  }, [allCuisines, extraCuisines]);

  const requiredRestrictions = useMemo(() => unionDietaryRestrictions(participants), [participants]);

  const refreshParticipants = useCallback(async (roomId: string) => {
    setParticipants(await fetchRoomParticipants(roomId));
  }, []);

  const refreshRoomSwipes = useCallback(async (roomId: string) => {
    const rows = await fetchSwipesForSession(roomId);
    setRoomSwipes(buildRoomSwipeMap(rows));
  }, []);

  // ---------------------------------------------------------------------
  // Initial load: resolve user + room, fetch catalog/participants/swipes,
  // build the starting deck (dietary-filtered, minus cuisines this user
  // already swiped on in a previous visit to this room).
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        // Send them to sign in, carrying BOTH the reason and the destination:
        // this used to drop to /rooms, which then bounced to /login with the
        // room code lost, so an invited friend following a swipe link could
        // never actually reach the room they were invited to.
        redirectWithNotice("/login", "sign-in-required", {
          room: roomCode,
          redirect: currentPathForRedirect(),
        });
        return;
      }
      if (cancelled) return;
      setUserId(user.id);

      const roomState = await fetchRoomByCode(roomCode);
      if (!roomState) {
        // A toast here was destroyed by the navigation on the next line and
        // the user never saw it -- the reason now rides along in the URL.
        redirectWithNotice("/rooms", "not-a-member", { room: roomCode });
        return;
      }
      if (cancelled) return;
      setRoom(roomState);
      // Keep the room resolvable from anywhere in the app for as long as the
      // user is really in it (the header's room chip, "Back to the room").
      saveActiveRoom({ id: roomState.id, code: roomState.code });

      if (roomState.status === "matched" && roomState.matchedCuisineId) {
        window.location.href = `/match/${roomState.matchedCuisineId}?room=${roomState.code}`;
        return;
      }

      const [cuisines, roomParticipants, swipeRows] = await Promise.all([
        fetchCuisines(),
        fetchRoomParticipants(roomState.id),
        fetchSwipesForSession(roomState.id),
      ]);
      if (cancelled) return;

      setAllCuisines(cuisines);
      setParticipants(roomParticipants);
      setRoomSwipes(buildRoomSwipeMap(swipeRows));

      const mySwipedIds = new Set(swipeRows.filter((r) => r.userId === user.id).map((r) => r.cuisineId));
      const restrictions = unionDietaryRestrictions(roomParticipants);
      const startingDeck = filterCuisinesByDietary(cuisines, restrictions).filter((c) => !mySwipedIds.has(c.id));
      setLocalDeck(startingDeck);
      setLoadingRoom(false);
      initializedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ---------------------------------------------------------------------
  // Realtime (Task 3): react to session/participants/swipes changes for
  // this room instead of polling.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!room) return;
    const unsubscribe = subscribeToRoom(room.id, {
      onSessionChange: (updated) => {
        setRoom(updated);
        if (updated.status === "matched" && updated.matchedCuisineId) {
          // NOT clearActiveRoom(). Matching is the happy path, and wiping the
          // active-room cache at the exact moment the group succeeds is what
          // made "Back to the room" from the match page land on an empty
          // dashboard. The room is still live -- the group still has to pick a
          // restaurant and swipe dishes together -- so it must stay resolvable.
          saveActiveRoom({ id: updated.id, code: updated.code });
          toast({
            title: "It's a Match!",
            description: `Everyone in Room ${updated.code} agreed! Redirecting...`,
          });
          window.location.href = `/match/${updated.matchedCuisineId}?room=${updated.code}`;
        }
      },
      onSessionDeleted: () => {
        // The host closed the room. The cached entry now points at a row that
        // no longer exists, so drop it -- but only if it's THIS room.
        clearActiveRoomIfMatches(room.id);
        setRoomClosed(true);
      },
      onParticipantsChange: () => refreshParticipants(room.id),
      onSwipeChange: () => refreshRoomSwipes(room.id),
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  // Task 2: "recompute as participants join" -- when the required-
  // restrictions union changes, drop any remaining deck cards that no
  // longer qualify. Never adds cards back (a card removed by a stricter
  // union shouldn't reappear just because someone left).
  useEffect(() => {
    setLocalDeck((prev) => filterCuisinesByDietary(prev, requiredRestrictions));
  }, [requiredRestrictions]);

  // The vetted candidate set for THIS room: catalog cuisines that satisfy every
  // participant's restrictions. This is the only pool an AI suggestion may draw
  // from when anyone in the room has a restriction.
  const vettedCuisines = useMemo(
    () => filterCuisinesByDietary(allCuisines, requiredRestrictions),
    [allCuisines, requiredRestrictions]
  );

  const handleAiFallback = useCallback(
    async (auto: boolean) => {
      if (!room || aiLoading) return;
      if (auto) fallbackAttemptsRef.current += 1;
      setAiLoading(true);
      setSuggestionNote(null);
      try {
        const liked: string[] = [];
        const disliked: string[] = [];
        for (const [cuisineId, votes] of roomSwipes.entries()) {
          const name = cuisinesById.get(cuisineId)?.name;
          if (!name) continue;
          const hasRight = [...votes.values()].some((d) => d === "right");
          if (hasRight) liked.push(name);
          else disliked.push(name);
        }

        const hasRestrictions = requiredRestrictions.length > 0;

        // Gate 1 (quality): tell the endpoint which names are even eligible, so
        // the model chooses from the room's vetted set instead of inventing
        // something nobody checked. Omitted entirely for an unrestricted room,
        // which keeps the original open-ended behaviour and the request
        // backward-compatible.
        const allowedNames = hasRestrictions ? vettedCuisines.map((c) => c.name) : undefined;

        // A restricted room whose vetted pool is empty has nothing safe to ask
        // for. Say so instead of spending a Gemini call to be told nothing.
        if (hasRestrictions && (allowedNames?.length ?? 0) === 0) {
          const note =
            "No cuisine in our catalog satisfies everyone's dietary needs, so there's nothing safe left to suggest. Try widening the restrictions, or split into smaller groups.";
          setSuggestionNote(note);
          if (!auto) toast({ title: "No safe options left", description: note });
          return;
        }

        const suggestions = await suggestCuisines(liked, disliked, 3, allowedNames);
        if (suggestions.length === 0) {
          const note = hasRestrictions
            ? "No safe options left -- everything that fits the group's dietary needs is already in the deck. Try widening the restrictions, or pick a restaurant directly."
            : "Couldn't get AI suggestions right now -- try again in a bit.";
          setSuggestionNote(note);
          if (!auto) toast({ title: "No new suggestions", description: note });
          return;
        }

        // Gate 2 (safety): re-check every returned name locally. /api/suggest-
        // cuisines is unauthenticated and its whitelist lives on the far side of
        // a network call, so the deck does not take its word for it. Names that
        // don't resolve to a vetted catalog row are dropped in a restricted
        // room -- this is the fix for the bug where "Get AI Suggestions" added
        // an unvetted synthetic card ("Chinese") to a halal + gluten-free room
        // and the room then matched on it.
        const { accepted, rejectedUnvetted, rejectedDietary } = resolveSuggestedCuisines(
          suggestions,
          allCuisines,
          requiredRestrictions,
          new Set(cuisinesById.keys())
        );

        if (accepted.length > 0) {
          setExtraCuisines((prev) => [...prev, ...accepted]);
          setLocalDeck((prev) => [...prev, ...accepted]);
          toast({
            title: "Stuck? Here's some inspiration!",
            description: `Added ${accepted.map((c) => c.name).join(", ")} to the deck.`,
          });
          return;
        }

        const dropped = rejectedUnvetted.length + rejectedDietary.length;
        const note =
          dropped > 0
            ? `We left out ${[...rejectedUnvetted, ...rejectedDietary].join(", ")} because ${
                rejectedUnvetted.length > 0
                  ? "we can't confirm it meets everyone's dietary needs"
                  : "it conflicts with someone's dietary needs"
              }. No safe options left -- try widening the restrictions, or pick a restaurant directly.`
            : "The AI didn't have anything new to add.";
        setSuggestionNote(note);
        if (!auto) {
          toast({ title: dropped > 0 ? "No safe options left" : "No new suggestions", description: note });
        }
      } catch (err) {
        console.error("AI fallback failed:", err);
        const message = errorMessage(err, "Could not fetch AI suggestions.");
        setSuggestionNote(message);
        if (!auto) {
          toast({ variant: "destructive", title: "Error", description: message });
        }
      } finally {
        setAiLoading(false);
      }
    },
    [room, aiLoading, roomSwipes, cuisinesById, allCuisines, vettedCuisines, requiredRestrictions, toast]
  );

  // Task 5: auto-trigger once the deck empties with no match yet.
  useEffect(() => {
    if (!initializedRef.current || !room) return;
    if (localDeck.length > 0) return;
    // 'dish_matched' used to be checked here too. It no longer exists as an
    // app-level status: a dish match is now a row in dish_matches and never
    // touches the room's status (see src/lib/rooms.ts's RoomStatus comment).
    if (room.status === "matched") return;
    if (aiLoading) return;
    if (fallbackAttemptsRef.current >= MAX_AUTO_FALLBACK_ATTEMPTS) return;
    void handleAiFallback(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localDeck.length, room?.status]);

  const handleSwipe = async (direction: "left" | "right") => {
    if (!currentCuisine || !room || !userId) return;
    try {
      await submitSwipe(room.id, userId, currentCuisine.id, direction);
      // Optimistically fold our own vote into the local progress map so the
      // "X of Y diners voted" line updates immediately without waiting for
      // the Realtime round trip.
      setRoomSwipes((prev) => {
        const next = new Map(prev);
        const votes = new Map(next.get(currentCuisine.id) ?? []);
        votes.set(userId, direction);
        next.set(currentCuisine.id, votes);
        return next;
      });
      if (direction === "right") {
        toast({
          title: "Craving Saved",
          description: `You voted YES on ${currentCuisine.name}. Waiting for the group...`,
        });
      }
    } catch (err) {
      console.error("Swipe error:", err);
      toast({
        variant: "destructive",
        title: "Swipe Error",
        description: errorMessage(err, "Failed to record your vote."),
      });
      return;
    }

    // Match, if this vote completes it, arrives via the Realtime
    // swipe_sessions subscription above -- this component never decides a
    // match itself (Task 4).
    setTimeout(() => {
      setLocalDeck((prev) => prev.slice(1));
    }, 500);
  };

  const votesOnCurrent = currentCuisine ? roomSwipes.get(currentCuisine.id)?.size ?? 0 : 0;
  // A match needs every current participant to swipe right, and the trigger
  // requires >= 2 of them (0009). One person can therefore swipe the entire
  // deck and never match, which the old empty-state copy papered over by
  // suggesting "more suggestions" -- advice that cannot work by construction.
  const isSolo = participants.length < 2;

  if (loadingRoom) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground font-body">Preparing your card deck...</p>
      </div>
    );
  }

  if (roomClosed) {
    return (
      <div className="w-full max-w-sm text-center p-8 bg-card rounded-2xl shadow-lg">
        <div className="mx-auto bg-destructive/15 p-3 rounded-full mb-3 w-fit">
          <DoorClosed className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-xl font-headline mb-2">This room was closed</h3>
        <p className="text-muted-foreground font-body text-sm mb-6">
          The host closed room {roomCode} while you were swiping, so this session has ended. Your votes here
          are gone with it -- start a new room, or join another one.
        </p>
        <Button asChild className="w-full h-11 rounded-2xl">
          <a href="/rooms">Back to rooms</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm flex flex-col items-center">
      {isSolo && (
        <div className="w-full mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
          <p className="font-body text-sm font-semibold text-foreground flex items-center justify-center gap-1.5">
            <Users className="h-4 w-4" />
            You're the only one here
          </p>
          <p className="font-body text-xs text-muted-foreground mt-1">
            A match needs at least two people to swipe right on the same cuisine, so nothing can match until
            someone else joins room{" "}
            <span className="font-bold text-foreground select-all">{roomCode}</span>. Keep swiping if you
            like -- your votes are saved and count the moment they arrive.
          </p>
        </div>
      )}

      <div className="relative w-full h-[500px] flex items-center justify-center">
        {localDeck.length > 0 ? (
          [...localDeck]
            .map((cuisine, index) => (
              <CuisineCard
                key={cuisine.id}
                cuisine={cuisine}
                onSwipe={handleSwipe}
                isActive={index === 0}
                zIndex={localDeck.length - index}
              />
            ))
            .reverse()
        ) : (
          <div className="text-center p-8 bg-card rounded-2xl shadow-lg">
            <h3 className="text-xl font-headline mb-2">
              {aiLoading ? "Getting fresh ideas..." : "That's all for now!"}
            </h3>
            <p className="text-muted-foreground mb-4">
              {aiLoading
                ? "Asking the AI for a few more cuisines everyone might like."
                : isSolo
                  ? // Telling a lone swiper to "try more suggestions" is advice
                    // that cannot succeed: the match trigger needs >= 2
                    // participants, so no number of extra cards will ever
                    // produce a match on their own.
                    "You've swiped everything. Nothing can match until someone else joins this room -- more cards won't change that."
                  : "You've swiped through all available cuisines. No match yet -- waiting on the rest of the group, or try a few more suggestions."}
            </p>
            {suggestionNote && !aiLoading && (
              <p className="text-muted-foreground/90 font-body text-xs mb-4 border-t pt-3">{suggestionNote}</p>
            )}
            <Button onClick={() => handleAiFallback(false)} disabled={aiLoading}>
              {aiLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Get AI Suggestions
            </Button>
            {/*
              Dead-end fix: an empty deck whose AI refills also come back
              empty used to leave this screen with exactly one button that
              did nothing. There must always be a way back to the room.
            */}
            <div className="mt-3">
              <Button asChild variant="link" className="text-muted-foreground">
                <a href="/rooms">Back to the room</a>
              </Button>
            </div>
          </div>
        )}
      </div>

      {localDeck.length > 0 && participants.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4 font-body">
          {votesOnCurrent} of {participants.length} diners have voted on this cuisine
        </p>
      )}

      {localDeck.length > 0 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <Button
            variant="outline"
            size="icon"
            className="w-16 h-16 rounded-full shadow-lg border-2 border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={() => document.getElementById("cuisine-swipe-left-btn")?.click()}
          >
            <X className="h-8 w-8" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="w-16 h-16 rounded-full shadow-lg border-2 border-primary/50 text-primary hover:bg-primary/10"
            onClick={() => document.getElementById("cuisine-swipe-right-btn")?.click()}
          >
            <Heart className="h-8 w-8" />
          </Button>
        </div>
      )}

      <div className="mt-8">
        <Button variant="link" onClick={() => handleAiFallback(false)} disabled={aiLoading}>
          <Sparkles className="mr-2 h-4 w-4" />
          Stuck? Get AI suggestions
        </Button>
      </div>
    </div>
  );
}
