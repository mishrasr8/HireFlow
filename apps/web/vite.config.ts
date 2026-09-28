/**
 * Vite configuration.
 *
 * Two things here are worth understanding.
 *
 * ## `envDir: '../..'`
 *
 * Hireflow keeps exactly one `.env`, at the repository root, because there is
 * exactly one set of values that describes the whole system. Vite defaults to
 * reading `.env` from its own root (`apps/web`), which would force a second file
 * and create the question "which one do I edit?". Pointing `envDir` at the
 * workspace root lets the web app and the API read the same file, exactly as the
 * API does via `config/env.ts`.
 *
 * ## Vitest settings
 *
 * `environment: 'jsdom'` because these are DOM tests. React Testing Library is
 * used rather than Enzyme because it tests what a user can perceive -- rendered
 * text and accessible roles -- rather than component internals, so a refactor
 * that changes the implementation without changing the UI does not break tests.
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const DEV_PORT = 5173;
const PREVIEW_PORT = 4173;

export default defineConfig({
  envDir: '../..',

  plugins: [react(), tailwindcss()],

  server: {
    port: DEV_PORT,
    // Fail loudly instead of silently moving to 5174. A moved port breaks the
    // CORS allowlist, which is confusing in a way that a hard error is not.
    strictPort: true,
  },

  preview: {
    port: PREVIEW_PORT,
    strictPort: true,
  },

  build: {
    outDir: 'dist',
    // Source maps in a portfolio build make it possible to show that the
    // TypeScript in the repository is the TypeScript that runs.
    sourcemap: true,
  },

  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
