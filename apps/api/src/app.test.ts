/**
 * End-to-end tests for the HTTP surface.
 *
 * These drive the real Express application in-process with Supertest. There is
 * no database, no port, and no network: `createApp` is handed a function that
 * reports whatever database state the test wants, which is why a "database is
 * down" case is as cheap and as reliable as a normal one.
 *
 * The health assertions validate the body against the *shared* Zod contract
 * rather than against a hand-written copy of the expected JSON. That means these
 * tests fail if the server and the client contract ever drift apart, which is
 * the entire reason `packages/contracts` exists.
 */
import { apiFailureSchema, healthResponseSchema } from '@hireflow/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { REQUEST_ID_HEADER } from './middleware/requestId.js';
import { createFakeAuthService } from './testing/fakeAuth.js';
import { parseOrThrow } from './testing/parseOrThrow.js';
import type { AppDependencies } from './types/dependencies.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const DISALLOWED_ORIGIN = 'https://not-hireflow.example';

const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: 4000,
  MONGODB_URI: 'mongodb://127.0.0.1:27017/hireflow-test',
  CORS_ORIGINS: [ALLOWED_ORIGIN],
} satisfies AppDependencies['env'];

/** Build the app in a known database state. */
function buildApp(database: 'connected' | 'disconnected' = 'connected') {
  return createApp({
    env: TEST_ENV,
    getDatabaseStatus: () => database,
    auth: createFakeAuthService(),
  } satisfies AppDependencies);
}

/**
 * Build an app whose database check throws, which is a genuine unexpected error
 * inside the request pipeline rather than a simulated one.
 */
function buildAppThatFails(nodeEnv: AppDependencies['env']['NODE_ENV']) {
  return createApp({
    env: { ...TEST_ENV, NODE_ENV: nodeEnv },
    getDatabaseStatus: () => {
      throw new Error('connection pool exhausted at 10.0.0.5:27017');
    },
    auth: createFakeAuthService(),
  } satisfies AppDependencies);
}

describe('GET /api/health', () => {
  it('responds 200 with a body that satisfies the shared contract', async () => {
    const response = await request(buildApp()).get('/api/health');

    expect(response.status).toBe(200);

    // Validating against the contract, not against a literal, is the point.
    const body = parseOrThrow(healthResponseSchema.safeParse(response.body));

    expect(body.success).toBe(true);
    expect(body.data.service).toBe('hireflow-api');
    expect(body.data.status).toBe('ok');
    expect(body.data.database).toBe('connected');
  });

  it('reports status ok and database connected when MongoDB is up', async () => {
    const response = await request(buildApp('connected')).get('/api/health');
    const body = parseOrThrow(healthResponseSchema.safeParse(response.body));

    expect(body.data.status).toBe('ok');
    expect(body.data.database).toBe('connected');
  });

  it('still answers 200 but reports degraded when MongoDB is down', async () => {
    const response = await request(buildApp('disconnected')).get('/api/health');
    const body = parseOrThrow(healthResponseSchema.safeParse(response.body));

    // Deliberately not a 5xx. The process is alive and answering correctly; a
    // liveness probe that failed here would pull a still-useful process out of
    // rotation. The state is reported so a readiness check can act on it.
    expect(response.status).toBe(200);
    expect(body.data.status).toBe('degraded');
    expect(body.data.database).toBe('disconnected');
  });

  it('returns an ISO-8601 timestamp and a non-negative uptime', async () => {
    const response = await request(buildApp()).get('/api/health');
    const body = parseOrThrow(healthResponseSchema.safeParse(response.body));

    expect(Number.isNaN(Date.parse(body.data.timestamp))).toBe(false);
    expect(body.data.timestamp).toMatch(/Z$/);
    expect(body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('echoes a request id header so a user can quote it', async () => {
    const response = await request(buildApp()).get('/api/health');

    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toBeTruthy();
  });

  it('gives each request a different id', async () => {
    const app = buildApp();

    const first = await request(app).get('/api/health');
    const second = await request(app).get('/api/health');

    expect(first.headers[REQUEST_ID_HEADER.toLowerCase()]).not.toBe(
      second.headers[REQUEST_ID_HEADER.toLowerCase()],
    );
  });
});

describe('unknown routes', () => {
  it('responds 404 with the shared error envelope', async () => {
    const response = await request(buildApp()).get('/api/does-not-exist');

    expect(response.status).toBe(404);

    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Route not found');
  });

  it('includes a request id in the error body so the failure is traceable', async () => {
    const response = await request(buildApp()).get('/api/does-not-exist');
    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));

    expect(body.error.requestId).toBeTruthy();
    expect(body.error.requestId).toBe(response.headers[REQUEST_ID_HEADER.toLowerCase()]);
  });

  it('never leaks a stack trace in the response', async () => {
    const response = await request(buildApp()).get('/api/does-not-exist');

    expect(JSON.stringify(response.body)).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
    expect(response.body).not.toHaveProperty('stack');
  });

  it('hides the cause of an unexpected error in production', async () => {
    // This is the case that actually matters: a 404 is a controlled response,
    // but an unexpected throw is where file paths, dependency versions and
    // internal addresses leak. The message below deliberately contains a host
    // and port, because that is exactly the kind of detail that must not ship.
    const response = await request(buildAppThatFails('production')).get('/api/health');

    expect(response.status).toBe(500);

    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));

    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5/);
    expect(JSON.stringify(response.body)).not.toMatch(/connection pool exhausted/);
    expect(JSON.stringify(response.body)).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
    expect(response.body).not.toHaveProperty('stack');

    // The correlation id is the one thing the client is given, because it is
    // the only way to find the real error, which was logged server-side.
    expect(body.error.requestId).toBe(response.headers[REQUEST_ID_HEADER.toLowerCase()]);
  });

  it('returns the same 500 body in every environment', async () => {
    // Deliberate: the response shape does not vary with NODE_ENV.
    //
    // The alternative -- a richer body in development -- has a real cost. The
    // client would need optional error fields it only ever sees locally, and a
    // bug that only appears in production would get no early warning, because
    // development never exercised the code path that produces it. Debugging is
    // instead done from the server console, which prints the full error and the
    // same request id the client was given.
    const production = await request(buildAppThatFails('production')).get('/api/health');
    const development = await request(buildAppThatFails('development')).get('/api/health');

    expect(development.status).toBe(production.status);

    // `requestId` is excluded because it is unique per request; everything else
    // must be byte-identical, and the key set must not gain a dev-only field.
    const { requestId: _productionId, ...productionError } = production.body.error;
    const { requestId: _developmentId, ...developmentError } = development.body.error;

    expect(developmentError).toStrictEqual(productionError);
    expect(development.body.success).toBe(false);
  });
});

