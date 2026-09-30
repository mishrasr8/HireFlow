/**
 * Unit tests for the session service.
 *
 * Deterministic by construction: the service takes `now: Date` on every
 * validity-bearing call, so the full lifecycle -- Day 0 through Day 8 -- is
 * simulated precisely without fake timers or sleeping. The store is faked
 * in memory (`testing/fakeSessionStore.ts`); hashing and randomness are real,
 * exactly as in production.
 *
 * The absolute-expiry test below is the one the acceptance criteria single
 * out: activity every day for six days must not move `expiresAt`, and the
 * session must be rejected on Day 7 regardless.
 */
import { describe, expect, it } from 'vitest';

import { createFakeSessionStore } from '../testing/fakeSessionStore.js';
import { ApiError } from '../errors/apiError.js';
import {
  createSessionService,
  MAX_ACTIVE_SESSIONS,
  SESSION_IDLE_MS,
  SESSION_LIFETIME_MS,
  sha256Hex,
  type SessionRecord,
  type SessionService,
} from './session.service.js';

const USER_ID = 'user-42';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A deterministic clock frozen at `day` days after 2026-01-01T00:00:00Z. */
function day(n: number): Date {
  return new Date(Date.UTC(2026, 0, 1 + n));
}

/** Build a service wired to a fresh in-memory store. */
function freshService(): { sessions: SessionService; store: ReturnType<typeof createFakeSessionStore> } {
  const store = createFakeSessionStore();
  return { sessions: createSessionService(store), store };
}

/** A valid stored session record for seeding, with fully controllable times. */
function seedRecord(overrides: {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt?: Date;
  userId?: string;
}): SessionRecord {
  return {
    id: overrides.id,
    tokenHash: sha256Hex(`seed-${overrides.id}`),
    csrfToken: 'c'.repeat(64),
    userId: overrides.userId ?? USER_ID,
    expiresAt: overrides.expiresAt ?? new Date(overrides.createdAt.getTime() + SESSION_LIFETIME_MS),
    lastUsedAt: overrides.lastUsedAt,
    createdAt: overrides.createdAt,
  };
}

