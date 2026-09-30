/**
 * End-to-end tests for server-side session behaviour over real HTTP.
 *
 * These drive the full Express pipeline (Supertest in-process) with the *real*
 * session service backed by an in-memory store and the *fake* auth service, so
 * the HTTP surface -- cookies, the authentication middleware, the CSRF
 * middleware and logout -- is exercised exactly as in production without a
 * database. The session service's own policy rules are pinned down
 * deterministically in `services/session.service.test.ts`; here the same
 * rules are proven through the wire, including via `vi` fake system time for
 * the expiry and idle-timeout cases.
 *
 * The cookie assertions are made against the raw `Set-Cookie` header string --
 * not against a parsed object -- because cookie *attributes* are the security
 * contract (`FR-090`), and re-serializing them through a parser could hide a
 * header-level mistake.
 */
import {
  apiFailureSchema,
  csrfTokenResponseSchema,
  loginResponseSchema,
  meResponseSchema,
} from '@hireflow/contracts';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { AuthService } from './services/auth.service.js';
import { createSessionService } from './services/session.service.js';
import { createFakeAuthService } from './testing/fakeAuth.js';
import { createFakeSessionStore, type FakeSessionStore } from './testing/fakeSessionStore.js';
import { parseOrThrow } from './testing/parseOrThrow.js';
import type { AppDependencies } from './types/dependencies.js';
import { SESSION_COOKIE_NAME } from './utils/sessionCookie.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';

const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: 4000,
  MONGODB_URI: 'mongodb://127.0.0.1:27017/hireflow-test',
  CORS_ORIGINS: [ALLOWED_ORIGIN],
} satisfies AppDependencies['env'];

const LOGIN_BODY = { email: 'ada@example.com', password: 'correct-horse-battery' };

const DAY_MS = 24 * 60 * 60 * 1000;

function afterDays(days: number, from = Date.now()): Date {
  return new Date(from + days * DAY_MS);
}

interface Harness {
  readonly app: Express;
  readonly store: FakeSessionStore;
  readonly auth: AuthService;
}

/** Build the app with a real session service over an inspectable fake store. */
function buildHarness(options: {
  auth?: AuthService;
  nodeEnv?: AppDependencies['env']['NODE_ENV'];
} = {}): Harness {
  const auth = options.auth ?? createFakeAuthService();
  const store = createFakeSessionStore();
  const sessions = createSessionService(store);
  const app = createApp({
    env: { ...TEST_ENV, NODE_ENV: options.nodeEnv ?? 'test' },
    getDatabaseStatus: () => 'connected',
    auth,
    sessions,
  } satisfies AppDependencies);
  return { app, store, auth };
}

/** The full Set-Cookie line for our session cookie in a response, or fail. */
function sessionCookieLine(setCookieHeader: unknown): string {
  const lines = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const line of lines) {
    if (typeof line === 'string' && line.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return line;
    }
  }
  throw new Error('expected a session cookie in the response');
}

/** Just the opaque identifier value inside a session Set-Cookie line. */
function cookieValue(line: string): string {
  const value = line.split(';')[0]?.slice(SESSION_COOKIE_NAME.length + 1) ?? '';
  if (value === '') {
    throw new Error('expected a non-empty session cookie value');
  }
  return value;
}

/** Log in through the real endpoint and return the session cookie line. */
async function login(app: Express): Promise<string> {
  const response = await request(app).post('/api/auth/login').send(LOGIN_BODY);
  expect(response.status).toBe(200);
  return sessionCookieLine(response.headers['set-cookie']);
}

/** Read the current CSRF token through the real endpoint. */
async function csrfFor(app: Express, cookie: string): Promise<string> {
  const response = await request(app).get('/api/auth/csrf').set('Cookie', cookie);
  expect(response.status).toBe(200);
  const body = parseOrThrow(csrfTokenResponseSchema.safeParse(response.body));
  return body.data.token;
}

