// Server-side Supabase client for use inside .astro frontmatter and API
// routes.
//
// @supabase/ssr's createServerClient is framework-agnostic: it wants a
// `cookies` object implementing `getAll()` / `setAll()` against whatever
// cookie jar the host framework provides. This file is the adapter for
// Astro's `AstroCookies` (available as `Astro.cookies` in .astro files, or
// `context.cookies` in API routes / middleware).
//
// AstroCookies has no built-in "list every cookie on the request" method
// (only keyed get/has/set/delete), so `getAll` is implemented by parsing the
// raw `Cookie` request header instead, via @supabase/ssr's own
// `parseCookieHeader` helper. `setAll` writes back through
// `AstroCookies#set`, which is what turns into `Set-Cookie` response headers.
//
// Construct a new client per-request (per Supabase's SSR guidance — never
// share one across requests), passing `Astro.request` and `Astro.cookies`.
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";

export function createSupabaseServerClient(request: Request, cookies: AstroCookies) {
  return createServerClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get("Cookie") ?? "");
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookies.set(name, value, options);
          });
        },
      },
    }
  );
}
