/**
 * Routes for the health resource.
 *
 * A route module's only job is to bind a method and a path to a controller.
 * Everything else -- what the response means, how failures are shaped -- lives
 * elsewhere. When a route file starts doing work, that work usually belongs in
 * a service.
 */
import { Router } from 'express';

import type { DatabaseStatus } from '../config/database.js';
import { createHealthController } from '../controllers/health.controller.js';

export function createHealthRouter(getDatabaseStatus: () => DatabaseStatus): Router {
  const router = Router();
  const health = createHealthController(getDatabaseStatus);

  // Registered at `/` because the parent router supplies the `/health` segment.
  // The full path is therefore `/api/health`, composed from the mount point in
  // `routes/index.ts` and this one line. Declaring the segment in both places
  // would silently produce `/api/health/health`.
  router.get('/', health);

  return router;
}
