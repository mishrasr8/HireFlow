/**
 * Assembles the health snapshot.
 *
 * This is the "services" layer in its smallest honest form. It contains no
 * HTTP concepts -- no `Request`, no `Response`, no status code -- because the
 * question "is the system healthy?" is a question about the system, not about
 * HTTP. The controller's only job is to put this object on the wire.
 *
 * It is worth being clear that this is not an empty layer created to satisfy a
 * diagram: the `ok` versus `degraded` decision below is real logic, and it is
 * exactly the kind of decision that would otherwise end up inside a controller
 * by accident and become impossible to test or reuse.
 */
import type { HealthData } from '@hireflow/contracts';

import type { DatabaseStatus } from '../config/database.js';

/** Identifies this service in health output and in logs. */
export const SERVICE_NAME = 'hireflow-api';

export function buildHealthSnapshot(getDatabaseStatus: () => DatabaseStatus): HealthData {
  const database = getDatabaseStatus();

  return {
    service: SERVICE_NAME,

    // "degraded", not "failed". The process is alive and answering correctly;
    // one of its dependencies is not. A liveness probe that returned an error
    // here would cause an orchestrator to kill a process that is still able to
    // serve everything that does not need MongoDB. The state is reported so a
    // human or a readiness probe can act on it.
    status: database === 'connected' ? 'ok' : 'degraded',

    // ISO-8601, always UTC. Lets a client detect a cached or stale response.
    timestamp: new Date().toISOString(),

    // Rounded to milliseconds so the value is stable in JSON and in snapshots.
    uptimeSeconds: Math.round(process.uptime() * 1000) / 1000,

    database,
  };
}
