"use client";

// Phase 2, Task 7 (dish-level room sync -- the P0 fix). Ported from the
// reference Next.js project's src/components/dishes/dish-swipe-area.tsx,
// restructured the same way swipe-area.tsx was restructured from the
// reference's swipe-area.tsx: writes go through the new `dish_swipes` table
// (supabase/migrations/0007_dish_swipes.sql) instead of local-only React
// state, match detection is server-side (check_dish_swipe_match() trigger),
// and the group's progress/result is synced via the same Realtime channel
// swipe-area.tsx uses (src/lib/rooms.ts's subscribeToRoom).
//
// Dish source: the reference app fetched a live, restaurant-specific menu
// via an AI flow. That's Phase 3 territory this phase doesn't wire up (see
// match-reveal.tsx's stub comment for the matching restaurant-discovery
// boundary) -- and unlike suggest-cuisines, no HTTP contract for a menu
// endpoint was specified for this phase to build against. Instead, the
// matched cuisine's own `dishes text[]` column (supabase/migrations/
// 0002_seed_cuisines.sql, 5 dishes per cuisine) stands in as a generic
// dish deck, scoped to whatever restaurant name the group is currently
// looking at. A later phase can swap this for a real per-restaurant menu
// fetch without touching the dish_swipes schema, RLS, or match trigger at
// all -- only where the `Dish[]` array comes from changes.
import { useCallback, useEffect, useRef, useState } from "react";
import { DishCard, type Dish } from "./dish-card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { X, Heart, PartyPopper, ThumbsDown, Utensils, Loader2 } from "lucide-react";
import { fetchCuisines } from "@/lib/cuisines";
import { fetchDishSwipes, submitDishSwipe, type DishSwipeRow } from "@/lib/dish-swipes";
import { fetchRoomByCode, fetchRoomParticipants, subscribeToRoom, type Participant, type RoomState } from "@/lib/rooms";
import { getCurrentUser } from "@/lib/guest-auth";

interface DishSwipeAreaProps {
  cuisineId: string;
  restaurantName: string;
  roomCode: string;
}

