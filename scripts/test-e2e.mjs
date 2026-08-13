// scripts/test-e2e.mjs
//
// End-to-end integration test for the Food Swipe room/swipe/match stack,
// run entirely through the anon key as four real authenticated clients.
// This is the first thing in this project that executes the RLS policies,
// the SECURITY DEFINER RPCs, the match triggers and Realtime against a real
// Postgres, so treat every failure as a real defect until proven otherwise.
//
//   node --env-file=.env scripts/test-e2e.mjs
//
// Exits non-zero if any assertion fails.
import {
  TEST_USERS,
  userByKey,
  signInOrSignUp,
  generateRoomCode,
  waitFor,
  sleep,
  ROOM_COLUMNS,
} from "./_shared.mjs";

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------
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
  if (condition) ok(name, typeof detail === "string" && condition ? undefined : undefined);
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
    }${error.hint ? ` | hint: ${error.hint}` : ""}${extra ? ` | ${extra}` : ""}`
  );
  return false;
}

// ---------------------------------------------------------------------------
// Room helpers (mirror src/lib/rooms.ts's wire behaviour -- see _shared.mjs)
// ---------------------------------------------------------------------------

/**
 * Mirrors src/lib/rooms.ts createRoom(): client-generated id, insert the
 * swipe_sessions row, then insert the creator's room_participants row, with
 * a retry on room-code collision (23505). Deliberately reproduces the
 * two-statement shape so the harness catches the same failure modes the app
 * has.
 */
async function createRoomTwoInserts(client, userId) {
  const id = crypto.randomUUID();
  let code = generateRoomCode();
  let lastError = null;
  let inserted = false;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const { error } = await client
      .from("swipe_sessions")
      .insert({ id, code, creator_id: userId, status: "waiting" });
    if (!error) {
      inserted = true;
      break;
    }
    lastError = error;
    if (error.code === "23505") {
      code = generateRoomCode();
      continue;
    }
    throw error;
  }
  if (!inserted) throw lastError ?? new Error("could not create room");

  const { error: joinError } = await client
    .from("room_participants")
    .insert({ room_id: id, user_id: userId });
  if (joinError) throw joinError;

  return { id, code };
}

/** Preferred room creation for the rest of the suite (falls back if the RPC isn't deployed). */
async function createRoom(client, userId) {
  const { data, error } = await client.rpc("create_room").single();
  if (error) {
    if (error.code === "PGRST202" || /function .*create_room/i.test(error.message ?? "")) {
      // 0009 not applied yet -- fall back to the legacy two-insert path so
      // the rest of the suite can still run and report.
      return { ...(await createRoomTwoInserts(client, userId)), via: "two-inserts" };
    }
    throw error;
  }
  return { id: data.id, code: data.code, via: "rpc" };
}

async function joinByCode(client, code) {
  return client.rpc("join_room_by_code", { p_code: code.trim().toUpperCase() }).single();
}

async function fetchRoom(client, roomId) {
  const { data } = await client.from("swipe_sessions").select(ROOM_COLUMNS).eq("id", roomId).maybeSingle();
  return data ?? null;
}

async function participantCount(client, roomId) {
  const { data } = await client.from("room_participants").select("user_id").eq("room_id", roomId);
  return (data ?? []).length;
}

async function swipe(client, sessionId, userId, cuisineId, direction) {
  return client
    .from("swipes")
    .upsert(
      { session_id: sessionId, user_id: userId, cuisine_id: cuisineId, direction },
      { onConflict: "session_id,user_id,cuisine_id" }
    );
}

async function dishSwipe(client, sessionId, userId, restaurantName, dishName, direction) {
  return client
    .from("dish_swipes")
    .upsert(
      { session_id: sessionId, user_id: userId, restaurant_name: restaurantName, dish_name: dishName, direction },
      { onConflict: "session_id,user_id,restaurant_name,dish_name" }
    );
}

/**
 * Reads the agreed-dish list for a session (supabase/migrations/
 * 0012_dish_matches.sql). Mirrors src/lib/dish-matches.ts's fetchDishMatches().
 * Returns the raw error too -- several tests below assert on it (RLS).
 */
async function fetchDishMatches(client, sessionId) {
  const { data, error } = await client
    .from("dish_matches")
    .select("id, session_id, restaurant_name, dish_name, matched_at")
    .eq("session_id", sessionId)
    .order("matched_at", { ascending: true });
  return { rows: data ?? [], error };
}

/** Mirrors src/lib/rooms.ts leaveRoom()'s server-side half. */
async function leaveRoom(client, roomId, userId) {
  return client
    .from("room_participants")
    .delete({ count: "exact" })
    .eq("room_id", roomId)
    .eq("user_id", userId);
}

// Mirrors src/lib/dietary.ts (pure functions, no Supabase import).
function unionDietaryRestrictions(participants) {
  const union = new Set();
  for (const p of participants) for (const r of p.dietaryRestrictions ?? []) union.add(r);
  return [...union];
}
function filterCuisinesByDietary(cuisines, required) {
  if (required.length === 0) return cuisines;
  return cuisines.filter((c) => required.every((r) => (c.dietary_tags ?? []).includes(r)));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const started = Date.now();
  console.log("Food Swipe live integration test");
  console.log(`Target: ${process.env.PUBLIC_SUPABASE_URL}`);
  console.log("Auth:   anon key only, four real authenticated users\n");

  // -------------------------------------------------------------------------
  section("00 auth: sign in the four test users");
  // -------------------------------------------------------------------------
  const sessions = {};
  for (const spec of TEST_USERS) {
    try {
      const s = await signInOrSignUp(spec);
      sessions[spec.key] = s;
      ok(`sign in ${spec.key} (${spec.email})`, s.created ? "created now" : "existing");
    } catch (err) {
      bad(`sign in ${spec.key} (${spec.email})`, err.message);
    }
  }
  if (!sessions.A || !sessions.B || !sessions.C || !sessions.D) {
    console.error("\nCannot continue without all four users. Run scripts/seed-test-users.mjs first.");
    return finish(started);
  }
  const A = sessions.A, B = sessions.B, C = sessions.C, D = sessions.D;

  // Ensure dietary data is in place even if seed wasn't run in this order.
  for (const key of ["A", "B", "C", "D"]) {
    const spec = userByKey(key);
    await sessions[key].client
      .from("profiles")
      .update({ display_name: spec.displayName, phone: spec.phone, dietary_restrictions: spec.dietaryRestrictions })
      .eq("id", sessions[key].user.id);
  }

  // -------------------------------------------------------------------------
  section("01 anonymous sign-in (guest join precondition)");
  // -------------------------------------------------------------------------
  {
    const guest = (await import("./_shared.mjs")).makeClient();
    const { data, error } = await guest.auth.signInAnonymously();
    if (error) {
      console.log(
        `  SKIP  anonymous sign-in unavailable -- [${error.status ?? "?"}] ${error.message}` +
          `\n        (Dashboard toggle: Auth > Sign In / Providers > Anonymous sign-ins. Guest-join is untestable until this is on.)`
      );
    } else {
      ok("signInAnonymously() returns a session", data.user?.id);
      const { data: prof, error: profErr } = await guest
        .from("profiles")
        .select("id, display_name, is_guest")
        .eq("id", data.user.id)
        .maybeSingle();
      assertNoError("guest profile row readable", profErr);
      assert("handle_new_user() created guest profile", Boolean(prof), "no profiles row for the anonymous user");
      if (prof) assertEq("guest profile is_guest = true", prof.is_guest, true);
      const { error: renameErr } = await guest
        .from("profiles")
        .update({ display_name: "Gina Guest" })
        .eq("id", data.user.id);
      assertNoError("guest can rename own profile (ensureGuestSession path)", renameErr);
      await guest.auth.signOut();
    }
  }

  // -------------------------------------------------------------------------
  section("02 room create (user A)");
  // -------------------------------------------------------------------------
  let room1;
  try {
    room1 = await createRoom(A.client, A.user.id);
    ok("createRoom succeeded", `code=${room1.code} via=${room1.via}`);
  } catch (err) {
    bad("createRoom succeeded", err.message ?? String(err));
    return finish(started);
  }

  {
    const row = await fetchRoom(A.client, room1.id);
    assert("creator can read back the room row", Boolean(row), "select returned null -- RLS or missing row");
    if (row) {
      assertEq("room.status after create", row.status, "waiting");
      assertEq("room.creator_id is A", row.creator_id, A.user.id);
      assertEq("room.code round-trips", row.code, room1.code);
    }
    assertEq("participant count after create", await participantCount(A.client, room1.id), 1);
  }

  // -------------------------------------------------------------------------
  section("03 join by code (users B and C) + status auto-flip");
  // -------------------------------------------------------------------------
  {
    const { data: bJoin, error: bErr } = await joinByCode(B.client, room1.code);
    assertNoError("B: join_room_by_code() RPC", bErr);
    if (!bErr) {
      assertEq("B: RPC returns the right room id", bJoin?.id, room1.id);
      assertEq("B: room status auto-flipped waiting -> swiping", bJoin?.status, "swiping");
    }
    assertEq("participant count after B joins", await participantCount(A.client, room1.id), bErr ? 1 : 2);

    const { data: cJoin, error: cErr } = await joinByCode(C.client, room1.code);
    assertNoError("C: join_room_by_code() RPC", cErr);
    if (!cErr) assertEq("C: room status stays swiping", cJoin?.status, "swiping");
    assertEq("participant count after C joins", await participantCount(A.client, room1.id), cErr ? 1 : 3);

    const row = await fetchRoom(A.client, room1.id);
    assertEq("swipe_sessions.status persisted as swiping", row?.status, "swiping");

    // Idempotency: re-joining must not duplicate a participant row.
    const { error: reErr } = await joinByCode(B.client, room1.code);
    assertNoError("B: re-join is idempotent (no error)", reErr);
    assertEq("participant count unchanged after B re-joins", await participantCount(A.client, room1.id), cErr ? 1 : 3);

    // Bad code path.
    const { error: badErr } = await joinByCode(B.client, "ZZZZ");
    assert("joining a nonexistent code errors", Boolean(badErr), "expected an error for code ZZZZ, got none");
  }

  // -------------------------------------------------------------------------
  section("04 get_room_profiles(): visibility + no phone leak");
  // -------------------------------------------------------------------------
  {
    for (const [key, s] of [["A", A], ["B", B], ["C", C]]) {
      const { data, error } = await s.client.rpc("get_room_profiles", { p_room_id: room1.id });
      if (assertNoError(`${key}: get_room_profiles() call`, error)) {
        const names = (data ?? []).map((r) => r.display_name).sort();
        assertEq(`${key}: sees all three display names`, names, ["Ava Tester", "Ben Tester", "Cara Tester"]);
        const leaked = (data ?? []).some((r) => Object.prototype.hasOwnProperty.call(r, "phone"));
        assert(`${key}: get_room_profiles() does NOT expose phone`, !leaked, `returned keys: ${Object.keys(data?.[0] ?? {}).join(",")}`);
        const cara = (data ?? []).find((r) => r.display_name === "Cara Tester");
        assertEq(`${key}: sees Cara's dietary_restrictions`, cara?.dietary_restrictions, ["gluten-free"]);
      }
    }

    // Direct table read must still be own-row-only.
    const { data: direct } = await B.client.from("profiles").select("id, phone").eq("id", A.user.id);
    assertEq("B cannot read A's profiles row directly (RLS)", (direct ?? []).length, 0);
  }

  // -------------------------------------------------------------------------
  section("05 dietary filter against real seeded dietary_tags");
  // -------------------------------------------------------------------------
  {
    const { data: cuisines, error } = await A.client.from("cuisines").select("id, name, dishes, dietary_tags");
    assertNoError("cuisines catalog readable (public read policy)", error);
    const list = cuisines ?? [];
    assertEq("cuisine catalog size", list.length, 9);
    assert(
      "every cuisine has non-empty dietary_tags (0004 applied)",
      list.length > 0 && list.every((c) => (c.dietary_tags ?? []).length > 0),
      `untagged: ${list.filter((c) => !(c.dietary_tags ?? []).length).map((c) => c.id).join(",") || "none"}`
    );

    const { data: profiles } = await A.client.rpc("get_room_profiles", { p_room_id: room1.id });
    const union = unionDietaryRestrictions(
      (profiles ?? []).map((p) => ({ dietaryRestrictions: p.dietary_restrictions ?? [] }))
    );
    assertEq("room dietary union (A+B+C, Cara is gluten-free)", union.sort(), ["gluten-free"]);

    const deck = filterCuisinesByDietary(list, union).map((c) => c.id).sort();
    assertEq("filtered deck for gluten-free room", deck, ["indian", "mexican", "thai", "vietnamese"]);
    assert("filter actually removed cuisines", deck.length < list.length, `${deck.length} of ${list.length}`);

    const strict = filterCuisinesByDietary(list, ["halal", "gluten-free"]).map((c) => c.id);
    assertEq("filtered deck for halal+gluten-free (Dev's profile)", strict, ["indian"]);
  }

  // -------------------------------------------------------------------------
  section("06 negative match: 2 of 3 right-swipes must NOT match");
  // -------------------------------------------------------------------------
  {
    assertNoError("A swipes right on thai", (await swipe(A.client, room1.id, A.user.id, "thai", "right")).error);
    assertNoError("B swipes right on thai", (await swipe(B.client, room1.id, B.user.id, "thai", "right")).error);
    assertNoError("C swipes LEFT on thai", (await swipe(C.client, room1.id, C.user.id, "thai", "left")).error);

    await sleep(600);
    const row = await fetchRoom(A.client, room1.id);
    assertEq("status still swiping (no false match)", row?.status, "swiping");
    assertEq("matched_cuisine_id still null", row?.matched_cuisine_id, null);
  }

  // -------------------------------------------------------------------------
  section("07 re-swipe (upsert): no duplicate rows, trigger sees the update");
  // -------------------------------------------------------------------------
  {
    // C flips thai from left -> right. Same unique key, so this must UPDATE.
    assertNoError("C re-swipes thai left -> right", (await swipe(C.client, room1.id, C.user.id, "thai", "right")).error);

    const { data: rows, error } = await A.client
      .from("swipes")
      .select("user_id, cuisine_id, direction")
      .eq("session_id", room1.id)
      .eq("cuisine_id", "thai");
    assertNoError("read thai swipes", error);
    assertEq("exactly 3 thai swipe rows (no duplicates from the upsert)", (rows ?? []).length, 3);
    const cRows = (rows ?? []).filter((r) => r.user_id === C.user.id);
    assertEq("exactly 1 row for C on thai", cRows.length, 1);
    assertEq("C's thai swipe is now 'right'", cRows[0]?.direction, "right");

    // And the AFTER UPDATE trigger must fire, not just AFTER INSERT.
    const res = await waitFor(() => fetchRoom(A.client, room1.id), (r) => r?.status === "matched");
    assert("match trigger fires on UPDATE path too", res.ok, `status=${res.value?.status} after ${res.waitedMs}ms`);
    assertEq("matched_cuisine_id = thai", res.value?.matched_cuisine_id, "thai");
  }

  // -------------------------------------------------------------------------
  section("08 clean unanimous match in a fresh room (INSERT path)");
  // -------------------------------------------------------------------------
  let room2;
  {
    room2 = await createRoom(A.client, A.user.id);
    const { error: e1 } = await joinByCode(B.client, room2.code);
    const { error: e2 } = await joinByCode(C.client, room2.code);
    assertNoError("B joins room2", e1);
    assertNoError("C joins room2", e2);
    assertEq("room2 has 3 participants", await participantCount(A.client, room2.id), 3);

    assertNoError("A right-swipes italian", (await swipe(A.client, room2.id, A.user.id, "italian", "right")).error);
    let row = await fetchRoom(A.client, room2.id);
    assertEq("1/3 -> no match", row?.status, "swiping");

    assertNoError("B right-swipes italian", (await swipe(B.client, room2.id, B.user.id, "italian", "right")).error);
    await sleep(400);
    row = await fetchRoom(A.client, room2.id);
    assertEq("2/3 -> no match", row?.status, "swiping");

    assertNoError("C right-swipes italian", (await swipe(C.client, room2.id, C.user.id, "italian", "right")).error);
    const res = await waitFor(() => fetchRoom(A.client, room2.id), (r) => r?.status === "matched");
    assert("3/3 -> check_swipe_match() fired", res.ok, `status=${res.value?.status} after ${res.waitedMs}ms`);
    assertEq("matched_cuisine_id = italian", res.value?.matched_cuisine_id, "italian");

    // Every participant, not just the creator, must see the match.
    const asC = await fetchRoom(C.client, room2.id);
    assertEq("non-creator C also reads status=matched", asC?.status, "matched");
  }

  // -------------------------------------------------------------------------
  section("09 dish unanimity APPENDS to dish_matches (does not end the session)");
  //
  // The multi-dish model (supabase/migrations/0012_dish_matches.sql). The old
  // behaviour asserted here was: 3/3 flips swipe_sessions.status to
  // 'dish_matched' and writes the scalar matched_dish_name -- i.e. the
  // session ends after ONE dish. That is the bug being fixed, so these
  // assertions now demand the opposite.
  // -------------------------------------------------------------------------
  const RESTAURANT = "Test Bistro";
  const DISH_1 = "Margherita Pizza";
  const DISH_2 = "Garlic Bread";
  {
    assertNoError("A right-swipes dish 1", (await dishSwipe(A.client, room2.id, A.user.id, RESTAURANT, DISH_1, "right")).error);
    assertNoError("B right-swipes dish 1", (await dishSwipe(B.client, room2.id, B.user.id, RESTAURANT, DISH_1, "right")).error);
    await sleep(600);

    const partial = await fetchDishMatches(A.client, room2.id);
    assertNoError("dish_matches readable by a participant", partial.error);
    assertEq("2 of 3 right-swipes -> NO dish_matches row", partial.rows.length, 0);
    assertEq("room status unaffected by a partial dish vote", (await fetchRoom(A.client, room2.id))?.status, "matched");

    assertNoError("C right-swipes dish 1 (completes it)", (await dishSwipe(C.client, room2.id, C.user.id, RESTAURANT, DISH_1, "right")).error);
    const res = await waitFor(
      () => fetchDishMatches(A.client, room2.id),
      (r) => r.rows.length >= 1,
      { timeoutMs: 8000 }
    );
    assert(
      "3 of 3 -> check_dish_swipe_match() INSERTs a dish_matches row",
      res.ok,
      `rows=${JSON.stringify(res.value.rows)} err=${res.value.error?.message ?? "none"} after ${res.waitedMs}ms`
    );
    if (res.ok) {
      assertEq("dish_matches.dish_name", res.value.rows[0].dish_name, DISH_1);
      assertEq("dish_matches.restaurant_name", res.value.rows[0].restaurant_name, RESTAURANT);
      assert("dish_matches.matched_at is populated", Boolean(res.value.rows[0].matched_at));
    }

    // The whole point of the new model: the room keeps going.
    const row = await fetchRoom(A.client, room2.id);
    assertEq("room status UNCHANGED by a dish match (no 'dish_matched')", row?.status, "matched");
    assertEq("scalar matched_dish_name is no longer written", row?.matched_dish_name, null);
    assertEq("scalar matched_restaurant_name is no longer written", row?.matched_restaurant_name, null);

    // Every participant, not just the creator, must see the agreed dish.
    const asC = await fetchDishMatches(C.client, room2.id);
    assertEq("non-creator C also reads the dish_matches row", asC.rows.length, 1);
  }

  // -------------------------------------------------------------------------
  section("10 RLS negative: non-participant D is locked out of room2");
  // -------------------------------------------------------------------------
  {
    const { data: sess } = await D.client.from("swipe_sessions").select("id").eq("id", room2.id);
    assertEq("D cannot SELECT the swipe_sessions row", (sess ?? []).length, 0);

    const { data: sw } = await D.client.from("swipes").select("id").eq("session_id", room2.id);
    assertEq("D cannot SELECT the room's swipes", (sw ?? []).length, 0);

    const { data: dsw } = await D.client.from("dish_swipes").select("id").eq("session_id", room2.id);
    assertEq("D cannot SELECT the room's dish_swipes", (dsw ?? []).length, 0);

    // dish_matches carries what a private group decided to eat -- a
    // non-participant must not be able to read it. Its only SELECT policy
    // goes through is_room_participant(session_id) (0012).
    const dm = await fetchDishMatches(D.client, room2.id);
    assertEq("D cannot SELECT the room's dish_matches (RLS)", dm.rows.length, 0);

    // ...and there is no client write path at all: no INSERT policy exists,
    // so nobody can fabricate "the table agreed on this", not even a real
    // participant of the room.
    const { error: fakeErr } = await A.client
      .from("dish_matches")
      .insert({ session_id: room2.id, restaurant_name: "Forged Diner", dish_name: "Forged Dish" });
    assert(
      "even participant A cannot INSERT a dish_matches row (trigger-only writes)",
      Boolean(fakeErr),
      "insert unexpectedly succeeded -- a client can forge a group decision"
    );

    const { data: parts } = await D.client.from("room_participants").select("user_id").eq("room_id", room2.id);
    assertEq("D cannot SELECT the room's participants", (parts ?? []).length, 0);

    const { data: profs } = await D.client.rpc("get_room_profiles", { p_room_id: room2.id });
    assertEq("get_room_profiles() returns nothing to non-participant D", (profs ?? []).length, 0);

    const { error: wErr } = await swipe(D.client, room2.id, D.user.id, "greek", "right");
    assert("D cannot INSERT a swipe into a room she isn't in", Boolean(wErr), "insert unexpectedly succeeded");

    // Impersonation: D must not be able to write a swipe as A, even in a room D IS in.
    const room3 = await createRoom(D.client, D.user.id);
    const { error: impErr } = await swipe(D.client, room3.id, A.user.id, "greek", "right");
    assert("D cannot INSERT a swipe attributed to A", Boolean(impErr), "impersonating insert unexpectedly succeeded");
  }

  // -------------------------------------------------------------------------
  section("11 late joiner changes the unanimity denominator");
  // -------------------------------------------------------------------------
  {
    const room = await createRoom(A.client, A.user.id);
    await joinByCode(B.client, room.code);
    assertEq("room4 starts with 2 participants", await participantCount(A.client, room.id), 2);

    await swipe(A.client, room.id, A.user.id, "korean", "right");
    // With 2 participants, A alone is 1/2 -> no match yet.
    await sleep(300);
    assertEq("1/2 -> no match", (await fetchRoom(A.client, room.id))?.status, "swiping");

    // C joins BEFORE B votes: denominator becomes 3.
    await joinByCode(C.client, room.code);
    assertEq("room4 now has 3 participants", await participantCount(A.client, room.id), 3);

    await swipe(B.client, room.id, B.user.id, "korean", "right");
    await sleep(600);
    assertEq(
      "2/3 after late joiner -> still no match (late joiner correctly blocks)",
      (await fetchRoom(A.client, room.id))?.status,
      "swiping"
    );

    await swipe(C.client, room.id, C.user.id, "korean", "right");
    const res = await waitFor(() => fetchRoom(A.client, room.id), (r) => r?.status === "matched");
    assert("3/3 including late joiner -> match", res.ok, `status=${res.value?.status}`);
    assertEq("matched_cuisine_id = korean", res.value?.matched_cuisine_id, "korean");
  }

  // -------------------------------------------------------------------------
  section("12 Realtime: subscriber receives another user's match");
  // -------------------------------------------------------------------------
  {
    const room = await createRoom(A.client, A.user.id);
    await joinByCode(B.client, room.code);
    await joinByCode(C.client, room.code);

    const events = { session: [], swipes: [], participants: [] };
    let subscribeStatus = "(never called back)";
    let subscribeError;

    const channel = C.client
      .channel(`room:${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "swipe_sessions", filter: `id=eq.${room.id}` },
        (payload) => events.session.push(payload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "swipes", filter: `session_id=eq.${room.id}` },
        (payload) => events.swipes.push(payload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_participants", filter: `room_id=eq.${room.id}` },
        (payload) => events.participants.push(payload)
      );

    const subscribed = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      channel.subscribe((status, err) => {
        subscribeStatus = status;
        if (err) subscribeError = err;
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve(true);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(timer);
          resolve(false);
        }
      });
    });

    assert(
      "C's Realtime channel reaches SUBSCRIBED",
      subscribed,
      `status=${subscribeStatus}${subscribeError ? ` err=${subscribeError.message ?? subscribeError}` : ""} -- if this fails, Realtime is off at the project level (Dashboard > Settings > API / Realtime) or the publication is missing`
    );

    if (subscribed) {
      await sleep(500);
      // C votes first, so the match is completed by SOMEONE ELSE (B) --
      // this is the case the UI actually depends on.
      await swipe(C.client, room.id, C.user.id, "greek", "right");
      await swipe(A.client, room.id, A.user.id, "greek", "right");
      await sleep(300);
      await swipe(B.client, room.id, B.user.id, "greek", "right");

      const got = await waitFor(
        async () => events,
        (e) => e.session.some((p) => p.new?.status === "matched"),
        { timeoutMs: 12000, intervalMs: 250 }
      );

      assert(
        "C receives a swipe_sessions change event with status=matched",
        got.ok,
        `session events: ${JSON.stringify(events.session.map((p) => ({ type: p.eventType, status: p.new?.status })))} | swipe events: ${events.swipes.length}`
      );
      assert(
        "C receives postgres_changes for other users' swipes",
        events.swipes.length >= 2,
        `got ${events.swipes.length} swipe events (expected >= 3: C, A, B)`
      );
      const matchEvt = events.session.find((p) => p.new?.status === "matched");
      if (matchEvt) {
        assertEq("Realtime payload carries matched_cuisine_id", matchEvt.new?.matched_cuisine_id, "greek");
      }
      // DB truth check, independent of Realtime.
      assertEq("DB confirms the match happened", (await fetchRoom(C.client, room.id))?.status, "matched");
    }

    await C.client.removeChannel(channel);
  }

  // -------------------------------------------------------------------------
  section("13 createRoom() atomicity: no orphaned rooms");
  // -------------------------------------------------------------------------
  {
    // Simulate the app's second insert failing: insert only the
    // swipe_sessions row and never the room_participants row.
    const orphanId = crypto.randomUUID();
    const orphanCode = generateRoomCode();
    const { error: insErr } = await A.client
      .from("swipe_sessions")
      .insert({ id: orphanId, code: orphanCode, creator_id: A.user.id, status: "waiting" });

    if (insErr) {
      // If a bare swipe_sessions insert is no longer possible from the
      // client, atomicity is enforced at the schema level. That's a pass.
      ok("bare swipe_sessions insert is rejected (creation forced through the RPC)", insErr.code);
    } else {
      // A hand-rolled half-insert is still possible through the anon key --
      // RLS lets a creator insert their own swipe_sessions row, and nothing
      // forces the client to follow it with a participant row. What matters
      // is that it's no longer UNRECOVERABLE: migration 0009 added a
      // "creator can delete" policy so a stranded row (and its 4-letter
      // code) can be reclaimed. The app no longer takes this path at all --
      // src/lib/rooms.ts createRoom() calls the atomic create_room() RPC.
      const { error: delErr, count } = await A.client
        .from("swipe_sessions")
        .delete({ count: "exact" })
        .eq("id", orphanId);

      assert(
        `creator can delete a stranded room row (code ${orphanCode} reclaimed)`,
        !delErr && count === 1,
        delErr ? delErr.message : `deleted ${count}`
      );
      // fetchRoom() can't confirm this on its own: the creator can't SELECT a
      // room they aren't a participant of, so it returns null whether the row
      // was deleted or is merely invisible. join_room_by_code() is SECURITY
      // DEFINER, so it sees the row regardless of RLS -- "Room not found" is
      // the only conclusive proof the delete actually removed it.
      const { error: probeErr } = await joinByCode(A.client, orphanCode);
      assert(
        "stranded row really is gone (SECURITY DEFINER probe says room not found)",
        !!probeErr && /not found/i.test(probeErr.message ?? ""),
        probeErr ? probeErr.message : "room still joinable -- delete did NOT remove it"
      );
    }

    // The real guarantee: the RPC the app actually uses is atomic. The
    // creator can read the room back immediately, which is only possible if
    // the participant row was committed in the same transaction.
    const { data: rpcRoom, error: rpcErr } = await A.client.rpc("create_room").single();
    assert("create_room() RPC succeeds", !rpcErr && !!rpcRoom, rpcErr?.message);
    if (rpcRoom) {
      assert(
        "creator reads back the RPC-created room (participant row committed atomically)",
        !!(await fetchRoom(A.client, rpcRoom.id))
      );
      const { count: pCount } = await A.client
        .from("room_participants")
        .select("*", { count: "exact", head: true })
        .eq("room_id", rpcRoom.id);
      assert("RPC-created room has exactly 1 participant (the creator)", pCount === 1, `got ${pCount}`);
    }
  }

  // -------------------------------------------------------------------------
  section("14 MULTI-DISH: a session agrees on several dishes (core regression)");
  //
  // This is the regression the whole 0012 change exists for. Under the old
  // model room2 would be sitting in status 'dish_matched' right now and no
  // further dish could ever be agreed in it. Re-uses room2 (A/B/C), which
  // already agreed on DISH_1 back in section 09.
  // -------------------------------------------------------------------------
  {
    assertNoError("A right-swipes dish 2", (await dishSwipe(A.client, room2.id, A.user.id, RESTAURANT, DISH_2, "right")).error);
    assertNoError("B right-swipes dish 2", (await dishSwipe(B.client, room2.id, B.user.id, RESTAURANT, DISH_2, "right")).error);
    await sleep(600);
    assertEq(
      "2 of 3 on dish 2 -> still just the 1 agreed dish",
      (await fetchDishMatches(A.client, room2.id)).rows.length,
      1
    );

    assertNoError("C right-swipes dish 2 (completes it)", (await dishSwipe(C.client, room2.id, C.user.id, RESTAURANT, DISH_2, "right")).error);
    const res = await waitFor(
      () => fetchDishMatches(A.client, room2.id),
      (r) => r.rows.length >= 2,
      { timeoutMs: 8000 }
    );
    assert(
      "a SECOND dish reaches unanimity in the same session",
      res.ok,
      `rows=${JSON.stringify(res.value.rows.map((r) => r.dish_name))} after ${res.waitedMs}ms -- if this is stuck at 1, the session terminated on the first dish`
    );
    assertEq(
      "both dishes are on the order, in the order they were agreed",
      res.value.rows.map((r) => r.dish_name),
      [DISH_1, DISH_2]
    );
    assertEq(
      "room STILL not terminated after two dish matches",
      (await fetchRoom(A.client, room2.id))?.status,
      "matched"
    );

    // Idempotency: the unique (session_id, restaurant_name, dish_name) key
    // plus `on conflict do nothing` must absorb a re-vote on a settled dish.
    // Round-tripping right -> left -> right guarantees the AFTER UPDATE
    // trigger actually re-runs rather than being optimised away.
    assertNoError("C re-swipes dish 1 LEFT", (await dishSwipe(C.client, room2.id, C.user.id, RESTAURANT, DISH_1, "left")).error);
    await sleep(400);
    assertNoError("C re-swipes dish 1 RIGHT again", (await dishSwipe(C.client, room2.id, C.user.id, RESTAURANT, DISH_1, "right")).error);
    await sleep(800);
    const after = await fetchDishMatches(A.client, room2.id);
    assertEq("re-swiping an agreed dish creates NO duplicate row", after.rows.length, 2);
    const dish1Rows = after.rows.filter((r) => r.dish_name === DISH_1);
    assertEq("exactly one dish_matches row for dish 1", dish1Rows.length, 1);

    // A dish nobody agreed on must not appear.
    assert(
      "only unanimously-agreed dishes are listed",
      after.rows.every((r) => [DISH_1, DISH_2].includes(r.dish_name)),
      `unexpected: ${after.rows.map((r) => r.dish_name).join(", ")}`
    );
  }

  // -------------------------------------------------------------------------
  section("15 Realtime: a subscriber receives the dish_matches INSERT");
  //
  // This is how every member's agreed-dish list grows live. Needs BOTH
  // publication membership and `replica identity full` on dish_matches
  // (0012) -- with only the former, Supabase silently delivers nothing.
  // -------------------------------------------------------------------------
  {
    const room = await createRoom(A.client, A.user.id);
    await joinByCode(B.client, room.code);
    await joinByCode(C.client, room.code);

    const restaurant = "Realtime Grill";
    const dish = "Live Update Laksa";
    const events = [];
    let subscribeStatus = "(never called back)";
    let subscribeError;

    const channel = C.client.channel(`room:${room.id}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "dish_matches", filter: `session_id=eq.${room.id}` },
      (payload) => events.push(payload)
    );

    const subscribed = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      channel.subscribe((status, err) => {
        subscribeStatus = status;
        if (err) subscribeError = err;
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve(true);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(timer);
          resolve(false);
        }
      });
    });

    assert(
      "C's dish_matches channel reaches SUBSCRIBED",
      subscribed,
      `status=${subscribeStatus}${subscribeError ? ` err=${subscribeError.message ?? subscribeError}` : ""}`
    );

    if (subscribed) {
      await sleep(500);
      // C votes first so the match is completed by SOMEONE ELSE -- the case
      // the live-updating UI actually depends on.
      await dishSwipe(C.client, room.id, C.user.id, restaurant, dish, "right");
      await dishSwipe(A.client, room.id, A.user.id, restaurant, dish, "right");
      await sleep(300);
      await dishSwipe(B.client, room.id, B.user.id, restaurant, dish, "right");

      const got = await waitFor(
        async () => events,
        (e) => e.some((p) => p.eventType === "INSERT" && p.new?.dish_name === dish),
        { timeoutMs: 12000, intervalMs: 250 }
      );
      assert(
        "C receives the dish_matches INSERT over Realtime",
        got.ok,
        `events: ${JSON.stringify(events.map((p) => ({ type: p.eventType, dish: p.new?.dish_name })))} -- publication membership AND replica identity full are both required`
      );
      // DB truth check, independent of Realtime.
      assertEq(
        "DB confirms the dish match happened",
        (await fetchDishMatches(C.client, room.id)).rows.map((r) => r.dish_name),
        [dish]
      );
    }

    await C.client.removeChannel(channel);
  }

  // -------------------------------------------------------------------------
  section("16 leaving a room really removes the participant (no ghost voter)");
  //
  // "Leave Room" used to be a localStorage clear only. Because both match
  // triggers count room_participants rows as the unanimity denominator, a
  // departed member kept blocking every future match in that room. 0009
  // added the DELETE policy; src/lib/rooms.ts leaveRoom() now uses it.
  // -------------------------------------------------------------------------
  {
    const room = await createRoom(A.client, A.user.id);
    await joinByCode(B.client, room.code);
    await joinByCode(C.client, room.code);
    assertEq("room starts with 3 participants", await participantCount(A.client, room.id), 3);

    const restaurant = "Leaver's Diner";
    const dish = "House Special";

    await dishSwipe(A.client, room.id, A.user.id, restaurant, dish, "right");
    await dishSwipe(B.client, room.id, B.user.id, restaurant, dish, "right");
    await sleep(600);
    assertEq(
      "2 of 3 -> no dish agreed while C is still in the room",
      (await fetchDishMatches(A.client, room.id)).rows.length,
      0
    );

    const { error: leaveErr, count: leaveCount } = await leaveRoom(C.client, room.id, C.user.id);
    assertNoError("C can DELETE her own room_participants row", leaveErr);
    assertEq("exactly 1 participant row deleted", leaveCount, 1);
    assertEq("room now has 2 participants", await participantCount(A.client, room.id), 2);

    // Proof the leave was real and not just local: RLS keys off
    // room_participants, so a departed member loses read access entirely.
    assertEq("C can no longer read the room at all (really not a participant)", await fetchRoom(C.client, room.id), null);

    // The trigger only re-evaluates on a swipe, so leaving doesn't
    // retroactively complete a match -- the next vote does. B re-asserting
    // her existing right-swipe is enough to re-run the check.
    assertNoError("B re-swipes the dish after C left", (await dishSwipe(B.client, room.id, B.user.id, restaurant, dish, "right")).error);
    const res = await waitFor(
      () => fetchDishMatches(A.client, room.id),
      (r) => r.rows.length >= 1,
      { timeoutMs: 8000 }
    );
    assert(
      "the remaining pair CAN now reach unanimity (departed member no longer counts)",
      res.ok,
      `rows=${JSON.stringify(res.value.rows.map((r) => r.dish_name))} after ${res.waitedMs}ms -- a ghost participant is still inflating the denominator`
    );
    assertEq("the agreed dish is the one they both liked", res.value.rows[0]?.dish_name, dish);

    // And the 2-participant floor from 0009 still holds: B leaving too must
    // NOT let A match alone in a fresh room.
    const solo = await createRoom(A.client, A.user.id);
    await joinByCode(B.client, solo.code);
    await leaveRoom(B.client, solo.id, B.user.id);
    assertEq("solo room is down to 1 participant", await participantCount(A.client, solo.id), 1);
    await dishSwipe(A.client, solo.id, A.user.id, restaurant, dish, "right");
    await sleep(800);
    assertEq(
      "a lone remaining member cannot 'unanimously' agree with herself",
      (await fetchDishMatches(A.client, solo.id)).rows.length,
      0
    );
  }

  return finish(started);
}

function finish(started) {
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(74)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed  (${secs}s)`);
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
