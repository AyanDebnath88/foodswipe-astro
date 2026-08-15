// scripts/playwright/multi-session.mjs
//
// Reusable multi-user live-testing driver for Food Swipe.
//
// WHY THIS EXISTS: the in-app "Browser pane" tool available in this
// environment shares one cookie jar across every tab it opens, so it can
// never hold two different logged-in users at the same time -- exactly the
// limitation that made every earlier round of "test this as two people"
// require either two separate real browser surfaces (in-app pane + the
// user's actual Chrome) or a headless Node script hitting Supabase directly
// (scripts/test-e2e.mjs and friends). Neither of those lets a human actually
// WATCH the UI while it happens.
//
// Playwright's browser *contexts* are fully isolated (separate cookies,
// localStorage, IndexedDB) even though they share one browser process, so
// N independent logged-in sessions can run side by side, and every session
// can be screenshotted on demand. Screenshots are how "live in front of you"
// works in this environment: there's no shared display to stream to, so the
// loop is act -> screenshot -> show you the PNG -> next action, run as many
// times as needed while iterating on a change.
//
// Usage (see demo.mjs for a full example):
//   import { openSession, closeAll } from "./multi-session.mjs";
//   const ava = await openSession("ava");
//   await ava.page.goto(`${BASE_URL}/login`);
//   ...
//   await ava.shot("01-login-page");
//   await closeAll();

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SHOT_DIR = join(__dirname, "screenshots");
mkdirSync(SHOT_DIR, { recursive: true });

// Loopback, not "localhost": localhost:4321 has been observed to resolve to
// an unrelated app on this machine via IPv6/IPv4 ambiguity (see the build
// log's "Integration pass" section). Always use the literal IPv4 address.
export const BASE_URL = process.env.APP_BASE_URL ?? "http://127.0.0.1:4321";

let browser = null;
const sessions = [];
let shotCounter = 0;

async function getBrowser() {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

/**
 * Opens one fully independent session (own cookies/storage -- a real
 * separate login). `label` is used only for screenshot filenames.
 */
export async function openSession(label) {
  const b = await getBrowser();
  const context = await b.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();

  const session = {
    label,
    context,
    page,
    /** Screenshot this session's current page. Returns the file path. */
    async shot(step) {
      shotCounter += 1;
      const n = String(shotCounter).padStart(2, "0");
      const path = join(SHOT_DIR, `${n}-${label}-${step}.png`);
      await page.screenshot({ path, fullPage: false });
      return path;
    },
    async close() {
      await context.close();
    },
  };
  sessions.push(session);
  return session;
}

/** Real login through the actual UI (react-hook-form, real Supabase Auth) --
 *  not a cookie shortcut, so this exercises the same form-fill path a human
 *  would use, the way the earlier "form_input doesn't work on this app"
 *  lesson from prior agents required (Playwright's real click+type does
 *  work where the other browser tool's programmatic field-set did not). */
export async function login(session, email, password) {
  await session.page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await session.page.getByPlaceholder("m@example.com").click();
  await session.page.getByPlaceholder("m@example.com").fill(email);
  await session.page.getByPlaceholder("••••").click();
  await session.page.getByPlaceholder("••••").fill(password);
  await session.page.getByRole("button", { name: /^Login$/ }).click();
  await session.page.waitForURL(/\/rooms/, { timeout: 10000 });
}

export async function closeAll() {
  for (const s of sessions) await s.close();
  if (browser) await browser.close();
  browser = null;
  sessions.length = 0;
}
