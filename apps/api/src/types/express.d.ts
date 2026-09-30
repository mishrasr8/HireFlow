/**
 * Type augmentation for Express.
 *
 * Express has no built-in slot for a correlation id or an authenticated user,
 * and threading them through every handler would be noise. Declaring the
 * properties on Express's own `Request` interface is the idiomatic solution:
 * each property is then typed everywhere `Request` is used, and each is
 * genuinely absent until its middleware sets it.
 *
 * The empty `export {}` marks this file as a module, which is what allows
 * `declare global` to be used here instead of leaking into the global scope of
 * every file in the project.
 */
import type { UserResponse } from '@hireflow/contracts';

declare global {
  namespace Express {
    interface Request {
      /**
       * Unique id for this request, assigned by `requestId` middleware.
       *
       * It appears in every error response and in every server log line for
       * this request, so a user can quote one string and an engineer can find
       * the exact failure. See `NFR-S-006` in the Phase 0 requirements.
       */
      requestId: string;

      /**
       * The authenticated user, attached by `middleware/authenticate.ts`.
       *
       * Absent until authentication resolves the session successfully; a route
       * guarded by the middleware can rely on it being defined. It is the safe
       * `UserResponse` shape -- never the password hash -- and it is exactly
       * what the authorization layer will read in a later phase.
       */
      user?: UserResponse;
    }
  }
}

export {};