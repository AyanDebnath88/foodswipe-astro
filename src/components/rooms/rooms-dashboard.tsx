"use client";

// Phase 2, Task 1 (room create/join) + Task 3 (Realtime sync). Replaces the
// reference Next.js project's src/app/(app)/rooms/page.tsx, which used
// server actions (src/app/actions/rooms.ts) backed by a JSON file and a
// 2-second setInterval poll. Here: direct Supabase client calls
// (src/lib/rooms.ts) guarded by RLS, and a Realtime channel instead of
// polling.
//
// Card chrome (border/rounded-3xl/backdrop-blur) is inlined with Tailwind
// utility classes rather than importing an unported shadcn Card component --
// same approach src/pages/login.astro and signup.astro already use, and
// consistent with this rewrite's "lightweight" direction (see the phase
// brief in .claude/skills/build-log/SKILL.md): no new UI-primitive
// dependency for one page's worth of chrome.
import React, { useCallback, useEffect, useState } from "react";
import { Button, CtaArrow } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  clearActiveRoom,
  createRoom,
  fetchRoomById,
  fetchRoomParticipants,
  joinRoomByCode,
  leaveRoom,
  loadActiveRoom,
  saveActiveRoom,
  subscribeToRoom,
  type Participant,
  type RoomState,
} from "@/lib/rooms";
import { Users, Copy, Plus, LogIn, UserPlus, Loader2, LogOut, Link2 } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { consumeNotice, currentPathForRedirect, redirectWithNotice } from "@/lib/notices";

