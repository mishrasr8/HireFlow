/**
 * The graceful shutdown sequence, extracted so it can be tested.
 *
 * ## Why this is its own module
 *
 * `server.ts` runs `main()` at import time and calls `process.exit`, so neither
 * is testable: importing it would start a server, and testing it would end the
 * test runner. That is not a hypothetical concern -- it is the reason this file
 * exists. The *mechanics* of draining (stop accepting, release idle sockets,
 * close the database) have no process side effects, so they can be exercised
 * against a real listening socket in a real test.
 *
 * What remains in `server.ts` is only the genuinely process-bound part: binding
 * to signals and calling `process.exit`. The sequence itself is verified here.
 *
 * ## Why the order matters
 *
 * Stop accepting new connections *first*, then release the database. The other
 * order would accept requests while the connection pool is closing, and those
 * requests fail in ways that are very hard to diagnose in production.
 */
import type { Server } from 'node:http';

/**
 * Drain an HTTP server and then release the database.
 *
 * @param server - The listening server to stop.
 * @param closeDatabase - Called once no new requests can arrive.
 */
export async function drainServer(
  server: Server,
  closeDatabase: () => Promise<void>,
): Promise<void> {
  // `close()` stops the server accepting new connections. Its callback fires
  // when the last *existing* connection has finished, which is why the idle
  // sockets have to be released too.
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  // Browsers hold keep-alive sockets open for seconds between requests, so
  // without this `close()` waits for them and a shutdown appears to hang. Only
  // *idle* sockets are closed: a request already in flight is allowed to finish.
  server.closeIdleConnections();

  await closed;

  // No new request can start now, so it is safe to give up the connection pool.
  await closeDatabase();
}
