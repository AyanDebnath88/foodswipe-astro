/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  // Server-only (no PUBLIC_ prefix -- Astro never exposes these to client
  // code). Used by src/pages/api/* routes only.
  readonly GEMINI_API_KEY: string | undefined;
  readonly GEOAPIFY_API_KEY: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
