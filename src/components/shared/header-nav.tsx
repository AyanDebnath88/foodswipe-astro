"use client";

// The auth-aware half of the app nav (src/components/shared/AppHeader.astro).
// Design system v2 (design-language-v2.md #3): a floating ink pill fixed
// above the home indicator on mobile, flattening into a 68px ink app bar on
// desktop (>=1024px -- the pill returns below that). Three top-level
// destinations (Rooms/History/Saved) with icon + label; the active one is a
// terracotta pill, not an underline.
//
// MOBILE AUTO-COLLAPSE (user feedback: too much chrome on first load): both
// the floating destination pill and the account strip (room code / leave /
// log out) fly in on mount, then auto-collapse to a small round button in
// their own bottom-right / top-right corner 5s later. Tapping the button
// re-expands and restarts the 5s timer. Desktop's ink bar is unaffected --
// it's a normal always-visible top bar, nothing to declutter there.
//
// WHY THIS IS AN ISLAND rather than a server-side auth check: AppHeader is
// used by BOTH per-request pages (swipe.astro, match/[cuisine].astro --
// `prerender = false`) and statically prerendered ones (rooms/join.astro). A
// server-side `supabase.auth.getUser()` here would run at BUILD time for the
// static pages and bake in a permanent "signed out" answer. Reading the
// session client-side works identically on both kinds of page, and the nav is
// chrome, not an access-control boundary (RLS is), so a brief unresolved
// state costs nothing.
import { useEffect, useRef, useState } from "react";
import { Users, History as HistoryIcon, Heart, LogIn, UserPlus, LogOut, Menu, MoreHorizontal } from "lucide-react";
import { RoomControls } from "./room-controls";
import { getCurrentUser } from "@/lib/guest-auth";

interface HeaderNavProps {
  /** Room code from the page's ?room=CODE, when it has one. */
  roomCode?: string | null;
  /** Current pathname (Astro.url.pathname), for the active-item pill. */
  pathname: string;
}

const NAV_ITEMS = [
  { href: "/rooms", label: "Rooms", icon: Users },
  { href: "/history", label: "History", icon: HistoryIcon },
  { href: "/favorites", label: "Saved", icon: Heart },
] as const;

const AUTO_COLLAPSE_MS = 5000;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Fires `onExpire` once, AUTO_COLLAPSE_MS after every call to `restart()`. */
function useAutoCollapse(onExpire: () => void) {
  const timerRef = useRef<number | undefined>(undefined);
  const restart = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(onExpire, AUTO_COLLAPSE_MS);
  };
  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);
  return restart;
}

function NavItem({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: typeof Users;
  active: boolean;
}) {
  return (
    <a
      href={href}
      className={`flex w-[var(--fs-nav-item)] flex-col items-center justify-center gap-0.5 rounded-[var(--fs-r-pill)] py-1.5 text-[11px] font-medium transition-colors lg:h-[38px] lg:w-auto lg:flex-row lg:gap-1.5 lg:px-4 lg:text-sm ${
        active
          ? "bg-[var(--fs-terracotta-text)] text-[var(--fs-on-ink)]"
          : "text-[var(--fs-on-dark-4)] hover:text-[var(--fs-on-ink)]"
      }`}
    >
      <Icon className="h-5 w-5 lg:h-4 lg:w-4" aria-hidden="true" />
      <span>{label}</span>
    </a>
  );
}

