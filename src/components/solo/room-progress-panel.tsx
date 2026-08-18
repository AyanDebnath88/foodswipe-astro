"use client";

// Phase 4 — async rooms.
//
// A room in this app used to assume everybody was swiping at the same
// moment. The common real case is "let's sort out dinner during the day":
// people swipe over hours, from different places, and whoever opens the app
// third has no idea what they've walked into. Nothing here changes the
// room's lifecycle — rooms already stay open indefinitely (the schema has no
// expiry, see the build log's "no TTL/cleanup sweep" note) — what was
// missing was any way to SEE the room's current state without being present
// while it happened.
//
// This panel answers three questions for a late arriver:
//   where is the room up to   — status, matched cuisine, agreed dishes
//   who has and hasn't swiped — per member, with last-active time
//   what do I do now          — one resume link, pointed at the right stage
//
// No new schema backs any of it (see src/lib/history.ts's fetchRoomProgress
// and block D of 0014 for the derivation, and for why a `last_seen_at`
// column on room_participants was considered and rejected).
//
// DELIBERATE RESTRAINT: counts only, never swipe DIRECTIONS, even though RLS
// would return them. "Ben liked Italian" shown before the group has matched
// turns an independent vote into a bandwagon and quietly breaks unanimity.
import React, { useCallback, useEffect, useState } from "react";
import { fetchRoomProgress, relativeTime, type AgreedDish, type RoomProgress } from "@/lib/history";
import { subscribeToRoom } from "@/lib/rooms";
import { Users, Clock, CircleDashed, CircleCheck, ArrowRight, Utensils } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface RoomProgressPanelProps {
  sessionId: string;
  roomCode: string;
  status: string;
  matchedCuisineId: string | null;
  agreedDishes: AgreedDish[];
}

export function RoomProgressPanel({
  sessionId,
  roomCode,
  status,
  matchedCuisineId,
  agreedDishes,
}: RoomProgressPanelProps) {
  const [progress, setProgress] = useState<RoomProgress | null>(null);

  const refresh = useCallback(async () => {
    setProgress(await fetchRoomProgress(sessionId));
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates use the project's one shared channel factory
  // (subscribeToRoom) rather than a poll — same as every other room island.
  // A member swiping on the bus updates this panel on everyone else's screen
  // without anyone refreshing, which is the entire point of async rooms.
  useEffect(() => {
    return subscribeToRoom(sessionId, {
      onParticipantsChange: () => void refresh(),
      onSwipeChange: () => void refresh(),
      onDishSwipeChange: () => void refresh(),
    });
  }, [sessionId, refresh]);

  const resumeHref = matchedCuisineId
    ? `/match/${matchedCuisineId}?room=${roomCode}`
    : `/swipe?room=${roomCode}`;

  const waiting = progress?.waitingOnNames ?? [];

  return (
    <div className="rounded-[var(--fs-r-lg)] border border-[var(--fs-line)] bg-accent/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 font-body text-sm font-medium text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" />
          Where this room is up to
        </p>
        <a
          href={resumeHref}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--fs-r-pill)] bg-primary px-3 font-body text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--fs-terracotta-hover)]"
        >
          {matchedCuisineId ? "Pick dishes" : "Catch up on swiping"}
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>

      <p className="mt-2 font-body text-sm text-muted-foreground">
        <StageSummary
          status={status}
          matchedCuisineId={matchedCuisineId}
          agreedCount={agreedDishes.length}
        />
      </p>

      {agreedDishes.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {agreedDishes.map((dish) => (
            <li key={`${dish.restaurantName}::${dish.dishName}`}>
              <Badge variant="done">
                <Utensils className="h-3 w-3" />
                {dish.dishName}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {progress === null ? (
        <p className="mt-3 font-body text-xs text-muted-foreground">Loading who's swiped…</p>
      ) : progress.members.length === 0 ? (
        // Zero members is what a non-participant (or a departed one) sees:
        // get_room_profiles() returns no rows rather than erroring. Say so
        // instead of rendering an empty box.
        <p className="mt-3 font-body text-xs text-muted-foreground">
          Member activity isn't available for this room.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5">
            {progress.members.map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-2">
                  {member.hasStarted ? (
                    <CircleCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <CircleDashed
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate font-body text-sm text-foreground">
                    {member.displayName}
                    {member.isGuest ? (
                      <Badge variant="sponsored" className="ml-1.5">
                        guest
                      </Badge>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 font-body text-xs text-muted-foreground">
                  {member.hasStarted ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {member.cuisineSwipes + member.dishSwipes} swipes ·{" "}
                      {relativeTime(member.lastActiveAt)}
                    </span>
                  ) : (
                    "hasn't swiped yet"
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/*
            The unanimity model means one silent member blocks the whole
            room forever. Naming them is the in-app substitute for the
            notifications this phase is explicitly not building — someone
            reading this can go poke them on whatever they already use.
          */}
          {waiting.length > 0 ? (
            <p className="mt-3 font-body text-xs text-muted-foreground">
              Waiting on {formatNames(waiting)} — the room can't match until everyone swipes.
            </p>
          ) : (
            <p className="mt-3 font-body text-xs text-muted-foreground">
              Everyone's swiped at least once.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function StageSummary({
  status,
  matchedCuisineId,
  agreedCount,
}: {
  status: string;
  matchedCuisineId: string | null;
  agreedCount: number;
}) {
  if (agreedCount > 0) {
    return (
      <>
        The group has agreed on {agreedCount} {agreedCount === 1 ? "dish" : "dishes"} so far
        {matchedCuisineId ? ` at their ${matchedCuisineId} pick` : ""}. Still open — you can add
        more.
      </>
    );
  }
  if (matchedCuisineId) {
    return <>Matched on {matchedCuisineId}. Nobody's agreed a dish yet.</>;
  }
  if (status === "waiting") {
    return <>Still in the lobby — waiting for a second person to join.</>;
  }
  return <>Swiping on cuisines. No match yet.</>;
}

function formatNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
