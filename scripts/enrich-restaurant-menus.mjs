// scripts/enrich-restaurant-menus.mjs
//
// Phase 6/7, Track B (C:\Users\ajitd\.claude\plans\clever-baking-map.md).
// Pulls a menu (dish name + price, where visible) from each cached
// restaurant's OWN website -- never Zomato/Swiggy, that route was
// explicitly rejected on ToS/legal-risk grounds, see the plan -- via
// Gemini, since every restaurant site is shaped differently (plain HTML,
// PDF, an embedded widget, or nothing at all) and a bespoke parser per
// site doesn't scale.
//
// MANUALLY TRIGGERED, ON PURPOSE: neither Supabase's nor Vercel's free
// tier has real cron. This is the same convention every other script in
// this directory already uses -- run by hand, not scheduled. If/when a
// hosting tier with real cron is worth paying for, wiring this to run on a
// schedule is a small addition on top of what's here, not a rewrite.
//
// Run:  node --env-file=.env scripts/enrich-restaurant-menus.mjs [--limit=15]
//
// What it does, per restaurant with enrichment_status = 'pending':
//   1. Check robots.txt for a blanket disallow -- skip (leave pending) if so.
//   2. Fetch the homepage, look for a menu-page link; fall back to a few
//      common paths (/menu, /our-menu, ...) if none found.
//   3. Strip the candidate page to plain text, hand it to Gemini with an
//      extraction prompt (structured JSON out, same generateGeminiJson()
//      restaurant-menu.ts already uses -- see src/lib/ai/gemini.ts).
//   4. Write the result via record_enrichment_result() (0019's SECURITY
//      DEFINER function -- this script only ever has the anon key, same as
//      the live app; no service-role credential exists anywhere in this
//      project, by design).
//
// A transient failure (fetch timeout, 5xx, robots disallow) leaves the row
// at 'pending' so the NEXT run retries it. Only a page that was reached and
// genuinely has no menu gets marked 'no_menu_found' -- that distinction is
// what keeps this from either retrying forever or giving up on a restaurant
// after one bad network blip.
import { createClient } from "@supabase/supabase-js";
import { generateGeminiJson } from "../src/lib/ai/gemini.ts";

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("FATAL: PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY not set (run with --env-file=.env)");
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error("FATAL: GEMINI_API_KEY not set (run with --env-file=.env)");
  process.exit(1);
}

const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 15);
const FETCH_TIMEOUT_MS = 8000;
const MAX_PAGE_TEXT_CHARS = 12000;
const MENU_PATH_CANDIDATES = ["/menu", "/menus", "/our-menu", "/food-menu", "/menu.html"];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function fetchText(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "FoodSwipeMenuBot/1.0 (+https://foodswipe-astro.vercel.app)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Blanket "User-agent: * / Disallow: /" only -- not a full robots.txt parser, just the one signal worth hard-respecting. */
async function isDisallowed(origin) {
  try {
    const robots = await fetchText(`${origin}/robots.txt`, 5000);
    const lines = robots.split("\n").map((l) => l.trim().toLowerCase());
    let inWildcardBlock = false;
    for (const line of lines) {
      if (line.startsWith("user-agent:")) {
        inWildcardBlock = line.includes("*");
      } else if (inWildcardBlock && line === "disallow: /") {
        return true;
      }
    }
    return false;
  } catch {
    return false; // no robots.txt (or unreachable) -- not a disallow signal
  }
}

function stripHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PAGE_TEXT_CHARS);
}

