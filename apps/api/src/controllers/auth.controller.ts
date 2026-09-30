/**
 * HTTP adapter for registration, login, session and CSRF endpoints.
 *
 * A controller's responsibility is translating HTTP into a call and a result
 * back into HTTP. Everything else -- hashing, duplicate handling, session
 * creation, the generic failure message -- lives in services. Validation
 * happens here by parsing the request body against the shared contract; a
 * `ZodError` thrown by `.parse()` flows to `next(error)` and is turned into a
 * 400 with field-level detail by the centralized error handler.
 *
 * ## Login now creates a session (`FR-088`, `FR-094`)
 *
 * The exact sequence is security-conscious:
 *
 * ```text
 * validate credentials
 *   ↓ create a fresh random session identifier
 *   ↓ hash it, enforce the 5-session cap, persist
 *   ↓ set the HttpOnly session cookie
 *   ↓ return the safe authenticated-user response
 * ```
 *
 * A login never reuses an existing session: every successful login creates a
 * brand-new identifier, which is the session-fixation defence (`FR-094`). The
 * response body carries only the safe user -- the session identifier travels
 * exclusively in the cookie and never appears in JSON (`FR-090`, `NFR-S-003`).
 *
 * ## The CSRF token is issued, not embedded in auth responses
 *
 * The synchronizer CSRF token (`NFR-S-018`) is returned by `GET /api/auth/csrf`
 * (an authenticated, read-only endpoint), *not* smuggled into the login or
 * register response. That keeps every auth response body free of session
 * material, per the contracts' stated rule, and separates the two secrets
 * cleanly: the HttpOnly cookie authenticates, the header token proves intent.
 */
import type { NextFunction, Request, Response } from 'express';

import {
  loginRequestSchema,
  registerRequestSchema,
  type CsrfTokenResponse,
  type LoginResponse,
  type MeResponse,
  type RegisterResponse,
} from '@hireflow/contracts';

import { ApiError } from '../errors/apiError.js';
import type { AuthService } from '../services/auth.service.js';
import type { SessionService } from '../services/session.service.js';
import {
  clearSessionCookie,
  readSessionIdentifier,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '../utils/sessionCookie.js';

export interface AuthControllerDependencies {
  readonly auth: AuthService;
  readonly sessions: SessionService;
  /** Whether the session cookie must carry `Secure` (true only in production). */
  readonly secureCookies: boolean;
}

export function createAuthController(deps: AuthControllerDependencies) {
  async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = registerRequestSchema.parse(req.body);
      const data = await deps.auth.registerUser(input);
      const body: RegisterResponse = { success: true, data };
      res.status(201).json(body);
    } catch (error: unknown) {
      next(error);
    }
  }

  async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginRequestSchema.parse(req.body);

      // 1. Credentials first. Nothing below runs unless they are valid.
      const user = await deps.auth.verifyLogin(input);

      // 2. A fresh session, always: never reuse an identifier that exists
      //    before authentication (session-fixation defence, FR-094).
      const session = await deps.sessions.createSession(user.id, new Date());

      // 3. The identifier leaves the server only through this HttpOnly cookie.
      res.cookie(SESSION_COOKIE_NAME, session.identifier, sessionCookieOptions(deps.secureCookies));

      // 4. The response carries the safe user and nothing else.
      const body: LoginResponse = { success: true, data: user };
      res.status(200).json(body);
    } catch (error: unknown) {
      next(error);
    }
  }

  /**
   * The authenticated user's own identity (`req.user` was attached by the
   * authentication middleware). This is the minimal protected endpoint: it is
   * what every later protected route will build on.
   */
  async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user === undefined) {
        // Defensive: the route is guarded by `authenticate`, so this branch is
        // unreachable unless the middleware chain changes.
        next(ApiError.unauthenticated());
        return;
      }

      const body: MeResponse = { success: true, data: req.user };
      res.status(200).json(body);
    } catch (error: unknown) {
      next(error);
    }
  }

  /**
   * Issue the synchronizer CSRF token for the current session (`NFR-S-018`).
   *
   * Read-only and authenticated. The endpoint is safe to call repeatedly: the
   * service returns the session's stored token rather than rotating it, so a
   * second browser tab cannot invalidate the first tab's token mid-session.
   */
  async function getCsrfToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const identifier = readSessionIdentifier(req);
      if (identifier === undefined) {
        // Defensive: the `authenticate` middleware guarantees a session.
        next(ApiError.unauthenticated());
        return;
      }

      const token = await deps.sessions.getCsrfToken(identifier);
      const body: CsrfTokenResponse = { success: true, data: { token } };
      res.status(200).json(body);
    } catch (error: unknown) {
      next(error);
    }
  }

  /**
   * Logout (`FR-092`): delete the server-side session and clear the cookie.
   *
   * The session is deleted, not merely marked -- a replayed identifier then
   * finds nothing (the strongest form of invalidation). The cookie is cleared
   * regardless. Repeated logout is a clean 401 (there is no session to end),
   * never a server error.
   */
  async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const identifier = readSessionIdentifier(req);
      if (identifier !== undefined) {
        // The `authenticate` middleware resolved this identifier just before,
        // so this deletes the live session. Idempotent at the store level.
        await deps.sessions.revokeByIdentifier(identifier);
      }

      clearSessionCookie(res);
      res.status(204).end();
    } catch (error: unknown) {
      next(error);
    }
  }

  return { register, login, me, getCsrfToken, logout };
}