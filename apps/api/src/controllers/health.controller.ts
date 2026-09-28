/**
 * HTTP adapter for the health check.
 *
 * A controller's whole responsibility is translating HTTP into a call and a
 * result back into HTTP. If you ever find business logic here, that logic
 * belongs in `services/`.
 */
import type { HealthResponse } from '@hireflow/contracts';
import type { Request, Response } from 'express';

import type { DatabaseStatus } from '../config/database.js';
import { buildHealthSnapshot } from '../services/health.service.js';

/**
 * The endpoint is created by a factory because it needs the database status,
 * and passing that in as an argument keeps the module free of module-level
 * state -- which is what makes the test suite able to simulate a database
 * outage without mocking Mongoose.
 */
export function createHealthController(getDatabaseStatus: () => DatabaseStatus) {
  return function health(_req: Request, res: Response): void {
    // The body is declared as the shared `HealthResponse` type. That is a
    // compile-time guarantee only; the contract's Zod schema is what proves the
    // response actually matches at runtime, and the API test does exactly that.
    const body: HealthResponse = {
      success: true,
      data: buildHealthSnapshot(getDatabaseStatus),
    };

    res.status(200).json(body);
  };
}