export function RoomsDashboard() {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [activeRoom, setActiveRoom] = useState<RoomState | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshParticipants = useCallback(async (roomId: string) => {
    setParticipants(await fetchRoomParticipants(roomId));
  }, []);

  // Show the reason the user was sent here, if they were sent here.
  //
  // Redirect reasons used to be toasted immediately before a
  // `window.location.href = ...`, which tears down the document and the toast
  // with it -- so "that room isn't available" / "sign in required" were never
  // actually seen, on any of the three redirect paths. The reason now travels
  // as a ?notice= CODE (never text -- see src/lib/notices.ts) and is consumed
  // and stripped from the URL here, so it shows exactly once.
  useEffect(() => {
    const notice = consumeNotice();
    if (!notice) return;
    toast({
      variant: notice.variant === "destructive" ? "destructive" : "default",
      title: notice.title,
      description: notice.description,
    });
  }, [toast]);

  // Auth check + resume an in-progress room from localStorage, mirroring
  // the reference app's checkUser()/food_swipe_active_room logic.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;

      if (!user) {
        // The toast used to be destroyed by the navigation on the very next
        // line, so the user was bounced to /login with no explanation at all.
        redirectWithNotice("/login", "sign-in-required", { redirect: currentPathForRedirect() });
        return;
      }
      setUserId(user.id);

      const stored = loadActiveRoom();
      if (stored) {
        const room = await fetchRoomById(stored.id);
        if (room && !cancelled) {
          setActiveRoom(room);
          await refreshParticipants(room.id);
        } else {
          clearActiveRoom();
        }
      }
      if (!cancelled) setCheckingAuth(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshParticipants, toast]);

  // Realtime sync while inside a room -- replaces the reference app's
  // 2-second setInterval poll (rooms/page.tsx).
  useEffect(() => {
    if (!activeRoom) return;
    const unsubscribe = subscribeToRoom(activeRoom.id, {
      onSessionChange: (room) => {
        setActiveRoom(room);
        if (room.status === "matched" && room.matchedCuisineId) {
          // NOT clearActiveRoom(). Matching is the HAPPY path and the room is
          // still very much alive -- the group still has to pick a restaurant
          // and swipe dishes together. Wiping the active-room cache at the
          // moment they succeed is what made "Back to the room" from the match
          // page land on an empty dashboard.
          saveActiveRoom({ id: room.id, code: room.code });
          toast({
            title: "It's a Match!",
            description: "A consensus was reached! Redirecting to matches...",
          });
          window.location.href = `/match/${room.matchedCuisineId}?room=${room.code}`;
        }
      },
      onParticipantsChange: () => refreshParticipants(activeRoom.id),
    });
    return unsubscribe;
  }, [activeRoom?.id, refreshParticipants, toast]);

  const handleCreateRoom = async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const room = await createRoom(userId);
      saveActiveRoom({ id: room.id, code: room.code });
      setActiveRoom(room);
      await refreshParticipants(room.id);
      toast({
        title: "Dining Room Created!",
        description: `Room code: ${room.code}. Share this code with friends!`,
      });
    } catch (err) {
      console.error("Failed to create room:", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage(err, "Could not create swipe room. Please try again."),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCodeInput.trim().length !== 4) {
      toast({
        variant: "destructive",
        title: "Invalid Code",
        description: "Please enter a valid 4-character room code.",
      });
      return;
    }
    setIsLoading(true);
    try {
      const room = await joinRoomByCode(roomCodeInput);
      saveActiveRoom({ id: room.id, code: room.code });
      setActiveRoom(room);
      await refreshParticipants(room.id);
      toast({ title: "Joined Room!", description: `Successfully joined room ${room.code}.` });
    } catch (err) {
      console.error("Failed to join room:", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage(err, "Could not join the swipe room."),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // A real leave: leaveRoom() DELETEs this user's room_participants row (see
  // src/lib/rooms.ts) before clearing the local cache. This used to be a
  // localStorage-only clear, which left a ghost participant inflating the
  // match trigger's unanimity denominator -- the room could then never match
  // again, because someone who had visibly "left" still had to vote.
  const handleLeaveRoom = async () => {
    if (!activeRoom || !userId || isLoading) return;
    setIsLoading(true);
    try {
      await leaveRoom(activeRoom.id, userId);
      setActiveRoom(null);
      setParticipants([]);
      toast({ title: "Room Left", description: "You have left the swiping session." });
    } catch (err) {
      console.error("Failed to leave room:", err);
      toast({
        variant: "destructive",
        title: "Could not leave",
        description: errorMessage(err, "You're still in the room -- please try again."),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyRoomCode = () => {
    if (!activeRoom) return;
    navigator.clipboard.writeText(activeRoom.code);
    toast({ title: "Code Copied!", description: `Room code ${activeRoom.code} copied to clipboard.` });
  };

  // Task 1's shareable deep link: /rooms/join?code=XXXX, which pre-fills
  // and auto-attempts the join (src/components/rooms/join-by-link.tsx),
  // rather than making friends type a raw code in by hand.
  const copyShareLink = () => {
    if (!activeRoom) return;
    const link = `${window.location.origin}/rooms/join?code=${activeRoom.code}`;
    navigator.clipboard.writeText(link);
    toast({ title: "Link Copied!", description: "Shareable join link copied to clipboard." });
  };

  const handleStartSwiping = () => {
    if (!activeRoom) return;
    window.location.href = `/swipe?room=${activeRoom.code}`;
  };

  if (checkingAuth) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-body">Verifying session details...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 max-w-4xl pb-16">
      <div className="text-center mb-12">
        <h1 className="font-display text-4xl font-extrabold uppercase tracking-[-.02em] text-foreground md:text-5xl">
          Social Swiping Rooms
        </h1>
        <p className="text-muted-foreground mt-3 font-body text-lg max-w-2xl mx-auto">
          Host a private swipe room or enter a code to join one. Swipe together in real-time to discover
          mutual cravings with friends!
        </p>
      </div>

      {!activeRoom ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          {/* HOST PANEL */}
          <div className="flex flex-col border border-[var(--fs-line)] bg-card shadow-[var(--fs-e-1)] transition-shadow duration-300 hover:shadow-[var(--fs-e-2)] rounded-[var(--fs-r-xl)] p-6">
            <div className="w-12 h-12 rounded-[var(--fs-r-md)] bg-[var(--fs-terracotta)]/15 flex items-center justify-center text-[var(--fs-terracotta)] mb-2">
              <Plus className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-headline">Host a Group Swipe</h2>
            <p className="font-body text-sm text-muted-foreground mt-1">
              Start a session and get a private room code. Share the code (or a link) with your partner or
              friends to swipe together.
            </p>
            <div className="flex-1 flex flex-col justify-end mt-6">
              <div className="bg-[var(--fs-cream-tint)] rounded-[var(--fs-r-md)] p-4 border border-[var(--fs-line)] mb-6">
                <h4 className="font-body font-semibold text-sm text-foreground flex items-center gap-1.5 mb-1.5">
                  <Users className="h-4 w-4 text-[var(--fs-terracotta)]" /> Multi-user Matchmaking
                </h4>
                <p className="font-body text-xs text-muted-foreground leading-relaxed">
                  The system tracks swipes of 2-4 users simultaneously and fires an immediate alert when all
                  diners swipe right on the same cuisine!
                </p>
              </div>
              <Button variant="cta" onClick={handleCreateRoom} disabled={isLoading}>
                <span>{isLoading ? "Creating..." : "Host Dining Room"}</span>
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CtaArrow />}
              </Button>
            </div>
          </div>

          {/* JOIN PANEL */}
          <div className="flex flex-col border border-[var(--fs-line)] bg-card shadow-[var(--fs-e-1)] transition-shadow duration-300 hover:shadow-[var(--fs-e-2)] rounded-[var(--fs-r-xl)] p-6">
            <div className="w-12 h-12 rounded-[var(--fs-r-md)] bg-[var(--fs-gold)]/25 flex items-center justify-center text-[var(--fs-text)] mb-2">
              <UserPlus className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-headline">Join a Swipe Room</h2>
            <p className="font-body text-sm text-muted-foreground mt-1">
              Enter a 4-letter room code (e.g. ABCD) shared by your partner or friends to jump directly into
              their swiping session.
            </p>
            <form onSubmit={handleJoinRoom} className="space-y-6 mt-6 flex-1 flex flex-col justify-end">
              <div className="space-y-2">
                <label
                  htmlFor="roomCode"
                  className="font-body text-xs text-muted-foreground uppercase font-bold tracking-wider"
                >
                  Enter 4-Letter Room Code
                </label>
                <Input
                  id="roomCode"
                  type="text"
                  maxLength={4}
                  placeholder="ABCD"
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  className="h-14 text-center text-3xl font-headline uppercase tracking-[0.5em] rounded-[var(--fs-r-md)]"
                  disabled={isLoading}
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={isLoading || roomCodeInput.trim().length !== 4}
                className="w-full h-12"
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                Join Session Room
              </Button>
            </form>
          </div>
        </div>
      ) : (
        // ACTIVE ROOM DETAILS (WAITING ROOM HUB)
        <div className="max-w-xl mx-auto">
          <div className="border-2 border-primary/20 bg-card/75 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-primary/10 border-b border-primary/15 py-8 text-center">
              <p className="font-body text-xs text-primary font-bold uppercase tracking-widest">
                Your Private Room Code
              </p>
              <div className="flex items-center justify-center gap-3 mt-2">
                <span className="text-5xl font-headline font-bold text-foreground tracking-widest select-all">
                  {activeRoom.code}
                </span>
                <Button variant="ghost" size="icon" onClick={copyRoomCode} className="h-10 w-10 rounded-full">
                  <Copy className="h-5 w-5 text-primary" />
                  <span className="sr-only">Copy code</span>
                </Button>
              </div>
              <div className="mt-4 px-6">
                <Button variant="outline" size="sm" onClick={copyShareLink} className="rounded-full">
                  <Link2 className="h-4 w-4" />
                  Copy shareable join link
                </Button>
              </div>
              <p className="font-body text-xs text-muted-foreground mt-3 px-6">
                Share the code or link with up to 3 friends so they can join from their phone or browser --
                no account needed on their end.
              </p>
            </div>

            <div className="py-6 px-6">
              <h3 className="text-xl font-headline flex items-center justify-between">
                <span>Diners Joined ({participants.length})</span>
                <Badge variant={participants.length >= 2 ? "done" : "distance"}>
                  {participants.length >= 2 ? "Ready to Swipe" : "Waiting for Friends"}
                </Badge>
              </h3>

              <div className="space-y-3 mt-4">
                {participants.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex items-center justify-between p-3.5 bg-background/50 rounded-2xl border border-black/5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/20 text-primary font-headline flex items-center justify-center font-bold">
                        {participant.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-body text-sm font-semibold text-foreground">
                          {participant.displayName}
                        </span>
                        {participant.id === activeRoom.creatorId && (
                          <Badge variant="distance" className="ml-2">
                            Host
                          </Badge>
                        )}
                        {participant.isGuest && (
                          <Badge variant="sponsored" className="ml-2">
                            Guest
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--fs-forest)] animate-pulse" />
                  </div>
                ))}
              </div>

              {participants.length === 1 && (
                <div className="mt-6 flex flex-col items-center justify-center py-6 border border-dashed rounded-2xl gap-3">
                  <Loader2 className="h-6 w-6 text-primary animate-spin" />
                  <p className="font-body text-xs text-muted-foreground text-center px-4">
                    Waiting for others to join... Share the room code{" "}
                    <span className="font-bold text-foreground select-all">{activeRoom.code}</span> or the join
                    link above.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-4 border-t border-black/5 pt-6 pb-8 px-6">
              <Button
                onClick={handleLeaveRoom}
                variant="outline"
                className="w-full sm:w-auto h-12 rounded-2xl flex gap-2 shrink-0"
              >
                <LogOut className="h-4 w-4" />
                Leave Room
              </Button>
              <Button variant="cta" onClick={handleStartSwiping} className="flex-1">
                <span>Start Swiping Together</span>
                <CtaArrow />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
