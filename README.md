# Food Swipe

Stop arguing, start eating. A group swipes on cuisines together (Tinder-style),
gets a real-time celebration the moment everyone agrees, then swipes dishes
at a real nearby restaurant with real Google ratings and, where available,
real menu items pulled from the restaurant's own website.

**Live**: https://foodswipe-astro.vercel.app

## Stack

Astro (server output, `@astrojs/vercel` adapter) + React islands + Tailwind
v4 + Supabase (Postgres, Auth, Realtime), deployed on Vercel. No service-role
Supabase key anywhere, by design — privileged writes go through `SECURITY
DEFINER` Postgres functions instead (see `AGENTS.md`).

## Status

Functionally complete through the design pass and initial real-restaurant-data
work. **Full status, architecture, and exactly what's pending lives in
`.claude/skills/build-log/SKILL.md` — read that, not this file, for anything
beyond "how do I run this locally."**

## Local development

```sh
npm install
npm run dev          # localhost:4321
```

Needs a `.env` (copy `.env.example`) with Supabase + Gemini + Geoapify +
Google Places keys. Real accounts/data only — this app has never used mock
auth or fabricated data (ratings, prices, delivery ETAs are real or `null`,
never invented; see the build log's "no fabricated data" thread if that
history matters to you).

```sh
npx astro check       # typecheck
npm run build          # production build
node --env-file=.env scripts/playwright/demo-two-user-match.mjs   # live 2-user test
```

## Deploying

Push to `master` — Vercel auto-deploys via the GitHub connection. New
Supabase migrations under `supabase/migrations/` are **not** applied
automatically; run each new one individually in Supabase Studio's SQL
editor (never the concatenated `supabase/ALL_MIGRATIONS.sql` bundle against
an already-migrated project — see `AGENTS.md`).
