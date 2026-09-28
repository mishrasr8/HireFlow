/**
 * Graceful shutdown tests.
 *
 * These exercise the *real* mechanics against a real listening socket on an
 * ephemeral port: an actual `http.Server` is started, actually drained, and then
 * checked. Nothing is mocked, because the properties being verified here --
 * "the port stops accepting" and "the database is released last" -- only exist at
 * the socket level. A mock would assert that the code called the functions it
 * was written to call, which is a restatement of the source, not a test.
 *
 * What is *not* covered here is the delivery of `SIGINT`/`SIGTERM` to the
 * process, because on Windows a signal cannot be sent to another process. That
 * part lives in `server.ts` and is verified on Linux/macOS or in a container.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { drainServer } from './shutdown.js';

/** Start a real server on a free port and return it with that port. */
async function startServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });

  await new Promise<void>((resolve) => {
    // Port 0 asks the operating system for a free port, so parallel test runs
    // cannot collide and the test needs no configuration.
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;

  return { server, origin: `http://127.0.0.1:${address.port}` };
}

describe('drainServer', () => {
  it('stops the server accepting new connections', async () => {
    const { server, origin } = await startServer();

    // Confirm it really was serving before draining, so a later failure cannot
    // be a server that never started.
    await expect(fetch(origin)).resolves.toBeInstanceOf(Response);

    await drainServer(server, () => Promise.resolve());

    expect(server.listening).toBe(false);
    // The observable version of the same fact: the port is closed, so a client
    // gets a connection error rather than a hung request.
    await expect(fetch(origin)).rejects.toThrow();
  });

  it('closes the database only after no new request can arrive', async () => {
    const { server } = await startServer();

    let listeningDuringDatabaseClose: boolean | null = null;

    await drainServer(server, () => {
      listeningDuringDatabaseClose = server.listening;
      return Promise.resolve();
    });

    // Releasing the connection pool while the server can still accept requests
    // would let a request arrive with no pool to serve it.
    expect(listeningDuringDatabaseClose).toBe(false);
  });

  it('propagates a database close failure so the caller can log it', async () => {
    const { server } = await startServer();

    // Swallowing this would produce a process that exits "successfully" while
    // its connection pool was never released.
    await expect(
      drainServer(server, () => Promise.reject(new Error('connection pool close failed'))),
    ).rejects.toThrow('connection pool close failed');
  });
});
