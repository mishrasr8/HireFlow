/**
 * Type augmentation for Express.
 *
 * Express has no built-in slot for a correlation id, and threading a fourth
 * parameter through every handler to carry one would be noise. Declaring the
 * property on Express's own `Request` interface is the idiomatic solution: the
 * property is then typed everywhere `Request` is used, and it is genuinely
 * absent until `middleware/requestId.ts` sets it.
 *
 * The empty `export {}` marks this file as a module, which is what allows
 * `declare global` to be used here instead of leaking into the global scope of
 * every file in the project.
 */

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
    }
  }
}

export {};
