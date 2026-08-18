# Food Swipe — design language notes

Two boards, same system:
- **Food Swipe Mobile.dc.html** — 8 screen groups at true 390x844, each with spec + motion note.
- **Food Swipe Desktop.dc.html** — the same system at 1280, with a deltas panel at the top.
- **tokens.css** — everything added beyond the given palette/type.

## What was fixed vs. what I pushed

Untouched, as instructed: the two-token-set boundary, photography direction (all imagery is a
labelled placeholder to be swapped for the existing editorial shots), Fraunces + Inter.

Pushed further:

1. **Radius language.** Five steps tied to meaning, not size: pill (transient/labels) / 8-14
   (badges, rows) / 16-18 (controls, utility cards) / 22-28 (discovery cards, panels) / 32-44
   (sheets, device). Discovery surfaces are rounder than utility surfaces — that's how History
   reads "lower intensity" without a second palette.

2. **Nested surfaces get lighter inward.** bg #FBF3EC -> card #FEFCF9 -> row #FBF3EC with a
   #EFE3D6 hairline. No shadow stacking to express depth; one warm-tinted elevation ramp only.

3. **Terracotta is reserved for forward motion.** Like, Continue, Join, Save. Positive feedback
   ("Loved it") is sage; alerts are gold-on-ivory. Nothing recoverable is ever red — the
   "room isn't available" notice uses the same surface family as a normal card.

4. **Contrast pinned to real numbers** (in the specs): #6B5749 6.2:1, #4A3B31 9.1:1, ink-on-gold
   9.8:1, #FFF6F0 on terracotta 4.7:1. #8A7462 (4.6:1) is restricted to >=16px or 600 weight.
   On the void: #FFF8FC 15.9:1, mint 10.4:1. **Neon pink is never body copy** (3.4:1) and neon
   CTAs take ink labels (#2A0D1C), not white.

5. **One motion vocabulary, three durations.** Direct manipulation 120-220ms; entrances 300-420ms;
   the celebration alone gets 520ms and a stagger. Default easing is cubic-bezier(.22,1,.36,1)
   everywhere — overshoot (.34,1.56,.64,1) is allowed on exactly two things: the match heart and
   the save-heart tap. The heart glow pulses **3 iterations and stops**; nothing loops.

6. **Deviation worth flagging:** on desktop the feedback prompt is an inline row, not a bottom
   sheet, and the match reveal is horizontal rather than vertically stacked. Same tokens, same
   choreography timings — only the axis changes. A sheet metaphor on a pointer device reads as a
   ported mobile screen.

7. **Desktop earns width with context, not scale.** The card is capped at 460px because drag
   ergonomics don't scale with the viewport; the extra columns show the room roster, round
   progress and activity — the things mobile has to compress into a 5-segment bar. Below 1120px
   the rails drop and the layout becomes the mobile stack verbatim. Only one breakpoint.

8. **Keyboard is a real input on desktop** (left/right/up/Z), hinted permanently under the stack, and it
   replays the drag arc rather than cutting — the same 260ms translate + rotate, so mouse and
   keyboard produce one mental model.

9. **Revision: the celebration is warm, not neon.** The brief specified #FF4FA3 / #43E5C5 on
   #241220; in flow it read as a different product dropped into the middle of the app. The
   *decision* is kept — one bounded dark beat, everything else light — but the accents now come
   from the everyday family: void #2A1A16 (warm ink-brown), ember badge #E8875F -> #C05F3F, dish
   name in the everyday gold #E8C87E (11.1:1), CTA is the standard terracotta button wearing a
   glow. It still reads as a takeover; it no longer reads as a different brand. If you want the
   neon back, it is a three-token swap in tokens.css.

10. **Navigation model changed: bottom tab bar, not a hamburger.** Three top-level destinations
   (Rooms / History / Saved) with icon + label, current destination in terracotta, an 8px dot badge
   on Saved that clears on visit. The hamburger hid every destination behind a tap in a product
   whose whole loop is "get in, decide, leave". Bar 62px + 26px home-indicator inset; swipe
   controls sit 96px above it so the thumb arc never collides with a tab. Sub-flows (rounds,
   results, celebration) push above the bar and keep a back affordance in the header.

11. **States are now specified, not implied.** Waiting/tallying, skeleton (after 300ms, geometry
   identical to the loaded card so CLS stays at 0), empty-no-overlap, offline with an explicit
   Retry, room-full, room-expired, back-online, and a leave-room confirm using --fs-destructive
   #A6503A — the only red-leaning token, and it never appears outside a confirm. Every notice
   pairs an icon with its colour so state never depends on hue alone.

12. **Four breakpoints, no more:** 375 / 768 / 1120 / 1440, with landscape phone handled by moving
   the action row beside the card rather than under it. Full pointer state matrix (hover / active /
   disabled per element) is on the desktop board; hover is enhancement only and guarded by
   @media (hover:hover).

## Implementation notes (Astro + React + Tailwind v4)

- Drag: track pointer x, apply `translate3d(x,y,0) rotate(x/18deg)` with **no transition** while
  dragging; add `transition: transform var(--fs-dur-base) var(--fs-ease-out)` only on release.
- Commit at 96px or velocity > 0.6px/ms; below that, snap back.
- Stamp opacity = clamp((|x| - 32) / 88, 0, 1).
- The celebration should mount as a portal over the app shell, not a route with dark chrome —
  that is what keeps the dark palette bounded.
- Every icon-only control needs `aria-label` + `focus-visible` ring (2px #D97757, 2px offset,
  no transition). Focus is never animated.
