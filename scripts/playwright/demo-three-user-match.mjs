// scripts/playwright/demo-three-user-match.mjs
//
// Same idea as demo-two-user-match.mjs, one more real independent session.
// Ava/Ben are the two persistent test accounts; Chandra signs up fresh via
// the real signup form on first run (Supabase anon-signin is disabled on
// this project, so this is the actual 3rd-account path, not a shortcut).
//
// Run: node --env-file=.env scripts/playwright/demo-three-user-match.mjs

import { openSession, login, closeAll, BASE_URL } from "./multi-session.mjs";

const CREDS = {
  ava: { email: "foodswipe.tester.a@gmail.com", password: "FoodSwipeTest!2026" },
  ben: { email: "foodswipe.tester.b@gmail.com", password: "FoodSwipeTest!2026" },
};
const CHANDRA_PASSWORD = "FoodSwipeTest!2026";
const CHANDRA_EMAIL = "foodswipe.tester.c@gmail.com";

const shots = [];
async function shot(session, step) {
  const path = await session.shot(step);
  shots.push({ session: session.label, step, path });
  console.log(`  [shot] ${session.label} / ${step} -> ${path}`);
}

async function swipeRight(session) {
  await session.page.dispatchEvent("#cuisine-swipe-right-btn", "click");
  await session.page.waitForTimeout(700);
}

async function signupOrLoginChandra(session) {
  await session.page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await session.page.getByPlaceholder("m@example.com").fill(CHANDRA_EMAIL);
  await session.page.getByPlaceholder("••••").fill(CHANDRA_PASSWORD);
  await session.page.getByRole("button", { name: /^Login$/ }).click();
  // If the account doesn't exist yet, login fails and stays on /login --
  // fall through to signup. If it succeeds, we land on /rooms.
  const result = await Promise.race([
    session.page.waitForURL(/\/rooms/, { timeout: 6000 }).then(() => "logged-in"),
    session.page.waitForTimeout(6000).then(() => "no-redirect"),
  ]);
  if (result === "logged-in") return;

  console.log("  (Chandra account doesn't exist yet -- signing up for real)");
  await session.page.goto(`${BASE_URL}/signup`, { waitUntil: "networkidle" });
  await session.page.getByPlaceholder("Your Name").fill("Chandra Tester");
  await session.page.getByPlaceholder("m@example.com").fill(CHANDRA_EMAIL);
  await session.page.getByPlaceholder("••••").fill(CHANDRA_PASSWORD);
  await session.page.getByRole("button", { name: /Sign Up|Create Account/i }).click();
  await session.page.waitForURL(/\/rooms/, { timeout: 10000 });
}

async function main() {
  console.log(`Food Swipe live three-user demo`);
  console.log(`Target: ${BASE_URL}\n`);

  const ava = await openSession("ava");
  const ben = await openSession("ben");
  const chandra = await openSession("chandra");

  console.log("-- 01 all three log in for real --");
  await login(ava, CREDS.ava.email, CREDS.ava.password);
  await shot(ava, "logged-in");
  await login(ben, CREDS.ben.email, CREDS.ben.password);
  await shot(ben, "logged-in");
  await signupOrLoginChandra(chandra);
  await shot(chandra, "logged-in");

  console.log("-- 02 Ava hosts a room --");
  await ava.page.getByRole("button", { name: /Host Dining Room/i }).click();
  await ava.page.waitForSelector(".select-all", { timeout: 10000 });
  const roomCode = (await ava.page.locator(".select-all").first().innerText()).trim();
  console.log(`  room code: ${roomCode}`);
  await shot(ava, `hosting-room-${roomCode}`);

  console.log("-- 03 Ben and Chandra both join by code --");
  for (const s of [ben, chandra]) {
    await s.page.getByPlaceholder("ABCD").fill(roomCode);
    await s.page.getByRole("button", { name: /Join Session Room/i }).click();
    await s.page.waitForSelector(".select-all", { timeout: 10000 });
    await shot(s, `joined-room-${roomCode}`);
  }
  await ava.page.waitForTimeout(1500);
  await shot(ava, "sees-both-join-live");

  console.log("-- 04 all three head to the swipe deck --");
  await ava.page.getByRole("button", { name: /Start Swiping Together/i }).click();
  await ava.page.waitForURL(/\/swipe/, { timeout: 10000 });
  await ben.page.goto(`${BASE_URL}/swipe?room=${roomCode}`, { waitUntil: "networkidle" });
  await chandra.page.goto(`${BASE_URL}/swipe?room=${roomCode}`, { waitUntil: "networkidle" });
  await shot(ava, "swipe-deck");
  await shot(ben, "swipe-deck");
  await shot(chandra, "swipe-deck");

  console.log("-- 05 all three swipe right until a 3-way match lands --");
  let matched = false;
  for (let round = 0; round < 12 && !matched; round++) {
    await swipeRight(ava);
    await swipeRight(ben);
    await swipeRight(chandra);
    await ava.page.waitForTimeout(400);
    if ([ava, ben, chandra].some((s) => /\/match\//.test(s.page.url()))) {
      for (const s of [ava, ben, chandra]) {
        await s.page.waitForURL(/\/match\//, { timeout: 6000 }).catch(() => {});
      }
      matched = true;
    }
  }

  if (matched) {
    console.log(`  MATCHED after swiping -- landed on: ${ava.page.url()}`);
    for (const s of [ava, ben, chandra]) await shot(s, "match-reveal");
  } else {
    console.log("  FATAL: no match after 12 rounds");
  }

  console.log("\n--- SCREENSHOTS (in order) ---");
  console.log(JSON.stringify(shots, null, 2));

  await closeAll();
  if (!matched) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
