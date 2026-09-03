import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Vite has no built-in loader for .geojson; treat it as a JSON module. */
function geojson(): Plugin {
  return {
    name: 'geojson-loader',
    load(id) {
      if (!id.endsWith('.geojson')) return null;
      const json = readFileSync(id.split('?')[0]!, 'utf8');
      return { code: `export default ${json.trim()};`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), geojson()],
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // The campus extract and the two libraries change on completely
        // different schedules from the app, so they get their own chunks and
        // stay in the browser cache across deploys.
        manualChunks: {
          leaflet: ['leaflet'],
          supabase: ['@supabase/supabase-js'],
          campus: ['./src/data/campus.ts'],
        },
      },
    },
  },
  server: {
    host: true,
    // Pinned, and strict rather than falling through to the next free port:
    // the OAuth redirect allow-list in Supabase has to name an exact origin,
    // and a dev server that quietly moves to :5174 breaks sign-in.
    port: 5173,
    strictPort: true,
  },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
