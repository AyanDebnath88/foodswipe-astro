"use client";

// The auth-aware half of the app nav (src/components/shared/AppHeader.astro).
// Design system v2 (design-language-v2.md #3): a floating ink pill fixed
// above the home indicator on mobile, flattening into a 68px ink app bar on
// desktop (>=1024px -- the pill returns below that). Three top-level
// destinations (Rooms/History/Saved) with icon + label; the active one is a
// terracotta pill, not an underline.
//
// WHY THIS IS AN ISLAND rather than a server-side auth check: AppHeader is
// used by BOTH per-request pages (swipe.astro, match/[cuisine].astro --
// `prerender = false`) and statically prerendered ones (rooms/join.astro). A
// server-side `supabase.auth.getUser()` here would run at BUILD time for the
// static pages and bake in a permanent "signed out" answer. Reading the
// session client-side works identically on both kinds of page, and the nav is
// chrome, not an access-control boundary (RLS is), so a brief unresolved
// state costs nothing.
import { useEffect, useState } from "react";
import { Users, History as HistoryIcon, Heart, LogIn, UserPlus, LogOut } from "lucide-react";
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

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
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
    // Reserve roughly the right amount of space so nothing jumps once resolved.
    return <div className="h-full w-full" aria-hidden="true" />;
  }

  if (!signedIn) {
    return (
      <div className="flex h-full w-full items-center justify-around gap-2 lg:justify-end lg:gap-3">
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
      </div>
    );
  }

  return (
    <>
      {/*
        Mobile: room controls + Log out float in their own strip above the
        pill (position: fixed escapes this island's DOM position regardless
        of where AppHeader.astro mounts it) -- neither gets one of the pill's
        three destination slots, but both must stay reachable; the app has no
        other account surface. Desktop: same two controls, inline at the
        right of the ink bar instead.
      */}
      <div
        className="pointer-events-none fixed inset-x-5 z-40 flex justify-end gap-2 lg:hidden"
        style={{ bottom: "calc(var(--fs-nav-bottom) + var(--fs-nav-pill-h) + 10px)" }}
      >
        <div className="pointer-events-auto">
          <RoomControls roomCode={roomCode} floating />
        </div>
        <a
          href="/logout"
          className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-[var(--fs-r-pill)] bg-[var(--fs-ink)] px-3 text-xs font-medium text-[var(--fs-on-dark-4)] shadow-[var(--fs-e-float)] hover:text-[var(--fs-on-ink)]"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Log out
        </a>
      </div>

      <div className="hidden lg:block">
        <RoomControls roomCode={roomCode} />
      </div>

      <div className="flex h-full w-full items-center justify-around lg:w-auto lg:justify-end lg:gap-1">
        {NAV_ITEMS.map(({ href, label, icon }) => (
          <NavItem key={href} href={href} label={label} Icon={icon} active={isActive(pathname, href)} />
        ))}
        <a
          href="/logout"
          className="hidden lg:flex h-[38px] items-center gap-1.5 rounded-[var(--fs-r-pill)] px-4 text-sm font-medium text-[var(--fs-on-dark-4)] hover:text-[var(--fs-on-ink)]"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Log out
        </a>
      </div>
    </>
  );
}
