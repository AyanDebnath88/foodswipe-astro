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
import { CuisineDishGuide } from "./cuisine-dish-guide";
import { Button, CtaArrow } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { X, Heart, Loader2, Users, DoorClosed } from "lucide-react";
import { fetchCuisines, type Cuisine } from "@/lib/cuisines";
import { filterCuisinesByDietary, unionDietaryRestrictions } from "@/lib/dietary";
import { shuffle } from "@/lib/utils";
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
  const [localDeck, setLocalDeck] = useState<Cuisine[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [roomSwipes, setRoomSwipes] = useState<Map<string, Map<string, "left" | "right">>>(new Map());
  // Set when the room is deleted out from under us (Realtime DELETE). Until
  // this existed the deck just kept rendering a room that no longer existed.
  const [roomClosed, setRoomClosed] = useState(false);

  const initializedRef = useRef(false);

  const currentCuisine = localDeck[0] ?? null;

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

      setParticipants(roomParticipants);
      setRoomSwipes(buildRoomSwipeMap(swipeRows));

      const mySwipedIds = new Set(swipeRows.filter((r) => r.userId === user.id).map((r) => r.cuisineId));
      const restrictions = unionDietaryRestrictions(roomParticipants);
      const startingDeck = filterCuisinesByDietary(cuisines, restrictions).filter((c) => !mySwipedIds.has(c.id));
      // Shuffled per user, per open -- every room member used to see the exact
      // same catalog order (alphabetical, from the DB query), so everyone's
      // first card was always Italian. Order is local-only and match
      // detection is keyed by cuisine id, not position, so this is purely
      // cosmetic and safe.
      setLocalDeck(shuffle(startingDeck));
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
      <div className="w-full max-w-sm text-center p-8 bg-card rounded-[var(--fs-r-xl)] shadow-[var(--fs-e-2)]">
        <div className="mx-auto bg-[var(--fs-destructive)]/15 p-3 rounded-full mb-3 w-fit">
          <DoorClosed className="h-8 w-8 text-[var(--fs-destructive)]" />
        </div>
        <h3 className="text-xl font-headline mb-2">This room was closed</h3>
        <p className="text-muted-foreground font-body text-sm mb-6">
          The host closed room {roomCode} while you were swiping, so this session has ended. Your votes here
          are gone with it -- start a new room, or join another one.
        </p>
        <Button asChild variant="cta">
          <a href="/rooms">
            <span>Back to rooms</span>
            <CtaArrow />
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center lg:max-w-[var(--fs-max-content)] lg:flex-row lg:items-start lg:justify-center lg:gap-10">
    <div className="flex w-full flex-col items-center lg:sticky lg:top-[calc(var(--fs-appbar-h)+24px)] lg:w-[var(--fs-card-max)] lg:shrink-0">
      {isSolo && (
        <div className="w-full mb-4 rounded-[var(--fs-r-md)] border border-[var(--fs-gold-line)] bg-[var(--fs-gold-tint)] p-4 text-center">
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

      <div className="relative w-full h-[54vh] min-h-[340px] max-h-[500px] flex items-center justify-center">
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
          <div className="text-center p-8 bg-card rounded-[var(--fs-r-xl)] shadow-[var(--fs-e-2)]">
            <h3 className="text-xl font-headline mb-2">That's all for now!</h3>
            <p className="text-muted-foreground mb-4">
              {isSolo
                ? // Telling a lone swiper to "keep waiting" is honest, not
                  // advice that can't succeed: the match trigger needs >= 2
                  // participants regardless of deck size.
                  "You've swiped everything. Nothing can match until someone else joins this room."
                : "You've swiped through all available cuisines. No match yet -- waiting on the rest of the group."}
            </p>
            {/*
              Dead-end fix: an empty deck used to leave this screen with no
              way out. There must always be a way back to the room.
            */}
            <Button asChild variant="link" className="text-muted-foreground">
              <a href="/rooms">Back to the room</a>
            </Button>
          </div>
        )}
      </div>

      {localDeck.length > 0 && participants.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4 font-body">
          {votesOnCurrent} of {participants.length} diners have voted on this cuisine
        </p>
      )}

      {localDeck.length > 0 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <Button
            variant="outline"
            size="icon"
            aria-label="Pass on this cuisine"
            className="rounded-full shadow-[var(--fs-e-1)] border-2 border-[var(--fs-line-strong)] text-[var(--fs-text-3)] hover:bg-[var(--fs-cream-tint)]"
            style={{ width: "var(--fs-swipe-pass)", height: "var(--fs-swipe-pass)" }}
            onClick={() => document.getElementById("cuisine-swipe-left-btn")?.click()}
          >
            <X className="h-7 w-7" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Like this cuisine"
            className="rounded-full shadow-[var(--fs-e-primary)] border-2 border-[var(--fs-terracotta)] text-[var(--fs-terracotta)] hover:bg-[var(--fs-terracotta)]/10"
            style={{ width: "var(--fs-swipe-like)", height: "var(--fs-swipe-like)" }}
            onClick={() => document.getElementById("cuisine-swipe-right-btn")?.click()}
          >
            <Heart className="h-8 w-8" />
          </Button>
        </div>
      )}
    </div>

      {/*
        Dish glossary for the currently active card -- user feedback: nobody
        swiping past "Vietnamese" knows what pho or banh mi actually are.
        Keyed off currentCuisine so it updates as the deck advances. Desktop:
        a right-side rail next to the sticky card (user feedback: stacking it
        below made the desktop page feel like an afterthought scroll). Mobile:
        unchanged vertical flow below the deck.
      */}
      {currentCuisine && (
        <div className="mt-10 w-full lg:mt-0 lg:max-w-2xl lg:flex-1">
          <CuisineDishGuide
            cuisineId={currentCuisine.id}
            cuisineName={currentCuisine.name}
            dishes={currentCuisine.dishes}
          />
        </div>
      )}
    </div>
  );
}
