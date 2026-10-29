"use client";

// Home-page quick start: the lowest-friction path into a table.
// Signed out: one field (your name) -> ensureGuestSession() (anonymous
// sign-in, src/lib/guest-auth.ts) -> createRoom() -> /rooms. No email or
// password; an account can be added later. Signed in: one tap.
// "Got a code?" hands off to the existing name-only join at /rooms/join.
// If anonymous sign-ins are switched off in Supabase Auth, say so plainly
// and point at /signup instead of failing silently.
import React, { useState } from "react";
import { ensureGuestSession } from "@/lib/guest-auth";
import { createRoom, saveActiveRoom } from "@/lib/rooms";
import { errorMessage } from "@/lib/errors";
import { CtaArrow } from "@/components/ui/button";

export function QuickStart({ signedIn }: { signedIn: boolean }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; signup?: boolean } | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn && name.trim().length === 0) {
      setError({ text: "Tell us what to call you." });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await ensureGuestSession(signedIn ? "" : name);
      const room = await createRoom(user.id);
      saveActiveRoom({ id: room.id, code: room.code });
      window.location.href = "/rooms";
    } catch (err) {
      const text = errorMessage(err, "Could not start a table.");
      setError(/anonymous/i.test(text)
        ? { text: "Guest tables are switched off right now.", signup: true }
        : { text });
      setBusy(false);
    }
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length !== 4) {
      setError({ text: "Codes are 4 letters, like K7QF." });
      return;
    }
    window.location.href = `/rooms/join?code=${encodeURIComponent(clean)}`;
  }

  return (
    <div className="grid w-full max-w-[26rem] gap-3">
      <form onSubmit={start} className="flex items-center gap-2 rounded-[var(--fs-r-pill)] bg-[var(--fs-on-ink)] p-1.5 shadow-[var(--fs-e-float)]">
        {!signedIn && (
          <input
            aria-label="Your name"
            placeholder="Your name"
            autoComplete="given-name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 min-w-0 flex-1 bg-transparent pl-4 font-body text-base text-[var(--fs-ink)] placeholder:text-[var(--fs-ink)]/65 focus:outline-none"
          />
        )}
        <button
          type="submit"
          disabled={busy}
          className={`group inline-flex h-11 shrink-0 items-center gap-3 rounded-[var(--fs-r-pill)] font-body text-base font-semibold text-[var(--fs-ink)] disabled:opacity-60 ${signedIn ? "w-full justify-between pl-4" : "pl-2"}`}
        >
          <span>{busy ? "Setting the table…" : "Start a table"}</span>
          <CtaArrow className="h-10 w-10 group-hover:h-10 group-hover:w-10" />
        </button>
      </form>

      <form onSubmit={join} className="flex items-center gap-2 pl-4">
        <label htmlFor="qs-code" className="font-body text-sm text-[var(--fs-text-5)]">Got a code?</label>
        <input
          id="qs-code"
          placeholder="K7QF"
          maxLength={4}
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-9 w-20 rounded-[var(--fs-r-sm)] border border-[var(--fs-line-strong)] bg-[var(--fs-card)] text-center font-body text-sm font-semibold uppercase tracking-[.2em] text-[var(--fs-text)] placeholder:text-[var(--fs-text-6)] focus:border-[var(--fs-text-4)] focus:outline-none"
        />
        <button type="submit" className="font-body text-sm font-semibold text-[var(--fs-text)] underline-offset-4 hover:underline">
          Join
        </button>
      </form>

      <p className="min-h-5 pl-4 font-body text-sm text-[var(--fs-text-4)]" role="status">
        {error ? (
          <>
            <span className="text-[var(--fs-on-ink)]">{error.text}</span>{" "}
            {error.signup && <a href="/signup" className="underline underline-offset-4">Create a free account instead</a>}
          </>
        ) : signedIn ? (
          ""
        ) : (
          "No account needed. Save your tables later."
        )}
      </p>
    </div>
  );
}
