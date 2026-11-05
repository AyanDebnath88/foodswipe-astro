# 003 — Press feedback on buttons; neon pulse when a dish locks

- **Status**: DONE (executed in the same session that wrote it)
- **Commit**: 993d433
- **Severity**: MEDIUM (press feedback) / LOW, additive (lock pulse)
- **Category**: Physicality & origin; Missed opportunities
- **Estimated scope**: 3 files

## Problem

1. `src/components/ui/button.tsx:9` — the shared button has no `:active` feedback; taps feel dead on touch.
2. A dish becoming unanimous (`dish-swipe-area.tsx`, the tile gets its locked styling) only swaps classes — the table's shared moment teleports.

## Target

1. Add to the cva base string: `transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.97]` (replacing `transition-colors`). Press is the deliberate phase; 150ms with the default ease is within the 100–160ms budget.
2. In `src/styles/global.css` add:

```css
@keyframes lock-pulse {
  0% { box-shadow: 0 0 0 0 rgba(232, 255, 58, 0.55); }
  100% { box-shadow: 0 0 0 14px rgba(232, 255, 58, 0); }
}
.animate-lock-pulse { animation: lock-pulse 600ms var(--fs-ease-out) 1; }
```

   and add `animate-lock-pulse` to each item in the live "Agreed so far" list (`dish-swipe-area.tsx`, the `agreedHere.map` `<li>`). Agreed dishes leave the grid and mount there, so the ring plays exactly once per lock; the global reduced-motion rule already shortens it. The item's check icon turns neon (`text-[var(--fs-gold)]`).

## Boundaries

- No changes to lock logic or realtime sync.

## Verification

- `npx astro check` → 0 errors.
- Feel check: press and hold any button — it settles to 97% scale; release springs back. Two users tap the same dish — the tile flashes one neon ring outward, once.
