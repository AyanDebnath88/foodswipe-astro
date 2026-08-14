// scripts/test-monetization.mjs
//
// Phase 5 (monetization hooks) test suite. Same harness and same rules as
// test-e2e.mjs / test-security.mjs: real assertions against the real live
// Supabase project through the anon key only, and against a real built
// server over real HTTP. Nothing here is mocked and no assertion is weakened
// to make a run green.
//
//   npm run build                                  # required: this suite
//                                                  # boots dist/server/entry.mjs
//   node --env-file=.env scripts/test-monetization.mjs
//
// What it covers, and why each one is here:
//
//   01  Delivery links with ZERO affiliate ids configured. This is today's
//       real state and it is the case that must never break: every link
//       present, every link a usable https URL, nothing tagged, and no
//       affiliate disclosure claimed. Run against a server started with no
//       AFFILIATE_* variables at all.
//   02  Delivery links WITH affiliate ids configured. Run against a second
//       server started with a deliberately mixed configuration: one good
//       redirect template, one direct-parameter program, one template with
//       no {url} placeholder, one non-https template, and one id with no
//       format at all. The three broken ones must degrade to plain working
//       links -- a misconfigured affiliate id must never cost the user their
//       delivery link.
//   03  The sponsored API's contract, including that it REFUSES to answer
//       without an already-matched cuisine.
//   04  The sponsorship guardrail, as a source-level structural test: no
//       file on the matching path may so much as mention sponsorship, and
//       0015 may not touch the match triggers. This is the test that fails
//       if someone later wires sponsored data into the swipe deck.
//   05  sponsored_placements RLS: a normal authenticated user can read live
//       placements and CANNOT write one.
//   06  monetization_events: a click event records, is private to its owner,
//       cannot be forged for another user, and cannot be edited or deleted.
//
// Sections 05 and 06 depend on supabase/migrations/0015_monetization.sql,
// which nobody in this project can apply (no Docker, no CLI, no service_role
// key). Until the user runs it in the SQL editor those assertions FAIL, and
// they are tagged [needs 0015] so a red run reads as "the migration is
// waiting", not "the code is broken". They are not skipped and not softened.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { userByKey, signInOrSignUp, sleep } from "./_shared.mjs";

// fileURLToPath, not URL#pathname: on Windows the latter yields
// "/C:/Antigravity%20Projects/..." -- percent-encoded and with a leading
// slash -- which no fs call can open.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "dist", "server", "entry.mjs");

// Two servers on two ports so the configured and unconfigured cases are
// both real HTTP against real code, in one run. Deliberately NOT 4321: a dev
// server may be running there and it is not ours to take.
const PORT_PLAIN = 4398;
const PORT_AFFILIATE = 4399;

// A deliberately mixed affiliate configuration. Only the first two are
// valid; the rest exist to prove the failure paths degrade to plain links.
const AFFILIATE_ENV = {
  // Valid redirect template + id -- how nearly every network works.
  AFFILIATE_DOORDASH_TEMPLATE: "https://affiliate-network.test/c/{id}/9999?u={url}",
  AFFILIATE_DOORDASH_ID: "pub-test-123",
  // Valid direct-parameter program.
  AFFILIATE_ZOMATO_PARAM: "ref",
  AFFILIATE_ZOMATO_ID: "fs-test-zom",
  // Broken: no {url} placeholder, so the destination would be lost.
  AFFILIATE_GRUBHUB_TEMPLATE: "https://broken-network.test/click/12345",
  // Broken: not https -- must not downgrade an https destination.
  AFFILIATE_SWIGGY_TEMPLATE: "http://insecure-network.test/go?u={url}",
  // Broken: an id with no template and no param attributes nothing.
  AFFILIATE_UBER_EATS_ID: "orphan-id-no-format",
};

// Coordinates that select each region in delivery-links.ts's resolveRegion().
const COORDS = {
  GLOBAL: { latitude: 40.7128, longitude: -74.006 },   // New York
  IN: { latitude: 22.49, longitude: 88.39 },           // Kolkata
  UK: { latitude: 51.5074, longitude: -0.1278 },       // London
  EU: { latitude: 52.52, longitude: 13.405 },          // Berlin
};

const RESTAURANT = "Banzara A. C. Restaurant";

// ---------------------------------------------------------------------------
// Assertion harness (same shape as test-e2e.mjs -- name first)
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
let pendingMigration = 0;
const failures = [];
let currentSection = "";
let needsMigration = false;

