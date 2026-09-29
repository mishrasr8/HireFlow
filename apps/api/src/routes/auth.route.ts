/**
 * Routes for the authentication resource.
 *
 * Like every route module, this file only binds a method and a path to a
 * controller; the meaning of the response lives in the service and the
 * controller. The parent router in `routes/index.ts` supplies the `/auth`
 * segment, so the full paths are `/api/auth/register` and `/api/auth/login`.
 */
import { Router } from 'express';

import { createAuthController } from '../controllers/auth.controller.js';
import type { AuthService } from '../services/auth.service.js';

export function createAuthRouter(auth: AuthService): Router {
  const router = Router();
  const authController = createAuthController(auth);

  router.post('/register', authController.register);
  router.post('/login', authController.login);

  return router;
}
