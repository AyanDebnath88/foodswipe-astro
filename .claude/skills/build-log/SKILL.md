---
name: build-log
description: Food Swipe Astro/Supabase rebuild — current phase status, architecture decisions, file map, and pending manual steps. Load this whenever resuming work on this project after a context clear, or when asked "what's the status" / "where did we leave off" on the Food Swipe rebuild.
---

# Food Swipe — Astro/Supabase rebuild: build log & handoff

This file is the single source of truth for where this rebuild stands. Update it at the end of every phase — before moving to the next one — so a fresh session (after a context clear) can pick up work with zero re-derivation. Read this file fully before touching code in a resumed session.

## Origin

Original app was scaffolded in Firebase Studio (Next.js 15 + Firebase App Hosting + Genkit), lives at `C:\Antigravity Projects\Food Swipe App` — kept as a read-only reference for porting UI/copy/logic, never modified during this rebuild. Migrating off it entirely to Astro + Supabase + Vercel for a lighter stack, per user decision on 2026-08-13. Full original plan (stack rationale, phase breakdown, PM product-gap review, revenue plan) lives in a published artifact — ask the user for the link if you need it, it isn't duplicated here.

## Stack

Astro (React islands) + Tailwind v4 + Supabase (Postgres/Auth/Realtime) + Vercel (target host, not yet deployed). Project root: `C:\Antigravity Projects\foodswipe-astro`.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Foundation | ✅ done | Astro+React+Tailwind scaffold, brand tokens, git init, base Supabase schema |
| 1 — Auth & core UI | ✅ done | Real Supabase Auth (email/pass + Google OAuth path), guest-auth groundwork, landing/login/signup pages |
| 2 — Swipe & matching core | ⏳ in progress | Rooms, Realtime sync, dietary filter, match fallback, dish-level room sync, shareable links |
| 3 — Restaurant discovery & AI | ✅ done | `/api/suggest-cuisines`, `/api/find-restaurants`, `/api/restaurant-menu`, `/api/delivery-links` — see "Phase 3 detail" below. Built and verified independently of Phase 2 (no dependency between them); Phase 2 was still in progress when this landed. |
| 4 — Retention loop | ⬜ not started | Post-meal feedback, solo mode, async rooms |
| 5 — Monetization hooks | ⬜ not started | Affiliate delivery links first |
| 6 — Deploy & polish | ⬜ not started | Vercel, analytics, Lighthouse pass |

## Phase 3 detail — Restaurant discovery & AI (done)

Four API routes under `src/pages/api/` (all `export const prerender = false`, all plain `fetch` — no Genkit, no SDK wrapper, per the AI-calls pattern below):

- **`POST /api/suggest-cuisines`** — the HTTP contract Phase 2's match-fallback logic depends on. **Implemented exactly as specified, verified byte-for-byte against the spec:**
  ```
  body:     { likedCuisines: string[], dislikedCuisines: string[], numberOfSuggestions?: number }
  response: { suggestedCuisines: string[] }
  ```
  Direct Gemini REST call (`gemini-2.5-flash`, `generateContent`, `responseMimeType: application/json` + `responseSchema` for structured output, `thinkingConfig.thinkingBudget: 0` — cuts token cost ~19x for this simple task, verified 950 tokens with thinking vs. ~50 without, same prompt). On any Gemini failure, falls back to picking cuisines from the `cuisines` table the caller hasn't already liked/disliked (via `createSupabaseServerClient`), and if that also fails (e.g. no live Supabase project — see Manual steps), falls further to a hardcoded 9-cuisine list. Never returns an error response for a well-formed request — matches Task spec's "never hard-fails the caller."
  Live-tested: `{"likedCuisines":["Italian","Japanese"],"dislikedCuisines":["Mexican"],"numberOfSuggestions":3}` → `{"suggestedCuisines":["French","Thai","Mediterranean"]}`.