describe('login sets the session cookie', () => {
  it('attaches an HttpOnly, SameSite=Lax cookie that is not Secure outside production', async () => {
    const { app } = buildHarness();
    const response = await request(app).post('/api/auth/login').send(LOGIN_BODY);

    expect(response.status).toBe(200);

    const line = sessionCookieLine(response.headers['set-cookie']).toLowerCase();
    expect(line).toContain('httponly');
    expect(line).toContain('samesite=lax');
    expect(line).toContain('path=/');
    // Outside production the API serves plain HTTP (e.g. localhost), where a
    // Secure cookie would never be stored by a browser at all.
    expect(line).not.toContain('secure');
    // The browser-side hint mirrors the server-side 7-day absolute lifetime.
    expect(line).toContain('max-age=604800000');
  });

  it('adds the Secure attribute when running in production', async () => {
    const { app } = buildHarness({ nodeEnv: 'production' });
    const response = await request(app).post('/api/auth/login').send(LOGIN_BODY);

    const line = sessionCookieLine(response.headers['set-cookie']).toLowerCase();
    expect(line).toContain('secure');
    expect(line).toContain('httponly');
  });

  it('never puts the session identifier in the response body', async () => {
    const { app } = buildHarness();
    const response = await request(app).post('/api/auth/login').send(LOGIN_BODY);

    const line = sessionCookieLine(response.headers['set-cookie']);
    const identifier = cookieValue(line);
    const body = parseOrThrow(loginResponseSchema.safeParse(response.body));

    // The body is exactly the safe user...
    expect(Object.keys(body.data)).toEqual(['id', 'email', 'name', 'capabilities']);
    // ...and the raw identifier that just travelled in the cookie appears
    // nowhere in the JSON (NFR-S-003). The web app cannot read it either:
    // HttpOnly keeps it out of JavaScript.
    expect(JSON.stringify(response.body)).not.toContain(identifier);
  });

  it('creates a fresh session on every login (session-fixation defence)', async () => {
    const { app } = buildHarness();

    const first = cookieValue(await login(app));
    const second = cookieValue(await login(app));

    // FR-094: an identifier issued before authentication is never accepted.
    expect(first).not.toBe(second);
  });

  it('still answers login even when the CSRF check would later apply', async () => {
    // Login itself is a pre-session POST: there is no session to CSRF-attack,
    // so no token is demanded here. Guard against a regression where the CSRF
    // middleware is naively applied to every POST including login/register.
    const { app } = buildHarness();
    const response = await request(app).post('/api/auth/login').send(LOGIN_BODY);
    expect(response.status).toBe(200);
  });
});

