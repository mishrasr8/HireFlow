/**
 * The complete set of things the HTTP layer is allowed to know about the rest
 * of the system.
 *
 * This is the project's dependency-inversion seam. The HTTP layer asks for
 * "what is the database doing?" through a function it is given, rather than
 * importing Mongoose. Two things fall out of that:
 *
 *  1. Tests can drive any database state without a live MongoDB, which is why
 *     the health tests are fast and deterministic.
 *  2. The Express code has no compile-time knowledge of Mongoose, so swapping
 *     the database driver would not touch a single line of route or controller
 *     code.
 *
 * It lives in its own file rather than in `app.ts` so that `routes/` and
 * `app.ts` can both depend on it without importing each other.
 */
import type { DatabaseStatus } from '../config/database.js';
import type { Env } from '../config/env.js';
import type { AuthService } from '../services/auth.service.js';

export interface AppDependencies {
  /** Validated, immutable process configuration. */
  readonly env: Env;

  /** Current MongoDB connection state, read fresh on every call. */
  readonly getDatabaseStatus: () => DatabaseStatus;

  /**
   * Authentication operations (registration, credential verification).
   *
   * Backed by MongoDB through `createUserStore()` in production; faked in
   * tests, which is what keeps the auth endpoint tests offline. The HTTP layer
   * never imports Mongoose; it only knows this interface.
   */
  readonly auth: AuthService;
}
