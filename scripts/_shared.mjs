// Shared bits for the Food Swipe test harness.
//
// Everything here runs through the *anon key* only -- there is no
// service_role key in this project on purpose. Every script therefore
// exercises exactly the same RLS / RPC / trigger paths a real browser
// client does, which is the whole point: a test that bypassed RLS with a
// service key would prove nothing about whether the app works.
//
// Run scripts with `node --env-file=.env scripts/<name>.mjs` from the
// project root so PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY are
// present in process.env (Node >= 20.6 / this project pins >= 22.12).
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "Missing PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Run these scripts as:  node --env-file=.env scripts/<script>.mjs"
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Test accounts
//
// Deterministic on purpose: re-running seed-test-users.mjs is idempotent and
// a human can log into any of them in a browser to poke at multiplayer by
// hand. These are throwaway accounts on a throwaway project; the password is
// intentionally in source so the harness needs no extra config.
// ---------------------------------------------------------------------------
export const TEST_PASSWORD = "FoodSwipeTest!2026";

export const TEST_USERS = [
  {
    key: "A",
    email: "foodswipe.tester.a@gmail.com",
    displayName: "Ava Tester",
    phone: "+15550100001",
    dietaryRestrictions: [],
  },
  {
    key: "B",
    email: "foodswipe.tester.b@gmail.com",
    displayName: "Ben Tester",
    phone: "+15550100002",
    dietaryRestrictions: [],
  },
  {
    key: "C",
    email: "foodswipe.tester.c@gmail.com",
    displayName: "Cara Tester",
    phone: "+15550100003",
    // Exercises the dietary filter for real: only mexican/indian/thai/
    // vietnamese carry 'gluten-free' in 0004_room_dietary_filter.sql, so a
    // room containing Cara must show a 4-cuisine deck, not 9.
    dietaryRestrictions: ["gluten-free"],
  },
  {
    key: "D",
    email: "foodswipe.tester.d@gmail.com",
    displayName: "Dev Tester",
    phone: "+15550100004",
    // Harsher case: only 'indian' carries both halal and gluten-free.
    dietaryRestrictions: ["halal", "gluten-free"],
  },
];

export function userByKey(key) {
  const u = TEST_USERS.find((t) => t.key === key);
  if (!u) throw new Error(`Unknown test user key: ${key}`);
  return u;
}

// ---------------------------------------------------------------------------
// Clients
//
// One isolated client per user. `persistSession: false` + no shared storage
// means four "browsers" in one process with no cross-talk -- otherwise
// supabase-js would share a single in-memory session and every user would
// silently become the last one who signed in.
// ---------------------------------------------------------------------------
export function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Signs in an existing test user, or signs them up if they don't exist yet.
 * Email confirmation is off on this project, so signUp() returns a usable
 * session immediately.
 */
export async function signInOrSignUp(user, { password = TEST_PASSWORD } = {}) {
  const client = makeClient();

  const signIn = await client.auth.signInWithPassword({
    email: user.email,
    password,
  });

  if (!signIn.error) {
    // Keep Realtime's JWT in sync with the auth session. supabase-js does
    // this on auth state change, but being explicit removes a class of
    // "realtime silently unauthorized" flake from the harness.
    client.realtime.setAuth(signIn.data.session.access_token);
    return { client, user: signIn.data.user, session: signIn.data.session, created: false };
  }

  const signUp = await client.auth.signUp({
    email: user.email,
    password,
    options: {
      data: { display_name: user.displayName, phone: user.phone },
    },
  });
  if (signUp.error) {
    throw new Error(`signUp failed for ${user.email}: ${signUp.error.message}`);
  }
  if (!signUp.data.session) {
    throw new Error(
      `signUp for ${user.email} returned no session -- email confirmation is probably ON in the Supabase dashboard (Auth > Providers > Email > Confirm email). Turn it off for this test project.`
    );
  }
  client.realtime.setAuth(signUp.data.session.access_token);
  return { client, user: signUp.data.user, session: signUp.data.session, created: true };
}

// ---------------------------------------------------------------------------
// Room helpers -- deliberately mirror src/lib/rooms.ts's SQL surface
//
// These are NOT imports of src/lib/*.ts: those modules build their client
// through @supabase/ssr's createBrowserClient and read `import.meta.env`,
// neither of which exists in a bare Node process. What is mirrored exactly
// is the wire behaviour that matters -- same RPC names/arguments, same
// column lists, same upsert onConflict keys -- so a failure here is a real
// failure of the database contract the app depends on.
// ---------------------------------------------------------------------------
export const ROOM_COLUMNS =
  "id, code, creator_id, status, matched_cuisine_id, matched_restaurant_name, matched_dish_name";

const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
  }
  return code;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls a supplier until `predicate` passes or the deadline expires.
 * Used instead of a flat sleep after writes that a trigger reacts to, so a
 * slow round trip shows up as "slower" rather than "failed".
 */
export async function waitFor(supplier, predicate, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  const started = Date.now();
  let last;
  for (;;) {
    last = await supplier();
    if (predicate(last)) return { ok: true, value: last, waitedMs: Date.now() - started };
    if (Date.now() - started >= timeoutMs) return { ok: false, value: last, waitedMs: Date.now() - started };
    await sleep(intervalMs);
  }
}
