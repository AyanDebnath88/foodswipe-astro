"use client";

// The refine-layer deck (0017_indian_subcuisines.sql): shown once a room
// matches on a cuisine that has real internal breadth (today: Indian) and
// hasn't picked a subcategory yet. Deliberately simpler than swipe-area.tsx:
//
//   - No dietary re-filtering. The room only reached this layer because the
//     matched cuisine already passed everyone's dietary check
//     (src/lib/dietary.ts, against cuisines.dietary_tags); subcategories
//     don't carry their own dietary_tags yet -- see 0017's header comment
//     for why that's an accepted simplification, not an oversight.
//   - No AI fallback. Ten subcategories is a small, fixed, well-curated
//     deck (unlike the open-ended cuisine catalog) -- if a room rejects all
//     ten, "ask an AI for an eleventh Indian regional category" isn't a
//     real product need the way "suggest more cuisines" was.
//   - An explicit skip escape hatch, since unanimity can genuinely stall
//     here same as anywhere else, and this layer is a refinement, not a
//     requirement -- "just show me Indian restaurants" must always work.
import { useCallback, useEffect, useState } from "react";
import { SubcuisineCard } from "./subcuisine-card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { X, Heart, Loader2, DoorClosed, ArrowRight } from "lucide-react";
import { fetchSubcuisines, fetchSubcuisineSwipesForSession, submitSubcuisineSwipe, type Subcuisine } from "@/lib/subcuisine";
import { fetchRoomByCode, fetchRoomParticipants, subscribeToRoom, saveActiveRoom, clearActiveRoomIfMatches, type Participant, type RoomState } from "@/lib/rooms";
import { getCurrentUser } from "@/lib/guest-auth";
import { errorMessage } from "@/lib/errors";
import { currentPathForRedirect, redirectWithNotice } from "@/lib/notices";
import { shuffle } from "@/lib/utils";

interface SubcuisineSwipeAreaProps {
  cuisineId: string;
  roomCode: string;
}

