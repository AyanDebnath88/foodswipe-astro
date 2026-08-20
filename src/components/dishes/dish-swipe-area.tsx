"use client";

// Group dish swiping -- MULTI-DISH model.
//
// This component used to render a terminal "The group decided!" screen the
// moment `swipe_sessions.status` flipped to 'dish_matched', i.e. after ONE
// dish reached unanimity. Real two-user testing showed that's the wrong
// product model: a table orders a starter, a couple of mains and a dessert,
// so stopping at the first agreed dish ends the session with most of the
// order still undecided (and nothing could move the room back out of that
// status again).
//
// New model (supabase/migrations/0012_dish_matches.sql): each dish that
// reaches unanimity INSERTs a row into `dish_matches` and the room's status
// is left alone. This component therefore:
//   * renders a RUNNING agreed-dishes list that grows live via Realtime as
//     each member's vote completes another dish,
//   * removes an agreed dish from the remaining deck (and shows it in the
//     agreed list instead) so nobody re-votes on something already settled,
//   * offers an explicit "Done -- show our order" summary, which is the only
//     thing that ends the session, and is reversible ("keep swiping"),
//   * always offers a way onward, including when the deck empties with zero
//     agreed dishes.
//
// Match detection is still entirely server-side (check_dish_swipe_match()
// SECURITY DEFINER trigger) -- this component never decides a match, it only
// reads dish_matches and reacts.
//
// DISH SOURCE (changed): the deck now comes from POST /api/restaurant-menu --
// a real per-restaurant menu for the restaurant the group actually picked.
// It used to be `cuisines.find(c => c.id === cuisineId)?.dishes ?? []`, which
// broke in two ways a QA pass caught:
//   * an AI-suggested cuisine has an `ai-<slug>` id matching no catalog row,
//     so the deck was literally [] and a group that matched on an AI
//     suggestion landed on "That's the whole menu / nobody's reached unanimity
//     here yet" forever, with no dish to swipe. A dead end at the end of the
//     happy path;
//   * every restaurant served the same 5 generic catalog dishes, so the
//     restaurant choice changed nothing about what you were offered.
// The catalog dishes remain as the OFFLINE fallback only (see loadMenu()).
//
// THE ROOM-CONSISTENCY PROBLEM this creates, and how it's handled: the menu
// comes from a generative model, so two members opening the same restaurant
// can be served slightly different dish lists, and `dish_swipes` are scoped by
// (restaurant_name, dish_name) -- a dish only one member can see could never
// reach unanimity. Rather than add a schema/caching change (a migration nobody
// in this session can apply), the deck is the UNION of my fetched menu and
// every dish name the room has already swiped on or agreed at this restaurant
// (both already synced to every member over Realtime). So a dish someone else
// sees enters my deck the moment they vote on it, and the group converges on
// the same set without any new storage. Documented rather than hidden: the
// proper fix is to persist the menu per (session, restaurant) when a migration
// is possible again.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DishCard, type Dish } from "./dish-card";
import { Button, CtaArrow } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  X,
  Heart,
  PartyPopper,
  Utensils,
  Loader2,
  Check,
  ClipboardList,
  ArrowLeft,
  Store,
  RefreshCw,
  DoorClosed,
  WifiOff,
} from "lucide-react";
import { fetchCuisines, type Cuisine } from "@/lib/cuisines";
import { fetchDishSwipes, submitDishSwipe } from "@/lib/dish-swipes";
import { fetchDishMatches, type DishMatch } from "@/lib/dish-matches";
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
import {
  fetchRestaurantMenu,
  MenuRateLimitedError,
  type MenuSource,
} from "@/lib/restaurant-menu";
import { errorMessage } from "@/lib/errors";
import { currentPathForRedirect, redirectWithNotice } from "@/lib/notices";
import { shuffle } from "@/lib/utils";
import { DeliveryOptions } from "@/components/delivery/delivery-options";
import { FeedbackPrompt } from "@/components/feedback/feedback-prompt";

interface DishSwipeAreaProps {
  cuisineId: string;
  restaurantName: string;
  /** From the search result that led here, when there was one -- see [restaurant].astro. Sharpens the delivery-link search; never required. */
  restaurantAddress?: string;
  roomCode: string;
}

