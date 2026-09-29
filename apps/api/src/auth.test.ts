/**
 * End-to-end tests for the authentication endpoints.
 *
 * These drive the real Express application in-process with Supertest -- the
 * full middleware chain (requestId, noStore, helmet, cors, body parser) and
 * the centralized error handler all really run. The auth *service* is faked
 * (see `testing/fakeAuth.ts`), so no database is needed; the service's own
 * logic and its use of real scrypt hashing are covered in
 * `services/auth.service.test.ts` and `services/password.service.test.ts`.
 *
 * The security assertions mirror the health tests' philosophy: responses are
 * validated against the *shared* Zod contract, and the serialized JSON is
 * additionally checked to prove no secret field can appear on the wire.
 */
import { apiFailureSchema, loginResponseSchema, registerResponseSchema } from '@hireflow/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { ApiError } from './errors/apiError.js';
import type { AuthService } from './services/auth.service.js';
import { createFakeAuthService } from './testing/fakeAuth.js';
import { parseOrThrow } from './testing/parseOrThrow.js';
import type { AppDependencies } from './types/dependencies.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';

const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: 4000,
  MONGODB_URI: 'mongodb://127.0.0.1:27017/hireflow-test',
  CORS_ORIGINS: [ALLOWED_ORIGIN],
} satisfies AppDependencies['env'];

function buildApp(auth: AuthService) {
  return createApp({
    env: TEST_ENV,
    getDatabaseStatus: () => 'connected',
    auth,
  } satisfies AppDependencies);
}

const REGISTER_BODY = {
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  password: 'correct-horse-battery',
  capability: 'CANDIDATE',
};

const LOGIN_BODY = { email: 'ada@example.com', password: 'correct-horse-battery' };

/** A fake auth service that always fails login with the generic 401. */
const failingLogin = createFakeAuthService({
  verifyLogin: () => Promise.reject(ApiError.unauthenticated('Invalid email or password')),
});

describe('POST /api/auth/register', () => {
  it('responds 201 with a body that satisfies the shared contract', async () => {
    const response = await request(buildApp(createFakeAuthService()))
      .post('/api/auth/register')
      .send(REGISTER_BODY);

    expect(response.status).toBe(201);

    const body = parseOrThrow(registerResponseSchema.safeParse(response.body));
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('ada@example.com');
    expect(body.data.capabilities).toEqual(['CANDIDATE']);
  });

  it('never exposes a password, hash or session identifier in the response', async () => {
    const response = await request(buildApp(createFakeAuthService()))
      .post('/api/auth/register')
      .send(REGISTER_BODY);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/session/i);

    const body = parseOrThrow(registerResponseSchema.safeParse(response.body));
    expect(Object.keys(body.data)).toEqual(['id', 'email', 'name', 'capabilities']);
  });

  it('responds 409 with the shared error envelope for a duplicate email', async () => {
    const auth = createFakeAuthService({
      registerUser: () =>
        Promise.reject(ApiError.conflict('An account with this email already exists')),
    });

    const response = await request(buildApp(auth)).post('/api/auth/register').send(REGISTER_BODY);

    expect(response.status).toBe(409);

    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    // Safe, controlled message; nothing internal.
    expect(body.error.message).toBe('An account with this email already exists');
    expect(JSON.stringify(response.body)).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });

  it('rejects a syntactically invalid email with field detail', async () => {
    const response = await request(buildApp(createFakeAuthService()))
      .post('/api/auth/register')
      .send({ ...REGISTER_BODY, email: 'not-an-email' });

    expect(response.status).toBe(400);

    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
    );
  });

  it('rejects an unknown capability value', async () => {
    const response = await request(buildApp(createFakeAuthService()))
      .post('/api/auth/register')
      .send({ ...REGISTER_BODY, capability: 'ADMIN' });

    expect(response.status).toBe(400);

    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'capability' })]),
    );
  });

  it('responds 400 for missing required fields and short passwords', async () => {
    const app = buildApp(createFakeAuthService());

    const missing = await request(app)
      .post('/api/auth/register')
      .send({ email: 'ada@example.com' });
    expect(missing.status).toBe(400);
    expect(parseOrThrow(apiFailureSchema.safeParse(missing.body)).error.code).toBe(
      'VALIDATION_ERROR',
    );

    const shortPassword = await request(app)
      .post('/api/auth/register')
      .send({ ...REGISTER_BODY, password: 'short' });
    expect(shortPassword.status).toBe(400);
  });

  it('responds 400 (not 500) for an unparseable JSON body', async () => {
    const response = await request(buildApp(createFakeAuthService()))
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"unterminated": ');

    expect(response.status).toBe(400);
    expect(parseOrThrow(apiFailureSchema.safeParse(response.body)).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('never leaks an unexpected server error to the client', async () => {
    const auth = createFakeAuthService({
      registerUser: () => Promise.reject(new Error('connection pool exhausted at 10.0.0.5:27017')),
    });

    const response = await request(buildApp(auth)).post('/api/auth/register').send(REGISTER_BODY);

    expect(response.status).toBe(500);

    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5/);
    expect(JSON.stringify(response.body)).not.toMatch(/connection pool exhausted/);
    expect(JSON.stringify(response.body)).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('answers a CORS preflight for POST, which the auth routes use', async () => {
    const response = await request(buildApp(createFakeAuthService()))
      .options('/api/auth/register')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });
});

describe('POST /api/auth/login', () => {
  it('responds 200 with the safe user for valid credentials', async () => {
    const response = await request(buildApp(createFakeAuthService()))
      .post('/api/auth/login')
      .send(LOGIN_BODY);

    expect(response.status).toBe(200);

    const body = parseOrThrow(loginResponseSchema.safeParse(response.body));
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('ada@example.com');

    // No password, hash or session material in a login response either.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/session/i);
  });

  it('responds 401 with one generic message for invalid credentials', async () => {
    const response = await request(buildApp(failingLogin)).post('/api/auth/login').send(LOGIN_BODY);

    expect(response.status).toBe(401);

    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toBe('Invalid email or password');
  });

  it('returns the identical body for a wrong password and an unknown account', async () => {
    // The service makes these indistinguishable (FR-007); the endpoint must
    // not differentiate them either.
    const wrongPassword = await request(buildApp(failingLogin))
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'not-the-password' });
    const unknownAccount = await request(buildApp(failingLogin))
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'correct-horse-battery' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);

    const wrongBody = parseOrThrow(apiFailureSchema.safeParse(wrongPassword.body));
    const unknownBody = parseOrThrow(apiFailureSchema.safeParse(unknownAccount.body));

    // The authentication-failure shape is identical: same code, same message.
    // The requestId is the per-request correlation id and deliberately differs
    // (it is not auth state, and asserting it differs proves each request
    // really is a separate incident, not a cached/replayed failure).
    expect(wrongBody.error.code).toBe(unknownBody.error.code);
    expect(wrongBody.error.message).toBe(unknownBody.error.message);
    expect(wrongBody.error.requestId).not.toBe(unknownBody.error.requestId);
  });

  it('responds 400 for a malformed login body', async () => {
    const response = await request(buildApp(failingLogin))
      .post('/api/auth/login')
      .send({ email: 'not-an-email' });

    expect(response.status).toBe(400);

    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
    );
  });
});
