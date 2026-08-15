# Live multi-user testing (Playwright)

Real, watchable, multi-user browser testing for Food Swipe — two or more
fully independent logged-in sessions running side by side, screenshotted at
each step so a human can watch a change get exercised without needing to be
two people at once.

## Why this exists

The other browser tool available in this environment (the in-app "Browser
pane") shares one cookie jar across every tab it opens, so it can never hold
two different logged-in users simultaneously — the exact thing a room/swipe/
match app needs to test for real. Playwright's browser *contexts* are fully
isolated (separate cookies, localStorage, IndexedDB), so N independent real
logins can run side by side in one process.

There is no shared display to stream pixels to in this environment, so "live"
here means: act → screenshot → look at the PNG → next action. Screenshots
land in `screenshots/` (gitignored — regenerated every run, not build
output).

## Run it

```bash
npm run test:live
```

or directly:

```bash
node --env-file=.env scripts/playwright/demo-two-user-match.mjs
```

Requires the dev server running (`npx astro dev --host`) and a live,
migrated Supabase project (see the build log's "Manual steps" for which
migrations must be applied). Uses the seeded test accounts (`foodswipe.
tester.a@gmail.com` / `.b@gmail.com`, password `FoodSwipeTest!2026` — see
`scripts/seed-test-users.mjs`).

**Always use `http://127.0.0.1:4321`, never `http://localhost:4321`.**
`localhost` has been observed to resolve to an unrelated app on this machine
via IPv6/IPv4 ambiguity — see the build log's "Integration pass" section.
`multi-session.mjs` defaults `BASE_URL` to the correct address already;
override with `APP_BASE_URL` only if you know the target is elsewhere.

## Writing a new scenario

`multi-session.mjs` is the reusable driver — everything else is a scenario
script built on top of it:

```js
import { openSession, login, closeAll, BASE_URL } from "./multi-session.mjs";

const ava = await openSession("ava");
const ben = await openSession("ben");
await login(ava, "foodswipe.tester.a@gmail.com", "FoodSwipeTest!2026");
await login(ben, "foodswipe.tester.b@gmail.com", "FoodSwipeTest!2026");

// ... drive each session's `page` (a real Playwright Page) however the
// scenario needs, calling `await session.shot("step-name")` at any point
// worth showing.

await closeAll();
```

`session.page` is a real Playwright `Page` — use `getByRole`, `getByPlaceholder`,
`locator`, etc. as normal. The one app-specific gotcha: the cuisine/dish swipe
gesture is triggered through a hidden proxy button
(`#cuisine-swipe-right-btn` / `#cuisine-swipe-left-btn`, only rendered on the
active card) that the visible round Heart/X buttons click via
`document.getElementById(...)?.click()`. Dispatch a click on it directly
(`page.dispatchEvent("#cuisine-swipe-right-btn", "click")`) rather than trying
to click the visible button by icon — see `demo-two-user-match.mjs` for the
working pattern.

## What exists today

- `multi-session.mjs` — the driver (`openSession`, `login`, `closeAll`, `BASE_URL`).
- `demo-two-user-match.mjs` — full run: two real logins → host a room → the
  other joins by code (proving cross-user join works) → both watch the
  waiting room update live over Realtime with no reload → both swipe →
  both land on the same match reveal at the same time.

## A finding from building this

Neither swipe button (`X` / `Heart`, `swipe-area.tsx`) has an `aria-label` —
they're icon-only with no accessible name. Not fixed here (out of scope for
a testing tool), flagged for the design/accessibility pass.