describe('GET /api/auth/me (the protected route)', () => {
  it('rejects a request with no session cookie', async () => {
    const { app } = buildHarness();
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unknown session identifier', async () => {
    const { app } = buildHarness();
    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${'a'.repeat(64)}`);

    expect(response.status).toBe(401);
    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('accepts a valid session and returns the safe user', async () => {
    const { app } = buildHarness();
    const cookie = await login(app);

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(response.status).toBe(200);
    const body = parseOrThrow(meResponseSchema.safeParse(response.body));
    expect(body.data.email).toBe('ada@example.com');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('rejects a session whose user no longer exists and revokes the orphan', async () => {
    const auth = createFakeAuthService({ getUserById: () => Promise.resolve(null) });
    const { app, store } = buildHarness({ auth });
    const cookie = await login(app);

    expect(store.records).toHaveLength(1);

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(response.status).toBe(401);
    // The orphaned session was revoked rather than left to linger.
    expect(store.records).toHaveLength(0);
  });

  it('rejects after the 7-day absolute expiry, even with activity along the way', async () => {
    const { app, store } = buildHarness();
    const cookie = await login(app);
    const dayZero = Date.now();

    try {
      vi.useFakeTimers();
      vi.setSystemTime(afterDays(6, dayZero));

      const active = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(active.status).toBe(200);
      // Activity refreshed the idle clock, but the absolute limit is 7 days.
      const record = store.records[0];
      if (record === undefined) throw new Error('expected the session to survive Day 6');
      expect(record.expiresAt.getTime()).toBe(dayZero + 7 * DAY_MS);
      expect(record.lastUsedAt.getTime()).toBe(dayZero + 6 * DAY_MS);

      // One day later the absolute limit wins regardless of that activity.
      vi.setSystemTime(afterDays(7, dayZero));
      const expired = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(expired.status).toBe(401);
      const body = parseOrThrow(apiFailureSchema.safeParse(expired.body));
      expect(body.error.code).toBe('UNAUTHENTICATED');
      expect(store.records).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a session idle for more than 3 days, measured from the last refresh', async () => {
    const { app, store } = buildHarness();
    const cookie = await login(app);
    const dayZero = Date.now();

    try {
      // Two days in, the session is active, and this request refreshes the
      // idle clock (`lastUsedAt`) without touching the absolute expiry.
      vi.useFakeTimers();
      vi.setSystemTime(afterDays(2, dayZero));
      const active = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(active.status).toBe(200);

      const record = store.records[0];
      if (record === undefined) throw new Error('expected the session to survive Day 2');
      expect(record.lastUsedAt.getTime()).toBe(dayZero + 2 * DAY_MS);
      expect(record.expiresAt.getTime()).toBe(dayZero + 7 * DAY_MS);

      // More than 3 idle days after that refresh: rejected and revoked. The
      // boundary ("exactly 3 days is still valid") is pinned in the unit
      // tests; here the real request path just has to refuse the expired one.
      vi.setSystemTime(dayZero + 2 * DAY_MS + 3 * DAY_MS + 3_600_000);
      const idle = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(idle.status).toBe(401);
      expect(store.records).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a read-only route and does not demand a CSRF token', async () => {
    const { app } = buildHarness();
    const cookie = await login(app);

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(response.status).toBe(200);
  });
});

describe('GET /api/auth/csrf (synchronizer-token issuance)', () => {
  it('requires an authenticated session', async () => {
    const { app } = buildHarness();
    const response = await request(app).get('/api/auth/csrf');

    expect(response.status).toBe(401);
  });

  it('issues a 64-hex token that is separate from the session identifier', async () => {
    const { app } = buildHarness();
    const cookie = await login(app);
    const identifier = cookieValue(cookie);

    const response = await request(app).get('/api/auth/csrf').set('Cookie', cookie);

    expect(response.status).toBe(200);
    const body = parseOrThrow(csrfTokenResponseSchema.safeParse(response.body));
    expect(body.data.token).toMatch(/^[a-f0-9]{64}$/);
    // The token is a different value from the cookie identifier (NFR-S-018:
    // the CSRF mechanism must not expose the session identifier), and the
    // identifier appears nowhere in the response body.
    expect(body.data.token).not.toBe(identifier);
    expect(JSON.stringify(response.body)).not.toContain(identifier);
  });

  it('returns the same token on repeat calls (no mid-session rotation)', async () => {
    const { app } = buildHarness();
    const cookie = await login(app);

    const first = await csrfFor(app, cookie);
    const second = await csrfFor(app, cookie);

    // A second browser tab must not invalidate the first tab's token: issuance
    // is idempotent for the life of the session.
    expect(first).toBe(second);
  });
});

describe('CSRF enforcement on state-changing requests', () => {
  it('rejects a state-changing POST without a CSRF token', async () => {
    const { app, store } = buildHarness();
    const cookie = await login(app);

    const response = await request(app).post('/api/auth/logout').set('Cookie', cookie);

    expect(response.status).toBe(403);
    const body = parseOrThrow(apiFailureSchema.safeParse(response.body));
    expect(body.error.code).toBe('FORBIDDEN');
    // The session is still valid and was not touched.
    expect(store.records).toHaveLength(1);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('rejects a state-changing POST with an invalid CSRF token', async () => {
    const { app, store } = buildHarness();
    const cookie = await login(app);

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'f'.repeat(64));

    expect(response.status).toBe(403);
    expect(store.records).toHaveLength(1);
  });

  it('CSRF-token responses are not readable cross-origin', async () => {
    // The token is issued only to the authenticated session holder, and the
    // CORS allowlist refuses unlisted origins, so an attacker-controlled page
    // cannot read the issuance response (it gets no allow-origin header).
    const { app, store } = buildHarness();
    const cookie = await login(app);

    const response = await request(app)
      .get('/api/auth/csrf')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    // And even if the token leaked, it grants nothing: with the identifier
    // stored only as a hash, no cookie can be forged from the database.
    expect(store.records).toHaveLength(1);
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the session, clears the cookie, and rejects a replayed identifier', async () => {
    const { app, store } = buildHarness();
    const cookie = await login(app);
    const token = await csrfFor(app, cookie);

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token);

    expect(response.status).toBe(204);

    // The server-side session is deleted (the strongest invalidation, FR-092).
    expect(store.records).toHaveLength(0);

    // The browser is told to drop the cookie.
    const cleared = sessionCookieLine(response.headers['set-cookie']);
    expect(cleared).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));
    expect(cleared.toLowerCase()).toContain('max-age=0');

    // Replaying the old identifier authenticates nothing, as if it had never
    // existed.
    const replay = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(replay.status).toBe(401);
  });

  it('requires authentication: a second logout is a clean 401, never a server error', async () => {
    const { app } = buildHarness();
    const cookie = await login(app);
    const token = await csrfFor(app, cookie);

    const first = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token);
    expect(first.status).toBe(204);

    // The session (and its CSRF token) are gone; the replay is refused without
    // a 500.
    const second = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token);
    expect(second.status).toBe(401);
  });
});

describe('the 5-session cap over HTTP', () => {
  it('a sixth login evicts the oldest session; the evicted cookie stops working', async () => {
    const { app, store } = buildHarness();

    const cookies: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      cookies.push(await login(app));
    }

    // Six logins, five live sessions: the first was evicted to make room.
    expect(store.records).toHaveLength(5);

    const evicted = await request(app).get('/api/auth/me').set('Cookie', cookies[0] ?? '');
    expect(evicted.status).toBe(401);

    const newest = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookies[5] ?? '');
    expect(newest.status).toBe(200);
  });
});

afterEach(() => {
  vi.useRealTimers();
});