export function SubcuisineSwipeArea({ cuisineId, roomCode }: SubcuisineSwipeAreaProps) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [deck, setDeck] = useState<Subcuisine[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [votesOnCurrent, setVotesOnCurrent] = useState(0);
  const [roomClosed, setRoomClosed] = useState(false);

  const currentSubcuisine = deck[0] ?? null;

  const refreshVotes = useCallback(async (roomId: string, subcuisineId: string | undefined) => {
    if (!subcuisineId) {
      setVotesOnCurrent(0);
      return;
    }
    const rows = await fetchSubcuisineSwipesForSession(roomId);
    setVotesOnCurrent(rows.filter((r) => r.subcuisineId === subcuisineId).length);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        redirectWithNotice("/login", "sign-in-required", { room: roomCode, redirect: currentPathForRedirect() });
        return;
      }
      if (cancelled) return;
      setUserId(user.id);

      const roomState = await fetchRoomByCode(roomCode);
      if (!roomState) {
        redirectWithNotice("/rooms", "not-a-member", { room: roomCode });
        return;
      }
      if (cancelled) return;

      // Already resolved (by another member, or this tab reloaded after
      // matching) -- go straight back to the reveal page, don't re-swipe.
      if (roomState.matchedSubcuisineId) {
        window.location.href = `/match/${cuisineId}?room=${roomCode}`;
        return;
      }

      setRoom(roomState);
      saveActiveRoom({ id: roomState.id, code: roomState.code });

      const [subcuisines, roomParticipants] = await Promise.all([
        fetchSubcuisines(cuisineId),
        fetchRoomParticipants(roomState.id),
      ]);
      if (cancelled) return;

      // Shuffled per user, per open -- same reasoning as the cuisine/dish
      // decks (src/lib/utils.ts's shuffle()).
      const shuffledDeck = shuffle(subcuisines);
      setParticipants(roomParticipants);
      setDeck(shuffledDeck);
      await refreshVotes(roomState.id, shuffledDeck[0]?.id);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuisineId, roomCode]);

  useEffect(() => {
    if (!room) return;
    const unsubscribe = subscribeToRoom(room.id, {
      onSessionChange: (updated) => {
        setRoom(updated);
        if (updated.matchedSubcuisineId) {
          saveActiveRoom({ id: updated.id, code: updated.code });
          toast({ title: "Narrowed it down!", description: "Redirecting to restaurants..." });
          window.location.href = `/match/${cuisineId}?room=${updated.code}`;
        }
      },
      onSessionDeleted: () => {
        clearActiveRoomIfMatches(room.id);
        setRoomClosed(true);
      },
      onParticipantsChange: () => fetchRoomParticipants(room.id).then(setParticipants),
      onSubcuisineSwipeChange: () => refreshVotes(room.id, currentSubcuisine?.id),
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, currentSubcuisine?.id]);

  const handleSwipe = async (direction: "left" | "right") => {
    if (!currentSubcuisine || !room || !userId) return;
    try {
      await submitSubcuisineSwipe(room.id, userId, currentSubcuisine.id, direction);
      if (direction === "right") {
        toast({ title: "Noted!", description: `You voted YES on ${currentSubcuisine.name}. Waiting on the group...` });
      }
    } catch (err) {
      console.error("Subcuisine swipe error:", err);
      toast({ variant: "destructive", title: "Swipe Error", description: errorMessage(err, "Failed to record your vote.") });
      return;
    }
    setTimeout(() => {
      setDeck((prev) => {
        const next = prev.slice(1);
        if (room) void refreshVotes(room.id, next[0]?.id);
        return next;
      });
    }, 500);
  };

  const isSolo = participants.length < 2;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground font-body">Loading Indian regional favourites...</p>
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
          The host closed room {roomCode} while you were narrowing it down.
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
          <p className="font-body text-sm text-muted-foreground">
            Nothing can match until someone else joins room{" "}
            <span className="font-bold text-foreground select-all">{roomCode}</span>. Keep swiping -- your
            votes count the moment they arrive.
          </p>
        </div>
      )}

      <div className="relative w-full h-[500px] flex items-center justify-center">
        {deck.length > 0 ? (
          [...deck]
            .map((sub, index) => (
              <SubcuisineCard
                key={sub.id}
                subcuisine={sub}
                onSwipe={handleSwipe}
                isActive={index === 0}
                zIndex={deck.length - index}
              />
            ))
            .reverse()
        ) : (
          <div className="text-center p-8 bg-card rounded-2xl shadow-lg">
            <h3 className="text-xl font-headline mb-2">That's every style!</h3>
            <p className="text-muted-foreground mb-4">
              No unanimous pick yet -- {isSolo ? "wait for someone else to join, or" : "you can"} just search
              Indian restaurants generally instead.
            </p>
            <Button asChild className="rounded-2xl">
              <a href={`/match/indian?room=${roomCode}&skipRefine=1`}>
                Skip narrowing <ArrowRight className="ml-1 h-4 w-4" />
              </a>
            </Button>
          </div>
        )}
      </div>

      {deck.length > 0 && participants.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4 font-body">
          {votesOnCurrent} of {participants.length} diners have voted on this style
        </p>
      )}

      {deck.length > 0 && (
        <div className="flex items-center justify-center gap-4 mt-8" style={{ marginBottom: "var(--fs-thumb-clearance)" }}>
          <Button
            variant="outline"
            size="icon"
            aria-label="Pass on this style of Indian food"
            className="rounded-full shadow-[var(--fs-e-1)] border-2 border-[var(--fs-line-strong)] text-[var(--fs-text-3)] hover:bg-[var(--fs-cream-tint)]"
            style={{ width: "var(--fs-swipe-pass)", height: "var(--fs-swipe-pass)" }}
            onClick={() => document.getElementById("subcuisine-swipe-left-btn")?.click()}
          >
            <X className="h-7 w-7" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Like this style of Indian food"
            className="rounded-full shadow-[var(--fs-e-primary)] border-2 border-[var(--fs-terracotta)] text-[var(--fs-terracotta)] hover:bg-[var(--fs-terracotta)]/10"
            style={{ width: "var(--fs-swipe-like)", height: "var(--fs-swipe-like)" }}
            onClick={() => document.getElementById("subcuisine-swipe-right-btn")?.click()}
          >
            <Heart className="h-8 w-8" />
          </Button>
        </div>
      )}

      <div className="mt-8">
        <Button asChild variant="link" className="text-muted-foreground">
          <a href={`/match/indian?room=${roomCode}&skipRefine=1`}>Skip -- just show me Indian restaurants</a>
        </Button>
      </div>
    </div>
  );
}
