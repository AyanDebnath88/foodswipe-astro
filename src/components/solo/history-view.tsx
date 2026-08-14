"use client";

// Phase 4 — solo value, half one: the history page (/history).
//
// Outside a live room this app offered literally nothing: no record of what
// the group decided, no way back to a place you liked, no reason to open it
// on a Tuesday. This page is that reason. It is also where the async-room
// catch-up state lives, because "which of my rooms are still going, and who
// hasn't swiped" is the same question as "what have I been part of" asked
// about today instead of last week.
//
// Two lists, split by src/lib/history.ts's OPEN_ROOM_WINDOW_MS:
//   STILL GOING — a live plan. Gets the async catch-up panel and a resume
//                 link, so a member arriving hours later sees the current
//                 state instead of an empty deck with no context.
//   EARLIER     — a memory. Gets what the group matched on, which
//                 restaurant, which dishes were agreed, and the post-meal
//                 feedback prompt.
//
// Nothing here is backed by a history table; it's all derived from rows the
// swipe flow already writes (see src/lib/history.ts's header).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchMyHistory, relativeTime, type SessionHistoryEntry } from "@/lib/history";
import { fetchSavedNameSet, saveFavorite } from "@/lib/favorites";
import { FeedbackPrompt } from "@/components/feedback/feedback-prompt";
import { RoomProgressPanel } from "@/components/solo/room-progress-panel";
import {
  History as HistoryIcon,
  Loader2,
  Users,
  Utensils,
  Heart,
  Plus,
  Bookmark,
} from "lucide-react";

