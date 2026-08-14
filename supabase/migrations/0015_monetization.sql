-- 0015_monetization.sql
--
-- Phase 5 -- monetization hooks. Two tables and one analytics view:
--
--   1. sponsored_placements   restaurant-side paid placement (groundwork only;
--                             nothing in the app reads it yet)
--   2. monetization_events    outbound-click / impression instrumentation for
--                             the delivery-affiliate funnel
--   3. monetization_funnel    a service-role-only aggregate view over both
--
-- Migrations 0001-0012 are applied and immutable. 0013 (security hardening)
-- and 0014 (another agent's) are pending/owned elsewhere -- this file is
-- INDEPENDENT of both: it adds new objects and does not alter, drop or
-- redefine anything either of them touches, so it can be run before or after
-- them. Everything here is additive and re-runnable.
--
-- =========================================================================
-- THE SPONSORSHIP GUARDRAIL -- READ THIS BEFORE EXTENDING ANY OF IT
-- =========================================================================
-- Sponsored placement may ONLY affect which restaurants surface AFTER a
-- cuisine has already been matched. It must NEVER influence the cuisine
-- swipe deck, the cards a room is dealt, or the match algorithm.
--
-- This is not a style preference, it is the product's core promise. Food
-- Swipe tells a group "swipe to decide fairly". The moment money can tilt
-- what the group appears to "agree" on, that sentence becomes false and the
-- app is quietly manipulating a social decision between friends. A group
-- can reasonably be shown a paid restaurant option, clearly labelled, once
-- they have decided they want Thai food. A group must never be nudged
-- toward wanting Thai food in the first place because someone paid.
--
-- Enforced structurally, not by good intentions:
--
--   * sponsored_placements is reachable from NOTHING on the matching path.
--     check_swipe_match() (0006/0009) and check_dish_swipe_match()
--     (0007/0012) are not modified by this migration and do not reference
--     this table. The cuisines catalog does not reference it. swipes and
--     dish_swipes do not reference it. The only direction any reference
--     runs is sponsored -> cuisine id, as an inert text tag.
--   * cuisine_id here is plain text, deliberately NOT a foreign key to
--     public.cuisines. Partly for the same reason swipes.cuisine_id isn't
--     one (the AI match-fallback deals synthetic `ai-<slug>` cuisines that
--     are not in the catalog), and partly because an FK is a coupling: it
--     would put a sponsorship row in the dependency graph of the catalog
--     the swipe deck is built from. There must be no edge in that
--     direction at all.
--   * The read helper (src/lib/sponsored.ts) REQUIRES an already-matched
--     cuisine id as its first argument and returns restaurants only. It
--     cannot rank, filter, order or suggest cuisines -- it has no code path
--     that returns a cuisine, so it cannot be misused to seed a deck.
--   * scripts/test-monetization.mjs asserts, as a permanent test, that no
--     file on the matching path (src/components/swipe/**, src/lib/cuisines.ts,
--     src/lib/ai-suggestions.ts, src/lib/dietary.ts, /api/suggest-cuisines)
--     so much as mentions sponsorship. If someone wires it in later, that
--     test goes red.
--
-- If a future change needs sponsored data anywhere near matching: it doesn't.
-- Say no.
-- =========================================================================


-- ===========================================================================
-- sponsored_placements
--
-- One row per paid placement campaign. A placement is "live" for a request
-- when it is active, inside its start/end window, and its targeting matches
-- (cuisine and/or geography).
--
-- WRITES: none from clients, by design -- there are no INSERT/UPDATE/DELETE
-- policies at all, so only service_role (which bypasses RLS) can write.
-- Restaurant-side accounts do not exist yet, so there is nobody to grant a
-- write path to; inventing a client-writable path now would mean any
-- authenticated user could insert themselves as a paid feature, for free,
-- into other people's results. When restaurant accounts do exist, the write
-- path should be an admin-reviewed one, not a raw INSERT policy. Same
-- reasoning as dish_matches in 0012: the rows are a commercial fact, and a
-- client-writable table of commercial facts is a forgeable one.
--
-- READS: an ordinary user needs exactly one thing -- the restaurants they
-- are about to be shown, so the client can render them labelled "Featured".
-- The SELECT policy therefore exposes only placements that are live right
-- now. Draft, scheduled-for-later, expired and deactivated campaigns are
-- invisible to users; that is a commercial calendar, not their business.
--
-- NOTE FOR FUTURE FIELDS: RLS is row-level, never column-level. Anything
-- commercially sensitive (rate card, spend, contract terms, contact
-- details) must NOT be added to this table -- a live row is fully readable
-- by every user it is served to. Put those on a separate service-role-only
-- sibling table keyed by placement id.
-- ===========================================================================
create table if not exists public.sponsored_placements (
  id uuid primary key default gen_random_uuid(),

  -- Restaurant identity. Text, not a FK: this rebuild has no restaurants
  -- table (restaurant data is ephemeral and API-sourced from Geoapify), the
  -- same reason dish_swipes.restaurant_name is text in 0007. The name is
  -- what the results list matches and de-duplicates on.
  restaurant_name text not null check (char_length(restaurant_name) between 1 and 200),
  restaurant_address text check (restaurant_address is null or char_length(restaurant_address) <= 300),
  restaurant_website text check (restaurant_website is null or char_length(restaurant_website) <= 500),

  -- Targeting. Both dimensions are optional and independent:
  --   cuisine_id null    -> applies to any matched cuisine
  --   country_code null  -> applies in any country
  --   lat/lon + radius   -> applies only near a point (a restaurant is a
  --                         local business; a national campaign for one
  --                         address would be spam everywhere else)
  cuisine_id text check (cuisine_id is null or char_length(cuisine_id) between 1 and 120),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  latitude double precision check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude double precision check (longitude is null or (longitude >= -180 and longitude <= 180)),
  radius_km numeric(6,2) check (radius_km is null or (radius_km > 0 and radius_km <= 500)),

  -- Flight window. starts_at defaults to now so a row is live on insert
  -- unless scheduled; ends_at null means open-ended.
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,

  -- Ranking. Higher priority wins; ties break on the earlier start (the
  -- campaign that has been waiting longest), then on id for total
  -- determinism -- an unstable order would make results jump around
  -- between reloads for no reason the user can see.
  priority integer not null default 0 check (priority between 0 and 1000),

  -- Who is paying. Public on purpose: it is the disclosure, and a user
  -- looking at a "Featured" badge is entitled to know who featured it.
  advertiser_name text check (advertiser_name is null or char_length(advertiser_name) <= 200),

  created_at timestamptz not null default now(),

  -- A window that ends before it starts is a data-entry error, and an
  -- always-expired campaign that silently never serves is worse than a
  -- rejected insert.
  constraint sponsored_placements_window_ordered
    check (ends_at is null or ends_at > starts_at),
  -- A coordinate is a pair or it is nothing.
  constraint sponsored_placements_coords_paired
    check ((latitude is null) = (longitude is null)),
  -- A radius with no centre cannot be evaluated; treat it as invalid rather
  -- than silently ignoring the radius and serving nationwide.
  constraint sponsored_placements_radius_needs_centre
    check (radius_km is null or latitude is not null)
);

alter table public.sponsored_placements enable row level security;

drop policy if exists "sponsored_placements: select live placements" on public.sponsored_placements;
create policy "sponsored_placements: select live placements"
  on public.sponsored_placements
  for select
  to anon, authenticated
  using (
    is_active
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  );

-- No INSERT / UPDATE / DELETE policies. See the header above.
grant select on public.sponsored_placements to anon, authenticated;

-- Serving lookup: live rows, narrowed by cuisine and country, ordered by
-- priority. Partial on is_active because expired/paused rows are dead
-- weight in the index for the only query that matters.
create index if not exists sponsored_placements_serving_idx
  on public.sponsored_placements (cuisine_id, country_code, priority desc)
  where is_active;


-- ===========================================================================
-- monetization_events
--
-- The revenue funnel, first-party only. Three stages matter:
--
--   matches reached      -> NOT stored here. It is already a fact in
--                           swipe_sessions/dish_matches, and duplicating it
--                           into an event row would let the two disagree
--                           and would let a client inflate the top of the
--                           funnel. The view below derives it.
--   delivery link shown  -> 'delivery_links_shown', one per render
--   delivery link clicked-> 'delivery_link_clicked', one per outbound click
--
-- Privacy: no IP address, no user agent, no device id, no third-party
-- analytics SDK, no cookie beyond the app's own auth session. The only
-- identifier is user_id -- this app's own auth id, which every other table
-- here already stores. Rows cascade away with the user, so deleting an
-- account really deletes its analytics.
--
-- Honest limitation, stated up front: these rows are client-reported, so a
-- determined user could insert plausible-looking events for themselves.
-- That is acceptable for what this is -- our own funnel diagnostics, to see
-- which delivery channels people actually use. It is NOT billing-grade. If
-- sponsored placement ever bills a restaurant per click, that click must be
-- counted somewhere a client cannot write: a server-side endpoint with a
-- signed payload, or the affiliate network's own dashboard, which is the
-- system of record for commissions anyway.
-- ===========================================================================
create table if not exists public.monetization_events (
  id uuid primary key default gen_random_uuid(),

  event_type text not null check (event_type in (
    'delivery_links_shown',
    'delivery_link_clicked',
    'sponsored_shown',
    'sponsored_clicked'
  )),

  -- Defaulted to auth.uid() so a client cannot omit it, and constrained by
  -- the INSERT policy so a client cannot forge someone else's.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- Where it happened, when known. A solo user browsing delivery options
  -- outside a room has no session, hence nullable; `on delete set null`
  -- keeps the funnel count honest after a room is deleted rather than
  -- silently erasing history.
  session_id uuid references public.swipe_sessions(id) on delete set null,

  service_name text check (service_name is null or char_length(service_name) between 1 and 40),
  restaurant_name text check (restaurant_name is null or char_length(restaurant_name) <= 200),
  cuisine_id text check (cuisine_id is null or char_length(cuisine_id) <= 120),
  region text check (region is null or region in ('IN', 'UK', 'EU', 'GLOBAL')),

  -- Whether the link the user actually clicked carried a tracking id. This
  -- is the number that answers "is the affiliate integration earning
  -- anything, or are we sending untagged traffic?".
  affiliate_tagged boolean not null default false,

  -- Set on sponsored_* events. Nullable and `on delete set null`: a click
  -- happened even if the campaign is later removed.
  sponsored_placement_id uuid references public.sponsored_placements(id) on delete set null,

  created_at timestamptz not null default now()
);

alter table public.monetization_events enable row level security;

-- INSERT: own rows only. Recording a click is the one write an ordinary
-- user makes here.
drop policy if exists "monetization_events: insert own" on public.monetization_events;
create policy "monetization_events: insert own"
  on public.monetization_events
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- SELECT: own rows only. Nobody needs to read anyone else's -- the
-- aggregate reporting runs as service_role through the view below. A
-- co-participant SELECT policy would turn "which takeaway did you click"
-- into shared data, which it is not.
drop policy if exists "monetization_events: select own" on public.monetization_events;
create policy "monetization_events: select own"
  on public.monetization_events
  for select
  to authenticated
  using (user_id = auth.uid());

-- No UPDATE / DELETE policies: an analytics event is an append-only fact.
grant select, insert on public.monetization_events to authenticated;

create index if not exists monetization_events_type_time_idx
  on public.monetization_events (event_type, created_at desc);
create index if not exists monetization_events_session_idx
  on public.monetization_events (session_id)
  where session_id is not null;


-- ===========================================================================
-- monetization_funnel  (service-role only)
--
-- matches reached -> delivery links shown -> link clicked, per day.
--
-- "Matches reached" is derived from swipe_sessions rather than from an
-- event row, so the top of the funnel is the same number the product
-- itself is built on and cannot be inflated by a client. There is no
-- matched_at column on swipe_sessions (0001 never added one), so a matched
-- room is counted on its created_at day -- rooms are same-session and
-- short-lived, so the skew is minutes, but it is a real approximation and
-- is named as one rather than dressed up.
--
-- Deliberately NOT granted to anon/authenticated. A Postgres view runs with
-- its owner's privileges by default (security_invoker = false), so granting
-- it to users would hand them everyone's aggregate behaviour. Reporting is
-- run from the SQL editor / a service-role job.
-- ===========================================================================
create or replace view public.monetization_funnel as
with matches as (
  select date_trunc('day', created_at) as day, count(*) as matches_reached
  from public.swipe_sessions
  where matched_cuisine_id is not null
  group by 1
),
shown as (
  select date_trunc('day', created_at) as day,
         count(*) as delivery_links_shown,
         count(distinct user_id) as users_shown
  from public.monetization_events
  where event_type = 'delivery_links_shown'
  group by 1
),
clicked as (
  select date_trunc('day', created_at) as day,
         count(*) as delivery_links_clicked,
         count(distinct user_id) as users_clicked,
         count(*) filter (where affiliate_tagged) as affiliate_tagged_clicks
  from public.monetization_events
  where event_type = 'delivery_link_clicked'
  group by 1
)
select
  coalesce(m.day, s.day, c.day) as day,
  coalesce(m.matches_reached, 0) as matches_reached,
  coalesce(s.delivery_links_shown, 0) as delivery_links_shown,
  coalesce(s.users_shown, 0) as users_shown,
  coalesce(c.delivery_links_clicked, 0) as delivery_links_clicked,
  coalesce(c.users_clicked, 0) as users_clicked,
  coalesce(c.affiliate_tagged_clicks, 0) as affiliate_tagged_clicks
from matches m
full outer join shown s on s.day = m.day
full outer join clicked c on c.day = coalesce(m.day, s.day)
order by 1 desc;

revoke all on public.monetization_funnel from anon, authenticated;
grant select on public.monetization_funnel to service_role;

-- Per-service breakdown -- "which channels actually convert". Same
-- restriction: service_role only.
create or replace view public.monetization_clicks_by_service as
select
  service_name,
  region,
  count(*) as clicks,
  count(*) filter (where affiliate_tagged) as affiliate_tagged_clicks,
  count(distinct user_id) as users,
  max(created_at) as last_click_at
from public.monetization_events
where event_type = 'delivery_link_clicked'
group by service_name, region
order by clicks desc;

revoke all on public.monetization_clicks_by_service from anon, authenticated;
grant select on public.monetization_clicks_by_service to service_role;

-- Realtime is deliberately NOT enabled on either table. Nothing in the UI
-- reacts live to an ad campaign or to someone else's click, and publishing
-- them would push commercial rows over the wire for no feature.
