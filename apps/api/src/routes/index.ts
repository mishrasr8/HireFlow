/**
 * Mounts every route under `/api`.
 *
 * Adding an endpoint to the API means adding one line here. Nothing else in the
 * file needs to change, and a new route module never has to know where it is
 * mounted.
 */
import { Router } from 'express';

import type { AppDependencies } from '../types/dependencies.js';
import { createAuthRouter } from './auth.route.js';
import { createHealthRouter } from './health.route.js';

export function createApiRouter(deps: AppDependencies): Router {
  const router = Router();

  router.use('/health', createHealthRouter(deps.getDatabaseStatus));
  router.use('/auth', createAuthRouter(deps.auth));

  return router;
}
