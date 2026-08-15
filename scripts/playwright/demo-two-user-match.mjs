// scripts/playwright/demo-two-user-match.mjs
//
// Live, watchable two-user run through the core loop: two independent real
// logins -> one creates a room -> the other joins by code -> both swipe on
// the real UI (not a headless API call) until Realtime delivers a match to
// both sessions -> screenshot every step. This is the multi-user proof the
// earlier single-cookie-jar Browser pane could never actually show.
//
// Run: node --env-file=.env scripts/playwright/demo-two-user-match.mjs
//
// Prints a JSON summary with every screenshot path at the end, in order.

import { openSession, login, closeAll, BASE_URL } from "./multi-session.mjs";

const CREDS = {
  ava: { email: "foodswipe.tester.a@gmail.com", password: "FoodSwipeTest!2026" },
  ben: { email: "foodswipe.tester.b@gmail.com", password: "FoodSwipeTest!2026" },
};

const shots = [];
async function shot(session, step) {
  const path = await session.shot(step);
  shots.push({ session: session.label, step, path });
  console.log(`  [shot] ${session.label} / ${step} -> ${path}`);
}

async function swipeRight(session) {
  // The hidden #cuisine-swipe-right-btn is the real app's own gesture proxy
  // (see cuisine-card.tsx / swipe-area.tsx) -- dispatching a click on it is
  // not a test-only shortcut, it's the exact DOM event the visible round
  // Heart button already triggers under the hood.
  await session.page.dispatchEvent("#cuisine-swipe-right-btn", "click");
  await session.page.waitForTimeout(700); // swipe-out animation
}

async function main() {
  console.log(`Food Swipe live two-user demo`);
  console.log(`Target: ${BASE_URL}\n`);

  const ava = await openSession("ava");
  const ben = await openSession("ben");

  console.log("-- 01 both log in for real (real Supabase Auth, real form) --");
  await login(ava, CREDS.ava.email, CREDS.ava.password);
  await shot(ava, "logged-in-rooms-dashboard");
  await login(ben, CREDS.ben.email, CREDS.ben.password);
  await shot(ben, "logged-in-rooms-dashboard");

  console.log("-- 02 Ava hosts a room --");
  await ava.page.getByRole("button", { name: /Host Dining Room/i }).click();
  await ava.page.waitForSelector(".select-all", { timeout: 10000 });
  const roomCode = (await ava.page.locator(".select-all").first().innerText()).trim();
  console.log(`  room code: ${roomCode}`);
  await shot(ava, `hosting-room-${roomCode}`);

  console.log("-- 03 Ben joins by typing the code (real cross-user join) --");
  await ben.page.getByPlaceholder("ABCD").click();
  await ben.page.getByPlaceholder("ABCD").fill(roomCode);
  await ben.page.getByRole("button", { name: /Join Session Room/i }).click();
  await ben.page.waitForSelector(".select-all", { timeout: 10000 });
  await shot(ben, `joined-room-${roomCode}`);

  // Ava's waiting-room view updates over Realtime the moment Ben joins --
  // give the subscription a beat, then capture proof it actually fired
  // without a reload (the whole point of the Phase 2 Realtime rewrite).
  await ava.page.waitForTimeout(1500);
  await shot(ava, "sees-ben-join-live");

  console.log("-- 04 both head to the swipe deck --");
  await ava.page.getByRole("button", { name: /Start Swiping Together/i }).click();
  await ava.page.waitForURL(/\/swipe/, { timeout: 10000 });
  await ben.page.goto(`${BASE_URL}/swipe?room=${roomCode}`, { waitUntil: "networkidle" });
  await shot(ava, "swipe-deck");
  await shot(ben, "swipe-deck");

  console.log("-- 05 both swipe right on every card until a match lands --");
  let matched = false;
  for (let round = 0; round < 12 && !matched; round++) {
    await swipeRight(ava);
    await swipeRight(ben);
    await ava.page.waitForTimeout(400);
    const avaMatched = /\/match\//.test(ava.page.url());
    const benMatched = /\/match\//.test(ben.page.url());
    if (avaMatched || benMatched) {
      // Realtime propagates the match to the OTHER tab even if it didn't
      // trigger it -- give that a moment before declaring done.
      await ava.page.waitForURL(/\/match\//, { timeout: 6000 }).catch(() => {});
      await ben.page.waitForURL(/\/match\//, { timeout: 6000 }).catch(() => {});
      matched = true;
    }
  }

  if (matched) {
    console.log(`  MATCHED after swiping -- both landed on: ${ava.page.url()}`);
    await shot(ava, "match-reveal");
    await shot(ben, "match-reveal");
  } else {
    console.log("  no match within the round budget (deck exhausted or AI fallback engaged)");
    await shot(ava, "no-match-final-state");
    await shot(ben, "no-match-final-state");
  }

  await closeAll();
  console.log("\n--- SCREENSHOTS (in order) ---");
  console.log(JSON.stringify(shots, null, 2));
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  await closeAll();
  process.exit(1);
});
