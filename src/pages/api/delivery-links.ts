// POST /api/delivery-links
//
//   body:     { restaurantName: string, latitude: number, longitude: number }
//   response: { services: DeliveryLink[],
//               region: "IN" | "UK" | "EU" | "GLOBAL",
//               affiliateDisclosure: boolean }
//
//   DeliveryLink = { serviceName: string, url: string, affiliate: boolean }
//
// Loosely ported from the reference project's find-delivery-prices.ts, but
// deliberately NOT a straight port: that file fabricated per-service prices
// via hardcoded pricing formulas (e.g. "dishesCount * 240 + 60") with no
// real pricing API behind them. Per the build log's revenue plan, real
// delivery pricing/affiliate integration is Phase 5 monetization work, not
// this phase -- so this endpoint keeps only the real, useful part: regional
// service selection and search deep-link URLs. No price is shown to the
// user because none of these numbers would be real.
//
// Phase 5 (monetization) added affiliate decoration on top, WITHOUT changing
// any of the above: the search URLs are still the same real search URLs, and
// still carry no prices. src/lib/affiliates.ts adds a tracking id to a link
// only when that service's program has actually been signed up for and its
// env vars are set. None are set today, so today every link comes back
// exactly as it did before and `affiliate` is false across the board -- that
// path is the tested default, not an afterthought.
//
// `affiliateDisclosure` is true only when at least one link on this response
// really was tagged. The UI shows the "we may earn a commission" line off
// that flag, so the app never claims a commercial relationship it doesn't
// have (and never hides one it does).
import type { APIRoute } from "astro";
import { anyAffiliate, decorateDeliveryUrl } from "@/lib/affiliates";
import {
  BadRequest,
  cleanText,
  errorResponse,
  finiteNumber,
  json,
  rateLimit,
  readJsonBody,
  tooManyRequests,
} from "@/lib/api/guard";

export const prerender = false;

// This is the one route with no paid upstream -- it only builds search URLs
// -- so its limit is looser. It still needs one: it is a public endpoint that
// echoes caller text back inside URLs, which is exactly the shape of thing
// people point at other people.
const MAX_RESTAURANT_NAME = 120;
const RATE_LIMIT_PER_WINDOW = 25;

interface DeliveryLink {
  serviceName: string;
  url: string;
  /** True only if a real tracking id was applied. See src/lib/affiliates.ts. */
  affiliate: boolean;
}

type Region = "IN" | "UK" | "EU" | "GLOBAL";

function resolveRegion(latitude: number, longitude: number): Region {
  // Coordinate check for India
  if (latitude >= 6.0 && latitude <= 37.0 && longitude >= 68.0 && longitude <= 97.0) {
    return "IN";
  }
  // Coordinate check for United Kingdom
  if (latitude >= 49.0 && latitude <= 61.0 && longitude >= -8.0 && longitude <= 2.0) {
    return "UK";
  }
  // Coordinate check for Europe (broad bounding box)
  if (latitude >= 35.0 && latitude <= 70.0 && longitude >= -10.0 && longitude <= 30.0) {
    return "EU";
  }
  return "GLOBAL";
}

/**
 * The plain, un-tagged search links. Affiliate decoration happens after.
 *
 * Restaurant name ONLY -- this used to fold in the full street address too
 * (`${restaurantName} ${area}`), on the theory that a longer query would
 * land on the right listing more precisely. Live use showed the opposite:
 * Zomato/Swiggy's own search treats a 60+ character address string as
 * mostly noise and returns unrelated results, sometimes nothing at all,
 * for a query that would have worked fine as just the name. The app
 * already has the user's real location (geolocation, passed to this same
 * endpoint) doing the disambiguation work a city/address suffix was trying
 * to do, so the address added query-string length without adding any
 * precision the platform's search could actually use. This still can't
 * guarantee landing directly on that restaurant's menu page -- that would
 * need the platform's real listing id, which this app has no way to get
 * without either their API (not available to us) or scraping their site
 * (explicitly rejected on ToS/legal grounds, see clever-baking-map.md).
 * It's a sharper search, not a direct link -- said plainly here rather than
 * implied.
 */
function buildLinks(region: Region, restaurantName: string): Array<Omit<DeliveryLink, "affiliate">> {
  const q = encodeURIComponent(restaurantName);

  switch (region) {
    case "IN":
      return [
        { serviceName: "Zomato", url: `https://www.zomato.com/search?q=${q}` },
        { serviceName: "Swiggy", url: `https://www.swiggy.com/search?query=${q}` },
      ];

    case "UK":
      return [
        { serviceName: "Deliveroo", url: `https://deliveroo.co.uk/restaurants/search?search=${q}` },
        { serviceName: "Just Eat", url: `https://www.just-eat.co.uk/search?q=${q}` },
        { serviceName: "Uber Eats", url: `https://www.ubereats.com/gb/search?q=${q}` },
      ];

    case "EU":
      return [
        { serviceName: "Wolt", url: `https://wolt.com/en/search?q=${q}` },
        { serviceName: "Lieferando", url: `https://www.lieferando.de/en/search?q=${q}` },
        { serviceName: "Uber Eats", url: `https://www.ubereats.com/search?q=${q}` },
      ];

    case "GLOBAL":
    default:
      return [
        { serviceName: "DoorDash", url: `https://www.doordash.com/search/store/${q}` },
        { serviceName: "Uber Eats", url: `https://www.ubereats.com/search?q=${q}` },
        { serviceName: "Grubhub", url: `https://www.grubhub.com/search?orderMethod=delivery&queryText=${q}` },
      ];
  }
}

export const POST: APIRoute = async ({ request }) => {
  const limit = rateLimit(request, "delivery-links", RATE_LIMIT_PER_WINDOW);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return errorResponse(err instanceof BadRequest ? err.message : "Invalid JSON body", 400);
  }

  const restaurantName = cleanText(body.restaurantName, MAX_RESTAURANT_NAME);
  // `area` is still accepted in the request body (the caller still sends it,
  // and geolocation-driven region resolution below still needs lat/lon) but
  // is no longer folded into the delivery-app search query -- see
  // buildLinks()'s comment for why that made results worse, not better.
  const latitude = finiteNumber(body.latitude, -90, 90);
  const longitude = finiteNumber(body.longitude, -180, 180);

  if (!restaurantName || latitude === null || longitude === null) {
    return errorResponse(
      "restaurantName (string), latitude (number, -90..90), longitude (number, -180..180) are required",
      400
    );
  }

  const region = resolveRegion(latitude, longitude);

  // Decorate per-link rather than per-region: affiliate programs are signed
  // up for one service at a time, so a region will routinely be a mix of
  // tagged and untagged links, and each one has to report its own truth.
  const services: DeliveryLink[] = buildLinks(region, restaurantName).map((link) => {
    const decorated = decorateDeliveryUrl(link.serviceName, link.url);
    return { serviceName: link.serviceName, url: decorated.url, affiliate: decorated.affiliate };
  });

  return json({ services, region, affiliateDisclosure: anyAffiliate(services) });
};
