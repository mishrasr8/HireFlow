/**
 * Routes for the authentication and session resource.
 *
 * Like every route module, this file only binds a method and a path to
 * middleware and a controller; the meaning of the response lives in the service
 * and the controller. The parent router in `routes/index.ts` supplies the
 * `/auth` segment, so the full paths are `/api/auth/register`,
 * `/api/auth/login`, `/api/auth/me`, `/api/auth/csrf` and `/api/auth/logout`.
 *
 * ## Middleware per route
 *
 * - `register` and `login` are public (only `csrf`-free state-changing POSTs
 *   that establish or verify identity; they cannot be CSRF-attacked in a way
 *   the synchronizer token would fix -- there is no session to abuse yet).
 * - `me` and `csrf` are authenticated GETs: the session cookie is required and
 *   resolved, no CSRF token is demanded (read-only).
 * - `logout` is a state-changing POST: authenticated **and** CSRF-protected,
 *   exactly like any other protected mutation will be.
 */
import { Router } from 'express';

import { createAuthController } from '../controllers/auth.controller.js';
import { createAuthenticate } from '../middleware/authenticate.js';
import { createRequireCsrf } from '../middleware/csrf.js';
import type { AuthService } from '../services/auth.service.js';
import type { SessionService } from '../services/session.service.js';

export interface AuthRouterDependencies {
  readonly auth: AuthService;
  readonly sessions: SessionService;
  readonly secureCookies: boolean;
}

export function createAuthRouter(deps: AuthRouterDependencies): Router {
  const router = Router();
  const authController = createAuthController(deps);
  const authenticate = createAuthenticate(deps.auth, deps.sessions);
  const requireCsrf = createRequireCsrf(deps.sessions);

  router.post('/register', authController.register);
  router.post('/login', authController.login);

  // Authenticated, read-only: identity and CSRF-token issuance.
  router.get('/me', authenticate, authController.me);
  router.get('/csrf', authenticate, authController.getCsrfToken);

  // State-changing and therefore CSRF-protected.
  router.post('/logout', authenticate, requireCsrf, authController.logout);

  return router;
}