export function HistoryView() {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([]);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState<string | null>(null);

  const load = useCallback(async (uid: string) => {
    const [history, saved] = await Promise.all([fetchMyHistory(uid), fetchSavedNameSet()]);
    setEntries(history);
    setSavedNames(saved);
  }, []);

  // Same auth shape as rooms-dashboard.tsx: the page is a static shell and
  // the island does the check, so this route needs no `prerender = false`.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        window.location.href = "/login";
        return;
      }
      setUserId(user.id);
      await load(user.id);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const { open, past } = useMemo(() => {
    return {
      open: entries.filter((e) => e.isOpen),
      past: entries.filter((e) => !e.isOpen),
    };
  }, [entries]);

  const handleSaveRestaurant = async (entry: SessionHistoryEntry, restaurantName: string) => {
    if (!userId) return;
    setSavingName(restaurantName);
    try {
      await saveFavorite({
        userId,
        restaurantName,
        cuisineId: entry.matchedCuisineId,
        sourceSessionId: entry.id,
      });
      setSavedNames((prev) => new Set(prev).add(restaurantName.trim().toLowerCase()));
      toast({ title: "Saved", description: `${restaurantName} is in your favourites.` });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't save that",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setSavingName(null);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto flex min-h-[50vh] items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="inline-flex items-center gap-2 font-headline text-3xl font-bold text-foreground">
          <HistoryIcon className="h-7 w-7 text-primary" /> Your rooms
        </h1>
        <p className="mt-1 font-body text-muted-foreground">
          Everything you've decided together — and everything still being decided.
        </p>
      </header>

      {entries.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-10">
          {open.length > 0 ? (
            <section>
              <h2 className="mb-3 font-headline text-lg font-semibold text-foreground">
                Still going
              </h2>
              <div className="space-y-4">
                {open.map((entry) => (
                  <RoomCard
                    key={entry.id}
                    entry={entry}
                    userId={userId!}
                    savedNames={savedNames}
                    savingName={savingName}
                    onSaveRestaurant={handleSaveRestaurant}
                    onChanged={() => userId && void load(userId)}
                    showProgress
                  />
                ))}
              </div>
            </section>
          ) : null}

          {past.length > 0 ? (
            <section>
              <h2 className="mb-3 font-headline text-lg font-semibold text-foreground">Earlier</h2>
              <div className="space-y-4">
                {past.map((entry) => (
                  <RoomCard
                    key={entry.id}
                    entry={entry}
                    userId={userId!}
                    savedNames={savedNames}
                    savingName={savingName}
                    onSaveRestaurant={handleSaveRestaurant}
                    onChanged={() => userId && void load(userId)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {/*
            Honest footnote rather than a silent gap. Leaving a room deletes
            the room_participants row that carries the membership (it has to
            — a ghost member deadlocks the room's unanimity denominator
            forever), and that row is also what makes the room visible here.
          */}
          <p className="font-body text-xs text-muted-foreground">
            Rooms you've left don't appear here — leaving a room removes you from it entirely.
          </p>
        </div>
      )}
    </div>
  );
}

function RoomCard({
  entry,
  userId,
  savedNames,
  savingName,
  onSaveRestaurant,
  onChanged,
  showProgress = false,
}: {
  entry: SessionHistoryEntry;
  userId: string;
  savedNames: Set<string>;
  savingName: string | null;
  onSaveRestaurant: (entry: SessionHistoryEntry, name: string) => void;
  onChanged: () => void;
  showProgress?: boolean;
}) {
  // Pre-fill the feedback form only when there is exactly one candidate —
  // guessing which of three restaurants the group ate at would put a wrong
  // answer in front of the user and make them fix it.
  const singleRestaurant = entry.restaurants.length === 1 ? entry.restaurants[0] : null;

  return (
    <article className="rounded-3xl border border-black/5 bg-card p-5 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-headline text-xl font-semibold text-foreground">
            {entry.matchedCuisineId ? capitalise(entry.matchedCuisineId) : "No match yet"}
            {entry.restaurants.length > 0 ? (
              <span className="font-body text-base font-normal text-muted-foreground">
                {" "}
                · {entry.restaurants.join(", ")}
              </span>
            ) : null}
          </h3>
          <p className="mt-0.5 font-body text-sm text-muted-foreground">
            Room {entry.code} · {relativeTime(entry.createdAt)} ·{" "}
            <span className="inline-flex items-center gap-1 align-middle">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {entry.participantCount}
            </span>
          </p>
        </div>
      </div>

      {entry.agreedDishes.length > 0 ? (
        <div className="mt-4">
          <p className="font-body text-sm font-medium text-foreground">What you agreed on</p>
          <ul className="mt-2 space-y-1">
            {entry.agreedDishes.map((dish) => (
              <li
                key={`${dish.restaurantName}::${dish.dishName}`}
                className="flex items-baseline gap-2 font-body text-sm text-muted-foreground"
              >
                <Utensils className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-foreground">{dish.dishName}</span>
                {entry.restaurants.length > 1 ? <span>at {dish.restaurantName}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {entry.restaurants.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {entry.restaurants.map((name) => {
            const alreadySaved = savedNames.has(name.trim().toLowerCase());
            return (
              <Button
                key={name}
                size="sm"
                variant={alreadySaved ? "ghost" : "outline"}
                disabled={alreadySaved || savingName === name}
                onClick={() => onSaveRestaurant(entry, name)}
              >
                {savingName === name ? (
                  <Loader2 className="animate-spin" />
                ) : alreadySaved ? (
                  <Heart className="fill-primary text-primary" />
                ) : (
                  <Plus />
                )}
                {alreadySaved ? `${name} saved` : `Save ${name}`}
              </Button>
            );
          })}
        </div>
      ) : null}

      {showProgress ? (
        <div className="mt-4">
          <RoomProgressPanel
            sessionId={entry.id}
            roomCode={entry.code}
            status={entry.status}
            matchedCuisineId={entry.matchedCuisineId}
            agreedDishes={entry.agreedDishes}
          />
        </div>
      ) : null}

      {/*
        The feedback prompt is offered once the group has actually decided
        something — before that there is nothing to have gone to. It renders
        for open rooms too: a lunch room from this morning is exactly the one
        worth asking about this afternoon.
      */}
      {entry.agreedDishes.length > 0 || entry.matchedCuisineId ? (
        <div className="mt-4">
          <FeedbackPrompt
            sessionId={entry.id}
            userId={userId}
            roomCode={entry.code}
            restaurantName={singleRestaurant}
            dishName={entry.agreedDishes[0]?.dishName ?? null}
            onChanged={onChanged}
          />
        </div>
      ) : null}
    </article>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-dashed border-black/10 bg-card/50 p-10 text-center">
      <Bookmark className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 font-headline text-lg font-semibold text-foreground">
        Nothing here yet
      </p>
      <p className="mx-auto mt-1 max-w-sm font-body text-sm text-muted-foreground">
        Once you've swiped through a room with friends, what you decided shows up here — and you
        can tell us how it went.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <a
          href="/rooms"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 font-body text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Start a room
        </a>
        <a
          href="/favorites"
          className="inline-flex h-10 items-center justify-center rounded-md border border-input px-4 font-body text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Your favourites
        </a>
      </div>
    </div>
  );
}

function capitalise(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