function dishIdFor(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export function DishSwipeArea({ cuisineId, restaurantName, restaurantAddress, roomCode }: DishSwipeAreaProps) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  // The menu as fetched for THIS restaurant (POST /api/restaurant-menu).
  const [menuDishes, setMenuDishes] = useState<Dish[]>([]);
  const [menuState, setMenuState] = useState<"loading" | "ready" | "error">("loading");
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuRetryAfter, setMenuRetryAfter] = useState(0);
  const [menuSource, setMenuSource] = useState<MenuSource | "catalog" | null>(null);
  // The matched cuisine's generic catalog dishes, kept ONLY as the offline
  // fallback for when the menu endpoint can't be reached at all.
  const [catalogDishes, setCatalogDishes] = useState<Dish[]>([]);
  const [cuisineLabel, setCuisineLabel] = useState<string>("");
  // The room was deleted out from under us (Realtime DELETE).
  const [roomClosed, setRoomClosed] = useState(false);

  const [mySwipedNames, setMySwipedNames] = useState<Set<string>>(new Set());
  const [myLikedNames, setMyLikedNames] = useState<Set<string>>(new Set());
  const [dishVotes, setDishVotes] = useState<Map<string, Map<string, "left" | "right">>>(new Map());
  const [agreed, setAgreed] = useState<DishMatch[]>([]);
  const [showSummary, setShowSummary] = useState(false);

  // Names already agreed by the group at THIS restaurant. An agreed dish is
  // settled -- it leaves the deck so nobody votes on it twice.
  const agreedNamesHere = useMemo(
    () =>
      new Set(
        agreed.filter((m) => m.restaurantName === restaurantName).map((m) => m.dishName)
      ),
    [agreed, restaurantName]
  );

  /**
   * The full dish set for this restaurant: MY fetched menu, unioned with every
   * dish name the room has already swiped on or agreed here.
   *
   * The union is what makes a generative menu survivable. Two members opening
   * the same restaurant can be served slightly different lists, and dish_swipes
   * are scoped by (restaurant_name, dish_name) -- so a dish only one member can
   * see could never reach unanimity, and the group would silently be unable to
   * agree on it. Both of the extra sources here are already synced to everyone
   * over Realtime, so the moment someone votes on a dish I don't have, it
   * appears in my deck and the room converges on one set without any new
   * storage or a migration.
   */
  const allDishes = useMemo(() => {
    const byName = new Map<string, Dish>();
    for (const dish of menuDishes) byName.set(dish.name, dish);
    for (const name of dishVotes.keys()) {
      if (!byName.has(name)) byName.set(name, { id: dishIdFor(name), name });
    }
    for (const name of agreedNamesHere) {
      if (!byName.has(name)) byName.set(name, { id: dishIdFor(name), name });
    }
    return [...byName.values()];
  }, [menuDishes, dishVotes, agreedNamesHere]);

  const deck = useMemo(
    () => allDishes.filter((d) => !mySwipedNames.has(d.name) && !agreedNamesHere.has(d.name)),
    [allDishes, mySwipedNames, agreedNamesHere]
  );

  const currentDish = deck[0] ?? null;
  const deckExhausted = deck.length === 0;

  // Announce newly agreed dishes once each. Without this ref every Realtime
  // refetch would re-toast the whole list.
  const announcedRef = useRef<Set<string>>(new Set());

  const refreshParticipants = useCallback(async (roomId: string) => {
    setParticipants(await fetchRoomParticipants(roomId));
  }, []);

  const refreshDishSwipes = useCallback(
    async (sessionId: string) => {
      const rows = await fetchDishSwipes(sessionId, restaurantName);
      const map = new Map<string, Map<string, "left" | "right">>();
      for (const row of rows) {
        if (!map.has(row.dishName)) map.set(row.dishName, new Map());
        map.get(row.dishName)!.set(row.userId, row.direction);
      }
      setDishVotes(map);
    },
    [restaurantName]
  );

  const refreshAgreed = useCallback(
    async (sessionId: string) => {
      // Whole-session scope, not just this restaurant: the summary is "what
      // the table agreed on", and a group can browse more than one restaurant.
      const matches = await fetchDishMatches(sessionId);
      setAgreed(matches);
      // announcedRef is pre-seeded with everything present at first load, so
      // anything unseen here genuinely landed while the user was swiping.
      for (const m of matches) {
        const key = `${m.restaurantName}::${m.dishName}`;
        if (announcedRef.current.has(key)) continue;
        announcedRef.current.add(key);
        toast({ title: "The table agreed!", description: `${m.dishName} is on the order.` });
      }
    },
    [toast]
  );

  /**
   * Fetches the real menu for this restaurant.
   *
   * Separated out (and re-callable) because every one of its failure modes has
   * to leave the user somewhere they can act, not on an empty deck. The deck
   * being empty IS the dead end this whole change exists to remove, so an
   * error here must never be swallowed into `[]`.
   *
   *   * 429 -- the routes are per-IP rate limited and a whole room opening the
   *     same restaurant at once genuinely trips it. Surfaced with the real
   *     retry window and a retry button, never as a permanent failure.
   *   * anything else -- fall back to the matched cuisine's generic catalog
   *     dishes if we have them (offline fallback only, and labelled as such),
   *     and only show a hard error when there is nothing at all to swipe.
   */
  const loadMenu = useCallback(
    async (cuisineName: string, fallbackDishes: Dish[]) => {
      setMenuState("loading");
      setMenuError(null);
      setMenuRetryAfter(0);
      try {
        const { menu, source } = await fetchRestaurantMenu(restaurantName, cuisineName);
        // Shuffled per user, per open -- same reasoning as the cuisine deck
        // (src/lib/utils.ts's shuffle()): order is local-only display state,
        // match detection is keyed by dish name, not position.
        setMenuDishes(
          shuffle(
            menu.map((dish) => ({
              id: dishIdFor(dish.name),
              name: dish.name,
              description: dish.description || undefined,
              isTopPick: dish.isTopPick,
            }))
          )
        );
        setMenuSource(source);
        setMenuState("ready");
      } catch (err) {
        console.error("Menu fetch failed:", err);
        if (err instanceof MenuRateLimitedError) {
          // Don't silently substitute the catalog here: a rate limit is
          // temporary and retrying gets the real menu, so say so.
          setMenuRetryAfter(err.retryAfterSeconds);
          setMenuError(
            `Too many menu requests at once (that happens when the whole room opens ${restaurantName} together). Try again in ${err.retryAfterSeconds}s.`
          );
          setMenuState("error");
          return;
        }
        if (fallbackDishes.length > 0) {
          setMenuDishes(shuffle(fallbackDishes));
          setMenuSource("catalog");
          setMenuState("ready");
          return;
        }
        setMenuError(errorMessage(err, "We couldn't load a menu for this restaurant."));
        setMenuState("error");
      }
    },
    [restaurantName]
  );

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        // The reason used to be lost: a toast created microseconds before a
        // full page navigation dies with the document.
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
        redirectWithNotice("/rooms", "not-a-member", { room: roomCode });
        return;
      }
      if (cancelled) return;
      setRoom(roomState);
      // Keep the room resolvable while the group is still ordering together.
      saveActiveRoom({ id: roomState.id, code: roomState.code });

      const [cuisines, roomParticipants, dishRows, matches] = await Promise.all([
        fetchCuisines(),
        fetchRoomParticipants(roomState.id),
        fetchDishSwipes(roomState.id, restaurantName),
        fetchDishMatches(roomState.id),
      ]);
      if (cancelled) return;

      // An AI-suggested cuisine has an `ai-<slug>` id that matches no catalog
      // row, which is exactly the case that used to produce an empty deck.
      // De-slug it into a readable cuisine name for the menu prompt instead.
      const cuisine = cuisines.find((c) => c.id === cuisineId);
      const cuisineName =
        cuisine?.name ??
        cuisineId
          .replace(/^ai-/, "")
          .replace(/-/g, " ")
          .replace(/\b\w/g, (ch) => ch.toUpperCase());
      const fallbackDishes: Dish[] = (cuisine?.dishes ?? []).map((name, index) => ({
        id: dishIdFor(name),
        name,
        isTopPick: index === 0,
      }));
      setCuisineLabel(cuisineName);
      setCatalogDishes(fallbackDishes);

      const mine = dishRows.filter((r) => r.userId === user.id);
      const map = new Map<string, Map<string, "left" | "right">>();
      for (const row of dishRows) {
        if (!map.has(row.dishName)) map.set(row.dishName, new Map());
        map.get(row.dishName)!.set(row.userId, row.direction);
      }

      for (const m of matches) announcedRef.current.add(`${m.restaurantName}::${m.dishName}`);

      setParticipants(roomParticipants);
      setDishVotes(map);
      setMySwipedNames(new Set(mine.map((r) => r.dishName)));
      setMyLikedNames(new Set(mine.filter((r) => r.direction === "right").map((r) => r.dishName)));
      setAgreed(matches);
      setLoading(false);

      // The room/swipe state is usable now; the menu is a separate, slower
      // network call, so it gets its own state and its own error handling
      // rather than blocking the whole page behind it.
      void loadMenu(cuisineName, fallbackDishes);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, cuisineId, restaurantName]);

  // -------------------------------------------------------------------------
  // Realtime: this is how each member watches the order fill up live.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!room) return;
    const unsubscribe = subscribeToRoom(room.id, {
      onSessionChange: (updated) => setRoom(updated),
      onSessionDeleted: () => {
        // Previously undeliverable: the swipe_sessions handler guarded on
        // `"id" in payload.new`, which is false for a DELETE. So the host
        // closing the room went unnoticed here while the dish_matches cascade
        // silently emptied the "agreed so far" list -- the group watched their
        // order vanish with no explanation. Clear the cache for THIS room only.
        clearActiveRoomIfMatches(room.id);
        setRoomClosed(true);
      },
      onParticipantsChange: () => refreshParticipants(room.id),
      onDishSwipeChange: () => refreshDishSwipes(room.id),
      onDishMatch: () => refreshAgreed(room.id),
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
      if (direction === "right") {
        setMyLikedNames((prev) => new Set(prev).add(dish.name));
      }
    } catch (err) {
      console.error("Dish swipe error:", err);
      toast({
        variant: "destructive",
        title: "Swipe Error",
        description: errorMessage(err, "Failed to record your vote."),
      });
      return;
    }

    // A vote that completes unanimity arrives back as a dish_matches INSERT
    // over Realtime (onDishMatch above) -- never decided here. The delay just
    // lets the card's exit animation finish before the deck recomputes.
    setTimeout(() => {
      setMySwipedNames((prev) => new Set(prev).add(dish.name));
    }, 500);
  };

  const votesOnCurrent = currentDish ? dishVotes.get(currentDish.name)?.size ?? 0 : 0;
  const agreedHere = agreed.filter((m) => m.restaurantName === restaurantName);
  const agreedElsewhere = agreed.filter((m) => m.restaurantName !== restaurantName);
  const pendingLikes = [...myLikedNames].filter((n) => !agreedNamesHere.has(n));

  const backToRestaurants = `/match/${cuisineId}?room=${roomCode}`;

  if (loading) {
    return (
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // The host closed the room while we were ordering.
  // ---------------------------------------------------------------------------
  if (roomClosed) {
    return (
      <div className="w-full max-w-sm text-center p-8 bg-card rounded-[var(--fs-r-xl)] shadow-[var(--fs-e-2)]">
        <div className="mx-auto bg-[var(--fs-destructive)]/15 p-3 rounded-full mb-3 w-fit">
          <DoorClosed className="h-8 w-8 text-[var(--fs-destructive)]" />
        </div>
        <h3 className="text-xl font-headline mb-2">This room was closed</h3>
        <p className="text-muted-foreground font-body text-sm mb-6">
          The host closed room {roomCode} while you were picking dishes, so the session has ended. The
          agreed list went with it -- start a new room, or join another one.
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

  // ---------------------------------------------------------------------------
  // Menu still loading. Note this is NOT a dead end and NOT an empty deck --
  // it's an explicit "we're fetching the real menu for this restaurant".
  // ---------------------------------------------------------------------------
  if (menuState === "loading") {
    return (
      <div className="w-full max-w-sm flex flex-col items-center gap-4 p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="font-body text-sm text-muted-foreground">
          Building the menu for <span className="font-semibold text-foreground">{restaurantName}</span>...
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Final summary -- reached by choosing "Done", never forced by the server.
  // ---------------------------------------------------------------------------
  if (showSummary) {
    return (
      <div className="w-full max-w-md rounded-2xl border-2 border-primary/30 bg-card/75 backdrop-blur-md shadow-2xl p-8 text-center">
        <div className="mx-auto bg-primary/20 p-3 rounded-full mb-3 w-fit">
          <ClipboardList className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-2xl font-headline">Your table's order</h3>
        <p className="text-muted-foreground mt-1 font-body text-sm">
          {agreed.length > 0
            ? `${agreed.length} dish${agreed.length === 1 ? "" : "es"} everyone agreed on.`
            : "Nothing agreed on yet."}
        </p>

        {agreed.length > 0 ? (
          <ul className="mt-6 space-y-2 text-left">
            {agreed.map((match) => (
              <li
                key={match.id}
                className="flex items-center gap-3 bg-background/60 p-3 rounded-xl border border-primary/10"
              >
                <Check className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="font-body text-sm font-semibold text-foreground truncate">{match.dishName}</p>
                  <p className="font-body text-xs text-muted-foreground truncate">{match.restaurantName}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground font-body text-sm mt-6">
            The group didn't reach unanimity on any dish. Try another restaurant, or keep swiping -- a dish
            only lands here once <em>everyone</em> in the room says yes.
          </p>
        )}

        {/* Ordering + post-meal feedback, both only once the table actually
            agreed on something. Delivery links are the Phase 5 affiliate
            surface; they degrade to plain search links when no affiliate ids
            are configured (which is today's state). The feedback prompt is
            the Phase 4 retention hook -- it's a card, never a modal, and is
            dismissible, so it can't become another dead end. */}
        {agreed.length > 0 && (
          <div className="mt-6 text-left">
            <DeliveryOptions
              restaurantName={restaurantName}
              restaurantAddress={restaurantAddress}
              sessionId={room?.id}
              cuisineId={cuisineId}
            />
            {room && userId && (
              <div className="mt-4">
                <FeedbackPrompt
                  sessionId={room.id}
                  userId={userId}
                  roomCode={roomCode}
                  restaurantName={restaurantName}
                  dishName={agreedHere[0]?.dishName ?? null}
                />
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-col gap-2">
          <Button variant="outline" className="w-full rounded-2xl h-11" onClick={() => setShowSummary(false)}>
            <ArrowLeft className="h-4 w-4" />
            Keep swiping
          </Button>
          <Button asChild variant="outline" className="w-full rounded-2xl h-11">
            <a href={backToRestaurants}>
              <Store className="h-4 w-4" />
              Pick a different restaurant
            </a>
          </Button>
          <Button asChild className="w-full rounded-2xl h-11">
            <a href="/rooms">Back to rooms / start over</a>
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Agreed-so-far panel, rendered alongside the deck and in the empty state.
  // ---------------------------------------------------------------------------
  const agreedPanel = (
    <div className="w-full mt-6 rounded-2xl border border-primary/20 bg-card/60 backdrop-blur-md p-4">
      <h4 className="font-body text-xs uppercase font-bold tracking-wider text-primary flex items-center gap-1.5">
        <PartyPopper className="h-3.5 w-3.5" />
        Agreed so far ({agreed.length})
      </h4>
      {agreed.length === 0 ? (
        <p className="font-body text-xs text-muted-foreground mt-2">
          Nothing yet. A dish lands here the moment every diner in the room swipes right on it -- and you
          keep swiping the rest of the menu either way.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {agreedHere.map((match) => (
            <li key={match.id} className="flex items-center gap-2 text-sm font-body">
              <Check className="h-4 w-4 text-primary shrink-0" />
              <span className="font-medium text-foreground">{match.dishName}</span>
            </li>
          ))}
          {agreedElsewhere.map((match) => (
            <li key={match.id} className="flex items-center gap-2 text-sm font-body text-muted-foreground">
              <Check className="h-4 w-4 shrink-0" />
              <span>{match.dishName}</span>
              <span className="text-xs">· {match.restaurantName}</span>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant={agreed.length > 0 ? "default" : "outline"}
        className="w-full mt-4 rounded-2xl h-11"
        onClick={() => setShowSummary(true)}
      >
        <ClipboardList className="h-4 w-4" />
        Done — show our order
      </Button>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Menu unavailable and no catalog dishes to fall back on. Every branch here
  // offers a real action -- this used to be the permanent "That's the whole
  // menu / nobody's reached unanimity here yet" dead end.
  // ---------------------------------------------------------------------------
  if (menuState === "error") {
    return (
      <div className="w-full max-w-sm flex flex-col items-center">
        <div className="w-full rounded-2xl border bg-card/75 backdrop-blur-md shadow-2xl p-8 text-center">
          <div className="mx-auto bg-destructive/15 p-3 rounded-full mb-3 w-fit">
            <WifiOff className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="text-xl font-headline">No menu for {restaurantName}</h3>
          <p className="text-muted-foreground mt-2 font-body text-sm">
            {menuError ?? "We couldn't load a menu for this restaurant."}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button
              className="w-full rounded-2xl h-11"
              onClick={() => void loadMenu(cuisineLabel, catalogDishes)}
            >
              <RefreshCw className="h-4 w-4" />
              {menuRetryAfter > 0 ? `Try again (wait ~${menuRetryAfter}s)` : "Try again"}
            </Button>
            <Button asChild variant="outline" className="w-full rounded-2xl h-11">
              <a href={backToRestaurants}>
                <Store className="h-4 w-4" />
                Pick a different restaurant
              </a>
            </Button>
            <Button asChild variant="outline" className="w-full rounded-2xl h-11">
              <a href="/rooms">Back to rooms</a>
            </Button>
          </div>
        </div>
        {agreedPanel}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Deck exhausted. Not a dead end in either case: the agreed panel always
  // carries "Done", plus explicit ways back out.
  // ---------------------------------------------------------------------------
  if (deckExhausted) {
    return (
      <div className="w-full max-w-sm flex flex-col items-center">
        <div className="w-full rounded-2xl border bg-card/75 backdrop-blur-md shadow-2xl p-8 text-center">
          <div className="mx-auto bg-primary/20 p-3 rounded-full mb-3 w-fit">
            <Utensils className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-xl font-headline">
            {agreed.length > 0 ? "You've swiped the whole menu" : "That's the whole menu"}
          </h3>
          <p className="text-muted-foreground mt-2 font-body text-sm">
            {pendingLikes.length > 0
              ? `You said yes to ${pendingLikes.join(", ")} — waiting on the rest of the group. This list updates the moment everyone agrees.`
              : agreed.length > 0
                ? "Nothing left to vote on here. Wrap up your order, or try another restaurant."
                : "Nobody's reached unanimity here yet. Wait for the others to finish swiping, or try a different restaurant."}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button asChild variant="outline" className="w-full rounded-2xl h-11">
              <a href={backToRestaurants}>
                <Store className="h-4 w-4" />
                Pick a different restaurant
              </a>
            </Button>
            <Button asChild variant="outline" className="w-full rounded-2xl h-11">
              <a href="/rooms">Back to rooms</a>
            </Button>
          </div>
        </div>
        {agreedPanel}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Normal swiping
  // ---------------------------------------------------------------------------
  return (
    <div className="w-full max-w-sm flex flex-col items-center">
      <div className="relative w-full h-[20rem] flex items-center justify-center">
        {[...deck]
          .map((dish, index) => (
            <DishCard
              key={dish.id}
              dish={dish}
              cuisineId={cuisineId}
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

      {/*
        Honest about where the list came from. "catalog" means the menu
        endpoint was unreachable and these are the cuisine's generic dishes,
        not this restaurant's own -- worth saying, rather than quietly
        presenting stand-ins as the real menu.
      */}
      {menuSource === "catalog" && (
        <p className="mt-2 font-body text-[11px] text-muted-foreground text-center">
          Couldn't reach the menu service, so these are generic {cuisineLabel} dishes rather than{" "}
          {restaurantName}'s own.{" "}
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => void loadMenu(cuisineLabel, catalogDishes)}
          >
            Retry
          </button>
        </p>
      )}

      <div className="flex items-center justify-center gap-4 mt-6">
        <Button
          variant="outline"
          size="icon"
          aria-label="Pass on this dish"
          className="rounded-full shadow-[var(--fs-e-1)] border-2 border-[var(--fs-line-strong)] text-[var(--fs-text-3)] hover:bg-[var(--fs-cream-tint)]"
          style={{ width: "var(--fs-swipe-pass)", height: "var(--fs-swipe-pass)" }}
          onClick={() => document.getElementById("dish-swipe-left-btn")?.click()}
        >
          <X className="h-7 w-7" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Like this dish"
          className="rounded-full shadow-[var(--fs-e-primary)] border-2 border-[var(--fs-terracotta)] text-[var(--fs-terracotta)] hover:bg-[var(--fs-terracotta)]/10"
          style={{ width: "var(--fs-swipe-like)", height: "var(--fs-swipe-like)" }}
          onClick={() => document.getElementById("dish-swipe-right-btn")?.click()}
        >
          <Heart className="h-8 w-8" />
        </Button>
      </div>

      {agreedPanel}
    </div>
  );
}
