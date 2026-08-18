import { openSession, login, closeAll, BASE_URL } from "./multi-session.mjs";

const KOLKATA = { latitude: 22.5726, longitude: 88.3639 };

const ava = await openSession("ava-ratings-check");
const ben = await openSession("ben-ratings-check");

await login(ava, "foodswipe.tester.a@gmail.com", "FoodSwipeTest!2026");
await ava.shot("rooms-dashboard");

await login(ben, "foodswipe.tester.b@gmail.com", "FoodSwipeTest!2026");

await ava.page.getByRole("button", { name: /Host Dining Room/i }).click();
await ava.page.waitForSelector(".select-all", { timeout: 10000 });
const roomCode = (await ava.page.locator(".select-all").first().innerText()).trim();
console.log("room code:", roomCode);

await ben.page.getByPlaceholder("ABCD").fill(roomCode);
await ben.page.getByRole("button", { name: /Join Session Room/i }).click();
await ben.page.waitForSelector(".select-all", { timeout: 10000 });
await ava.page.waitForTimeout(1500);

await ava.page.getByRole("button", { name: /Start Swiping Together/i }).click();
await ava.page.waitForURL(/\/swipe/, { timeout: 10000 });
await ben.page.goto(`${BASE_URL}/swipe?room=${roomCode}`, { waitUntil: "networkidle" });
await ava.shot("swipe-deck");

// The visible round Heart button (aria-label="Like this cuisine"), not the
// hidden #cuisine-swipe-right-btn dispatch proxy every other script here
// uses. That hidden-button approach hung `page.dispatchEvent()` specifically
// on this script five runs in a row, even after confirming via
// locator().count()/evaluate() that the element genuinely exists in the DOM
// at the exact moment of the failing call -- never fully root-caused, but
// clicking the real button a user actually clicks sidesteps it entirely and
// is arguably the more honest test anyway.
async function swipeRight(page) {
  await page.getByRole("button", { name: /Like this cuisine/i }).click();
  await page.waitForTimeout(700);
}

let matched = false;
for (let i = 0; i < 12 && !matched; i++) {
  await swipeRight(ava.page);
  await swipeRight(ben.page);
  await ava.page.waitForTimeout(400);
  if (/\/match\//.test(ava.page.url())) {
    await ava.page.waitForURL(/\/match\//, { timeout: 6000 }).catch(() => {});
    matched = true;
  }
}
if (!matched) {
  console.error("FATAL: no match");
  await closeAll();
  process.exit(1);
}
console.log("matched, url:", ava.page.url());
await ava.page.waitForTimeout(1300); // let the celebration settle
await ava.shot("match-reveal-settled");

await ava.context.grantPermissions(["geolocation"], { origin: BASE_URL });
await ava.context.setGeolocation(KOLKATA);

const findBtn = ava.page.getByRole("button", { name: /Find restaurants near me/i });
if (await findBtn.count()) {
  await findBtn.click();
  await ava.page.waitForTimeout(3000);
  await ava.shot("restaurant-results-with-ratings");
} else {
  console.log("(no refine-gate skip needed, or button not present -- check screenshot)");
  await ava.shot("post-match-state");
}

await closeAll();
console.log("done");
