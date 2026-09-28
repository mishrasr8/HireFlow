/**
 * Runtime validation and loading of process configuration.
 *
 * This module is the concrete answer to the Phase 0 requirement that
 * "compile-time safety and runtime safety are separate concerns".
 *
 * `Env` below is a TypeScript type, so `process.env.PORT` being a `string` at
 * compile time tells us nothing about whether it is `"4000"`, `"four thousand"`,
 * or absent. Zod is what turns the untyped, untrusted `process.env` object into
 * a value of type `Env` that the rest of the program may trust.
 *
 * If this file did not exist, `process.env.PORT` would be `string | undefined`
 * everywhere and every consumer would have to re-check it. That is the exact
 * bug class `DC-004` asks us to remove, so the check happens once, here.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotEnvFile } from 'dotenv';
import { z } from 'zod';

/**
 * Accepted MongoDB URI schemes.
 *
 * Checking the scheme catches the most common misconfiguration -- pasting a
 * Postgres or Redis URL into a MongoDB variable -- at startup, with a message
 * that says what is wrong, instead of as an opaque driver error later.
 */
const MONGODB_URI_SCHEMES = ['mongodb://', 'mongodb+srv://'] as const;

const mongoUriSchema = z
  .string()
  .min(1, 'MONGODB_URI must not be empty')
  .refine((value) => MONGODB_URI_SCHEMES.some((scheme) => value.startsWith(scheme)), {
    message: `MONGODB_URI must start with one of: ${MONGODB_URI_SCHEMES.join(', ')}`,
  });

/**
 * Comma-separated origin list, parsed into a real array.
 *
 * Doing the splitting here means the rest of the program only ever handles
 * `string[]`. It also means a trailing comma or a stray space is tolerated,
 * which is the difference between a working setup and a puzzling CORS failure.
 */
const corsOriginsSchema = z
  .string()
  .min(1, 'CORS_ORIGINS must list at least one origin')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .refine((origins) => origins.length > 0, {
    message: 'CORS_ORIGINS must list at least one origin',
  });

/**
 * The schema every environment must satisfy.
 *
 * Note that `PORT` is coerced, not merely validated. `process.env` can only ever
 * hold strings, so demanding a number would reject every valid value. Coercion
 * is the honest way to convert, and validating the *result* still catches
 * `PORT=abc` and `PORT=99999`.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce
    .number()
    .int('PORT must be a whole number')
    .min(1, 'PORT must be at least 1')
    .max(65535, 'PORT must be at most 65535'),
  MONGODB_URI: mongoUriSchema,
  CORS_ORIGINS: corsOriginsSchema,
});

/** Fully validated, trustworthy configuration. */
export type Env = z.infer<typeof envSchema>;

/**
 * Validate an arbitrary object as `Env`, failing with a message a human can act on.
 *
 * `zod`'s own error output is a JSON dump of internal issues. At startup that is
 * worse than useless: it buries the one fact the developer needs, which is
 * which variable to fix. This formats the issues as a short list and points at
 * `.env.example`.
 */
export function parseEnv(source: unknown): Env {
  const result = envSchema.safeParse(source);

  if (result.success) {
    return result.data;
  }

  const lines = result.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  - ${key}: ${issue.message}`;
  });

  throw new Error(
    `Invalid environment configuration:\n${lines.join('\n')}\n\n` +
      'Copy .env.example to .env and fill in every value, or export the variables directly.',
  );
}

/**
 * Walk up from this module until we find the workspace root.
 *
 * The root is identified by the one package.json that declares `workspaces`.
 * This is used so the API can find a single root-level `.env` regardless of
 * whether it is running from `src` (tsx, development) or `dist` (node, after a
 * build) -- the module sits at a different depth in each case, so a fixed
 * `../../..` would break one of them.
 */
function findWorkspaceRoot(startDir: string): string {
  let current = startDir;

  for (;;) {
    const manifest = path.join(current, 'package.json');

    if (existsSync(manifest)) {
      const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));

      // `'workspaces' in parsed` narrows `unknown` to an object we can inspect,
      // so no type assertion is needed.
      if (typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed) {
        return current;
      }
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new Error(
        'Could not locate the Hireflow workspace root: no package.json declaring "workspaces" was found above this file.',
      );
    }

    current = parent;
  }
}

/**
 * Load and validate configuration from the single root `.env`.
 *
 * `dotenv` never overwrites a variable that is already set, which gives the
 * right precedence for free: real environment variables (CI, Docker, a hosted
 * platform) beat the local file. That is the behaviour we want, and it is why
 * no explicit merge logic is needed.
 */
export function loadEnv(): Env {
  const workspaceRoot = findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
  const envFile = path.join(workspaceRoot, '.env');

  if (existsSync(envFile)) {
    loadDotEnvFile({ path: envFile, quiet: true });
  }

  return parseEnv(process.env);
}
