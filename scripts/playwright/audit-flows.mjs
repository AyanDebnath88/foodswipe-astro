// scripts/playwright/audit-flows.mjs
//
// Full-app UX walkthrough: two real logins, host + join, swipe to a match,
// then continue past the match reveal (restaurants -> dish menu -> order)
// and visit every other page. Full-page screenshots plus a text dump of
// each screen's headings and buttons, so a reviewer can audit flows and
// visual consistency without clicking through by hand.
//
// Run: APP_BASE_URL=http://localhost:4321 node --env-file=.env scripts/playwright/audit-flows.mjs

import { openSession, login, closeAll, BASE_URL, SHOT_DIR } from "./multi-session.mjs";
import { join } from "node:path";

const CREDS = {
  ava: { email: "foodswipe.tester.a@gmail.com", password: "FoodSwipeTest!2026" },
  ben: { email: "foodswipe.tester.b@gmail.com", password: "FoodSwipeTest!2026" },
};

const report = [];
let n = 0;
async function capture(session, step) {
  n += 1;
  const path = join(SHOT_DIR, `audit-${String(n).padStart(2, "0")}-${session.label}-${step}.png`);
  await session.page.waitForTimeout(800);
  await session.page.screenshot({ path, fullPage: true });
  const info = await session.page.evaluate(() => {
    const txt = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim().replace(/\s+/g, " ")).filter(Boolean);
    return {
      url: location.pathname + location.search,
      headings: txt("h1, h2, h3").slice(0, 8),
      buttons: txt("button, a[href]").slice(0, 24),
      height: document.documentElement.scrollHeight,
    };
  });
  report.push({ step: `${session.label}/${step}`, path, ...info });
  console.log(`[${n}] ${session.label}/${step} ${info.url}\n    H: ${info.headings.join(" | ")}\n    B: ${info.buttons.join(" | ")}`);
}

async function main() {
  console.log(`Audit against ${BASE_URL}`);
  const ava = await openSession("ava");
  const ben = await openSession("ben");
  const anon = await openSession("anon");
  // grant location (Kolkata) so the match screen can look up real places
  for (const s of [ava, ben]) {
    await s.context.grantPermissions(["geolocation"]);
    await s.context.setGeolocation({ latitude: 22.5726, longitude: 88.3639 });
  }

  // signed-out pages
  for (const [step, path] of [["home", "/"], ["login", "/login"], ["signup", "/signup"], ["join-link-guest", "/rooms/join?code=ABCD"], ["not-found", "/nope"]]) {
    await anon.page.goto(BASE_URL + path, { waitUntil: "networkidle" });
    await capture(anon, step);
  }

  await login(ava, CREDS.ava.email, CREDS.ava.password);
  await capture(ava, "rooms-dashboard");
  await login(ben, CREDS.ben.email, CREDS.ben.password);

  // host + join
  await ava.page.getByRole("button", { name: /Host Dining Room/i }).click();
  await ava.page.waitForSelector(".select-all", { timeout: 10000 });
  const code = (await ava.page.locator(".select-all").first().innerText()).trim();
  await capture(ava, "hosting");
  await ben.page.getByPlaceholder("ABCD").click();
  await ben.page.getByPlaceholder("ABCD").fill(code);
  await ben.page.getByRole("button", { name: /Join Session Room/i }).click();
  await ben.page.getByText(/Diners Joined \(2\)/).waitFor({ timeout: 10000 }); // joiner view has no .select-all code element
  await ava.page.waitForTimeout(1500);
  await capture(ava, "waiting-room-both-joined");

  // swipe to a match
  await ava.page.getByRole("button", { name: /Start Swiping Together/i }).click();
  await ava.page.waitForURL(/\/swipe/, { timeout: 10000 });
  await ben.page.goto(`${BASE_URL}/swipe?room=${code}`, { waitUntil: "networkidle" });
  await capture(ava, "swipe-deck");
  let matched = false;
  for (let round = 0; round < 14 && !matched; round++) {
    for (const s of [ava, ben]) {
      await s.page.dispatchEvent("#cuisine-swipe-right-btn", "click").catch(() => {});
      await s.page.waitForTimeout(700);
    }
    if (/\/match\//.test(ava.page.url()) || /\/match\//.test(ben.page.url())) {
      await ava.page.waitForURL(/\/match\//, { timeout: 8000 }).catch(() => {});
      matched = true;
    }
  }
  await capture(ava, matched ? "match-reveal" : "no-match");
  if (!matched) return;

  // past the match: pick the first restaurant, then dishes with both users
  for (const s of [ava, ben]) {
    await s.page.waitForURL(/\/match\//, { timeout: 8000 }).catch(() => {});
    await s.page.waitForTimeout(4000); // places lookup
    if (s === ava) await capture(ava, "match-with-places");
    // dispatch, not click: the floating nav pill overlaps this button on phones (logged as a bug)
    const go = s.page.getByRole("button", { name: /^Swipe dishes here$/i }).first();
    await go.dispatchEvent("click").catch((e) => console.log("  dish button dispatch failed:", e.message.slice(0, 80)));
    await s.page.waitForURL(/\/match\/[^/?]+\/[^/?]+/, { timeout: 15000 }).catch(() => console.log(`  ${s.label}: no navigation to restaurant page`));
  }
  await capture(ava, "restaurant-dish-menu");
  // Same restaurant for both, then both tap the same two dishes BY NAME:
  // the dish grid is shuffled per user (deliberate, dish-swipe-area.tsx), so
  // "the first two tiles" are different dishes on each screen.
  await ben.page.goto(ava.page.url(), { waitUntil: "networkidle" });
  for (const s of [ava, ben]) await s.page.locator("button[aria-pressed]").first().waitFor({ timeout: 20000 });
  const picks = (await ava.page.$$eval("button[aria-pressed]", (bs) => bs.map((b) => b.querySelector("span.line-clamp-2")?.textContent?.trim()))).slice(0, 2);
  for (const s of [ava, ben]) {
    for (const name of picks) {
      await s.page.locator("button[aria-pressed]", { hasText: name }).first().click().catch(() => {});
      await s.page.waitForTimeout(600);
    }
  }
  await ava.page.waitForTimeout(1500);
  await capture(ava, "dishes-selected");
  const finish = ava.page.getByRole("button", { name: /order|done|finish|lock|continue/i }).first();
  if (await finish.count()) {
    await finish.click().catch(() => {});
    await ava.page.waitForTimeout(2500);
    await capture(ava, "after-finish");
  }

  // remaining signed-in pages
  for (const [step, path] of [["favorites", "/favorites"], ["history", "/history"], ["solo-swipe", "/swipe"]]) {
    await ava.page.goto(BASE_URL + path, { waitUntil: "networkidle" });
    await capture(ava, step);
  }
}

main()
  .catch((err) => console.error("FATAL:", err))
  .finally(async () => {
    await closeAll();
    console.log("\nREPORT_JSON " + JSON.stringify(report.map(({ step, url, height }) => ({ step, url, height }))));
  });
