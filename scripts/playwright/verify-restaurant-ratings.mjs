import { openSession, login, closeAll, BASE_URL } from "./playwright/multi-session.mjs";

const KOLKATA = { latitude: 22.5726, longitude: 88.3639 };

const ava = await openSession("ava-ratings-check");
await ava.context.grantPermissions(["geolocation"], { origin: BASE_URL });
await ava.context.setGeolocation(KOLKATA);

const ben = await openSession("ben-ratings-check");
await ben.context.grantPermissions(["geolocation"], { origin: BASE_URL });
await ben.context.setGeolocation(KOLKATA);

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

let matched = false;
for (let i = 0; i < 12 && !matched; i++) {
  await ava.page.dispatchEvent("#cuisine-swipe-right-btn", "click");
  await ben.page.dispatchEvent("#cuisine-swipe-right-btn", "click");
  await ava.page.waitForTimeout(500);
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

// Click through to real restaurant results -- geolocation is pre-granted
// and mocked to Kolkata, so this resolves instantly without a real prompt.
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
