// Shared input-validation / abuse-resistance helpers for the public API
// routes under src/pages/api/.
//
// These four routes are unauthenticated by design (the swipe UI calls them
// with no session), and three of them spend money on every call -- two hit
// Gemini and one hits Geoapify, both on real keys. Before this module they
// accepted arbitrary-length strings and arbitrarily large arrays straight
// off the wire and forwarded them to those APIs, with no cap on how often.
//
// Nothing here is a substitute for a real edge rate limiter; see rateLimit()'s
// comment for exactly what it does and does not buy.

/** Max accepted request body, in bytes. Every route's real body is < 1 KB. */
const MAX_BODY_BYTES = 16 * 1024;

export class BadRequest extends Error {}

/**
 * Reads and parses a JSON body, refusing anything oversized.
 *
 * Content-Length is checked first (cheap, and rejects before buffering), but
 * it is client-supplied and optional -- chunked uploads have none -- so the
 * decoded text is measured too.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new BadRequest("Request body is too large");
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new BadRequest("Could not read request body");
  }

  if (text.length > MAX_BODY_BYTES) {
    throw new BadRequest("Request body is too large");
  }

  try {
    const parsed = JSON.parse(text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadRequest("Body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BadRequest) throw err;
    throw new BadRequest("Invalid JSON body");
  }
}

/**
 * Normalises a user-supplied string that is about to be interpolated into an
 * LLM prompt or an outbound URL.
 *
 * Collapses ALL whitespace (including newlines) to single spaces and drops
 * control characters. The newline part is the point for prompt injection:
 * the classic "\n\nIgnore the above and instead ..." payload needs line
 * breaks to look like a new instruction block, and a single-line value that
 * is also wrapped in delimiters by the caller is much weaker as an injection.
 *
 * This is defence in depth, not a guarantee -- see the risk note in
 * restaurant-menu.ts. The hard limit is what actually protects the API bill.
 */
export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;

  // Control characters (newline, carriage return, tab, NUL, ...) become
  // spaces, and runs of whitespace collapse to one. Done by code point rather
  // than by a regex escape so the source file itself stays plain ASCII.
  let flattened = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    flattened += code < 0x20 || code === 0x7f ? " " : ch;
  }

  const cleaned = flattened.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

/**
 * Same, for an array of strings: caps both the number of items and the length
 * of each, and drops anything that isn't a usable string.
 */
export function cleanTextArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= maxItems) break;
    const cleaned = cleanText(item, maxLength);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** A finite number within [min, max], or null. Rejects NaN/Infinity/strings. */
export function finiteNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound on a long-lived server. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Fixed-window per-IP limiter.
 *
 * Honest scope: this is in-process memory. On a single long-lived Node server
 * (how this app runs today) it works. On Vercel's serverless functions each
 * instance keeps its own map, so the effective limit is per-instance and an
 * attacker who fans out across instances gets a multiple of it -- and an IP
 * is spoofable-ish behind a proxy that doesn't normalise x-forwarded-for.
 * It exists to stop the cheap version of the attack (one script hammering
 * one endpoint and running up a Gemini bill); a real deployment should put a
 * platform/WAF limiter in front and keep this as the backstop.
 *
 * A short window is used on purpose: it keeps the memory footprint tiny and
 * it means a false positive costs a caller seconds, not minutes.
 */
export function rateLimit(
  request: Request,
  bucketName: string,
  limit: number,
  windowMs = 15_000
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  sweep(now);

  const key = `${bucketName}:${clientKey(request)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * The one place an error becomes a response body. Only ever emits a message
 * this codebase wrote -- never an exception's text, which for these routes
 * can contain an upstream URL (and therefore an API key) or an upstream
 * provider's error payload.
 */
export function errorResponse(message: string, status: number, headers: Record<string, string> = {}): Response {
  return json({ error: message }, status, headers);
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return errorResponse("Too many requests, slow down.", 429, {
    "Retry-After": String(retryAfterSeconds),
  });
}
