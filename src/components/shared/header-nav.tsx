"use client";

// The auth-aware half of the app header (src/components/shared/AppHeader.astro).
//
// WHY THIS IS AN ISLAND rather than a server-side auth check in the .astro
// file: AppHeader is used by BOTH per-request pages (swipe.astro,
// match/[cuisine].astro -- `prerender = false`) and statically prerendered
// ones (rooms/join.astro). A server-side `supabase.auth.getUser()` in the
// header would run at BUILD time for the static pages, when there is no
// request and therefore no session, and would bake in a permanent
// "signed out" answer -- the exact static/per-request trap documented in the
// build log's "Astro output mode" pattern. Reading the session client-side
// works identically on both kinds of page, and the header is chrome, not an
// access-control boundary (RLS is), so a brief unresolved state costs nothing.
//
// The bug this fixes: the header was entirely static markup with no auth
// branch, so it showed "Log out" and the room controls to signed-out visitors.
// That was at its most self-contradictory on the guest-invite page
// (/rooms/join), which tells the visitor "no account needed" while the header
// above it offered to log them out of the account they don't have.
import { useEffect, useState } from "react";
import { RoomControls } from "./room-controls";
import { getCurrentUser } from "@/lib/guest-auth";

interface HeaderNavProps {
  /** Room code from the page's ?room=CODE, when it has one. */
  roomCode?: string | null;
}

const LINK_CLASS =
  "inline-flex h-9 items-center justify-center rounded-md px-3 font-body text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground";

export function HeaderNav({ roomCode = null }: HeaderNavProps) {
  // `null` = not resolved yet. Rendering neither branch until we know beats
  // guessing and then flipping: a nav that offers "Log out" and then swaps to
  // "Log in" a moment later is worse than one that appears a moment late.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (!cancelled) setSignedIn(user !== null);
      })
      .catch(() => {
        // Supabase unreachable -- treat as signed out. The signed-out nav is
        // the safe default: it offers a way IN, whereas the signed-in nav
        // offers actions that would fail anyway.
        if (!cancelled) setSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (signedIn === null) {
    // Reserve roughly the right amount of space so the header doesn't jump.
    return <div className="h-9 w-24" aria-hidden="true" />;
  }

  if (!signedIn) {
    return (
      <>
        <a href="/login" className={`${LINK_CLASS} text-foreground`}>
          Log in
        </a>
        <a
          href="/signup"
          className={`${LINK_CLASS} bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground`}
        >
          Sign up
        </a>
      </>
    );
  }

  return (
    <>
      <a href="/rooms" className={`${LINK_CLASS} text-foreground`}>
        Rooms
      </a>
      {/*
        Phase 4 (retention loop) links, moved in here from the static markup
        along with the rest of the nav. Both are per-user pages, so they only
        make sense for a signed-in visitor. Hidden below `sm` so the mobile
        header doesn't wrap -- neither page is stranded there, since /history
        and /favorites cross-link to each other from their empty states and
        the room cards.
      */}
      <a href="/history" className={`hidden ${LINK_CLASS} text-foreground sm:inline-flex`}>
        History
      </a>
      <a href="/favorites" className={`hidden ${LINK_CLASS} text-foreground sm:inline-flex`}>
        Saved
      </a>
      <RoomControls roomCode={roomCode} />
      <a href="/logout" className={`${LINK_CLASS} text-muted-foreground`}>
        Log out
      </a>
    </>
  );
}
