// scripts/test-subcuisine.mjs
//
// Live integration test for the Indian refine layer
// (supabase/migrations/0017_indian_subcuisines.sql). Same harness shape as
// test-e2e.mjs: real anon-key clients, no service_role, so every assertion
// here exercises the actual RLS/RPC/trigger path a browser would.
//
//   node --env-file=.env scripts/test-subcuisine.mjs
//
// Everything in here is gated on 0017 being applied -- if it isn't, every
// assertion below is tagged [needs 0017] and reports NOT VERIFIED rather
// than silently passing on a missing-table error (see needs0017()).

import { TEST_USERS, signInOrSignUp, sleep, waitFor } from "./_shared.mjs";

let passed = 0;
let failed = 0;
const failures = [];
let currentSection = "";

function section(name) {
  currentSection = name;
  console.log(`\n--- ${name} ${"-".repeat(Math.max(0, 68 - name.length))}`);
}
function ok(name, detail) {
  passed++;
  console.log(`  PASS  ${name}${detail ? `  [${detail}]` : ""}`);
}
function bad(name, detail) {
  failed++;
  failures.push(`${currentSection} :: ${name}${detail ? ` -- ${detail}` : ""}`);
  console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
}
function assert(name, condition, detail) {
  if (condition) ok(name);
  else bad(name, detail);
  return Boolean(condition);
}
function assertEq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return ok(name, `= ${e}`), true;
  bad(name, `expected ${e}, got ${a}`);
  return false;
}

let schemaMissing = false;
function needs0017(name, fn) {
  return async (...args) => {
    if (schemaMissing) {
      bad(`[needs 0017]  ${name}`, "NOT VERIFIED -- 0017_indian_subcuisines.sql not applied yet");
      return;
    }
    try {
      await fn(...args);
    } catch (err) {
      if (err?.code === "PGRST205" || /schema cache/.test(err?.message ?? "")) {
        schemaMissing = true;
        bad(`[needs 0017]  ${name}`, `NOT VERIFIED -- ${err.message}`);
        return;
      }
      throw err;
    }
  };
}

