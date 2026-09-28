/**
 * MongoDB connection lifecycle.
 *
 * Phase 1 has no models and no collections. This module exists to prove one
 * thing end to end -- Express can reach MongoDB through Mongoose -- and to
 * decide the lifecycle policy that every later phase inherits.
 *
 * ## Connection lifecycle
 *
 * The connection is opened once during startup, before the HTTP server starts
 * listening, and closed once during shutdown. It is deliberately *not* opened
 * per request: opening a connection per request is the single most common
 * performance mistake in a Node/MongoDB application.
 *
 * ## Connection pooling
 *
 * At a high level: the driver keeps a pool of TCP connections to MongoDB and
 * lends one to each in-flight operation. Mongoose reuses that pool for
 * everything it does, so application code never sees a socket. Two practical
 * consequences worth knowing before Phase 12 (deployment):
 *
 *  - The pool size is a *server-side* limit, not a client one. If MongoDB is
 *    running on a free shared tier, the connection limit is low and a large pool
 *    will simply queue.
 *  - Idle connections still count against that limit, so `serverSelectionTimeoutMS`
 *    and an aggressive shutdown matter as soon as you run more than one process.
 *
 * ## Startup failure
 *
 * `connectToDatabase` rejects rather than retrying forever. A process that cannot
 * reach its database cannot serve requests, and exiting with a non-zero status
 * lets the supervisor (or a human) see the failure immediately, instead of a
 * server that accepts traffic and fails every call. See `server.ts`.
 */
import mongoose from 'mongoose';

/** Whether the database is currently usable. Reported, never thrown. */
export type DatabaseStatus = 'connected' | 'disconnected';

/**
 * How long to wait for a suitable server before giving up.
 *
 * The driver default is 30 seconds, which means a typo in `MONGODB_URI` looks
 * like a 30-second hang. Five seconds fails fast enough to feel immediate while
 * still tolerating a cold container start.
 */
const SERVER_SELECTION_TIMEOUT_MS = 5_000;

/**
 * Open the connection and resolve only once MongoDB is actually usable.
 *
 * Resolving on "connected" rather than on "the command was sent" is the
 * important part: it means the first real request will not pay the connection
 * cost, and a bad URI fails here rather than on a user's request.
 */
export async function connectToDatabase(uri: string): Promise<void> {
  // Registered before connecting so a connection that drops later is still
  // logged. Mongoose does not reject unhandled 'error' events on a connection,
  // but a silent disconnect is exactly the kind of failure that is expensive to
  // notice late.
  mongoose.connection.on('error', (error: Error) => {
    console.error(`[mongodb] connection error: ${error.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[mongodb] disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    console.info('[mongodb] reconnected');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
  });

  const { host, name } = mongoose.connection;
  console.log(`[mongodb] connected to "${name ?? 'default'}" at ${host ?? uri}`);
}

/** Close the connection and wait for the pool to drain. */
export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/**
 * Current connection state.
 *
 * Read fresh on every call rather than cached, because the value changes at
 * runtime. `readyState` is the driver's own view of the connection, so this
 * reports the truth even if a reconnect is in progress.
 */
export function getDatabaseStatus(): DatabaseStatus {
  // `ConnectionStates.connected` rather than the literal `1`: it is the driver's
  // own enum, so the comparison is typed, self-describing, and survives a driver
  // upgrade that renumbers the states.
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected
    ? 'connected'
    : 'disconnected';
}
