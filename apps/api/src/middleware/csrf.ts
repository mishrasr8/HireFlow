/**
 * Synchronizer-token CSRF middleware (`NFR-S-018`, `OQ-025`).
 *
 * ## Why this exists at all
 *
 * A browser attaches session cookies automatically, so any site can make a
 * victim's browser send an *authenticated* request. `SameSite=Lax` blocks the
 * most common cases but is explicitly **not** the complete defence (older
 * browsers, subdomain boundaries, top-level navigations) -- the requirement is
 * a real proof on every state-changing request. The synchronizer-token pattern
 * is that proof: the client must present, in a request header, the CSRF token
 * the server issued for this session.
 *
 * ## What is checked
 *
 * For state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`):
 *
 * 1. read the session identifier from the cookie (set by the authentication
 *    middleware that runs before this one);
 * 2. read the token from the `X-CSRF-Token` header (`CSRF_TOKEN_HEADER`,
 *    shared via the contracts package so the frontend and backend literally
 *    cannot disagree on the name);
 * 3. compare it in constant time against the token stored on the session
 *    record; missing token or mismatch → `403 FORBIDDEN`.
 *
 * Safe/read-only methods (`GET`, `HEAD`, `OPTIONS`) pass through untouched: the
 * CSRF token is deliberately *not* required where no state can be changed.
 *
 * ## What the token is not
 *
 * The CSRF token is not the session identifier and carries no identity or
 * authority. It is issued over an authenticated channel (`GET /api/auth/csrf`),
 * so an attacker-controlled origin cannot obtain it: the response is governed
 * by the CORS allowlist, and the token is useless without the HttpOnly session
 * cookie anyway. Cross-origin requests carrying the header are additionally
 * rejected at the CORS preflight step, because `x-csrf-token` is an explicit
 * allowed header only for listed origins (`APP` configuration in `app.ts`).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { CSRF_TOKEN_HEADER } from '@hireflow/contracts';

import { ApiError } from '../errors/apiError.js';
import type { SessionService } from '../services/session.service.js';
import { readSessionIdentifier } from '../utils/sessionCookie.js';

/** HTTP methods that may change server state; they require CSRF proof. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isStateChanging(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method);
}

/** Build the middleware. The session service is injected for offline tests. */
export function createRequireCsrf(sessions: SessionService): RequestHandler {
  return async function requireCsrf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!isStateChanging(req.method)) {
        next();
        return;
      }

      const identifier = readSessionIdentifier(req);
      const presentedToken = req.get(CSRF_TOKEN_HEADER);

      const valid =
        identifier !== undefined && presentedToken !== undefined
          ? await sessions.validateCsrfToken(identifier, presentedToken)
          : false;

      if (!valid) {
        // One generic message for both "missing" and "invalid": distinguishable
        // errors teach an attacker which half of the defence is armed.
        next(ApiError.forbidden('CSRF token missing or invalid'));
        return;
      }

      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}