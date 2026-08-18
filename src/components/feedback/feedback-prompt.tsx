"use client";

// Phase 4 — the post-meal feedback prompt.
//
// Three rules the brief set, and how each one is actually enforced here:
//
//   NEVER BLOCKING   — it is a card in the page flow, never a modal, never
//                      an overlay, and it never gates anything behind
//                      answering. Everything around it stays usable.
//   ALWAYS DISMISSIBLE — "Not now" hides it and remembers that per session
//                      in localStorage, so it does not re-nag on every
//                      visit to the same room's card.
//   NEVER A DEAD END — every state has a way out: collapsed has "Not now",
//                      the form has "Cancel", and a filed answer has "Edit"
//                      and "Remove". Filing feedback is reversible, the same
//                      way "Done — show our order" is (see the multi-dish
//                      product decision in the build log: don't reintroduce
//                      terminal states).
//
// Card chrome is inlined Tailwind rather than a ported shadcn Card, matching
// rooms-dashboard.tsx and the login/signup pages.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  NOTES_MAX_LENGTH,
  deleteFeedback,
  fetchSessionFeedback,
  saveFeedback,
  type SessionFeedback,
} from "@/lib/feedback";
import { Star, MessageSquarePlus, Check, X, Loader2, Trash2, Pencil } from "lucide-react";

const DISMISS_KEY = "foodswipe_feedback_dismissed";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  if (typeof window === "undefined") return;
  // Bounded: this is a convenience cache, not a record. 50 rooms of
  // "not now" is far more than anyone accumulates, and an unbounded
  // localStorage list that only ever grows is a slow leak.
  localStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(-50)));
}

export interface FeedbackPromptProps {
  sessionId: string;
  userId: string;
  /** Room code, for copy only ("your ABCD dinner"). */
  roomCode?: string;
  /** Pre-fills the form when the group agreed a dish at exactly one place. */
  restaurantName?: string | null;
  dishName?: string | null;
  /** Feedback already loaded by the parent, to save a round trip. */
  initialFeedback?: SessionFeedback[];
  /** Parent refresh hook (the history page re-sorts on answer). */
  onChanged?: () => void;
}

