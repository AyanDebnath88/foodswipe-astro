"use client";

// Phase 2, Task 1: shareable deep link + guest join.
//
// Mounted on /rooms/join (src/pages/rooms/join.astro), reading `?code=XXXX`
// from the URL. Two paths:
//   1. A session already exists (guest or real, e.g. a returning user
//      clicking a link they were sent earlier) -- join immediately, no
//      prompt.
//   2. No session at all -- this is the P0 guest-join fix: prompt for a
//      display name only, then ensureGuestSession() (signInAnonymously()
//      under the hood, src/lib/guest-auth.ts) before joining. No email,
//      password, or account creation anywhere in this path.
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { getCurrentUser, ensureGuestSession } from "@/lib/guest-auth";
import { joinRoomByCode, saveActiveRoom } from "@/lib/rooms";
import { Loader2, UtensilsCrossed } from "lucide-react";

type Stage = "checking" | "need-name" | "joining" | "error";

export function JoinByLink() {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("checking");
  const [displayName, setDisplayName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Read `?code=` client-side (via window.location) rather than as a prop
  // threaded from the Astro page's server-side Astro.url.searchParams.
  // That keeps src/pages/rooms/join.astro on Astro's default static
  // output -- reading the query string at request time would otherwise
  // require `export const prerender = false` (see src/pages/swipe.astro's
  // comment for why: a static build has no query string at build time, so
  // a server-read code would bake in as permanently empty). This
  // component already needs the browser (localStorage, Supabase auth
  // session) so reading window.location here costs nothing extra.
  const [cleanCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("code")?.trim().toUpperCase() ?? "";
  });

  async function completeJoin() {
    setStage("joining");
    try {
      const room = await joinRoomByCode(cleanCode);
      saveActiveRoom({ id: room.id, code: room.code });
      toast({ title: "Joined Room!", description: `Successfully joined room ${room.code}.` });
      window.location.href = "/rooms";
    } catch (err) {
      console.error("Failed to join room via link:", err);
      setErrorMessage(err instanceof Error ? err.message : "Could not join this room.");
      setStage("error");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cleanCode.length !== 4) {
        setErrorMessage("This join link is missing a valid room code.");
        setStage("error");
        return;
      }
      const user = await getCurrentUser();
      if (cancelled) return;
      if (user) {
        await completeJoin();
      } else {
        setStage("need-name");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanCode]);

  async function handleGuestSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (displayName.trim().length < 1) {
      toast({ variant: "destructive", title: "Name required", description: "Tell us what to call you." });
      return;
    }
    setStage("joining");
    try {
      await ensureGuestSession(displayName);
      await completeJoin();
    } catch (err) {
      console.error("Guest sign-in failed:", err);
      setErrorMessage(err instanceof Error ? err.message : "Could not create a guest session.");
      setStage("error");
    }
  }

  if (stage === "checking" || stage === "joining") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center px-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-body">
          {stage === "joining" ? `Joining room ${cleanCode}...` : "Checking your session..."}
        </p>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center px-4">
        <p className="text-destructive font-body">{errorMessage}</p>
        <Button variant="outline" onClick={() => (window.location.href = "/rooms")}>
          Go to Rooms
        </Button>
      </div>
    );
  }

  // stage === "need-name": guest path, no account required.
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
      <div className="w-full max-w-sm rounded-3xl border border-primary/20 bg-card/75 backdrop-blur-md shadow-2xl p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center text-primary mx-auto mb-4">
          <UtensilsCrossed className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-headline">You're invited to swipe!</h1>
        <p className="text-muted-foreground font-body text-sm mt-2">
          Room <span className="font-bold text-foreground select-all">{cleanCode}</span> is waiting. Just tell
          us what to call you -- no account needed.
        </p>
        <form onSubmit={handleGuestSubmit} className="mt-6 space-y-4 text-left">
          <div className="space-y-2">
            <label htmlFor="guestName" className="font-body text-xs text-muted-foreground uppercase font-bold tracking-wider">
              Your Name
            </label>
            <Input
              id="guestName"
              type="text"
              placeholder="e.g. Jamie"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-12 rounded-2xl"
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full h-12 rounded-2xl">
            Join Room {cleanCode}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-4 font-body">
          Already have an account? <a href="/login" className="underline">Log in</a> first to keep your
          profile across rooms.
        </p>
      </div>
    </div>
  );
}
