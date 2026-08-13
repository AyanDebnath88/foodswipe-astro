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
import { clearActiveRoom, fetchRoomByCode, leaveRoom, loadActiveRoom } from "@/lib/rooms";
import { getCurrentUser } from "@/lib/guest-auth";

interface RoomControlsProps {
  /**
   * The room code the *page* knows about (from ?room=CODE). Pages that don't
   * know one -- /rooms, /rooms/join -- omit it and we fall back to the
   * `foodswipe_active_room` localStorage cache.
   */
  roomCode?: string | null;
}

export function RoomControls({ roomCode = null }: RoomControlsProps) {
  const [room, setRoom] = useState<{ id: string | null; code: string } | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = loadActiveRoom();
      const wanted = roomCode?.trim().toUpperCase() ?? null;

      if (!wanted) {
        if (!cancelled) setRoom(stored);
        return;
      }
      // Fast path: the page's room is the cached one, so we already have the
      // id and can skip a round trip.
      if (stored?.code === wanted) {
        if (!cancelled) setRoom(stored);
        return;
      }
      // Otherwise resolve the id, which we need for the server-side leave.
      // fetchRoomByCode() is RLS-guarded and returns null for a room this
      // user isn't a participant of -- in that case we still show the code
      // (the page is about that room) but "leave" degrades to a local reset,
      // which is correct: there is no participant row to delete.
      const resolved = await fetchRoomByCode(wanted);
      if (cancelled) return;
      setRoom({ id: resolved?.id ?? null, code: wanted });
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  async function handleLeave() {
    if (leaving) return;
    const confirmed = window.confirm(
      "Leave this room and start over? You'll stop counting toward the group's votes, and the others can keep going without you."
    );
    if (!confirmed) return;

    setLeaving(true);
    try {
      const user = await getCurrentUser();
      if (room?.id && user) {
        // Real server-side leave -- deletes the room_participants row so the
        // match trigger's unanimity denominator actually shrinks. A local
        // clear alone would leave a ghost participant who has to keep voting
        // for the room to ever match again.
        await leaveRoom(room.id, user.id);
      } else {
        clearActiveRoom();
      }
    } catch (err) {
      console.error("Leave room failed:", err);
      // Deliberately do NOT clear the local cache here: the user is still a
      // participant server-side, so pretending otherwise would hide the room
      // from them while they still block the group's matches.
      window.alert("Could not leave the room -- check your connection and try again.");
      setLeaving(false);
      return;
    }
    window.location.href = "/rooms";
  }

  if (!room) return null;

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 font-body text-xs text-foreground sm:inline-flex"
        title="The room you're currently swiping in"
      >
        <span className="text-muted-foreground">Room</span>
        <span className="font-headline text-sm font-bold tracking-widest select-all">{room.code}</span>
      </span>
      <button
        type="button"
        onClick={handleLeave}
        disabled={leaving}
        className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 font-body text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-60"
      >
        {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}
        <span className="hidden sm:inline">Leave room</span>
        <span className="sm:hidden">Leave</span>
      </button>
    </div>
  );
}