describe('createSession', () => {
  it('creates a session, storing only the hash of the identifier', async () => {
    const { sessions, store } = freshService();

    const created = await sessions.createSession(USER_ID, day(0));

    // The identifier the client will receive is a fresh 64-hex value...
    expect(created.identifier).toMatch(/^[a-f0-9]{64}$/);

    // ...and the store only ever holds its SHA-256 hash, never the raw value.
    expect(store.records).toHaveLength(1);
    const record = store.records[0];
    if (record === undefined) throw new Error('expected one stored session');
    expect(record.tokenHash).toBe(sha256Hex(created.identifier));
    expect(record.tokenHash).not.toBe(created.identifier);

    // Absolute expiry is exactly 7 days from creation; the idle clock starts
    // at creation.
    expect(record.expiresAt.getTime()).toBe(day(0).getTime() + SESSION_LIFETIME_MS);
    expect(record.lastUsedAt.getTime()).toBe(day(0).getTime());

    // A per-session CSRF token exists and is a different random value.
    expect(record.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    expect(record.csrfToken).not.toBe(created.identifier);
  });

  it('every login creates a fresh, different identifier (session fixation defence)', async () => {
    const { sessions } = freshService();

    const first = await sessions.createSession(USER_ID, day(0));
    const second = await sessions.createSession(USER_ID, day(0));

    // FR-094: a login never re-issues an identifier that already exists, so a
    // pre-authentication identifier can never be steered and then recognised.
    expect(first.identifier).not.toBe(second.identifier);
  });
});

describe('resolveIdentifier (absolute expiry)', () => {
  it('accepts the session through Day 6 without ever extending its Day-7 expiry', async () => {
    const { sessions, store } = freshService();
    const { identifier } = await sessions.createSession(USER_ID, day(0));

    // Activity every single day, exactly like a heavy user.
    for (let n = 1; n <= 6; n += 1) {
      const resolved = await sessions.resolveIdentifier(identifier, day(n));
      expect(resolved).not.toBeNull();
      if (resolved !== null) {
        await sessions.recordUsage(resolved.sessionId, day(n));
      }
    }

    // The mandatory invariant: `expiresAt` was set once at creation and the
    // refreshes only ever moved `lastUsedAt`.
    const record = store.records[0];
    if (record === undefined) throw new Error('expected the session to survive Day 6');
    expect(record.expiresAt.getTime()).toBe(day(0).getTime() + SESSION_LIFETIME_MS);
    expect(record.lastUsedAt.getTime()).toBe(day(6).getTime());
    // Sanity: the refreshes actually did something.
    expect(record.lastUsedAt.getTime()).not.toBe(day(0).getTime());

    // The absolute limit always wins over continued activity: on Day 7 the
    // session is rejected and revoked on the spot.
    expect(await sessions.resolveIdentifier(identifier, day(7))).toBeNull();
    expect(store.records).toHaveLength(0);
  });
});

describe('resolveIdentifier (idle timeout)', () => {
  it('rejects a session unused for more than 3 days', async () => {
    const { sessions, store } = freshService();
    const { identifier } = await sessions.createSession(USER_ID, day(0));

    // Exactly 3 idle days is still valid (`now - lastUsedAt <= 3 days`).
    const boundary = await sessions.resolveIdentifier(identifier, day(3));
    expect(boundary).not.toBeNull();

    // A millisecond past the boundary is invalid -- and revoked.
    const justPast = new Date(day(3).getTime() + 1);
    expect(await sessions.resolveIdentifier(identifier, justPast)).toBeNull();
    expect(store.records).toHaveLength(0);
  });

  it('resets the idle clock on activity, measured from lastUsedAt', async () => {
    const { sessions } = freshService();
    const { identifier } = await sessions.createSession(USER_ID, day(0));

    // Use the session on Day 2...
    const used = await sessions.resolveIdentifier(identifier, day(2));
    expect(used).not.toBeNull();
    if (used !== null) {
      await sessions.recordUsage(used.sessionId, day(2));
    }

    // ...so Day 5 (3 days after the refresh) is still valid...
    expect(await sessions.resolveIdentifier(identifier, day(5))).not.toBeNull();

    // ...and Day 5 + a bit (more than 3 days of idleness) is not.
    expect(await sessions.resolveIdentifier(identifier, new Date(day(5).getTime() + 1))).toBeNull();
  });
});

describe('revokeByIdentifier', () => {
  it('deletes the session so a replayed identifier is not found', async () => {
    const { sessions, store } = freshService();
    const { identifier } = await sessions.createSession(USER_ID, day(0));

    await sessions.revokeByIdentifier(identifier);

    expect(store.records).toHaveLength(0);
    expect(await sessions.resolveIdentifier(identifier, day(0))).toBeNull();
  });

  it('is idempotent for an unknown identifier', async () => {
    const { sessions } = freshService();
    await expect(sessions.revokeByIdentifier('a'.repeat(64))).resolves.toBeUndefined();
  });
});

describe('the 5-session cap', () => {
  it('a sixth login evicts the oldest by createdAt, never by lastUsedAt', async () => {
    // Seed five sessions where the *newest created* one has the *stale*
    // lastUsedAt and the *oldest created* one was used most recently. If the
    // eviction logic wrongly keyed on `lastUsedAt`, it would evict the wrong
    // row -- so this test distinguishes the two policies unambiguously
    // (OQ-025: "oldest" means oldest by `createdAt`, never `lastUsedAt`).
    const seed: SessionRecord[] = [0, 1, 2, 3, 4].map((n) =>
      seedRecord({
        id: `seed-${n}`,
        createdAt: day(n),
        // Most-recently-used is the OLDEST-created row (index 0); the newest
        // created row (index 4) is the least recently used.
        lastUsedAt: day(10 - n),
      }),
    );
    const store = createFakeSessionStore(seed);
    const sessions = createSessionService(store);

    await sessions.createSession(USER_ID, day(11));

    // Still five rows: one of the seeded five was evicted, the sixth added.
    expect(store.records).toHaveLength(MAX_ACTIVE_SESSIONS);

    const remainingIds = store.records.map((record) => record.id).sort();
    const evictedIds = seed
      .map((record) => record.id)
      .filter((id) => !remainingIds.includes(id));

    // The evicted row is the one with `createdAt` Day 0 -- even though it was
    // the most recently used. The stale (Day-6 lastUsedAt) row survives.
    expect(evictedIds).toEqual(['seed-0']);
    expect(remainingIds).toContain('seed-4');
  });

  it('expired sessions do not count toward the cap', async () => {
    const store = createFakeSessionStore([
      ...([0, 1, 2, 3, 4] as const).map((n) =>
        seedRecord({ id: `active-${n}`, createdAt: day(n), lastUsedAt: day(n) }),
      ),
      seedRecord({
        id: 'expired',
        createdAt: day(0),
        lastUsedAt: day(0),
        expiresAt: day(2), // already expired by the time of the sixth login
      }),
    ]);
    const sessions = createSessionService(store);

    await sessions.createSession(USER_ID, day(10));

    // The expired row was never a candidate for eviction (non-expired only);
    // the new session evicts exactly one active row and is itself active.
    const byId = new Map(store.records.map((record) => [record.id, record]));
    expect(byId.size).toBe(MAX_ACTIVE_SESSIONS + 1); // 4 active + 1 expired + new
    expect(byId.has('expired')).toBe(true);

    const activeNow = store.records.filter(
      (record) => record.expiresAt.getTime() > day(10).getTime(),
    );
    expect(activeNow).toHaveLength(MAX_ACTIVE_SESSIONS);
    // The brand-new session (created at Day 10) is among the active ones.
    expect(activeNow.some((record) => record.createdAt.getTime() === day(10).getTime())).toBe(true);
  });
});

describe('CSRF tokens', () => {
  it('issues the session token idempotently', async () => {
    const { sessions } = freshService();
    const { identifier } = await sessions.createSession(USER_ID, day(0));

    const token = await sessions.getCsrfToken(identifier);
    expect(token).toMatch(/^[a-f0-9]{64}$/);

    // Idempotent issuance: repeated calls return the same token, so a second
    // browser tab cannot invalidate the first tab's token mid-session.
    expect(await sessions.getCsrfToken(identifier)).toBe(token);
  });

  it('validates the presented token in constant time', async () => {
    const { sessions } = freshService();
    const { identifier } = await sessions.createSession(USER_ID, day(0));

    const token = await sessions.getCsrfToken(identifier);

    expect(await sessions.validateCsrfToken(identifier, token)).toBe(true);
    expect(await sessions.validateCsrfToken(identifier, 'f'.repeat(64))).toBe(false);
    expect(await sessions.validateCsrfToken('a'.repeat(64), token)).toBe(false);
    // Malformed presentations fail closed (rejected), never compare equal.
    expect(await sessions.validateCsrfToken(identifier, 'not-a-token')).toBe(false);
  });

  it('throws the generic 401 for a session that no longer exists', async () => {
    const { sessions } = freshService();
    const error = await sessions.getCsrfToken('a'.repeat(64)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('SESSION_IDLE_MS is a full constant day count used by the policy', () => {
    expect(SESSION_IDLE_MS).toBe(3 * DAY_MS);
  });
});