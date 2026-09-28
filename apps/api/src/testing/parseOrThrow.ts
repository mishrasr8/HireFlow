/**
 * Test helpers that must never ship to production.
 *
 * Kept in one place, and excluded from the build in `tsconfig.build.json`, so
 * that a test-only dependency can never be reached from `dist/`.
 */
import type { z } from 'zod';

/**
 * Unwrap a Zod result, or throw with the reason.
 *
 * This exists because of a genuine testing trap. Writing
 * `if (!result.success) return;` after asserting `result.success` makes the test
 * *pass silently* when the shape is wrong: the assertion fails first, so the
 * outcome is still correct, but the type is never narrowed and every later
 * line has to be defensively written. Throwing instead narrows the type
 * properly and keeps the rest of the test clean.
 */
export function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (!result.success) {
    throw new Error(`Value did not match the expected shape:\n${result.error.message}`);
  }

  return result.data;
}
