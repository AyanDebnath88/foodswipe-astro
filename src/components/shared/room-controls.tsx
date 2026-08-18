"use client";

// The room-aware half of the app header (src/components/shared/AppHeader.astro).
//
// This is the ONLY part of the header that needs to be a React island: the
// active room is client state (localStorage + a Supabase read), and leaving a
// room is an authenticated DELETE. Everything else in the header -- logo,
// Rooms link, Log out -- is static Astro markup with no JS.
//
// Why the header needs this at all: before it existed, every in-app page was
// a dead end. Once a user was on /swipe or /match/... there was no way home,
// no way out of the room, and no way to start over short of editing the URL.
import { useEffect, useState } from "react";
import { DoorOpen, Loader2 } from "lucide-react";
import {
  fetchRoomById,
  fetchRoomByCode,
  isRoomParticipant,
  leaveRoom,
  loadActiveRoom,
} from "@/lib/rooms";
import { getCurrentUser } from "@/lib/guest-auth";
import { errorMessage } from "@/lib/errors";

interface RoomControlsProps {
  /**
   * The room code the *page* knows about (from ?room=CODE). Pages that don't
   * know one -- /rooms, /rooms/join -- omit it and we fall back to the
   * `foodswipe_active_room` localStorage cache.
   */
  roomCode?: string | null;
  /**
   * Rendered inside the mobile floating account strip (ink background) vs
   * inline in the desktop ink app bar. Both are dark surfaces, but the
   * floating strip needs its own shadow/pill chrome since it isn't already
   * sitting inside a bar.
   */
  floating?: boolean;
}

export function RoomControls({ roomCode = null, floating = false }: RoomControlsProps) {
  // `id` is NON-nullable now. A control that can't name the room it acts on
  // has no business being on screen -- see handleLeave().
  const [room, setRoom] = useState<{ id: string; code: string } | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = loadActiveRoom();
      const wanted = roomCode?.trim().toUpperCase() ?? null;
      const user = await getCurrentUser();
      if (cancelled) return;
      if (!user) {
        setRoom(null);
        return;
      }

      // Resolve the room this PAGE is about, falling back to the cached one
      // only when the page doesn't name a room at all.
      let resolved: { id: string; code: string } | null = null;
      if (wanted) {
        const byCode = await fetchRoomByCode(wanted);
        resolved = byCode ? { id: byCode.id, code: byCode.code } : null;
      } else if (stored) {
        // Re-verify the cache against the database -- it's a cache, never the
        // source of truth, and it can point at a room that has since been
        // deleted or that this user has left.
        const byId = await fetchRoomById(stored.id);
        resolved = byId ? { id: byId.id, code: byId.code } : null;
      }
      if (cancelled) return;

      // The control renders ONLY for a room this user is genuinely a member
      // of. This is the fix for a real data-loss bug: the old version showed
      // "Leave room" for any `?room=CODE` in the URL and, when it couldn't
      // resolve an id, fell back to clearActiveRoom() -- which wipes the one
      // global `foodswipe_active_room` key regardless of which room it refers
      // to. With room ZJHM active, visiting /match/italian?room=ZZZZ and
      // pressing Leave destroyed the ZJHM record while leaving the user a
      // participant of ZJHM server-side, still counted in its unanimity
      // denominator, with no "my rooms" list to recover from.
      if (!resolved || !(await isRoomParticipant(resolved.id, user.id))) {
        if (!cancelled) setRoom(null);
        return;
      }
      if (!cancelled) setRoom(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  async function handleLeave() {
    if (leaving || !room) return;
    const confirmed = window.confirm(
      `Leave room ${room.code} and start over? You'll stop counting toward the group's votes, and the others can keep going without you.`
    );
    if (!confirmed) return;

    setLeaving(true);
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error("You're signed out.");
      // The ONLY thing this button may ever do: a real server-side leave of
      // the room it is displaying. leaveRoom() deletes this user's
      // room_participants row (so the unanimity denominator actually shrinks)
      // and then clears the local cache only if it points at THIS room
      // (clearActiveRoomIfMatches). There is deliberately no "else" branch --
      // if we can't identify the room, the control isn't rendered at all.
      await leaveRoom(room.id, user.id);
    } catch (err) {
      console.error("Leave room failed:", err);
      // Deliberately do NOT clear the local cache here: the user is still a
      // participant server-side, so pretending otherwise would hide the room
      // from them while they still block the group's matches.
      window.alert(
        errorMessage(err, "Could not leave the room -- check your connection and try again.")
      );
      setLeaving(false);
      return;
    }
    window.location.href = "/rooms";
  }

  if (!room) return null;

  const chipClass = floating
    ? "inline-flex items-center gap-1.5 rounded-[var(--fs-r-pill)] bg-[var(--fs-ink)] px-3 h-9 font-body text-xs text-[var(--fs-on-ink)] shadow-[var(--fs-e-float)]"
    : "hidden items-center gap-1.5 rounded-[var(--fs-r-pill)] border border-[var(--fs-glass-line)] bg-white/5 px-3 py-1 font-body text-xs text-[var(--fs-on-ink)] sm:inline-flex";

  return (
    <div className="flex items-center gap-2">
      <span className={chipClass} title="The room you're currently swiping in">
        <span className={floating ? "text-[var(--fs-on-dark-4)]" : "text-[var(--fs-on-dark-4)]"}>Room</span>
        <span className="font-display text-sm font-bold tracking-widest select-all">{room.code}</span>
      </span>
      <button
        type="button"
        onClick={handleLeave}
        disabled={leaving}
        className={
          floating
            ? "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--fs-r-pill)] bg-[var(--fs-ink)] px-3 font-body text-xs font-medium text-[var(--fs-on-dark-4)] shadow-[var(--fs-e-float)] transition-colors hover:text-[var(--fs-on-ink)] disabled:pointer-events-none disabled:opacity-60"
            : "inline-flex h-[38px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--fs-r-pill)] px-3 font-body text-sm font-medium text-[var(--fs-on-dark-4)] transition-colors hover:text-[var(--fs-on-ink)] disabled:pointer-events-none disabled:opacity-60"
        }
      >
        {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}
        <span className={floating ? "" : "hidden sm:inline"}>Leave room</span>
      </button>
    </div>
  );
}
