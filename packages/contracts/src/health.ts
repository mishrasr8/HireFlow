/**
 * The health endpoint contract.
 *
 * This is the first real contract in the system, and it exists to prove one
 * thing: a single definition is consumed by the server that must satisfy it and
 * by the client that must understand it. If the two ever disagree, the build or
 * the tests fail. That is the whole point of `packages/contracts`
 * (Phase 0 decision `DC-010`).
 */
import { z } from 'zod';

import { apiSuccessSchema } from './envelope.js';

/** Payload returned by `GET /api/health`. */
export const healthDataSchema = z.object({
  service: z.string().min(1),
  status: z.enum(['ok', 'degraded']),

  /** ISO-8601 timestamp. Lets a client detect a stale cached response. */
  timestamp: z.string().min(1),

  /** Seconds the API process has been running. Diagnostic only. */
  uptimeSeconds: z.number().nonnegative(),

  /**
   * Whether the MongoDB connection is currently usable.
   *
   * Reported rather than thrown: a liveness endpoint that fails to respond
   * because a dependency is down tells an operator nothing. The API always
   * answers, and the answer states what the real condition is.
   */
  database: z.enum(['connected', 'disconnected']),
});

export type HealthData = z.infer<typeof healthDataSchema>;

/**
 * Full successful body of `GET /api/health`.
 *
 * Inferred from the composed schema rather than hand-written, so the type and
 * the runtime validation cannot disagree -- a change to either changes both.
 */
export const healthResponseSchema = apiSuccessSchema(healthDataSchema);

export type HealthResponse = z.infer<typeof healthResponseSchema>;
