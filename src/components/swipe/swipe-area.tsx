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
import { X, Heart, Sparkles, Loader2 } from "lucide-react";
import { fetchCuisines, syntheticCuisineFromName, type Cuisine } from "@/lib/cuisines";
import { filterCuisinesByDietary, unionDietaryRestrictions } from "@/lib/dietary";
import { suggestCuisines } from "@/lib/ai-suggestions";
import { fetchSwipesForSession, submitSwipe, type SwipeRow } from "@/lib/swipes";
import {
  fetchRoomByCode,
  fetchRoomParticipants,
  subscribeToRoom,
  clearActiveRoom,
  type Participant,
  type RoomState,
} from "@/lib/rooms";
import { getCurrentUser } from "@/lib/guest-auth";

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
        window.location.href = "/rooms";
        return;
      }
      if (cancelled) return;
      setUserId(user.id);

      const roomState = await fetchRoomByCode(roomCode);
      if (!roomState) {
        toast({ variant: "destructive", title: "Room not found", description: `Room "${roomCode}" no longer exists.` });
        window.location.href = "/rooms";
        return;
      }
      if (cancelled) return;
      setRoom(roomState);

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
          clearActiveRoom();
          toast({
            title: "It's a Match!",
            description: `Everyone in Room ${updated.code} agreed! Redirecting...`,
          });
          window.location.href = `/match/${updated.matchedCuisineId}?room=${updated.code}`;
        }
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

  const handleAiFallback = useCallback(
    async (auto: boolean) => {
      if (!room || aiLoading) return;
      if (auto) fallbackAttemptsRef.current += 1;
      setAiLoading(true);
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

        const suggestions = await suggestCuisines(liked, disliked, 3);
        if (suggestions.length === 0) {
          if (!auto) {
            toast({
              title: "No new suggestions",
              description: "Couldn't get AI suggestions right now -- try again in a bit.",
            });
          }
          return;
        }

        const knownIds = new Set(cuisinesById.keys());
        const newOnes: Cuisine[] = [];
        for (const name of suggestions) {
          const lower = name.toLowerCase();
          const catalogMatch = allCuisines.find((c) => c.name.toLowerCase() === lower);
          const candidate = catalogMatch ?? syntheticCuisineFromName(name);
          if (knownIds.has(candidate.id)) continue;
          // Real catalog cuisines still have to pass the dietary filter;
          // synthetic (fully novel) suggestions have no dietary_tags data
          // to check against, so they're shown unfiltered -- see
          // syntheticCuisineFromName()'s comment in src/lib/cuisines.ts.
          if (catalogMatch && filterCuisinesByDietary([catalogMatch], requiredRestrictions).length === 0) {
            continue;
          }
          knownIds.add(candidate.id);
          newOnes.push(candidate);
        }

        if (newOnes.length > 0) {
          setExtraCuisines((prev) => [...prev, ...newOnes]);
          setLocalDeck((prev) => [...prev, ...newOnes]);
          toast({
            title: "Stuck? Here's some inspiration!",
            description: `Added ${newOnes.map((c) => c.name).join(", ")} to the deck.`,
          });
        } else if (!auto) {
          toast({ title: "No new suggestions", description: "The AI didn't have anything new to add." });
        }
      } catch (err) {
        console.error("AI fallback failed:", err);
        if (!auto) {
          toast({ variant: "destructive", title: "Error", description: "Could not fetch AI suggestions." });
        }
      } finally {
        setAiLoading(false);
      }
    },
    [room, aiLoading, roomSwipes, cuisinesById, allCuisines, requiredRestrictions, toast]
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
      toast({ variant: "destructive", title: "Swipe Error", description: "Failed to record your vote." });
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

  if (loadingRoom) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground font-body">Preparing your card deck...</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm flex flex-col items-center">
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
                : "You've swiped through all available cuisines. No match yet -- try more suggestions."}
            </p>
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