function dishIdFor(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export function DishSwipeArea({ cuisineId, restaurantName, roomCode }: DishSwipeAreaProps) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [deck, setDeck] = useState<Dish[]>([]);
  const [likedDishes, setLikedDishes] = useState<Dish[]>([]);
  const [dishVotes, setDishVotes] = useState<Map<string, Map<string, "left" | "right">>>(new Map());
  const initializedRef = useRef(false);

  const currentDish = deck[0] ?? null;
  const swipingFinished = deck.length === 0;

  const refreshParticipants = useCallback(async (roomId: string) => {
    setParticipants(await fetchRoomParticipants(roomId));
  }, []);

  const refreshDishSwipes = useCallback(async (sessionId: string) => {
    const rows = await fetchDishSwipes(sessionId, restaurantName);
    const map = new Map<string, Map<string, "left" | "right">>();
    for (const row of rows as DishSwipeRow[]) {
      if (!map.has(row.dishName)) map.set(row.dishName, new Map());
      map.get(row.dishName)!.set(row.userId, row.direction);
    }
    setDishVotes(map);
  }, [restaurantName]);

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

      const [cuisines, roomParticipants, dishRows] = await Promise.all([
        fetchCuisines(),
        fetchRoomParticipants(roomState.id),
        fetchDishSwipes(roomState.id, restaurantName),
      ]);
      if (cancelled) return;

      const cuisine = cuisines.find((c) => c.id === cuisineId);
      const dishNames = cuisine?.dishes ?? [];
      const dishes: Dish[] = dishNames.map((name, index) => ({
        id: dishIdFor(name),
        name,
        isTopPick: index === 0,
      }));

      const mySwipedNames = new Set(dishRows.filter((r) => r.userId === user.id).map((r) => r.dishName));

      setParticipants(roomParticipants);
      const map = new Map<string, Map<string, "left" | "right">>();
      for (const row of dishRows) {
        if (!map.has(row.dishName)) map.set(row.dishName, new Map());
        map.get(row.dishName)!.set(row.userId, row.direction);
      }
      setDishVotes(map);
      setDeck(dishes.filter((d) => !mySwipedNames.has(d.name)));
      setLoading(false);
      initializedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, cuisineId, restaurantName]);

  useEffect(() => {
    if (!room) return;
    const unsubscribe = subscribeToRoom(room.id, {
      onSessionChange: (updated) => setRoom(updated),
      onParticipantsChange: () => refreshParticipants(room.id),
      onDishSwipeChange: () => refreshDishSwipes(room.id),
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  const handleSwipe = async (direction: "left" | "right", dish: Dish) => {
    if (!room || !userId) return;
    try {
      await submitDishSwipe(room.id, userId, restaurantName, dish.name, direction);
      setDishVotes((prev) => {
        const next = new Map(prev);
        const votes = new Map(next.get(dish.name) ?? []);
        votes.set(userId, direction);
        next.set(dish.name, votes);
        return next;
      });
    } catch (err) {
      console.error("Dish swipe error:", err);
      toast({ variant: "destructive", title: "Swipe Error", description: "Failed to record your vote." });
    }

    if (direction === "right") {
      setLikedDishes((prev) => [...prev, dish]);
    }
    setTimeout(() => {
      setDeck((prev) => prev.slice(1));
    }, 500);
  };

  const votesOnCurrent = currentDish ? dishVotes.get(currentDish.name)?.size ?? 0 : 0;

  if (loading) {
    return (
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (room?.status === "dish_matched" && room.matchedDishName) {
    return (
      <div className="w-full max-w-sm rounded-2xl border-2 border-primary/30 bg-card/75 backdrop-blur-md shadow-2xl p-8 text-center">
        <div className="mx-auto bg-primary/20 p-3 rounded-full mb-3 w-fit">
          <PartyPopper className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-xl font-headline">The group decided!</h3>
        <p className="text-muted-foreground mt-2">
          Everyone agreed on <span className="font-bold text-primary">{room.matchedDishName}</span> at{" "}
          {room.matchedRestaurantName ?? restaurantName}.
        </p>
        <Button asChild className="w-full mt-6 rounded-2xl h-12">
          <a href="/rooms">Start a new search</a>
        </Button>
      </div>
    );
  }

  if (swipingFinished) {
    return (
      <div className="w-full max-w-sm rounded-2xl border bg-card/75 backdrop-blur-md shadow-2xl p-8 text-center">
        <div className="mx-auto bg-primary/20 p-3 rounded-full mb-3 w-fit">
          {likedDishes.length > 0 ? (
            <PartyPopper className="h-8 w-8 text-primary" />
          ) : (
            <ThumbsDown className="h-8 w-8 text-primary" />
          )}
        </div>
        <h3 className="text-xl font-headline">
          {likedDishes.length > 0 ? "Here's your list!" : "Nothing caught your eye?"}
        </h3>
        {likedDishes.length > 0 ? (
          <ul className="mt-4 space-y-2 text-left">
            {likedDishes.map((dish) => (
              <li key={dish.id} className="flex items-center gap-3 bg-background/60 p-3 rounded-lg">
                <Utensils className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium text-sm">{dish.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground mt-2">You didn't select any dishes.</p>
        )}
        <p className="text-xs text-muted-foreground mt-4 font-body">
          Waiting for the rest of the group to finish swiping -- this screen updates automatically the moment
          everyone agrees on a dish.
        </p>
        <Button asChild variant="outline" className="w-full mt-4 rounded-2xl h-11">
          <a href="/rooms">Start a new search</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm flex flex-col items-center">
      <div className="relative w-full h-[20rem] flex items-center justify-center">
        {[...deck]
          .map((dish, index) => (
            <DishCard
              key={dish.id}
              dish={dish}
              onSwipe={(dir) => handleSwipe(dir, dish)}
              isActive={index === 0}
              zIndex={deck.length - index}
            />
          ))
          .reverse()}
      </div>

      {participants.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4 font-body">
          {votesOnCurrent} of {participants.length} diners have voted on this dish
        </p>
      )}

      <div className="flex items-center justify-center gap-4 mt-8">
        <Button
          variant="outline"
          size="icon"
          className="w-16 h-16 rounded-full shadow-lg border-2 border-destructive/50 text-destructive hover:bg-destructive/10"
          onClick={() => document.getElementById("dish-swipe-left-btn")?.click()}
        >
          <X className="h-8 w-8" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="w-16 h-16 rounded-full shadow-lg border-2 border-primary/50 text-primary hover:bg-primary/10"
          onClick={() => document.getElementById("dish-swipe-right-btn")?.click()}
        >
          <Heart className="h-8 w-8" />
        </Button>
      </div>
    </div>
  );
}
