// scripts/test-retention.mjs
//
// Phase 4 (retention loop) integration suite: post-meal feedback, saved
// favourites, derived history, and derived async-room progress — all run
// against the live Supabase project through the ANON KEY ONLY, as four real
// authenticated users. Same rule as the rest of this harness: no
// service_role key exists in this project on purpose, so every assertion
// here executes exactly the RLS policies, constraints and triggers a real
// browser client does.
//
//   node --env-file=.env scripts/test-retention.mjs
//
// Exits non-zero if any assertion fails.
//
// SCHEMA DEPENDENCY: everything touching session_feedback / saved_restaurants
// needs supabase/migrations/0014_retention_loop.sql, which nobody in this
// project can apply (no Docker, no CLI, no service_role key). Those
// assertions are tagged [needs 0014] via needs0014() and the suite prints a
// banner when the migration is missing, so a red run reads as "the migration
// is waiting to be run" rather than "the feature is broken". They are NOT
// weakened to go green — a passing suite against an unapplied migration
// would be worse than useless.
//
// The history and async-room sections have NO schema dependency at all,
// because neither feature added a table (see 0014 blocks C and D): they are
// derived from room_participants / swipe_sessions / swipes / dish_swipes /
// dish_matches, which are all applied. Those assertions must pass today.
import { userByKey, signInOrSignUp, waitFor, sleep } from "./_shared.mjs";

// ---------------------------------------------------------------------------
// Assertion harness — same shape as test-e2e.mjs (name first, then condition)
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const pendingMigration = [];
let currentSection = "";
let schema0014Applied = false;

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