function section(name) {
  currentSection = name;
  needsMigration = false;
  console.log(`\n--- ${name} ${"-".repeat(Math.max(0, 68 - name.length))}`);
}

/** Everything asserted until the next section() depends on 0015. */
function afterMigration() {
  needsMigration = true;
}

function ok(name, detail) {
  passed++;
  console.log(`  PASS  ${name}${detail ? `  [${detail}]` : ""}`);
}

function bad(name, detail) {
  failed++;
  if (needsMigration) pendingMigration++;
  const tag = needsMigration ? " [needs 0015]" : "";
  failures.push(`${currentSection} :: ${name}${tag}${detail ? ` -- ${detail}` : ""}`);
  console.log(`  FAIL${tag}  ${name}${detail ? `\n        ${detail}` : ""}`);
}

function assert(name, condition, detail) {
  if (condition) ok(name);
  else bad(name, detail);
  return Boolean(condition);
}

function assertEq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    ok(name, `= ${e}`);
    return true;
  }
  bad(name, `expected ${e}, got ${a}`);
  return false;
}

function assertNoError(name, error, extra) {
  if (!error) {
    ok(name);
    return true;
  }
  bad(
    name,
    `${error.code ? `[${error.code}] ` : ""}${error.message}${
      error.details ? ` | details: ${error.details}` : ""
    }${extra ? ` | ${extra}` : ""}`
  );
  return false;
}

/** A write that MUST be refused. Probed with no RETURNING, per the build log. */
function assertBlocked(name, error, extra) {
  if (error) {
    ok(name, `blocked: [${error.code ?? "?"}] ${String(error.message).slice(0, 70)}`);
    return true;
  }
  bad(name, `the write SUCCEEDED and should not have${extra ? ` | ${extra}` : ""}`);
  return false;
}

// ---------------------------------------------------------------------------
// Gating a negative assertion on the table actually existing
//
// This matters more than it looks. Every assertion in sections 05 and 06 of
// the form "a normal user CANNOT do X" trivially holds when the table does
// not exist at all -- PostgREST answers PGRST205 (or Postgres 42P01) and the
// probe sees "blocked". Before 0015 is applied that is a PASS for entirely
// the wrong reason, and it would go on reading green even if the migration
// later shipped with the RLS policies missing.
//
// So a negative assertion is only counted when the table is really there.
// Until then it is reported as NOT VERIFIED and tagged [needs 0015] -- the
// same honest posture as the positive assertions, rather than a false green
// that hides an unproven security claim.
// ---------------------------------------------------------------------------
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01", "PGRST202"]);

function isMissingTable(error) {
  if (!error) return false;
  return (
    MISSING_TABLE_CODES.has(error.code) ||
    /could not find the table|does not exist|schema cache/i.test(String(error.message ?? ""))
  );
}

function notVerified(name) {
  bad(name, "NOT VERIFIED -- the table does not exist yet, so this would 'pass' for the wrong reason");
  return false;
}

function assertBlockedGated(name, error, tableReady, extra) {
  if (!tableReady) return notVerified(name);
  return assertBlocked(name, error, extra);
}

function assertEqGated(name, actual, expected, tableReady) {
  if (!tableReady) return notVerified(name);
  return assertEq(name, actual, expected);
}