- **`POST /api/find-restaurants`** — `{ cuisine, latitude, longitude }` → `{ restaurants: Restaurant[], source: "geoapify" | "mock" }`. Direct Geoapify Places API call (`catering.restaurant` category, same semantic name/tag matching + reordering as the reference file). No Yelp path ported (reference's `YELP_API_KEY` was never configured and the task only asked for Geoapify). Regional mock fallback (India/UK/generic) preserved for when Geoapify is unreachable or empty. Live-tested at Kolkata (22.49, 88.39) for "Indian" cuisine — returned 6 real restaurants from OpenStreetMap-backed data (e.g. "Rashika South Indian Snacks", "Machhranga Airconditioned Multi Cuisine", "Banzara A. C. Restaurant" with its real website `banzara.co.in`), `source: "geoapify"`.

- **`POST /api/restaurant-menu`** — `{ restaurantName, cuisine, restaurantWebsite? }` → `{ menu: Dish[], source: "gemini" | "fallback" }`, `Dish = { name, description, isTopPick }`. Direct Gemini REST call asking for a 7-10 dish menu with 2-3 top picks (structured-output schema, same prompt shape as the reference Genkit flow). Fallback (key missing or call fails) pulls `dishes` from the `cuisines` table by id/name match, else a generic 5-dish list — same first/third-item top-pick marking as the reference. Live-tested for "Banzara A. C. Restaurant" / Indian — got a real 8-dish Gemini-generated menu (Paneer Tikka Masala, Chicken Biryani, Butter Chicken marked as top picks), `source: "gemini"`.

- **`POST /api/delivery-links`** — `{ restaurantName, latitude, longitude }` → `{ services: { serviceName, url }[], region }`. Same regional service selection and search-URL structure as the reference `find-delivery-prices.ts` (India → Zomato/Swiggy, UK → Deliveroo/Just Eat/Uber Eats, EU → Wolt/Lieferando/Uber Eats, else DoorDash/Uber Eats/Grubhub) but **deliberately not a straight port**: the reference file's per-service prices were fabricated (hardcoded formulas, no real pricing API), which is explicitly out of scope per the revenue plan — real delivery pricing/affiliate integration is Phase 5. This endpoint returns search deep-links only, no price shown anywhere. No affiliate tracking IDs in the URLs yet — those get added in Phase 5 once the affiliate programs are actually signed up for. Live-tested both India (22.49, 88.39 → Zomato/Swiggy) and UK (51.5074, -0.1278 → Deliveroo/Just Eat/Uber Eats) coordinates.

Shared helper: `src/lib/ai/gemini.ts` — `generateGeminiJson<T>()`, one place all Gemini calls in this project should go through (endpoint, model, schema/thinking-budget wiring). Reuse this for any future Gemini call rather than re-implementing the fetch.

`GEMINI_API_KEY` / `GEOAPIFY_API_KEY` are real working keys now in `.env` (server-only, no `PUBLIC_` prefix, confirmed `git check-ignore` clean) — copied from the reference project's `.env.local`. `src/env.d.ts`'s `ImportMetaEnv` interface was extended with these two (typed `string | undefined` since they're allowed to be absent — the whole point of the fallback paths).

Not tested live: the Supabase-backed fallback branches in `suggest-cuisines` and `restaurant-menu` (they only trigger when Gemini itself fails, which wasn't forced during verification, and there's no live Supabase project yet anyway per Manual steps — a fetch against the placeholder URL there would fail safely into the next fallback tier, by inspection, but this is not the same as an observed live test).

## Product decisions baked into this rebuild (don't relitigate these)

Four P0 gaps were found in the original app and are being fixed *during* the rebuild, not as backlog:
1. **Guest join** — joining a room via shared code/link must not require a real account. Implemented via Supabase Anonymous Auth (`signInAnonymously()`), which issues a real `auth.users` row/UUID so RLS works uniformly for guests and registered users alike. No parallel guest-id scheme.
2. **Dietary/allergy filter** — a room must never surface a cuisine that conflicts with any participant's stated restrictions.
3. **Match fallback** — unanimous-right-swipe matching can stall for 3-4 person rooms. After the deck is exhausted with no match, auto-trigger AI cuisine suggestions rather than leaving the room stuck.
4. **Dish-level room sync** — the old app synced the cuisine swipe across the room but let each person pick the final dish alone. The rebuild extends group sync all the way to dish choice.

Also: sponsored restaurant placement (a planned revenue channel) must never be allowed to influence the cuisine-match algorithm itself — only which restaurants surface after a cuisine is already matched. Keep this guardrail in mind if/when building monetization hooks (Phase 5).

## Schema (supabase/migrations/)

- `0001_init.sql` — `profiles`, `swipe_sessions`, `room_participants`, `swipes`. Full RLS. Includes a `is_room_participant(room_id)` SECURITY DEFINER helper (avoids self-referencing RLS recursion on `room_participants` — reuse this pattern for any new room-scoped table/policy, don't reinvent it) and a `get_room_profiles(room_id)` SECURITY DEFINER RPC that exposes only `display_name`/`dietary_restrictions`/`is_guest` to co-participants — `phone` and other columns stay owner-only. This RPC is the correct way to read another participant's info; don't add a row-level co-participant SELECT policy directly on `profiles`, it would leak `phone`.
- `0002_seed_cuisines.sql` — `cuisines` table (`id`, `name`, `dishes text[]`, `dietary_tags text[]`) seeded with the 9 real cuisines ported from the old project. **`dietary_tags` was left empty in this migration** — Phase 2 needs to seed real values (see below) or the dietary filter is a no-op.
- `0003_profile_trigger.sql` — `handle_new_user()` trigger populates `profiles` from `auth.users.raw_user_meta_data` on signup, sets `is_guest` from the real `is_anonymous` column (not "email is null" — that misclassifies OAuth/phone-only accounts).
- *(Phase 2 adds more — update this list as they land.)*

**Dietary tag vocabulary** (shared contract between the cuisine seed data and the profile restriction data — keep these in sync, don't let them drift): `vegetarian`, `vegan`, `halal`, `gluten-free`, `nut-free`, `dairy-free`, `shellfish-free`. A cuisine is eligible for a room if its `dietary_tags` is a superset of the union of all participants' `dietary_restrictions` in that room.

## Key engineering patterns established (reuse, don't reinvent)

- **RLS recursion**: any policy that needs to check "is this user a participant of room X" should call the existing `is_room_participant()` SECURITY DEFINER function, not write a fresh self-join policy.
- **Cross-user data exposure**: never add a raw co-participant SELECT policy on a table with sensitive columns (like `profiles.phone`). Use a SECURITY DEFINER RPC that returns only the safe columns, following `get_room_profiles()`.
- **Astro + Supabase SSR cookies**: `src/lib/supabase/server.ts` has the working `AstroCookies` adapter for `@supabase/ssr` (Astro has no cookie-enumeration API, so `getAll` parses the raw `Cookie` header via `parseCookieHeader`). Reuse this client factory, don't rewrite it.
- **Astro output mode**: static by default; any page needing server-side auth checks must set `export const prerender = false` and the project needs the `@astrojs/node` adapter (already installed) for that route to render per-request.
- **AI calls**: no Genkit in this rebuild — direct Gemini REST calls only, kept lightweight. Same for restaurant search (direct Geoapify fetch, no wrapper). Phase 3 built the concrete pattern: `src/lib/ai/gemini.ts`'s `generateGeminiJson<T>()` (model `gemini-2.5-flash`, `responseSchema` for structured JSON, `thinkingConfig.thinkingBudget: 0` for these non-reasoning tasks) — reuse it, don't re-implement the fetch per endpoint.

## Manual steps only the user can do (still pending as of Phase 1)

1. Create a hosted Supabase project at supabase.com/dashboard, paste `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` into `.env` (gitignored, not committed).
2. Run the migration files against that project (SQL editor, or `supabase db push` if the CLI is linked).
3. Configure a Google OAuth client in the Supabase dashboard for real Google sign-in (the code path is built and correct, just untestable without this).
4. Decide on a GitHub remote — nothing has been pushed anywhere yet, only local commits exist.

(As of Phase 3: `GEMINI_API_KEY` and `GEOAPIFY_API_KEY` are no longer pending — real working keys are in `.env`, copied from the reference project. Only the Supabase project setup above is still outstanding.)

No live Supabase project has existed at any point during this build. Every phase's Supabase-dependent code has been verified via typecheck/build/render only, never a real end-to-end auth or database test, unless a later phase note in this file says otherwise.

## How to resume after a context clear

1. Read this file fully.
2. Check `git log --oneline` in `C:\Antigravity Projects\foodswipe-astro` to confirm the phase table above still matches reality (it should, but verify — this file is a snapshot, not a live source).
3. Pick up at the first `⏳`/`⬜` phase.
4. Update this file's phase table, schema list, and any new patterns/decisions *before* ending the session or moving to the next phase.