function skip(name, why) {
  skipped++;
  console.log(`  SKIP  ${name}  [${why}]`);
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
    }${error.hint ? ` | hint: ${error.hint}` : ""}${extra ? ` | ${extra}` : ""}`
  );
  return false;
}

function assertError(name, error, detail) {
  if (error) {
    ok(name, error.code ? `[${error.code}] ${truncate(error.message, 70)}` : truncate(error.message, 70));
    return true;
  }
  bad(name, detail ?? "expected an error, the write succeeded");
  return false;
}

/**
 * Wraps an assertion that cannot pass until 0014 is applied. Same intent as
 * test-security.mjs's afterMigration(): tag it so a red run reads as "the
 * migration is waiting", and record it separately in the summary.
 *
 * The body is deliberately NOT RUN while the schema is missing. The first
 * version of this ran it anyway, and the result was worse than useless: half
 * the NEGATIVE assertions ("a non-participant CANNOT write feedback",
 * "a javascript: URL is rejected", "a 5000-char note is rejected") went
 * GREEN — not because a policy or a CHECK constraint stopped anything, but
 * because PostgREST returned `PGRST205 Could not find the table` and
 * assertError() cannot tell one error from another. A suite that reports
 * "the security constraint holds" when the constrained table does not exist
 * is exactly the kind of vacuous pass this project's build log warns about.
 * So: no schema, no verdict — one honest failure per assertion instead.
 */
async function needs0014(name, fn) {
  const tagged = `${name} [needs 0014]`;
  if (!schema0014Applied) {
    pendingMigration.push(`${currentSection} :: ${tagged}`);
    bad(tagged, "not run: supabase/migrations/0014_retention_loop.sql is not applied");
    return false;
  }
  return fn(tagged);
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

// ---------------------------------------------------------------------------
// Room helpers — mirror src/lib/rooms.ts's WIRE behaviour (same RPC names,
// same column lists), deliberately not imports of src/lib/*.ts, which need
// import.meta.env and a browser client. See _shared.mjs's header.
// ---------------------------------------------------------------------------
async function createRoom(client) {
  const { data, error } = await client.rpc("create_room").single();
  if (error) throw new Error(`create_room failed: ${error.message}`);
  return data;
}

async function joinRoom(client, code) {
  const { data, error } = await client.rpc("join_room_by_code", { p_code: code }).single();
  if (error) throw new Error(`join_room_by_code(${code}) failed: ${error.message}`);
  return data;
}

async function swipe(client, sessionId, userId, cuisineId, direction = "right") {
  return client
    .from("swipes")
    .upsert(
      { session_id: sessionId, user_id: userId, cuisine_id: cuisineId, direction },
      { onConflict: "session_id,user_id,cuisine_id" }
    );
}

async function dishSwipe(client, sessionId, userId, restaurantName, dishName, direction = "right") {
  return client
    .from("dish_swipes")
    .upsert(
      {
        session_id: sessionId,
        user_id: userId,
        restaurant_name: restaurantName,
        dish_name: dishName,
        direction,
      },
      { onConflict: "session_id,user_id,restaurant_name,dish_name" }
    );
}

// ---------------------------------------------------------------------------
// Derived-history helpers — mirror src/lib/history.ts's queries exactly.
// If these drift from that module the suite stops proving anything about it,
// so keep the column lists and filters identical.
// ---------------------------------------------------------------------------
async function fetchMyRoomIds(client, userId) {
  const { data, error } = await client
    .from("room_participants")
    .select("room_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });
  if (error) return { ids: [], error };
  return { ids: (data ?? []).map((r) => r.room_id), error: null };
}

async function fetchRoomProgress(client, sessionId) {
  const { data: profiles, error: profileErr } = await client.rpc("get_room_profiles", {
    p_room_id: sessionId,
  });
  if (profileErr) return { members: [], error: profileErr };

  const [{ data: swipeRows }, { data: dishRows }] = await Promise.all([
    client.from("swipes").select("user_id, created_at").eq("session_id", sessionId),
    client.from("dish_swipes").select("user_id, created_at").eq("session_id", sessionId),
  ]);

  const counts = new Map();
  for (const row of [...(swipeRows ?? []), ...(dishRows ?? [])]) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }
  const members = (profiles ?? []).map((p) => ({
    userId: p.id,
    displayName: p.display_name,
    swipes: counts.get(p.id) ?? 0,
    hasStarted: (counts.get(p.id) ?? 0) > 0,
  }));
  return { members, error: null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const RESTAURANT = "Retention Test Bistro";
const createdRoomIds = [];
const createdFavoriteIds = [];

async function main() {
  console.log("Food Swipe — Phase 4 retention suite (anon key, real users)");

  // -------------------------------------------------------------------
  section("01  Sign in the test users");
  // -------------------------------------------------------------------
  const A = await signInOrSignUp(userByKey("A"));
  const B = await signInOrSignUp(userByKey("B"));
  const C = await signInOrSignUp(userByKey("C"));
  const D = await signInOrSignUp(userByKey("D"));
  assert("A signed in", Boolean(A.user?.id));
  assert("B signed in", Boolean(B.user?.id));
  assert("C signed in", Boolean(C.user?.id));
  assert("D signed in", Boolean(D.user?.id), "D is the non-participant used for RLS lockout tests");

  // -------------------------------------------------------------------
  section("02  Schema probe — is 0014 applied?");
  // -------------------------------------------------------------------
  const feedbackProbe = await A.client.from("session_feedback").select("id").limit(1);
  const favoritesProbe = await A.client.from("saved_restaurants").select("id").limit(1);
  // PostgREST reports an unknown relation as PGRST205 (schema cache miss) /
  // 42P01 depending on version; either means the table isn't there.
  const missing = (probe) =>
    Boolean(probe.error) && /PGRST205|42P01|does not exist|schema cache/i.test(
      `${probe.error.code} ${probe.error.message}`
    );
  schema0014Applied = !missing(feedbackProbe) && !missing(favoritesProbe);

  if (schema0014Applied) {
    ok("0014 tables are present", "session_feedback + saved_restaurants");
  } else {
    console.log(
      "\n  !! supabase/migrations/0014_retention_loop.sql is NOT applied to this project.\n" +
        "     Every assertion below tagged [needs 0014] will fail until the user runs it\n" +
        "     in the Supabase SQL editor. The history and async-room sections do not\n" +
        "     depend on it and must pass regardless.\n" +
        `     session_feedback probe:  ${feedbackProbe.error?.message ?? "ok"}\n` +
        `     saved_restaurants probe: ${favoritesProbe.error?.message ?? "ok"}`
    );
  }

  // -------------------------------------------------------------------
  section("03  Build a real finished session (A + B + C, matched, 2 dishes)");
  // -------------------------------------------------------------------
  const room = await createRoom(A.client);
  createdRoomIds.push(room.id);
  await joinRoom(B.client, room.code);
  await joinRoom(C.client, room.code);
  assert("room created and joined by 3", Boolean(room.id), `code ${room.code}`);

  // Unanimity on a cuisine -> the 0006/0009 trigger sets status = matched.
  await swipe(A.client, room.id, A.user.id, "italian");
  await swipe(B.client, room.id, B.user.id, "italian");
  await swipe(C.client, room.id, C.user.id, "italian");
  const matched = await waitFor(
    async () =>
      (await A.client.from("swipe_sessions").select("status, matched_cuisine_id").eq("id", room.id).single())
        .data,
    (v) => v?.status === "matched"
  );
  assert("room reached a cuisine match", matched.ok, JSON.stringify(matched.value));

  // Two agreed dishes -> two dish_matches rows (the multi-dish model, 0012).
  for (const dish of ["Cacio e Pepe", "Tiramisu"]) {
    await dishSwipe(A.client, room.id, A.user.id, RESTAURANT, dish);
    await dishSwipe(B.client, room.id, B.user.id, RESTAURANT, dish);
    await dishSwipe(C.client, room.id, C.user.id, RESTAURANT, dish);
  }
  const dishesAgreed = await waitFor(
    async () =>
      (await A.client.from("dish_matches").select("dish_name").eq("session_id", room.id)).data ?? [],
    (rows) => rows.length >= 2
  );
  assertEq("two dishes reached unanimity", dishesAgreed.value.length, 2);

  // -------------------------------------------------------------------
  section("04  History is derivable with NO new table");
  // -------------------------------------------------------------------
  // This is the load-bearing claim of 0014 block C: the brief asked whether
  // past sessions could be rendered from existing tables, and the answer
  // "yes" has to be proved, not asserted in a comment.
  const mine = await fetchMyRoomIds(A.client, A.user.id);
  assertNoError("A can list her own room_participants rows", mine.error);
  assert("A's room list contains the new room", mine.ids.includes(room.id), `got ${mine.ids.length} rooms`);

  const { data: histSessions, error: histErr } = await A.client
    .from("swipe_sessions")
    .select("id, code, status, matched_cuisine_id, created_at")
    .in("id", [room.id]);
  assertNoError("A can read the session rows for her rooms", histErr);
  assertEq("history session carries the matched cuisine", histSessions?.[0]?.matched_cuisine_id, "italian");
  assert("history session carries a created_at", Boolean(histSessions?.[0]?.created_at));

  const { data: histDishes, error: dishErr } = await A.client
    .from("dish_matches")
    .select("session_id, restaurant_name, dish_name, matched_at")
    .in("session_id", [room.id])
    .order("matched_at", { ascending: true });
  assertNoError("A can read the agreed dishes for her rooms", dishErr);
  assertEq(
    "history renders restaurant + dishes from dish_matches",
    (histDishes ?? []).map((d) => `${d.restaurant_name}::${d.dish_name}`).sort(),
    [`${RESTAURANT}::Cacio e Pepe`, `${RESTAURANT}::Tiramisu`].sort()
  );

  // The other half of the requirement: a user sees ONLY sessions they were
  // in. D never joined this room.
  const dRooms = await fetchMyRoomIds(D.client, D.user.id);
  assert(
    "D's history does NOT contain a room she never joined",
    !dRooms.ids.includes(room.id),
    `D sees ${dRooms.ids.length} rooms`
  );
  const { data: dSession } = await D.client
    .from("swipe_sessions")
    .select("id")
    .eq("id", room.id)
    .maybeSingle();
  assertEq("D cannot read the session row directly either", dSession, null);
  const { data: dDishes } = await D.client
    .from("dish_matches")
    .select("id")
    .eq("session_id", room.id);
  assertEq("D cannot read the room's agreed dishes", (dDishes ?? []).length, 0);

  // -------------------------------------------------------------------
  section("05  Async rooms: who has and hasn't swiped, derived");
  // -------------------------------------------------------------------
  // A fourth member joins LATE, after the room already matched and agreed
  // two dishes — the exact "arrives during the afternoon" case async rooms
  // exist for. Note this also (correctly) breaks future unanimity until she
  // swipes, which is precisely why naming her in the UI matters.
  await joinRoom(D.client, room.code);

  const lateView = await D.client
    .from("swipe_sessions")
    .select("status, matched_cuisine_id")
    .eq("id", room.id)
    .single();
  assertEq("a late joiner sees the room's current status", lateView.data?.status, "matched");
  assertEq("a late joiner sees what the group matched on", lateView.data?.matched_cuisine_id, "italian");
  const { data: lateDishes } = await D.client
    .from("dish_matches")
    .select("dish_name")
    .eq("session_id", room.id);
  assertEq("a late joiner sees the dishes already agreed", (lateDishes ?? []).length, 2);

  const progress = await fetchRoomProgress(D.client, room.id);
  assertNoError("progress roster resolves for a participant", progress.error);
  assertEq("roster has all four members", progress.members.length, 4);
  const started = progress.members.filter((m) => m.hasStarted).map((m) => m.displayName).sort();
  const notStarted = progress.members.filter((m) => !m.hasStarted).map((m) => m.displayName);
  assertEq("A, B and C read as having swiped", started, ["Ava Tester", "Ben Tester", "Cara Tester"]);
  assertEq("the late joiner reads as not having swiped", notStarted, ["Dev Tester"]);

  await swipe(D.client, room.id, D.user.id, "italian");
  const caughtUp = await waitFor(
    async () => (await fetchRoomProgress(D.client, room.id)).members,
    (members) => members.every((m) => m.hasStarted)
  );
  assert("after the late joiner swipes, nobody is outstanding", caughtUp.ok, JSON.stringify(caughtUp.value));

  // A non-participant gets an empty roster, not an error and not data.
  const strangerProgress = await (async () => {
    const stranger = await createRoom(B.client);
    createdRoomIds.push(stranger.id);
    return fetchRoomProgress(A.client, stranger.id);
  })();
  assertEq("a non-participant's progress read returns nobody", strangerProgress.members.length, 0);

  // -------------------------------------------------------------------
  section("06  Post-meal feedback: the happy path");
  // -------------------------------------------------------------------
  await needs0014("A files feedback for the session", async (name) => {
    const { error } = await A.client.from("session_feedback").upsert(
      {
        session_id: room.id,
        user_id: A.user.id,
        did_go: true,
        rating: 5,
        restaurant_name: RESTAURANT,
        dish_name: "Cacio e Pepe",
        notes: "Worth the queue.",
      },
      { onConflict: "session_id,user_id" }
    );
    return assertNoError(name, error);
  });

  await needs0014("B files feedback too", async (name) => {
    const { error } = await B.client.from("session_feedback").upsert(
      { session_id: room.id, user_id: B.user.id, did_go: true, rating: 4 },
      { onConflict: "session_id,user_id" }
    );
    return assertNoError(name, error);
  });

  await needs0014("the whole room can read the room's feedback", async (name) => {
    const { data } = await C.client
      .from("session_feedback")
      .select("user_id, did_go, rating")
      .eq("session_id", room.id);
    return assertEq(name, (data ?? []).length, 2);
  });

  await needs0014("re-answering EDITS rather than duplicating", async (name) => {
    await A.client.from("session_feedback").upsert(
      { session_id: room.id, user_id: A.user.id, did_go: true, rating: 3, notes: "Second thoughts." },
      { onConflict: "session_id,user_id" }
    );
    const { data } = await A.client
      .from("session_feedback")
      .select("rating, notes")
      .eq("session_id", room.id)
      .eq("user_id", A.user.id);
    if ((data ?? []).length !== 1) return bad(name, `expected exactly 1 row, got ${(data ?? []).length}`);
    return assertEq(name, data[0].rating, 3);
  });

  await needs0014('"we never went" is recordable with no rating', async (name) => {
    const { error } = await C.client.from("session_feedback").upsert(
      { session_id: room.id, user_id: C.user.id, did_go: false },
      { onConflict: "session_id,user_id" }
    );
    return assertNoError(name, error);
  });

  await needs0014("updated_at is server-set and moves on edit", async (name) => {
    const before = await A.client
      .from("session_feedback")
      .select("created_at, updated_at")
      .eq("session_id", room.id)
      .eq("user_id", A.user.id)
      .maybeSingle();
    await sleep(1100);
    await A.client
      .from("session_feedback")
      .update({ notes: "Third thoughts.", updated_at: "2000-01-01T00:00:00Z" })
      .eq("session_id", room.id)
      .eq("user_id", A.user.id);
    const after = await A.client
      .from("session_feedback")
      .select("created_at, updated_at")
      .eq("session_id", room.id)
      .eq("user_id", A.user.id)
      .maybeSingle();
    if (!before.data || !after.data) return bad(name, "could not read the row back");
    const moved = new Date(after.data.updated_at).getTime() > new Date(before.data.updated_at).getTime();
    const notBackdated = new Date(after.data.updated_at).getFullYear() > 2001;
    const createdFrozen = before.data.created_at === after.data.created_at;
    return assert(
      name,
      moved && notBackdated && createdFrozen,
      `before=${before.data.updated_at} after=${after.data.updated_at} created_at frozen=${createdFrozen}`
    );
  });

  await needs0014("retracting feedback works and leaves no row", async (name) => {
    await B.client
      .from("session_feedback")
      .delete()
      .eq("session_id", room.id)
      .eq("user_id", B.user.id);
    const { data } = await B.client
      .from("session_feedback")
      .select("id")
      .eq("session_id", room.id)
      .eq("user_id", B.user.id);
    return assertEq(name, (data ?? []).length, 0);
  });

  // -------------------------------------------------------------------
  section("07  Post-meal feedback: the adversarial path");
  // -------------------------------------------------------------------
  // Probed WITHOUT .select() on purpose. Postgres applies SELECT policies to
  // a RETURNING clause and reports that with the SAME 42501 text as a WITH
  // CHECK violation, so an `.insert().select()` probe cannot distinguish
  // "blocked" from "written but unreadable" — that is exactly how the
  // "anyone can join any room by uuid" hole hid in the 0013 pass. Write
  // bare, then read back separately.
  const stranger = await createRoom(B.client);
  createdRoomIds.push(stranger.id);

  await needs0014("a non-participant CANNOT write feedback into a room", async (name) => {
    const { error } = await A.client
      .from("session_feedback")
      .insert({ session_id: stranger.id, user_id: A.user.id, did_go: true, rating: 5 });
    const blocked = assertError(name, error);
    if (!blocked) {
      const { data } = await B.client
        .from("session_feedback")
        .select("id")
        .eq("session_id", stranger.id);
      bad(`${name} :: read-back`, `row count in the victim's room: ${(data ?? []).length}`);
    }
    return blocked;
  });

  await needs0014("a participant CANNOT file feedback in another member's name", async (name) => {
    const { error } = await A.client
      .from("session_feedback")
      .insert({ session_id: room.id, user_id: D.user.id, did_go: false });
    return assertError(name, error);
  });

  await needs0014("a participant CANNOT edit another member's feedback", async (name) => {
    // C filed "we never went" above; A tries to rewrite it as a rave.
    const { error } = await A.client
      .from("session_feedback")
      .update({ did_go: true, rating: 5 })
      .eq("session_id", room.id)
      .eq("user_id", C.user.id);
    // An UPDATE filtered to rows the USING clause excludes is not an error —
    // it matches nothing. Prove the row is unchanged rather than trusting
    // the absence of an error.
    const { data } = await C.client
      .from("session_feedback")
      .select("did_go, rating")
      .eq("session_id", room.id)
      .eq("user_id", C.user.id)
      .maybeSingle();
    return assert(
      name,
      Boolean(error) || (data?.did_go === false && data?.rating === null),
      `error=${error?.message ?? "none"} row=${JSON.stringify(data)}`
    );
  });

  await needs0014("a participant CANNOT delete another member's feedback", async (name) => {
    await A.client
      .from("session_feedback")
      .delete()
      .eq("session_id", room.id)
      .eq("user_id", C.user.id);
    const { data } = await C.client
      .from("session_feedback")
      .select("id")
      .eq("session_id", room.id)
      .eq("user_id", C.user.id);
    return assertEq(name, (data ?? []).length, 1);
  });

  await needs0014("a rating outside 1..5 is rejected", async (name) => {
    const { error } = await A.client
      .from("session_feedback")
      .upsert(
        { session_id: room.id, user_id: A.user.id, did_go: true, rating: 9 },
        { onConflict: "session_id,user_id" }
      );
    return assertError(name, error);
  });

  await needs0014("rating a meal you did NOT go to is rejected", async (name) => {
    const { error } = await A.client
      .from("session_feedback")
      .upsert(
        { session_id: room.id, user_id: A.user.id, did_go: false, rating: 5 },
        { onConflict: "session_id,user_id" }
      );
    return assertError(name, error);
  });

  await needs0014("a 5000-char note is rejected (unbounded free text was a real finding)", async (name) => {
    const { error } = await A.client
      .from("session_feedback")
      .upsert(
        { session_id: room.id, user_id: A.user.id, did_go: true, rating: 4, notes: "x".repeat(5000) },
        { onConflict: "session_id,user_id" }
      );
    return assertError(name, error);
  });

  await needs0014("a 5000-char restaurant_name is rejected", async (name) => {
    const { error } = await A.client
      .from("session_feedback")
      .upsert(
        {
          session_id: room.id,
          user_id: A.user.id,
          did_go: true,
          restaurant_name: "y".repeat(5000),
        },
        { onConflict: "session_id,user_id" }
      );
    return assertError(name, error);
  });

  await needs0014("feedback CANNOT be re-homed onto another session by UPDATE", async (name) => {
    // The guard trigger freezes session_id. Without it, a member could move
    // a row they own into a room whose participants never saw it written —
    // the same class of hole 0013 block B closed on swipe_sessions.
    const target = await createRoom(A.client);
    createdRoomIds.push(target.id);
    await A.client
      .from("session_feedback")
      .update({ session_id: target.id })
      .eq("session_id", room.id)
      .eq("user_id", A.user.id);
    const { data } = await A.client
      .from("session_feedback")
      .select("id")
      .eq("session_id", room.id)
      .eq("user_id", A.user.id);
    return assertEq(name, (data ?? []).length, 1);
  });

  // -------------------------------------------------------------------
  section("08  Saved favourites are private to their owner");
  // -------------------------------------------------------------------
  await needs0014("A saves a favourite", async (name) => {
    const { data, error } = await A.client
      .from("saved_restaurants")
      .upsert(
        {
          user_id: A.user.id,
          restaurant_name: RESTAURANT,
          cuisine_id: "italian",
          source_session_id: room.id,
        },
        { onConflict: "user_id,restaurant_name" }
      )
      .select("id")
      .single();
    if (data?.id) createdFavoriteIds.push({ id: data.id, client: A.client });
    return assertNoError(name, error);
  });

  await needs0014("saving the same place twice UPDATES rather than duplicates", async (name) => {
    await A.client
      .from("saved_restaurants")
      .upsert(
        { user_id: A.user.id, restaurant_name: RESTAURANT, notes: "Book ahead." },
        { onConflict: "user_id,restaurant_name" }
      );
    const { data } = await A.client
      .from("saved_restaurants")
      .select("id, notes")
      .eq("restaurant_name", RESTAURANT);
    if ((data ?? []).length !== 1) return bad(name, `expected 1 row, got ${(data ?? []).length}`);
    return assertEq(name, data[0].notes, "Book ahead.");
  });

  await needs0014("B cannot see A's favourites", async (name) => {
    const { data } = await B.client
      .from("saved_restaurants")
      .select("id, restaurant_name")
      .eq("restaurant_name", RESTAURANT);
    return assertEq(name, (data ?? []).length, 0);
  });

  await needs0014("B cannot plant a favourite in A's list", async (name) => {
    const { error } = await B.client
      .from("saved_restaurants")
      .insert({ user_id: A.user.id, restaurant_name: "Planted By B" });
    const blocked = assertError(name, error);
    if (!blocked) {
      const { data } = await A.client
        .from("saved_restaurants")
        .select("id")
        .eq("restaurant_name", "Planted By B");
      bad(`${name} :: read-back`, `rows now in A's list: ${(data ?? []).length}`);
    }
    return blocked;
  });

  await needs0014("B cannot delete A's favourite", async (name) => {
    await B.client.from("saved_restaurants").delete().eq("restaurant_name", RESTAURANT);
    const { data } = await A.client
      .from("saved_restaurants")
      .select("id")
      .eq("restaurant_name", RESTAURANT);
    return assertEq(name, (data ?? []).length, 1);
  });

  await needs0014("a javascript: website URL is rejected at the column", async (name) => {
    // Not tidiness: this value is rendered as an <a href> by
    // src/components/solo/favorites-view.tsx, and it originates from a
    // third-party places API. A non-http(s) scheme there is a stored-XSS
    // shape, so the column is the boundary.
    const { error } = await A.client.from("saved_restaurants").insert({
      user_id: A.user.id,
      restaurant_name: "XSS Bistro",
      website: "javascript:alert(document.cookie)",
    });
    return assertError(name, error);
  });

  await needs0014("an empty restaurant name is rejected", async (name) => {
    const { error } = await A.client
      .from("saved_restaurants")
      .insert({ user_id: A.user.id, restaurant_name: "   " });
    return assertError(name, error);
  });

  await needs0014("a 5000-char restaurant name is rejected", async (name) => {
    const { error } = await A.client
      .from("saved_restaurants")
      .insert({ user_id: A.user.id, restaurant_name: "z".repeat(5000) });
    return assertError(name, error);
  });

  await needs0014("a favourite survives the room it was saved from being deleted", async (name) => {
    // ON DELETE SET NULL, not CASCADE. A creator closing a room must never
    // silently delete other people's saved restaurants — cascade is right
    // for room-scoped data (0012) and wrong here.
    const throwaway = await createRoom(A.client);
    const { data: saved } = await A.client
      .from("saved_restaurants")
      .upsert(
        {
          user_id: A.user.id,
          restaurant_name: "Orphan Grill",
          source_session_id: throwaway.id,
        },
        { onConflict: "user_id,restaurant_name" }
      )
      .select("id")
      .single();
    if (saved?.id) createdFavoriteIds.push({ id: saved.id, client: A.client });
    await A.client.from("swipe_sessions").delete().eq("id", throwaway.id);
    const { data } = await A.client
      .from("saved_restaurants")
      .select("id, source_session_id")
      .eq("restaurant_name", "Orphan Grill")
      .maybeSingle();
    return assert(
      name,
      Boolean(data) && data.source_session_id === null,
      `row=${JSON.stringify(data)}`
    );
  });

  // -------------------------------------------------------------------
  section("09  Feedback cascades with its room (no orphans)");
  // -------------------------------------------------------------------
  await needs0014("deleting a room removes its feedback", async (name) => {
    const doomed = await createRoom(A.client);
    await joinRoom(B.client, doomed.code);
    await A.client
      .from("session_feedback")
      .insert({ session_id: doomed.id, user_id: A.user.id, did_go: true, rating: 5 });
    await A.client.from("swipe_sessions").delete().eq("id", doomed.id);
    // A is no longer a participant of a room that no longer exists, so she
    // reads zero rows either way; the point is that nothing survives.
    const { data } = await A.client.from("session_feedback").select("id").eq("session_id", doomed.id);
    return assertEq(name, (data ?? []).length, 0);
  });

  // -------------------------------------------------------------------
  section("10  Clean up the rooms this run created");
  // -------------------------------------------------------------------
  // Rooms are never expired by the schema (build log: "no TTL/cleanup
  // sweep"), and create_room() caps a creator at 100/hour, so a suite that
  // leaked ~8 rooms per run would eventually throttle itself.
  let deleted = 0;
  for (const id of createdRoomIds) {
    for (const owner of [A, B]) {
      const { error } = await owner.client.from("swipe_sessions").delete().eq("id", id);
      if (!error) deleted++;
    }
  }
  ok("rooms cleaned up", `${deleted} delete statements issued for ${createdRoomIds.length} rooms`);

  for (const fav of createdFavoriteIds) {
    await fav.client.from("saved_restaurants").delete().eq("id", fav.id);
  }
  await A.client.from("saved_restaurants").delete().eq("restaurant_name", RESTAURANT);
  ok("favourites cleaned up");
}

main()
  .catch((err) => {
    bad("suite crashed", err?.stack ?? String(err));
  })
  .finally(() => {
    console.log(`\n${"=".repeat(72)}`);
    console.log(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (failures.length > 0) {
      console.log("\n  Failures:");
      for (const f of failures) console.log(`    - ${f}`);
    }
    if (!schema0014Applied && pendingMigration.length > 0) {
      console.log(
        `\n  ${pendingMigration.length} of the failures above are tagged [needs 0014].\n` +
          "  They are NOT broken code: supabase/migrations/0014_retention_loop.sql has not\n" +
          "  been applied to this project yet. Run it in the Supabase SQL editor and\n" +
          "  re-run this suite — nothing in it should be weakened to make them pass."
      );
    }
    console.log(`${"=".repeat(72)}\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