function findMenuLink(html, origin) {
  const linkRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html))) {
    const [, href, label] = match;
    const combined = `${href} ${label}`.toLowerCase();
    if (/\bmenu\b/.test(combined)) {
      try {
        return new URL(href, origin).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

const MENU_SCHEMA = {
  type: "object",
  properties: {
    hasMenu: { type: "boolean" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dishName: { type: "string" },
          price: { type: "number" },
        },
        required: ["dishName"],
      },
    },
  },
  required: ["hasMenu", "items"],
};

async function extractMenu(pageText, restaurantName) {
  const prompt = `You are extracting a restaurant's menu from raw webpage text. The restaurant is "${restaurantName}".
Below is text scraped from their website (may include navigation, footer junk, etc alongside the actual menu -- ignore anything that clearly isn't a dish name + price).
If there is a real menu with dish names in this text, return hasMenu: true and a list of items (dishName required, price only if a real number is visible -- omit price rather than guess).
If there is no real menu content in this text (e.g. it's just a homepage with no prices/dishes), return hasMenu: false and an empty items array. Never invent a dish or a price that isn't in the text.

TEXT:
${pageText}`;

  return generateGeminiJson({
    prompt,
    responseSchema: MENU_SCHEMA,
    apiKey: GEMINI_API_KEY,
    timeoutMs: 15000,
  });
}

async function enrichOne(restaurant) {
  const { id, name, website } = restaurant;
  console.log(`\n-- ${name} (${website})`);

  let origin;
  try {
    origin = new URL(website).origin;
  } catch {
    console.log("   skip: invalid website URL, leaving pending for manual review");
    return "skipped";
  }

  if (await isDisallowed(origin)) {
    console.log("   skip: robots.txt disallows all crawling, leaving pending");
    return "skipped";
  }

  let menuUrl = website;
  let pageHtml;
  try {
    pageHtml = await fetchText(website);
    const foundLink = findMenuLink(pageHtml, origin);
    if (foundLink) {
      menuUrl = foundLink;
      try {
        pageHtml = await fetchText(menuUrl);
      } catch {
        menuUrl = website; // menu link existed but 404'd/timed out -- fall back to homepage text
      }
    } else {
      for (const path of MENU_PATH_CANDIDATES) {
        try {
          const candidate = `${origin}${path}`;
          pageHtml = await fetchText(candidate, 5000);
          menuUrl = candidate;
          break;
        } catch {
          continue;
        }
      }
    }
  } catch (err) {
    console.log(`   skip: couldn't fetch the site (${err.message}), leaving pending for retry`);
    return "skipped";
  }

  const pageText = stripHtmlToText(pageHtml);
  if (pageText.length < 50) {
    console.log("   no_menu_found: page had almost no text content");
    await supabase.rpc("record_enrichment_result", {
      p_restaurant_id: id,
      p_status: "no_menu_found",
      p_items: [],
    });
    return "no_menu_found";
  }

  let result;
  try {
    result = await extractMenu(pageText, name);
  } catch (err) {
    console.log(`   skip: Gemini extraction failed (${err.message}), leaving pending for retry`);
    return "skipped";
  }

  if (!result.hasMenu || !Array.isArray(result.items) || result.items.length === 0) {
    console.log("   no_menu_found: Gemini found no real menu on this page");
    await supabase.rpc("record_enrichment_result", {
      p_restaurant_id: id,
      p_status: "no_menu_found",
      p_items: [],
    });
    return "no_menu_found";
  }

  const items = result.items
    .filter((it) => typeof it.dishName === "string" && it.dishName.trim().length > 0)
    .slice(0, 60) // sane upper bound -- a real menu doesn't have 500 items, a bad extraction might
    .map((it) => ({
      dish_name: it.dishName.trim().slice(0, 120),
      price: typeof it.price === "number" && it.price > 0 && it.price < 100000 ? it.price : null,
      source_url: menuUrl,
    }));

  console.log(`   done: ${items.length} dishes extracted from ${menuUrl}`);
  const { error } = await supabase.rpc("record_enrichment_result", {
    p_restaurant_id: id,
    p_status: "done",
    p_items: items,
  });
  if (error) {
    console.error(`   ERROR writing result: ${error.message}`);
    return "skipped";
  }
  return "done";
}

async function main() {
  console.log(`Restaurant menu enrichment -- batch of up to ${LIMIT}`);

  const { data: pending, error } = await supabase
    .from("restaurants")
    .select("id, name, website")
    .eq("enrichment_status", "pending")
    .not("website", "is", null)
    .limit(LIMIT);

  if (error) {
    console.error("FATAL: could not read pending restaurants:", error.message);
    console.error("(is migration 0019 applied? this needs record_enrichment_result() and restaurants.enrichment_status)");
    process.exit(1);
  }

  if (!pending || pending.length === 0) {
    console.log("Nothing pending -- every cached restaurant with a website is already enriched or has none to try.");
    return;
  }

  console.log(`Found ${pending.length} pending restaurant(s).`);

  const counts = { done: 0, no_menu_found: 0, skipped: 0 };
  for (const r of pending) {
    const outcome = await enrichOne(r);
    counts[outcome] += 1;
  }

  console.log(`\n--- summary ---`);
  console.log(`done (menu extracted): ${counts.done}`);
  console.log(`no menu found:         ${counts.no_menu_found}`);
  console.log(`skipped (retry later): ${counts.skipped}`);
}

main();
