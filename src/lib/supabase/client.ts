// Browser-side Supabase client.
//
// Uses @supabase/ssr's createBrowserClient rather than
// @supabase/supabase-js's plain createClient: it persists the auth session
// in cookies instead of localStorage, which is what lets
// src/lib/supabase/server.ts read the same session on the server (see that
// file for why that matters). Safe to call from any React island — reads
// PUBLIC_-prefixed env vars, which Astro exposes to client-side code.
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY
  );
}
