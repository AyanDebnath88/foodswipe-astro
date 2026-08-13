// POST /api/delivery-links
//
//   body:     { restaurantName: string, latitude: number, longitude: number }
//   response: { services: DeliveryLink[], region: "IN" | "UK" | "EU" | "GLOBAL" }
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
// Affiliate tracking IDs are NOT included in these URLs -- they get added
// in Phase 5 once the affiliate programs (DoorDash, Uber Eats, Swiggy,
// Zomato, Deliveroo, Just Eat, Wolt, Lieferando) are actually signed up for.
import type { APIRoute } from "astro";

export const prerender = false;

interface DeliveryLink {
  serviceName: string;
  url: string;
}

type Region = "IN" | "UK" | "EU" | "GLOBAL";

interface RequestBody {
  restaurantName?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

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

function buildLinks(region: Region, restaurantName: string): DeliveryLink[] {
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
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const restaurantName =
    typeof body.restaurantName === "string" && body.restaurantName.trim() ? body.restaurantName.trim() : null;
  const latitude = typeof body.latitude === "number" ? body.latitude : null;
  const longitude = typeof body.longitude === "number" ? body.longitude : null;

  if (!restaurantName || latitude === null || longitude === null) {
    return new Response(
      JSON.stringify({ error: "restaurantName (string), latitude (number), longitude (number) are required" }),
      { status: 400 }
    );
  }

  const region = resolveRegion(latitude, longitude);
  const services = buildLinks(region, restaurantName);

  return new Response(JSON.stringify({ services, region }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
