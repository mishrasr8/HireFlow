/**
 * The Express application.
 *
 * `createApp` returns a configured app without starting a server or opening a
 * database connection. That single decision is what makes the API testable: a
 * test can build the whole app, drive it with Supertest in-process, and finish
 * in milliseconds. The alternative -- `app.listen()` inside module scope -- would
 * force every test to manage a real port and a real MongoDB.
 *
 * Middleware order below is load-bearing. Express runs middleware in the order
 * it is registered, so:
 *
 *  - `requestId` comes first, so every later failure has a correlation id.
 *  - `helmet` and `cors` come before any route, so headers are set even for
 *    errors and preflight requests.
 *  - the body parser comes before the routes, so a route can rely on `req.body`.
 *  - `notFoundHandler` and `errorHandler` come last, which is the only position
 *    where they can catch everything registered before them.
 */
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { noStore } from './middleware/noStore.js';
import { requestId } from './middleware/requestId.js';
import { createApiRouter } from './routes/index.js';
import type { AppDependencies } from './types/dependencies.js';

/**
 * Upper bound on a JSON request body.
 *
 * The auth endpoints are the first body-carrying routes (registration carries
 * a password), so this limit is now load-bearing: it is the cheapest possible
 * defence against memory exhaustion from a large body, and it bounds how much
 * input a handler can be asked to validate per request.
 */
const MAX_JSON_BODY_BYTES = '100kb';

/** How long a browser may cache a CORS preflight result, in seconds. */
const CORS_PREFLIGHT_MAX_AGE_SECONDS = 600;

export function createApp(deps: AppDependencies): Express {
  const app = express();

  // Do not advertise the framework. Removing one fingerprint costs nothing.
  app.disable('x-powered-by');

  app.use(requestId);

  // Registered before every route so the policy also covers error responses and
  // the 404 handler, not just successful ones. See `middleware/noStore.ts` for
  // why this API refuses to let the browser cache anything.
  app.use(noStore);

  app.use(
    helmet({
      // HSTS tells a browser to refuse plain HTTP for this host for a year. It
      // only means anything once TLS is actually terminated in front of the API,
      // and browsers ignore it on `localhost`, so sending it in development
      // would be a placebo that looks like a security control.
      strictTransportSecurity: deps.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  app.use(
    cors({
      // An explicit allowlist, never the wildcard.
      //
      // Phase 0 decision `D-011` requires this API to be called with credentials
      // (a session cookie). The CORS specification forbids combining
      // `Access-Control-Allow-Origin: *` with credentials, and browsers reject
      // the combination outright. A reflected allowlist is the correct control:
      // a request from an origin that is not listed simply receives no CORS
      // headers, and the browser blocks the response.
      origin: deps.env.CORS_ORIGINS,
      credentials: true,

      // GET (health) and POST (auth registration/login/logout). Listing methods
      // explicitly is a real control -- it limits what a hostile page can even
      // attempt cross-origin -- and it grows as routes are added.
      methods: ['GET', 'POST'],

      // `x-csrf-token` is required by the synchronizer-token CSRF defence
      // (`NFR-S-018`): the web app sends the token in this header on every
      // state-changing request, so the browser must be allowed to carry it in a
      // cross-origin call. Listing it here also means the CORS spec *requires*
      // a preflight for cross-origin POSTs carrying it, which the allowlist
      // below then refuses for unlisted origins -- a second, browser-enforced
      // layer on top of the server-side token check.
      allowedHeaders: ['Content-Type', 'x-csrf-token'],

      // Let the browser read the correlation id, so a user reporting a failure
      // can quote the exact request.
      exposedHeaders: ['X-Request-Id'],

      maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
    }),
  );

  app.use(express.json({ limit: MAX_JSON_BODY_BYTES }));

  app.use('/api', createApiRouter(deps));

  // Both of these must be registered last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
