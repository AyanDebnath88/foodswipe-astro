// Affiliate configuration for outbound delivery links (Phase 5, channel 1).
//
// SERVER-ONLY MODULE. Nothing here may be imported from a React island or any
// other client bundle: it reads un-prefixed environment variables, and Astro
// only keeps `PUBLIC_`-prefixed vars out of the client build by convention,
// not by force. The one consumer is src/pages/api/delivery-links.ts, which
// runs on the server and tells the browser *whether* a link was tagged
// (a boolean) rather than handing it the tracking id.
//
// What this file is for
// ---------------------
// The delivery links this app emits are plain public search URLs. An
// affiliate program turns those same links into a commission when someone
// actually orders. Every network expresses that differently, so the mapping
// lives here, in one place, driven entirely by environment variables:
//
//   AFFILIATE_<SERVICE>_TEMPLATE   the tracking/redirect URL your network
//                                  gives you, with {url} where the
//                                  destination goes (and optionally {id})
//   AFFILIATE_<SERVICE>_ID         your publisher / affiliate id
//   AFFILIATE_<SERVICE>_PARAM      (rare) a query parameter to append to the
//                                  destination directly, for programs that
//                                  attribute by parameter instead of by
//                                  redirect
//
// Design rules, in priority order:
//
//  1. ZERO CONFIGURATION MUST WORK. Today not a single affiliate program has
//     been signed up for, so every one of these variables is unset and every
//     link must come out exactly as it does now. A missing, malformed or
//     nonsense id must never produce a broken link, a dropped link, or a
//     link that goes somewhere other than the delivery service. Every failure
//     path in decorateDeliveryUrl() returns the untouched original URL.
//
//  2. NEVER CLAIM A COMMISSION THAT DOESN'T EXIST. decorate() reports back
//     whether it really tagged the URL, and the UI only shows the affiliate
//     disclosure when something was really tagged. Showing "we may earn a
//     commission" while earning nothing is just as dishonest as hiding it
//     when we do.
//
//  3. NO FABRICATED NUMBERS ANYWHERE. The reference project's
//     find-delivery-prices.ts printed invented per-service delivery prices
//     from a hardcoded formula. That was deliberately dropped in Phase 3 and
//     must not come back in through the monetization door: this file adds
//     tracking parameters to URLs and nothing else. No prices, no ratings,
//     no "commission earned", no social proof.
//
// Why the network specifics are NOT hardcoded
// -------------------------------------------
// Affiliate networks change their link formats, and the exact deep-link
// shape differs per publisher account (the id, the campaign id and the
// merchant id are all account-specific). Guessing a format in code would
// produce links that look configured and attribute nothing. So the template
// comes from the operator, verbatim, out of their network dashboard. The
// per-service notes below record which network each program is *usually*
// run through, as a starting point for signup -- not as a promise.

/**
 * Reads one server-side affiliate variable.
 *
 * process.env first, import.meta.env second, and both are needed:
 *
 *  * `process.env` is what a real deployment (Vercel, `node
 *    dist/server/entry.mjs`, `node --env-file=.env`) actually populates, and
 *    it is the only one that supports a *dynamic* key -- Vite statically
 *    replaces `import.meta.env.LITERAL` at build time, so an indexed lookup
 *    on it cannot be relied on in a built server bundle.
 *  * `import.meta.env` is the fallback that covers `astro dev`, where Vite
 *    loads .env itself.
 *
 * Un-prefixed vars are never exposed to client code by Astro, which is
 * exactly why the tracking ids are named without `PUBLIC_` -- see the
 * .env.example header.
 */
// Declared locally rather than pulling in @types/node: this project has no
// node types installed (nothing else needs them) and one guarded global is
// not worth a new dev dependency. The `typeof` guard below is the real
// runtime check -- this declaration only tells TypeScript the shape.
declare const process: { env?: Record<string, string | undefined> } | undefined;