export function FeedbackPrompt({
  sessionId,
  userId,
  roomCode,
  restaurantName = null,
  dishName = null,
  initialFeedback,
  onChanged,
}: FeedbackPromptProps) {
  const { toast } = useToast();
  const [feedback, setFeedback] = useState<SessionFeedback[]>(initialFeedback ?? []);
  const [loading, setLoading] = useState(initialFeedback === undefined);
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [didGo, setDidGo] = useState<boolean | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const mine = useMemo(() => feedback.find((f) => f.userId === userId) ?? null, [feedback, userId]);

  useEffect(() => {
    setDismissed(readDismissed().includes(sessionId));
  }, [sessionId]);

  useEffect(() => {
    if (initialFeedback !== undefined) {
      setFeedback(initialFeedback);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const rows = await fetchSessionFeedback(sessionId);
      if (!cancelled) {
        setFeedback(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, initialFeedback]);

  const openForm = useCallback(() => {
    setDidGo(mine ? mine.didGo : null);
    setRating(mine?.rating ?? null);
    setNotes(mine?.notes ?? "");
    setEditing(true);
  }, [mine]);

  const handleDismiss = () => {
    const ids = readDismissed();
    if (!ids.includes(sessionId)) writeDismissed([...ids, sessionId]);
    setDismissed(true);
  };

  const handleSave = async () => {
    if (didGo === null) return;
    setSaving(true);
    try {
      const saved = await saveFeedback({
        sessionId,
        userId,
        didGo,
        rating,
        restaurantName,
        dishName,
        notes,
      });
      setFeedback((prev) => [...prev.filter((f) => f.userId !== userId), saved]);
      setEditing(false);
      toast({
        title: "Thanks — noted",
        description: didGo
          ? "We'll use this to make your next suggestions better."
          : "Recorded that this one didn't happen.",
      });
      onChanged?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't save that",
        description:
          err instanceof Error ? err.message : "Something went wrong saving your feedback.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await deleteFeedback(sessionId, userId);
      setFeedback((prev) => prev.filter((f) => f.userId !== userId));
      setEditing(false);
      toast({ title: "Feedback removed" });
      onChanged?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't remove that",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  // ---------------------------------------------------------------------
  // Already answered — show the group's answers, offer edit/remove.
  // ---------------------------------------------------------------------
  if (mine && !editing) {
    return (
      <div className="rounded-[var(--fs-r-lg)] border border-[var(--fs-line)] bg-accent/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-body text-sm font-medium text-foreground">
              {mine.didGo ? "You went" : "You didn't end up going"}
              {mine.didGo && mine.rating !== null ? (
                <span className="ml-2 inline-flex align-middle">
                  <Stars value={mine.rating} />
                </span>
              ) : null}
            </p>
            {mine.notes ? (
              <p className="mt-1 break-words font-body text-sm text-muted-foreground">
                “{mine.notes}”
              </p>
            ) : null}
            <GroupSummary feedback={feedback} />
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={openForm} disabled={saving}>
              <Pencil /> Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRemove} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Collapsed prompt.
  // ---------------------------------------------------------------------
  if (!editing) {
    if (dismissed) {
      // Dismissed is not gone. A one-line, low-contrast way back in — a
      // dismissed prompt that can never be reopened is a dead end for
      // anyone who taps "Not now" and later changes their mind.
      return (
        <button
          type="button"
          onClick={() => {
            setDismissed(false);
            openForm();
          }}
          className="font-body text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Add feedback for this one
        </button>
      );
    }
    return (
      <div className="rounded-[var(--fs-r-lg)] border border-primary/20 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-headline text-base font-semibold text-foreground">
              How did {roomCode ? `room ${roomCode}` : "it"} go?
            </p>
            <p className="font-body text-sm text-muted-foreground">
              {restaurantName
                ? `Did you make it to ${restaurantName}?`
                : "Did the group actually go?"}{" "}
              Takes one tap.
            </p>
            <GroupSummary feedback={feedback} />
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={openForm}>
              <MessageSquarePlus /> Tell us
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDismiss}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // The form.
  // ---------------------------------------------------------------------
  return (
    <div className="rounded-[var(--fs-r-lg)] border border-[var(--fs-line)] bg-card p-4 shadow-[var(--fs-e-0)]">
      <div className="flex items-start justify-between gap-3">
        <p className="font-headline text-base font-semibold text-foreground">
          {restaurantName ? `${restaurantName} — how was it?` : "How did it go?"}
        </p>
        <button
          type="button"
          onClick={() => setEditing(false)}
          aria-label="Close feedback form"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <fieldset className="mt-3">
        <legend className="font-body text-sm text-muted-foreground">Did you go?</legend>
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={didGo === true ? "default" : "outline"}
            onClick={() => setDidGo(true)}
          >
            <Check /> We went
          </Button>
          <Button
            type="button"
            size="sm"
            variant={didGo === false ? "default" : "outline"}
            onClick={() => {
              setDidGo(false);
              // Mirrors the session_feedback_rating_requires_visit CHECK:
              // a rating for a meal nobody ate is noise, not data.
              setRating(null);
            }}
          >
            <X /> We didn't
          </Button>
        </div>
      </fieldset>

      {didGo === true ? (
        <fieldset className="mt-4">
          <legend className="font-body text-sm text-muted-foreground">
            How was it? <span className="text-xs">(optional)</span>
          </legend>
          <div className="mt-2 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value} star${value === 1 ? "" : "s"}`}
                aria-pressed={rating === value}
                onClick={() => setRating(rating === value ? null : value)}
                className="rounded-md p-1 transition-transform hover:scale-110"
              >
                <Star
                  className={
                    rating !== null && value <= rating
                      ? "h-6 w-6 fill-primary text-primary"
                      : "h-6 w-6 text-muted-foreground"
                  }
                />
              </button>
            ))}
            {rating !== null ? (
              <button
                type="button"
                onClick={() => setRating(null)}
                className="ml-2 font-body text-xs text-muted-foreground underline underline-offset-4"
              >
                clear
              </button>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      <div className="mt-4">
        <label
          htmlFor={`feedback-notes-${sessionId}`}
          className="font-body text-sm text-muted-foreground"
        >
          Anything worth remembering? <span className="text-xs">(optional)</span>
        </label>
        <textarea
          id={`feedback-notes-${sessionId}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX_LENGTH))}
          rows={3}
          maxLength={NOTES_MAX_LENGTH}
          placeholder="Great biryani, skip the starters…"
          className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-body text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <p className="mt-1 text-right font-body text-xs text-muted-foreground">
          {notes.length}/{NOTES_MAX_LENGTH}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={didGo === null || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />} Save
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
        {mine ? (
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={saving}>
            <Trash2 /> Remove
          </Button>
        ) : null}
        {didGo === null ? (
          <span className="font-body text-xs text-muted-foreground">
            Pick one to save — that's the whole form.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span aria-label={`${value} out of 5`} className="inline-flex">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={n <= value ? "h-4 w-4 fill-primary text-primary" : "h-4 w-4 text-muted-foreground/40"}
        />
      ))}
    </span>
  );
}

/**
 * "3 of 4 answered · 2 went · avg 4.5". The group-visible half of the
 * feature — feedback is readable room-wide (0014's SELECT policy), and
 * seeing that other people answered is what makes answering feel worth it.
 */
function GroupSummary({ feedback }: { feedback: SessionFeedback[] }) {
  if (feedback.length === 0) return null;
  const went = feedback.filter((f) => f.didGo);
  const rated = went.filter((f) => f.rating !== null);
  const avg =
    rated.length > 0
      ? (rated.reduce((sum, f) => sum + (f.rating ?? 0), 0) / rated.length).toFixed(1)
      : null;
  return (
    <p className="mt-1 font-body text-xs text-muted-foreground">
      {feedback.length} answered
      {went.length > 0 ? ` · ${went.length} went` : ""}
      {avg ? ` · avg ${avg}★` : ""}
    </p>
  );
}
