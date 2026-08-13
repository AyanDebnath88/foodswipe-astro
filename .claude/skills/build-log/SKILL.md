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
| 3 — Restaurant discovery & AI | ⬜ not started | Geoapify search, Gemini menu/suggestions as direct REST calls (no Genkit) |
| 4 — Retention loop | ⬜ not started | Post-meal feedback, solo mode, async rooms |
| 5 — Monetization hooks | ⬜ not started | Affiliate delivery links first |
| 6 — Deploy & polish | ⬜ not started | Vercel, analytics, Lighthouse pass |

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
- **AI calls**: no Genkit in this rebuild — direct Gemini REST calls only, kept lightweight. Same for restaurant search (direct Geoapify fetch, no wrapper).

## Manual steps only the user can do (still pending as of Phase 1)

1. Create a hosted Supabase project at supabase.com/dashboard, paste `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` into `.env` (gitignored, not committed).
2. Run the migration files against that project (SQL editor, or `supabase db push` if the CLI is linked).
3. Configure a Google OAuth client in the Supabase dashboard for real Google sign-in (the code path is built and correct, just untestable without this).
4. Decide on a GitHub remote — nothing has been pushed anywhere yet, only local commits exist.

No live Supabase project has existed at any point during this build. Every phase's Supabase-dependent code has been verified via typecheck/build/render only, never a real end-to-end auth or database test, unless a later phase note in this file says otherwise.

## How to resume after a context clear

1. Read this file fully.
2. Check `git log --oneline` in `C:\Antigravity Projects\foodswipe-astro` to confirm the phase table above still matches reality (it should, but verify — this file is a snapshot, not a live source).
3. Pick up at the first `⏳`/`⬜` phase.
4. Update this file's phase table, schema list, and any new patterns/decisions *before* ending the session or moving to the next phase.