describe('malformed request bodies', () => {
  it('responds 400 rather than 500 for unparseable JSON', async () => {
    const response = await request(buildApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"unterminated": ');

    // A client sending broken JSON has made a mistake, not broken the server.
    // Reporting 500 here would be actively misleading.
    expect(response.status).toBe(400);

    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('CORS', () => {
  it('allows a request from a configured origin', async () => {
    const response = await request(buildApp()).get('/api/health').set('Origin', ALLOWED_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    // Required because Phase 0 decision D-011 authenticates with a cookie.
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sends no allow-origin header for an unlisted origin', async () => {
    const response = await request(buildApp()).get('/api/health').set('Origin', DISALLOWED_ORIGIN);

    // No header means the browser blocks the response to the page. The server
    // still executed the request, which is why CORS is a browser control and
    // not an authorisation mechanism.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never uses the wildcard origin', async () => {
    const response = await request(buildApp()).get('/api/health').set('Origin', DISALLOWED_ORIGIN);

    // `*` combined with credentials is forbidden by the CORS specification and
    // would allow any site on the internet to read authenticated responses.
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('answers a preflight request for the methods the API exposes', async () => {
    const response = await request(buildApp())
      .options('/api/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('GET');
    // POST exists for the auth endpoints added in Phase 4.1.
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });
});

describe('hardening', () => {
  it('does not advertise the framework', async () => {
    const response = await request(buildApp()).get('/api/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sets security headers', async () => {
    const response = await request(buildApp()).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // HSTS is off outside production: it is meaningless without TLS and would
    // be a placebo control in development.
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('sets HSTS in production', async () => {
    const app = createApp({
      env: { ...TEST_ENV, NODE_ENV: 'production' },
      getDatabaseStatus: () => 'connected',
      auth: createFakeAuthService(),
    } satisfies AppDependencies);

    const response = await request(app).get('/api/health');

    expect(response.headers['strict-transport-security']).toBeTruthy();
  });

  it('forbids the browser from caching API responses', async () => {
    // Found by making a live request: the browser sent `If-None-Match` to
    // /api/health, so it was replaying a stored body and could show a
    // `status: "ok"` that was no longer true. TanStack Query owns caching here.
    const response = await request(buildApp()).get('/api/health');

    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('sets the no-store policy on error responses too', async () => {
    // The policy has to be registered before the error handler, not inside the
    // routes, or a failing request is the one case that leaks a stale body.
    const response = await request(buildApp()).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
