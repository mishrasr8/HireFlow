/**
 * Authentication middleware: resolves the session cookie into an authenticated
 * user, or rejects the request.
 *
 * ## What this middleware answers -- and what it deliberately does not
 *
 * Authentication answers **who is this user?** It does not answer **what may
 * this user do?** No capability check, no company-membership check, no
 * role logic lives here (`NFR-S-001`). Authorization is a later, separate
 * layer that runs after this one and reads `req.user`.
 *
 * ## The resolution sequence (`FR-091`)
 *
 * 1. read the session identifier from the cookie
 *    (missing → 401 -- no credentials at all);
 * 2. SHA-256 the presented identifier (the only value ever stored/queried);
 * 3. look the session up by `tokenHash` (unknown → 401);
 * 4. enforce the absolute 7-day expiry (`expiresAt`);
 * 5. enforce the 3-day idle timeout (`lastUsedAt`);
 *    -- an expired or idle session is revoked on the spot, so it cannot
 *    authenticate even before the TTL physically deletes the document;
 * 6. load the user the session points at; a session whose user no longer
 *    exists is an orphan, so it is revoked and treated as unauthenticated;
 * 7. attach the safe user to `req.user` (the request context);
 * 8. record activity (`lastUsedAt`), which refreshes the idle clock but can
 *    never extend `expiresAt` (`OQ-025`).
 *
 * Every failure path produces the identical generic 401: never "the session
 * expired" vs "unknown session" -- telling the caller which one it was is
 * reconnaissance for an attacker.
 *
 * The raw session identifier is never logged, stored, or placed in the
 * response (`NFR-S-003`); only its hash passes through the database boundary.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ApiError } from '../errors/apiError.js';
import type { AuthService } from '../services/auth.service.js';
import type { SessionService } from '../services/session.service.js';
import { readSessionIdentifier } from '../utils/sessionCookie.js';

/**
 * Build the middleware. The session and auth services are injected so the
 * middleware never touches Mongoose and can be tested with fakes.
 */
export function createAuthenticate(auth: AuthService, sessions: SessionService): RequestHandler {
  return async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const identifier = readSessionIdentifier(req);
      if (identifier === undefined) {
        next(ApiError.unauthenticated());
        return;
      }

      // Hashing happens here so the store only ever sees the hash -- a request
      // with a malformed cookie simply looks up (and fails to find) nothing.
      const session = await sessions.resolveIdentifier(identifier, new Date());
      if (session === null) {
        next(ApiError.unauthenticated());
        return;
      }

      const user = await auth.getUserById(session.userId);
      if (user === null) {
        // Orphaned session (the user account is gone): revoke it rather than
        // leaving a live document that can never authenticate again.
        await sessions.revokeByIdentifier(identifier);
        next(ApiError.unauthenticated());
        return;
      }

      req.user = user;

      // Refresh the idle clock. `updateLastUsedAt` touches only `lastUsedAt`;
      // the absolute 7-day lifetime is untouched by construction (OQ-025).
      await sessions.recordUsage(session.sessionId, new Date());

      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}