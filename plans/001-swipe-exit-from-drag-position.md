# 001 — Fly swiped cards out from where the finger let go

- **Status**: DONE (executed in the same session that wrote it)
- **Commit**: 993d433
- **Severity**: HIGH
- **Category**: Interruptibility
- **Estimated scope**: 3 component files + 1 CSS file, ~30 lines

## Problem

Swiping is the most frequent action in the app. On release past the threshold the card gets a keyframe class whose `from` is `translateX(0)`, so the card snaps back to centre for a frame and then flies out. Keyframes restart from zero instead of retargeting from the current drag position.

```tsx
// src/components/swipe/cuisine-card.tsx:84-100 — current (same in subcuisine-card.tsx:~88, dish-card.tsx:~84)
const transform = `translate(${pos.x}px, ${pos.y}px) rotate(${rotation}deg) scale(${isDragging ? 1.05 : 1})`;
let animationClass = "";
if (exitDirection === "left") animationClass = "animate-swipe-out-left";
if (exitDirection === "right") animationClass = "animate-swipe-out-right";
// style: transition: isDragging ? "none" : "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)"
```

```css
/* src/styles/global.css — current */
@keyframes swipe-out-left { from { transform: translateX(0) rotate(0) scale(1); opacity: 1; } to { transform: translateX(-200%) rotate(-20deg) scale(0.8); opacity: 0; } }
```

## Target

When `exitDirection` is set, the inline transform becomes the exit pose and the existing transition carries the card there from its current position:

```tsx
const dir = exitDirection === "right" ? 1 : exitDirection === "left" ? -1 : 0;
const transform = dir
  ? `translate(${dir * 150}%, ${pos.y}px) rotate(${dir * 20}deg) scale(1)`
  : `translate(${pos.x}px, ${pos.y}px) rotate(${rotation}deg) scale(${isDragging ? 1.05 : 1})`;
// style
transition: isDragging ? "none" : "transform 300ms var(--fs-ease-out), opacity 300ms var(--fs-ease-out)",
opacity: dir ? 0 : 1,
```

`--fs-ease-out` is `cubic-bezier(.22, 1, .36, 1)` (already in `src/styles/global.css`). The parent removes the card after 500ms (`swipe-area.tsx:220`, `subcuisine-swipe-area.tsx:139`), so a 300ms exit always completes.

## Steps

1. In each of `cuisine-card.tsx`, `subcuisine-card.tsx`, `dish-card.tsx`: replace the `transform`/`animationClass` block with the target code; remove `${animationClass}` from the className; add `opacity` to the style object.
2. In `src/styles/global.css`: delete `@keyframes swipe-out-left`, `@keyframes swipe-out-right`, `.animate-swipe-out-left`, `.animate-swipe-out-right` (no other users; grep to confirm).

## Boundaries

- Do NOT change thresholds, the 500ms removal delay, or gesture handlers.

## Verification

- `npx astro check` → 0 errors; `grep -rn "swipe-out" src` → no results.
- Feel check: drag a card halfway right and release — it continues right from under the finger with no snap to centre. Tap the heart button — card leaves from centre, same curve.