// ---------------------------------------------------------------------------
// Server control
// ---------------------------------------------------------------------------
async function startServer(port, extraEnv, label) {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });
  child.stdout.on("data", () => {});

  // Poll the real endpoint rather than sleeping a fixed amount: a slow boot
  // should show up as "slower", not as a spurious failure.
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`${label} server on :${port} never became ready.\n${stderr}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/delivery-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName: "ping", ...COORDS.GLOBAL }),
      });
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    await sleep(300);
  }
  console.log(`  (${label} server ready on :${port})`);
  return child;
}

async function postJson(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

function deliveryLinks(port, coords, restaurantName = RESTAURANT) {
  return postJson(port, "/api/delivery-links", { restaurantName, ...coords });
}

function serviceNamed(body, name) {
  return (body?.services ?? []).find((s) => s.serviceName === name) ?? null;
}

function isUsableHttpsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.host.length > 0;
  } catch {
    return false;
  }
}

function readSource(relative) {
  const path = join(ROOT, ...relative.split("/"));
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// ---------------------------------------------------------------------------
async function main() {
  const started = Date.now();

  if (!existsSync(ENTRY)) {
    console.error(
      `\nFATAL: ${ENTRY} not found.\nRun \`npm run build\` first -- this suite tests the real built server, not a mock.`
    );
    process.exit(2);
  }

  console.log("Booting two servers (no affiliate config / mixed affiliate config)...");
  const plain = await startServer(PORT_PLAIN, {}, "plain");
  const tagged = await startServer(PORT_AFFILIATE, AFFILIATE_ENV, "affiliate");

  try {
    // =====================================================================
    section("01  delivery links with ZERO affiliate ids (today's real state)");
    // =====================================================================
    const plainByRegion = {};
    for (const [region, coords] of Object.entries(COORDS)) {
      const { status, body } = await deliveryLinks(PORT_PLAIN, coords);
      plainByRegion[region] = body;

      assertEq(`${region}: 200 OK`, status, 200);
      assertEq(`${region}: region resolved`, body?.region, region);
      assert(
        `${region}: at least one delivery service returned`,
        (body?.services?.length ?? 0) > 0,
        JSON.stringify(body)
      );
      assert(
        `${region}: every link is a usable https URL (no missing/broken link)`,
        (body?.services ?? []).every((s) => isUsableHttpsUrl(s.url)),
        JSON.stringify(body?.services)
      );
      assert(
        `${region}: every link carries the restaurant name`,
        (body?.services ?? []).every((s) => decodeURIComponent(s.url).includes(RESTAURANT)),
        JSON.stringify(body?.services?.map((s) => s.url))
      );
      assert(
        `${region}: nothing is marked affiliate`,
        (body?.services ?? []).every((s) => s.affiliate === false),
        JSON.stringify(body?.services)
      );
      assertEq(`${region}: no affiliate disclosure claimed`, body?.affiliateDisclosure, false);
    }

    // The service lists themselves, so a future refactor can't silently drop
    // a region's services while still returning "something".
    assertEq(
      "GLOBAL services",
      plainByRegion.GLOBAL?.services?.map((s) => s.serviceName),
      ["DoorDash", "Uber Eats", "Grubhub"]
    );
    assertEq("IN services", plainByRegion.IN?.services?.map((s) => s.serviceName), ["Zomato", "Swiggy"]);
    assertEq(
      "UK services",
      plainByRegion.UK?.services?.map((s) => s.serviceName),
      ["Deliveroo", "Just Eat", "Uber Eats"]
    );

    // No fabricated commercial data anywhere in the payload -- the reference
    // app's fake prices must not come back through the monetization door.
    const plainText = JSON.stringify(plainByRegion);
    assert(
      "no price/rating/eta fields anywhere in the response",
      !/"(price|deliveryFee|eta|rating|reviews|orders|commission)"/i.test(plainText),
      plainText.slice(0, 200)
    );

    // =====================================================================
    section("02  delivery links WITH affiliate ids configured");
    // =====================================================================
    const g = await deliveryLinks(PORT_AFFILIATE, COORDS.GLOBAL);
    assertEq("GLOBAL: 200 OK", g.status, 200);

    const dd = serviceNamed(g.body, "DoorDash");
    const ddPlain = serviceNamed(plainByRegion.GLOBAL, "DoorDash");
    assert("DoorDash link is present", Boolean(dd), JSON.stringify(g.body));
    assertEq("DoorDash is flagged affiliate", dd?.affiliate, true);
    assert(
      "DoorDash goes through the configured network template",
      dd?.url?.startsWith("https://affiliate-network.test/c/pub-test-123/9999?u="),
      dd?.url
    );
    // The destination must survive the wrapper intact -- a tracking link that
    // loses the restaurant is worse than no tracking link.
    const ddDest = dd ? new URL(dd.url).searchParams.get("u") : null;
    assertEq("the wrapped destination is exactly the plain link", ddDest, ddPlain?.url);

    const ue = serviceNamed(g.body, "Uber Eats");
    assertEq("Uber Eats (id with no template/param) is NOT flagged affiliate", ue?.affiliate, false);
    assertEq(
      "Uber Eats falls back to the exact plain link",
      ue?.url,
      serviceNamed(plainByRegion.GLOBAL, "Uber Eats")?.url
    );
    assert(
      "the orphan affiliate id does not leak into the URL",
      !String(ue?.url).includes("orphan-id-no-format"),
      ue?.url
    );

    const gh = serviceNamed(g.body, "Grubhub");
    assertEq("Grubhub (template missing {url}) is NOT flagged affiliate", gh?.affiliate, false);
    assertEq(
      "Grubhub falls back to the exact plain link",
      gh?.url,
      serviceNamed(plainByRegion.GLOBAL, "Grubhub")?.url
    );
    assert(
      "the broken template's host never appears in a link",
      !String(gh?.url).includes("broken-network.test"),
      gh?.url
    );

    assertEq("disclosure is claimed when something really is tagged", g.body?.affiliateDisclosure, true);

    const inRes = await deliveryLinks(PORT_AFFILIATE, COORDS.IN);
    const zomato = serviceNamed(inRes.body, "Zomato");
    assertEq("Zomato (direct-parameter program) is flagged affiliate", zomato?.affiliate, true);
    assert(
      "Zomato link still points at zomato.com",
      zomato ? new URL(zomato.url).host === "www.zomato.com" : false,
      zomato?.url
    );
    assertEq(
      "Zomato carries the configured tracking parameter",
      zomato ? new URL(zomato.url).searchParams.get("ref") : null,
      "fs-test-zom"
    );
    assert(
      "Zomato's original search query is preserved alongside the tracking param",
      zomato ? new URL(zomato.url).searchParams.get("q") === RESTAURANT : false,
      zomato?.url
    );

    const swiggy = serviceNamed(inRes.body, "Swiggy");
    assertEq("Swiggy (non-https template) is NOT flagged affiliate", swiggy?.affiliate, false);
    assert(
      "an http template never downgrades the outbound link",
      isUsableHttpsUrl(swiggy?.url) && !String(swiggy?.url).includes("insecure-network.test"),
      swiggy?.url
    );

    // =====================================================================
    section("03  sponsored API contract");
    // =====================================================================
    const sponsoredOk = await postJson(PORT_PLAIN, "/api/sponsored-restaurants", {
      cuisine: "italian",
      ...COORDS.GLOBAL,
      countryCode: "US",
    });
    assertEq("returns 200 for a matched cuisine", sponsoredOk.status, 200);
    assert(
      "responds with a `sponsored` array",
      Array.isArray(sponsoredOk.body?.sponsored),
      JSON.stringify(sponsoredOk.body)
    );
    assert(
      "every entry (if any) is structurally distinguishable as sponsored",
      (sponsoredOk.body?.sponsored ?? []).every(
        (s) => s.isSponsored === true && s.sponsorshipLabel === "Featured"
      ),
      JSON.stringify(sponsoredOk.body?.sponsored)
    );
    assert(
      "the response cannot carry cuisines (guardrail: restaurants only)",
      !/"(cuisines|suggestedCuisines|cuisine_id|deck)"/.test(JSON.stringify(sponsoredOk.body ?? {})),
      JSON.stringify(sponsoredOk.body)
    );

    const noCuisine = await postJson(PORT_PLAIN, "/api/sponsored-restaurants", { ...COORDS.GLOBAL });
    assertEq("REFUSES to answer without an already-matched cuisine", noCuisine.status, 400);

    const badCoords = await postJson(PORT_PLAIN, "/api/sponsored-restaurants", {
      cuisine: "italian",
      latitude: 999,
      longitude: "not-a-number",
    });
    assertEq("out-of-range coordinates are rejected, not forwarded", badCoords.status, 200);
    assertEq("and degrade to an untargeted (empty) result", badCoords.body?.sponsored?.length, 0);

    // PostgREST filter injection, the bug class this project already found
    // once in /api/restaurant-menu. A cuisine containing PostgREST grammar
    // must be a value, not more query.
    const injection = await postJson(PORT_PLAIN, "/api/sponsored-restaurants", {
      cuisine: "nope,priority.gte.0",
      ...COORDS.GLOBAL,
    });
    assertEq("PostgREST filter injection in `cuisine` returns nothing", injection.body?.sponsored?.length, 0);

    // =====================================================================
    section("04  GUARDRAIL: sponsorship is unreachable from the matching path");
    // =====================================================================
    // The rule: sponsored placement may only affect which RESTAURANTS surface
    // AFTER a cuisine is matched. It must never influence the swipe deck or
    // the match algorithm. This is the test that goes red if that is ever
    // violated -- do not delete it, and do not "fix" it by adding an
    // exception.
    const MATCHING_PATH = [
      "src/components/swipe/swipe-area.tsx",
      "src/components/swipe/cuisine-card.tsx",
      "src/lib/cuisines.ts",
      "src/lib/ai-suggestions.ts",
      "src/lib/dietary.ts",
      "src/lib/swipes.ts",
      "src/pages/api/suggest-cuisines.ts",
      "supabase/migrations/0006_match_detection.sql",
      "supabase/migrations/0007_dish_swipes.sql",
      "supabase/migrations/0009_fix_join_match_realtime.sql",
      "supabase/migrations/0012_dish_matches.sql",
    ];

    for (const file of MATCHING_PATH) {
      const src = readSource(file);
      if (src === null) {
        // A renamed/removed file must not silently pass the guardrail.
        bad(`${file} exists to be checked`, "file not found -- update MATCHING_PATH in this suite");
        continue;
      }
      assert(
        `${file} never mentions sponsorship`,
        !/sponsor/i.test(src),
        "a matching-path file references sponsorship -- see the guardrail in src/lib/sponsored.ts"
      );
    }

    const mig = readSource("supabase/migrations/0015_monetization.sql") ?? "";
    assert(
      "0015 does not redefine either match trigger",
      !/create\s+or\s+replace\s+function\s+public\.check_(swipe|dish_swipe)_match/i.test(mig),
      "0015 must not touch match detection"
    );
    assert(
      "0015 does not alter swipes / dish_swipes / cuisines",
      !/alter\s+table\s+public\.(swipes|dish_swipes|cuisines)\b/i.test(mig),
      "0015 must be additive to the matching schema"
    );
    assert(
      "0015 creates no trigger on a matching table",
      !/create\s+trigger[\s\S]{0,120}\bon\s+public\.(swipes|dish_swipes)\b/i.test(mig),
      "0015 must not attach anything to the match path"
    );
    assert(
      "sponsored_placements.cuisine_id is NOT a foreign key into the cuisine catalog",
      !/cuisine_id[^,]*references\s+public\.cuisines/i.test(mig),
      "an FK would couple sponsorship into the catalog the deck is built from"
    );

    const sponsoredLib = readSource("src/lib/sponsored.ts") ?? "";
    assert(
      "src/lib/sponsored.ts never reads swipes/cuisines/dish_swipes",
      !/from\(\s*["'](swipes|cuisines|dish_swipes|swipe_sessions)["']/.test(sponsoredLib),
      "the sponsored read path must not touch matching tables"
    );
    assert(
      "the sponsored read path requires an already-matched cuisine",
      /matchedCuisineId/.test(sponsoredLib),
      "the guardrail depends on this argument being mandatory"
    );

    // =====================================================================
    section("05  sponsored_placements RLS (writes are service-role only)");
    // =====================================================================
    const A = await signInOrSignUp(userByKey("A"));
    const B = await signInOrSignUp(userByKey("B"));

    afterMigration();

    const readLive = await A.client
      .from("sponsored_placements")
      .select("id, restaurant_name, cuisine_id, priority");
    const sponsoredReady = !isMissingTable(readLive.error);
    assertNoError("an ordinary user CAN read live placements", readLive.error);
    assert(
      "the read returns a list (empty is correct -- no campaigns sold yet)",
      Array.isArray(readLive.data),
      JSON.stringify(readLive.data)
    );

    const rogueName = `Rogue Placement ${Date.now()}`;
    // Probed with no .select(): PostgreSQL reports a SELECT-policy failure on
    // RETURNING with the same 42501 text as a WITH CHECK violation, so a
    // write must be probed bare and read back separately (build log).
    const rogueInsert = await A.client.from("sponsored_placements").insert({
      restaurant_name: rogueName,
      cuisine_id: "italian",
      priority: 1000,
      advertiser_name: "Definitely Not Paid",
    });
    assertBlockedGated(
      "a normal authenticated user CANNOT insert a sponsored placement",
      rogueInsert.error,
      sponsoredReady,
      "any user could feature themselves for free in other people's results"
    );

    const rogueReadback = await A.client
      .from("sponsored_placements")
      .select("id")
      .eq("restaurant_name", rogueName);
    assertEqGated("...and no such row exists afterwards", rogueReadback.data?.length ?? 0, 0, sponsoredReady);

    const rogueUpdate = await A.client
      .from("sponsored_placements")
      .update({ priority: 1000 })
      .eq("cuisine_id", "italian")
      .select("id");
    assertEqGated(
      "a normal user cannot promote an existing placement (0 rows affected)",
      rogueUpdate.data?.length ?? 0,
      0,
      sponsoredReady
    );

    const rogueDelete = await A.client
      .from("sponsored_placements")
      .delete()
      .eq("cuisine_id", "italian")
      .select("id");
    assertEqGated(
      "a normal user cannot delete a competitor's placement (0 rows affected)",
      rogueDelete.data?.length ?? 0,
      0,
      sponsoredReady
    );

    // =====================================================================
    section("06  monetization_events (click tracking)");
    // =====================================================================
    afterMigration();

    // A real room id, so session_id exercises the real FK rather than null.
    let roomId = null;
    const room = await A.client.rpc("create_room").single();
    if (!room.error) roomId = room.data?.id ?? null;

    const marker = `Click Test ${Date.now()}`;
    const clickInsert = await A.client.from("monetization_events").insert({
      event_type: "delivery_link_clicked",
      session_id: roomId,
      service_name: "DoorDash",
      restaurant_name: marker,
      cuisine_id: "italian",
      region: "GLOBAL",
      affiliate_tagged: false,
    });
    const eventsReady = !isMissingTable(clickInsert.error);
    assertNoError("a click event records for the signed-in user", clickInsert.error);

    const mine = await A.client
      .from("monetization_events")
      .select("id, event_type, service_name, restaurant_name, region, affiliate_tagged, user_id, session_id")
      .eq("restaurant_name", marker);
    assertEq("the event is readable by its owner", mine.data?.length ?? 0, 1);
    const event = mine.data?.[0] ?? null;
    assertEq("user_id was filled in by the server, not the client", event?.user_id, A.user.id);
    assertEq("service_name recorded", event?.service_name, "DoorDash");
    assertEq("region recorded", event?.region, "GLOBAL");
    assertEq("affiliate_tagged recorded", event?.affiliate_tagged, false);
    assertEq("session_id recorded", event?.session_id, roomId);

    const shown = await A.client.from("monetization_events").insert({
      event_type: "delivery_links_shown",
      session_id: roomId,
      restaurant_name: marker,
      region: "GLOBAL",
    });
    assertNoError("the funnel's 'links shown' stage also records", shown.error);

    const otherUser = await B.client
      .from("monetization_events")
      .select("id")
      .eq("restaurant_name", marker);
    assertEqGated(
      "another user CANNOT read someone else's click events",
      otherUser.data?.length ?? 0,
      0,
      eventsReady
    );

    const forged = await A.client.from("monetization_events").insert({
      event_type: "delivery_link_clicked",
      user_id: B.user.id,
      service_name: "DoorDash",
      restaurant_name: `${marker} forged`,
    });
    assertBlockedGated("a user CANNOT record an event as someone else", forged.error, eventsReady);

    const badType = await A.client
      .from("monetization_events")
      .insert({ event_type: "definitely_not_a_real_event", restaurant_name: marker });
    assertBlockedGated(
      "an unknown event_type is rejected by the check constraint",
      badType.error,
      eventsReady
    );

    const badRegion = await A.client
      .from("monetization_events")
      .insert({ event_type: "delivery_link_clicked", region: "MARS", restaurant_name: marker });
    assertBlockedGated("an unknown region is rejected by the check constraint", badRegion.error, eventsReady);

    if (event?.id) {
      const edit = await A.client
        .from("monetization_events")
        .update({ service_name: "Rewritten" })
        .eq("id", event.id)
        .select("id");
      assertEq("an event cannot be edited after the fact (0 rows)", edit.data?.length ?? 0, 0);

      const del = await A.client
        .from("monetization_events")
        .delete()
        .eq("id", event.id)
        .select("id");
      assertEq("an event cannot be deleted (append-only, 0 rows)", del.data?.length ?? 0, 0);

      const still = await A.client
        .from("monetization_events")
        .select("service_name")
        .eq("id", event.id)
        .maybeSingle();
      assertEq("...and the original value is intact", still.data?.service_name, "DoorDash");
    }

    // Clean-up note: these rows deliberately cannot be deleted by their own
    // author (append-only, no DELETE policy), so each run leaves a couple of
    // test events behind, tagged with a timestamped restaurant name. That is
    // the intended trade-off -- an analytics table a client can edit is not
    // an analytics table.
  } finally {
    plain.kill();
    tagged.kill();
  }

  finish(started);
}

function finish(started) {
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(74)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed  (${secs}s)`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  if (pendingMigration > 0) {
    console.log(
      `\nNOTE: ${pendingMigration} of the ${failed} failures are tagged [needs 0015].\n` +
        "      supabase/migrations/0015_monetization.sql has NOT been applied to the\n" +
        "      live project yet -- run it in the Supabase SQL editor, then re-run this\n" +
        "      suite. Those assertions are the fix waiting to be applied, not a defect."
    );
  }
  console.log("=".repeat(74));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
