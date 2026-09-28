/**
 * Process entry point: everything that only makes sense for a running server.
 *
 * The split with `app.ts` is deliberate. `app.ts` builds an Express
 * application; this file starts a *process*. Loading configuration, opening a
 * database connection, listening on a port and handling signals all have side
 * effects on the machine, and none of them belong in a module that a test
 * imports. Keeping them here means importing `app.ts` is free of side effects.
 */
import type { Server } from 'node:http';

import { createApp } from './app.js';
import { connectToDatabase, disconnectFromDatabase, getDatabaseStatus } from './config/database.js';
import { loadEnv } from './config/env.js';
import { SERVICE_NAME } from './services/health.service.js';
import { drainServer } from './shutdown.js';

/**
 * How long a graceful shutdown may take before the process gives up.
 *
 * Without this, a single connection that refuses to close would keep the
 * process alive forever -- the failure mode where a deploy hangs and someone
 * eventually reaches for `kill -9`.
 */
const SHUTDOWN_GRACE_PERIOD_MS = 10_000;

/**
 * Drain connections, close the database, then exit.
 *
 * The draining itself lives in `shutdown.ts` so that it can be tested against a
 * real socket. What remains here is only the part that genuinely needs a
 * process: a watchdog timer and `process.exit`.
 */
async function drainAndExit(server: Server): Promise<void> {
  // A connection that refuses to close would otherwise keep the process alive
  // forever -- the failure mode where a deploy hangs and someone eventually
  // reaches for `kill -9`.
  const forceExit = setTimeout(() => {
    console.error('[api] graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_GRACE_PERIOD_MS);

  // `unref` stops this timer from holding the event loop open on its own.
  forceExit.unref();

  try {
    await drainServer(server, disconnectFromDatabase);
    console.log('[api] shutdown complete');
  } catch (error: unknown) {
    console.error('[api] error during shutdown:', error);
  } finally {
    clearTimeout(forceExit);
  }

  process.exit(0);
}

/**
 * React to the two signals a process manager actually sends.
 *
 * `SIGINT` is Ctrl+C. `SIGTERM` is what Docker, Kubernetes and systemd send on
 * a stop or a deploy. Handling only `SIGINT` is the classic mistake: the server
 * then dies mid-request on every deploy.
 */
function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const onSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (shuttingDown) {
      console.warn(`[api] ${signal} received again, already shutting down`);
      return;
    }

    shuttingDown = true;
    console.log(`[api] ${signal} received, draining connections`);

    void drainAndExit(server);
  };

  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
}

async function main(): Promise<void> {
  // 1. Configuration first. There is no point opening a socket if we do not yet
  //    know which port to open it on. `loadEnv` throws with a readable message,
  //    which the catch below turns into a non-zero exit.
  const env = loadEnv();

  // 2. Database before listening. The API cannot do anything useful without
  //    MongoDB, so accepting traffic we would immediately fail to serve only
  //    produces confusing downstream errors. `connectToDatabase` rejects on a
  //    bad URI within `serverSelectionTimeoutMS`, so a typo is reported as a
  //    startup failure rather than a hang.
  await connectToDatabase(env.MONGODB_URI);

  // 3. Only now accept traffic.
  const app = createApp({ env, getDatabaseStatus });

  const server = app.listen(env.PORT, () => {
    console.log(
      `[api] ${SERVICE_NAME} listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`,
    );
  });

  // Most commonly EADDRINUSE. Without this, the rejection surfaces as an
  // unhandled error and the process dies with no explanation.
  server.on('error', (error: Error) => {
    console.error(`[api] HTTP server error: ${error.message}`);
    process.exit(1);
  });

  installShutdownHandlers(server);
}

main().catch((error: unknown) => {
  console.error('[api] failed to start:', error instanceof Error ? error.message : error);

  // A process that cannot start cannot recover, and exiting non-zero is what
  // tells a supervisor (or CI) that the failure happened.
  process.exit(1);
});