function affiliateEnv(name: string): string | undefined {
  let raw: unknown;
  try {
    if (typeof process !== "undefined" && process?.env) raw = process.env[name];
  } catch {
    // No process (edge runtimes) -- fall through to import.meta.env.
  }
  if (typeof raw !== "string" || !raw.trim()) {
    const meta = import.meta.env as unknown as Record<string, unknown> | undefined;
    raw = meta ? meta[name] : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** How a service's program attributes a click. */
export interface AffiliateService {
  /** Must match the `serviceName` emitted by /api/delivery-links exactly. */
  service: string;
  /** Env-var infix: AFFILIATE_<slug>_ID etc. */
  slug: string;
  /** Region(s) the service operates in, for the .env.example comments. */
  regions: string;
  /** Where the program is normally run -- confirm at signup, not gospel. */
  network: string;
  /** Where to apply, as of writing. Informational only. */
  signupUrl: string;
}

/**
 * Every service /api/delivery-links can emit. Keep this list in sync with
 * that route's buildLinks(): a service missing from here simply never gets
 * tagged (it still works, it just earns nothing), which is the safe
 * direction for a mismatch to fail in.
 */
export const AFFILIATE_SERVICES: AffiliateService[] = [
  {
    service: "DoorDash",
    slug: "DOORDASH",
    regions: "US, CA, AU",
    network: "impact.com (DoorDash runs its affiliate program through Impact)",
    signupUrl: "https://www.doordash.com/affiliates/",
  },
  {
    service: "Uber Eats",
    slug: "UBER_EATS",
    regions: "US, UK, EU and most other markets",
    network: "impact.com / Partnerize, varies by country",
    signupUrl: "https://www.ubereats.com/",
  },
  {
    service: "Grubhub",
    slug: "GRUBHUB",
    regions: "US",
    network: "impact.com / CJ Affiliate",
    signupUrl: "https://www.grubhub.com/partner",
  },
  {
    service: "Zomato",
    slug: "ZOMATO",
    regions: "IN",
    network: "Indian aggregator networks (Cuelinks, Admitad, INRDeals)",
    signupUrl: "https://www.cuelinks.com/",
  },
  {
    service: "Swiggy",
    slug: "SWIGGY",
    regions: "IN",
    network: "Indian aggregator networks (Cuelinks, Admitad, vCommission)",
    signupUrl: "https://www.cuelinks.com/",
  },
  {
    service: "Deliveroo",
    slug: "DELIVEROO",
    regions: "UK, IE, FR, IT and others",
    network: "Awin",
    signupUrl: "https://www.awin.com/",
  },
  {
    service: "Just Eat",
    slug: "JUST_EAT",
    regions: "UK, IE",
    network: "Awin",
    signupUrl: "https://www.awin.com/",
  },
  {
    service: "Wolt",
    slug: "WOLT",
    regions: "Nordics, Baltics, DE, and other EU markets",
    network: "country-level programs; commonly Awin or a direct partnership",
    signupUrl: "https://wolt.com/en/about",
  },
  {
    service: "Lieferando",
    slug: "LIEFERANDO",
    regions: "DE (Just Eat Takeaway)",
    network: "Awin / Tradedoubler",
    signupUrl: "https://www.awin.com/",
  },
];

const BY_SERVICE = new Map(AFFILIATE_SERVICES.map((s) => [s.service, s]));

export interface DecoratedLink {
  /** The URL to send the user to. Always usable, tagged or not. */
  url: string;
  /**
   * True only when a tracking id was really applied. Drives the affiliate
   * disclosure in the UI and the `affiliate_tagged` column on the click
   * event -- so it must never be optimistic.
   */
  affiliate: boolean;
}

/**
 * Warn once per problem, not once per request. A misconfigured template would
 * otherwise print on every single page view; and these run on the server, so
 * a hot loop of warnings is a real (if small) production cost.
 */
const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[affiliates] ${message}`);
}

/** A tracking template is only usable if it is an https URL containing {url}. */
function applyTemplate(template: string, destination: string, id: string | undefined, slug: string): string | null {
  if (!template.includes("{url}")) {
    warnOnce(
      `${slug}:no-url-placeholder`,
      `AFFILIATE_${slug}_TEMPLATE has no {url} placeholder, so the destination would be lost. Ignoring it and using the plain link.`
    );
    return null;
  }
  if (template.includes("{id}") && !id) {
    warnOnce(
      `${slug}:template-needs-id`,
      `AFFILIATE_${slug}_TEMPLATE contains {id} but AFFILIATE_${slug}_ID is not set. Ignoring it and using the plain link.`
    );
    return null;
  }

  const candidate = template
    .replaceAll("{url}", encodeURIComponent(destination))
    .replaceAll("{id}", encodeURIComponent(id ?? ""));

  // Parse rather than trust. A typo'd template must not become an
  // unclickable href, and a non-https template must not silently downgrade
  // an https destination.
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    warnOnce(`${slug}:bad-template-url`, `AFFILIATE_${slug}_TEMPLATE did not expand to a valid URL. Using the plain link.`);
    return null;
  }
  if (parsed.protocol !== "https:") {
    warnOnce(`${slug}:insecure-template`, `AFFILIATE_${slug}_TEMPLATE is not https. Using the plain link.`);
    return null;
  }
  return parsed.toString();
}

/** Direct-parameter attribution: append ?<param>=<id> to our own URL. */
function applyParam(destination: string, param: string, id: string, slug: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(destination);
  } catch {
    // Our own URL failed to parse -- nothing to do but leave it alone.
    return null;
  }
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(param)) {
    warnOnce(`${slug}:bad-param`, `AFFILIATE_${slug}_PARAM is not a plausible query-parameter name. Using the plain link.`);
    return null;
  }
  parsed.searchParams.set(param, id);
  return parsed.toString();
}

/**
 * Adds affiliate tracking to one delivery link, if (and only if) that
 * service is configured.
 *
 * Precedence: TEMPLATE (how nearly every network works) beats PARAM (rare,
 * direct attribution). If neither is configured -- today's state, for every
 * service -- the original URL comes back untouched with affiliate: false.
 *
 * This function never throws. A monetization feature must not be able to
 * take down the delivery links, which are the actually-useful part of the
 * screen.
 */
export function decorateDeliveryUrl(serviceName: string, url: string): DecoratedLink {
  try {
    const config = BY_SERVICE.get(serviceName);
    if (!config) return { url, affiliate: false };

    const id = affiliateEnv(`AFFILIATE_${config.slug}_ID`);
    const template = affiliateEnv(`AFFILIATE_${config.slug}_TEMPLATE`);
    const param = affiliateEnv(`AFFILIATE_${config.slug}_PARAM`);

    if (template) {
      const tagged = applyTemplate(template, url, id, config.slug);
      if (tagged) return { url: tagged, affiliate: true };
      return { url, affiliate: false };
    }

    if (param && id) {
      const tagged = applyParam(url, param, id, config.slug);
      if (tagged) return { url: tagged, affiliate: true };
      return { url, affiliate: false };
    }

    if (id && !param) {
      warnOnce(
        `${config.slug}:id-without-format`,
        `AFFILIATE_${config.slug}_ID is set but neither AFFILIATE_${config.slug}_TEMPLATE nor AFFILIATE_${config.slug}_PARAM is. An id alone attributes nothing -- ${config.network} needs the tracking template from your dashboard. Using the plain link.`
      );
    }

    return { url, affiliate: false };
  } catch {
    // Belt and braces: whatever went wrong, the user still gets their link.
    return { url, affiliate: false };
  }
}

/** True when at least one affiliate program is configured for these links. */
export function anyAffiliate(links: { affiliate: boolean }[]): boolean {
  return links.some((l) => l.affiliate);
}
