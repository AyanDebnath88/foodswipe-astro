# 002 — Replace `transition-all` and over-budget durations

- **Status**: DONE (executed in the same session that wrote it)
- **Commit**: 993d433
- **Severity**: HIGH (dish tiles are tapped constantly) / MEDIUM (rest)
- **Category**: Performance, Easing & duration
- **Estimated scope**: 6 files, one class string each

## Problem

`transition-all` animates every changing property, including layout ones, off the GPU. Two UI transitions also exceed the 300ms budget.

- `src/components/dishes/dish-swipe-area.tsx:758` — dish tile: `transition-all duration-200`
- `src/components/swipe/cuisine-dish-guide.tsx:80` — `transition-all duration-500`
- `src/components/auth/login-form.tsx:135`, `src/components/auth/signup-form.tsx:141` — Google button `transition-all`
- `src/components/ui/toast.tsx:26` — toast root `transition-all`
- `src/components/match/match-reveal.tsx:502` — image hover `duration-700 ease-out`

## Target

- Dish tile: `transition-[transform,box-shadow] duration-200 ease-[var(--fs-ease-out)] active:scale-[0.97]` (selection ring is a box-shadow)
- Dish guide row: `transition-[opacity,transform] duration-[220ms] ease-[var(--fs-ease-out)]` (only opacity/translate change on reveal)
- Google buttons: `transition-colors`
- Toast: `transition-[transform,opacity]` (keep every `data-[swipe=…]` class as is)
- Match image hover: `duration-300 ease-[var(--fs-ease-out)]`

## Boundaries

- Do NOT change which states animate, only the property list, duration and curve.

## Verification

- `grep -rn "transition-all" src` → no results. `npx astro check` → 0 errors.
- Feel check: tap dish tiles rapidly — selection border/lock change is instant-feeling (200ms), no layout shimmer.
