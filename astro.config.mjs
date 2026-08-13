// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  // Most pages (landing, signup) stay static/prerendered -- see Task 5's
  // zero-client-JS requirement. Pages that need to check auth state on the
  // server before rendering (src/pages/login.astro,
  // src/pages/auth/callback.astro) opt out per-page with
  // `export const prerender = false`, which is why an adapter is configured
  // here even though most routes remain static output.
  adapter: node({ mode: 'standalone' }),
});