export function HeaderNav({ roomCode = null, pathname }: HeaderNavProps) {
  // `null` = not resolved yet. Rendering neither branch until we know beats
  // guessing and then flipping.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [navExpanded, setNavExpanded] = useState(true);
  const [accountExpanded, setAccountExpanded] = useState(true);

  const restartNavCollapse = useAutoCollapse(() => setNavExpanded(false));
  const restartAccountCollapse = useAutoCollapse(() => setAccountExpanded(false));

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

  // Start each 5s countdown once the thing it collapses actually exists.
  useEffect(() => {
    if (signedIn !== null) restartNavCollapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);
  useEffect(() => {
    if (signedIn) restartAccountCollapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  const expandNav = () => {
    setNavExpanded(true);
    restartNavCollapse();
  };
  const expandAccount = () => {
    setAccountExpanded(true);
    restartAccountCollapse();
  };

  if (signedIn === null) {
    // Reserve roughly the right amount of space so nothing jumps once resolved.
    return <div className="h-full w-full" aria-hidden="true" />;
  }

  if (!signedIn) {
    const items = (
      <>
        <a
          href="/login"
          className="flex w-[var(--fs-nav-item)] flex-col items-center justify-center gap-0.5 rounded-[var(--fs-r-pill)] py-1.5 text-[11px] font-medium text-[var(--fs-on-dark-4)] hover:text-[var(--fs-on-ink)] lg:h-[38px] lg:w-auto lg:flex-row lg:gap-1.5 lg:px-4 lg:text-sm"
        >
          <LogIn className="h-5 w-5 lg:h-4 lg:w-4" aria-hidden="true" />
          <span>Log in</span>
        </a>
        <a
          href="/signup"
          className="flex w-[var(--fs-nav-item)] flex-col items-center justify-center gap-0.5 rounded-[var(--fs-r-pill)] bg-[var(--fs-terracotta-text)] py-1.5 text-[11px] font-medium text-[var(--fs-on-ink)] lg:h-[38px] lg:w-auto lg:flex-row lg:gap-1.5 lg:px-4 lg:text-sm"
        >
          <UserPlus className="h-5 w-5 lg:h-4 lg:w-4" aria-hidden="true" />
          <span>Sign up</span>
        </a>
      </>
    );
    return (
      <>
        {/* Mobile: same fixed floating pill + auto-collapse as the signed-in destinations pill below. */}
        <div
          className="fixed inset-x-5 z-40 lg:hidden"
          style={{ bottom: "var(--fs-nav-bottom)" }}
        >
          {navExpanded ? (
            <div className="flex h-[var(--fs-nav-pill-h)] items-center justify-around gap-2 rounded-[var(--fs-r-pill)] bg-[var(--fs-ink)] px-1.5 shadow-[var(--fs-e-float)] animate-nav-fly-in-up">
              {items}
            </div>
          ) : (
            <button
              type="button"
              onClick={expandNav}
              aria-label="Show sign in options"
              className="ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--fs-ink)] text-[var(--fs-on-ink)] shadow-[var(--fs-e-float)] animate-nav-fly-in-up"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="hidden h-full w-full items-center justify-end gap-3 lg:flex">{items}</div>
      </>
    );
  }

  return (
    <>
      {/*
        Mobile: room controls + Log out float top-right, collapsing to a
        small round button after 5s (tap to re-expand). position: fixed
        escapes this island's DOM position regardless of where AppHeader
        mounts it. Desktop: same two controls, always inline at the right of
        the ink bar, no collapse -- a normal top bar doesn't need to declutter.
      */}
      <div
        className="fixed inset-x-3 z-40 flex justify-end lg:hidden"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)" }}
      >
        {accountExpanded ? (
          <div className="flex gap-2 animate-nav-fly-in-side">
            <RoomControls roomCode={roomCode} floating />
            <a
              href="/logout"
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--fs-r-pill)] bg-[var(--fs-ink)] px-3 text-xs font-medium text-[var(--fs-on-dark-4)] shadow-[var(--fs-e-float)] hover:text-[var(--fs-on-ink)]"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Log out
            </a>
            <button
              type="button"
              onClick={() => setAccountExpanded(false)}
              aria-label="Hide room controls"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--fs-ink)] text-[var(--fs-on-dark-4)] shadow-[var(--fs-e-float)] hover:text-[var(--fs-on-ink)]"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={expandAccount}
            aria-label="Show room controls and log out"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--fs-ink)] text-[var(--fs-on-dark-4)] shadow-[var(--fs-e-float)] hover:text-[var(--fs-on-ink)] animate-nav-fly-in-side"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="hidden lg:block">
        <RoomControls roomCode={roomCode} />
      </div>

      {/*
        Mobile: the three-destination pill, same auto-collapse pattern --
        collapses to a plain hamburger button pinned bottom-right (the
        "burger pill" the feedback asked for), tap to bring the destinations
        back for another 5s.
      */}
      <div
        className="fixed inset-x-5 z-40 lg:hidden"
        style={{ bottom: "var(--fs-nav-bottom)" }}
      >
        {navExpanded ? (
          <div className="flex h-[var(--fs-nav-pill-h)] items-center justify-around rounded-[var(--fs-r-pill)] bg-[var(--fs-ink)] px-1.5 shadow-[var(--fs-e-float)] animate-nav-fly-in-up">
            {NAV_ITEMS.map(({ href, label, icon }) => (
              <NavItem key={href} href={href} label={label} Icon={icon} active={isActive(pathname, href)} />
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={expandNav}
            aria-label="Show navigation"
            className="ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--fs-ink)] text-[var(--fs-on-ink)] shadow-[var(--fs-e-float)] animate-nav-fly-in-up"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="hidden h-full w-full items-center lg:flex lg:w-auto lg:justify-end lg:gap-1">
        {NAV_ITEMS.map(({ href, label, icon }) => (
          <NavItem key={href} href={href} label={label} Icon={icon} active={isActive(pathname, href)} />
        ))}
        <a
          href="/logout"
          className="flex h-[38px] items-center gap-1.5 rounded-[var(--fs-r-pill)] px-4 text-sm font-medium text-[var(--fs-on-dark-4)] hover:text-[var(--fs-on-ink)]"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Log out
        </a>
      </div>
    </>
  );
}