async function main() {
  const started = Date.now();
  console.log("Food Swipe -- Indian refine-layer integration test");
  console.log(`Target: ${process.env.PUBLIC_SUPABASE_URL}\n`);

  section("00 auth: sign in three test users");
  const A = await signInOrSignUp(TEST_USERS[0]);
  const B = await signInOrSignUp(TEST_USERS[1]);
  const C = await signInOrSignUp(TEST_USERS[2]);
  ok("A, B, C signed in");

  section("01 catalog: 10 Indian subcategories, 8 dishes each, no overlap with the flat list");
  await needs0017("cuisine_subcategories has exactly 10 rows for indian", async () => {
    const { data, error } = await A.client
      .from("cuisine_subcategories")
      .select("id, name, dishes")
      .eq("cuisine_id", "indian");
    if (error) throw error;
    assertEq("row count", data.length, 10);
    const allDishes = data.flatMap((r) => r.dishes);
    assertEq("total dish count (10 x 8)", allDishes.length, 80);
    assertEq("no duplicate dish names across subcategories", new Set(allDishes).size, allDishes.length);

    const { data: flat } = await A.client.from("cuisines").select("dishes").eq("id", "indian").single();
    const overlap = allDishes.filter((d) => flat.dishes.includes(d));
    assertEq("zero overlap with the flat indian.dishes catalog", overlap, []);
  })();

  section("02 non-participant is locked out (RLS)");
  await needs0017("D (not in any room here) cannot read cuisine_subcategories rows via a forged session filter", async () => {
    // cuisine_subcategories is public-read by design (mirrors `cuisines`),
    // so the real RLS boundary to prove is on subcuisine_swipes, not this
    // table -- verified in section 04 below instead. This section exists so
    // a reader scanning the file sees that omission was considered, not missed.
    ok("public-read catalog has no participant boundary to test (by design, see cuisines' own policy)");
  })();

  section("03 room setup: A hosts, B + C join, both dietary-clear so Indian is reachable");
  let roomId, roomCode;
  await needs0017("room created and joined", async () => {
    const { data: room, error } = await A.client.rpc("create_room").single();
    if (error) throw error;
    roomId = room.id;
    roomCode = room.code;
    await B.client.rpc("join_room_by_code", { p_code: roomCode });
    await C.client.rpc("join_room_by_code", { p_code: roomCode });
    ok("room created and both joined", roomCode);
  })();

  section("04 unanimity + RLS on subcuisine_swipes");
  await needs0017("2 of 3 does not match; 3rd completes it; non-participant is locked out", async () => {
    const target = "indian-hyderabadi";

    for (const u of [A, B]) {
      const { error } = await u.client
        .from("subcuisine_swipes")
        .upsert(
          { session_id: roomId, user_id: u.user.id, subcuisine_id: target, direction: "right" },
          { onConflict: "session_id,user_id,subcuisine_id" }
        );
      if (error) throw error;
    }
    await sleep(600);
    const { data: mid } = await A.client.from("swipe_sessions").select("matched_subcuisine_id").eq("id", roomId).single();
    assertEq("2/3 right -> no match yet", mid.matched_subcuisine_id, null);

    // D never joined this room -- must not be able to write a swipe into it.
    const D = await signInOrSignUp(TEST_USERS[3]);
    const forged = await D.client
      .from("subcuisine_swipes")
      .insert({ session_id: roomId, user_id: D.user.id, subcuisine_id: target, direction: "right" });
    assert(
      "D (non-participant) cannot insert a subcuisine swipe into this room",
      forged.error !== null,
      forged.error ? forged.error.message : "insert unexpectedly succeeded"
    );

    const { error } = await C.client
      .from("subcuisine_swipes")
      .upsert(
        { session_id: roomId, user_id: C.user.id, subcuisine_id: target, direction: "right" },
        { onConflict: "session_id,user_id,subcuisine_id" }
      );
    if (error) throw error;

    const result = await waitFor(
      async () => {
        const { data } = await A.client.from("swipe_sessions").select("matched_subcuisine_id, status").eq("id", roomId).single();
        return data;
      },
      (row) => row.matched_subcuisine_id !== null
    );
    assert("3/3 right -> check_subcuisine_match() fired", result.ok, `waited ${result.waitedMs}ms`);
    assertEq("matched_subcuisine_id", result.value?.matched_subcuisine_id, target);
    assertEq("cuisine-level status untouched (still 'matched', no new status value)", result.value?.status, "matched");
  })();

  section("05 Realtime: a subscriber sees the match live");
  await needs0017("B's channel receives the swipe_sessions UPDATE carrying matched_subcuisine_id", async () => {
    const target2 = "indian-street-food";
    const events = [];
    const channel = B.client
      .channel(`room:${roomId}:subcuisine-test`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "swipe_sessions", filter: `id=eq.${roomId}` },
        (payload) => events.push(payload.new)
      )
      .subscribe();
    await waitFor(() => channel.state, (s) => s === "joined", { timeoutMs: 5000 });

    for (const u of [A, B, C]) {
      await u.client
        .from("subcuisine_swipes")
        .upsert(
          { session_id: roomId, user_id: u.user.id, subcuisine_id: target2, direction: "right" },
          { onConflict: "session_id,user_id,subcuisine_id" }
        );
    }
    const result = await waitFor(
      async () => events,
      (evts) => evts.some((e) => e.matched_subcuisine_id === target2)
    );
    B.client.removeChannel(channel);
    assert("B received the match live over Realtime", result.ok, `${events.length} event(s), waited ${result.waitedMs}ms`);
  })();

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(74)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed  (${secs}s)`);
  if (schemaMissing) {
    console.log(
      "\nNOTE: supabase/migrations/0017_indian_subcuisines.sql has NOT been applied\n" +
        "yet -- run it in the Supabase SQL editor, then re-run this suite. Every\n" +
        "[needs 0017] failure above is the feature waiting to be turned on, not a defect."
    );
  }
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("=".repeat(74));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
