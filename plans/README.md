# Animation plans

Written by `improve-animations` (audit at commit 993d433). Order = leverage.

| # | Plan | Severity | Depends on | Status |
|---|---|---|---|---|
| 001 | [Fly swiped cards out from the drag position](001-swipe-exit-from-drag-position.md) | HIGH | — | DONE |
| 002 | [Replace transition-all and over-budget durations](002-transition-all-and-long-durations.md) | HIGH/MEDIUM | — | DONE |
| 003 | [Press feedback + neon pulse on dish lock](003-press-feedback-and-lock-pulse.md) | MEDIUM/LOW | 002 (same tile className) | DONE |

Settled, not reported: `--fs-ease-spring` overshoot is documented as match/save hearts only (rare celebration), so it stays. Tailwind v4 `hover:` already gates on `(hover: hover)`, so image hover zooms don't fire on touch.
