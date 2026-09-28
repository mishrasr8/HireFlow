/// <reference types="vite/client" />

/**
 * Type-safe access to build-time environment variables.
 *
 * Vite declares `ImportMetaEnv` with a catch-all string index signature, which
 * means `import.meta.env.VITE_ANYTHING` type-checks even when the variable is
 * never set. Declaring the variables we actually use turns a silent `undefined`
 * into a compile error the first time someone reads them.
 *
 * `VITE_`-prefixed variables are the only ones Vite exposes to the browser, and
 * anything exposed this way is public by definition. No secret may ever be named
 * with that prefix -- see `.env.example` and `NFR-S-012`.
 *
 * Not marked `readonly`, because the test setup writes this value before any
 * module reads it, so that the test suite does not depend on a local `.env`
 * file that is deliberately not committed.
 */
interface ImportMetaEnv {
  VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
