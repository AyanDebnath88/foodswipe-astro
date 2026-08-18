## Project: Food Swipe

Group food-decision app — swipe on cuisines together, get a real match when
everyone agrees, then swipe dishes at a real restaurant. Astro + React +
Tailwind v4 + Supabase (Auth/DB/Realtime). Live at
**foodswipe-astro.vercel.app** (Vercel, GitHub-connected,
`AyanDebnath88/foodswipe-astro`).

**Read `.claude/skills/build-log/SKILL.md` first, every session that
touches this project.** It is the actively-maintained, authoritative status
doc — phase table, schema, engineering patterns, exactly what's pending on
the user right now. This file (and `CLAUDE.md`, a symlink to it) is
intentionally thin; project status lives there, not here, so it doesn't go
stale in two places.

**One standing architectural fact worth knowing before proposing a fix**:
this app has no Supabase service-role key anywhere, by design. Every
"public read, privileged write" table (rooms, the restaurant cache, menu
enrichment results) uses a `SECURITY DEFINER` Postgres function instead
(`create_room()`, `join_room_by_code()`, `upsert_restaurant_cache()`,
`record_enrichment_result()`) — don't reach for a service-role key as the
"obvious" answer to a future write-access problem without checking whether
this pattern already covers it.

**Migrations are applied manually by the user in Supabase Studio, one at a
time** — never paste the full `supabase/ALL_MIGRATIONS.sql` bundle into an
already-migrated project; `create policy` isn't idempotent like
`create table if not exists`, and it will abort partway through re-running
the whole history. Point the user at the single new migration file instead.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

Live two/three-user testing (not the in-app Browser pane — it shares one
cookie jar across tabs, can't hold two logged-in sessions at once):
`node --env-file=.env scripts/playwright/demo-two-user-match.mjs` (or
`demo-three-user-match.mjs`). Point at production with
`APP_BASE_URL=https://foodswipe-astro.vercel.app`. These occasionally flake
on the very first `page.dispatchEvent` call after a cold navigation — a
retry has cleared it every time so far; don't over-diagnose a single
failure before trying again once.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
