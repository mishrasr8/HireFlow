/**
 * Session service: the business rules of server-side sessions (`D-011`).
 *
 * This module owns *what a session is* and *when it is valid*. Like the auth
 * service, it depends on a persistence boundary (`SessionStore`) that is
 * injected instead of Mongoose, so the whole policy is testable offline with an
 * in-memory fake store (`testing/fakeSessionStore.ts`).
 *
 * ## The clock is injected
 *
 * Every validity-bearing method takes `now: Date`. That is what lets the tests
 * simulate Day 0 through Day 8 deterministically -- the mandatory
 * "continuous activity cannot extend the 7-day absolute lifetime" test would
 * otherwise require sleeping for a week or fragile fake timers.
 *
 * ## The policy, in one place
 *
 * - a session identifier is 32 random bytes, hex-encoded (64 hex chars);
 * - MongoDB stores only SHA-256(identifier) in `tokenHash` (`FR-089`); the raw
 *   identifier never reaches the store, a response body, a log line, or
 *   client-side JavaScript (`NFR-S-003`);
 * - validity = exists AND `now < expiresAt` (absolute expiry, 7 days) AND
 *   `now - lastUsedAt <= 3 days` (idle timeout) -- `OQ-025`;
 * - absolute expiry always wins: refreshes update `lastUsedAt` and never touch
 *   `expiresAt`;
 * - at most 5 active sessions per account; a sixth evicts the oldest by
 *   `createdAt`, never by `lastUsedAt` (`OQ-025`);
 * - a session discovered expired or idle is revoked (deleted) immediately, so
 *   it cannot authenticate even before the TTL cleans it up (`NFR-S-016`);
 * - the synchronizer CSRF token (`NFR-S-018`) lives on the session record: one
 *   random token per session, stored raw (it is not an authenticator), returned
 *   idempotently by the issuance endpoint, and deleted with the session.
 *
 * ## What this service does *not* do
 *
 * It never reads a cookie or inspects HTTP state -- that is the middleware's
 * job (`middleware/authenticate.ts`, `middleware/csrf.ts`). It never decides
 * *what a user may do*; authorization is a later, separate layer (`NFR-S-001`).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { ApiError } from '../errors/apiError.js';

/** Absolute session lifetime: 7 days (`OQ-025`). Never extended by activity. */
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Idle timeout: a session unused for 3 days becomes invalid (`OQ-025`). */
export const SESSION_IDLE_MS = 3 * 24 * 60 * 60 * 1000;

/** Maximum concurrent sessions per account; the oldest by `createdAt` is evicted (`OQ-025`). */
export const MAX_ACTIVE_SESSIONS = 5;

/** Random bytes per session identifier / CSRF token (256-bit -> 64 hex chars). */
const SESSION_TOKEN_BYTES = 32;

/** A stored session as the service and its tests see it. */
export interface SessionRecord {
  readonly id: string;
  readonly tokenHash: string;
  readonly csrfToken: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly lastUsedAt: Date;
  readonly createdAt: Date;
}

/** Everything needed to persist a new session. */
export interface NewSessionInput {
  readonly tokenHash: string;
  readonly csrfToken: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly lastUsedAt: Date;
}

/**
 * The persistence boundary. Implemented against MongoDB in
 * `services/sessionStore.ts` and faked in tests.
 */
export interface SessionStore {
  insert(input: NewSessionInput): Promise<SessionRecord>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  /** Non-expired sessions for a user, oldest `createdAt` first (cap eviction). */
  findActiveByUserId(userId: string, now: Date): Promise<SessionRecord[]>;
  /** Update `lastUsedAt` only -- by construction this can never move `expiresAt`. */
  updateLastUsedAt(id: string, now: Date): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
}

/** The shape of a successfully resolved session. */
export interface ResolvedSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly lastUsedAt: Date;
  readonly expiresAt: Date;
}

/** The outcome of creating a session: the identifier goes to the cookie. */
export interface CreatedSession {
  readonly identifier: string;
  readonly expiresAt: Date;
}

/** The operations the HTTP layer (controllers and middleware) may invoke. */
export interface SessionService {
  /** Create a fresh session for a user after successful authentication (`FR-088`, `FR-094`). */
  createSession(userId: string, now: Date): Promise<CreatedSession>;
  /** Resolve an identifier to a valid session, or null (revoking stale ones). */
  resolveIdentifier(identifier: string, now: Date): Promise<ResolvedSession | null>;
  /** Record activity on a valid session without touching its absolute expiry. */
  recordUsage(sessionId: string, now: Date): Promise<void>;
  /** Delete the session identified by an opaque identifier (logout, `FR-092`). */
  revokeByIdentifier(identifier: string): Promise<void>;
  /** Return (issuing if necessary) the synchronizer CSRF token for a session. */
  getCsrfToken(identifier: string): Promise<string>;
  /** Verify a presented CSRF token against the session's stored token. */
  validateCsrfToken(identifier: string, presentedToken: string): Promise<boolean>;
}

/** SHA-256 hex of any string; used for both the identifier and CSRF hashing needs. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** A cryptographically random hex token of `bytes` random bytes. */
function randomHexToken(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Constant-time equality for two 64-hex values.
 *
 * `timingSafeEqual` needs equal-length buffers and throws on mismatch, and
 * `Buffer.from` silently drops invalid hex pairs, so the shape is validated
 * first: a malformed presented token must fail closed (be rejected), never
 * compare equal to anything.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Build the session service against a given store. */
export function createSessionService(store: SessionStore): SessionService {
  return {
    async createSession(userId: string, now: Date): Promise<CreatedSession> {
      const identifier = randomHexToken(SESSION_TOKEN_BYTES);
      const csrfToken = randomHexToken(SESSION_TOKEN_BYTES);

      // Cap enforcement: the sixth login evicts the oldest *active* session by
      // `createdAt`. `lastUsedAt` never drives eviction (`OQ-025`).
      const active = await store.findActiveByUserId(userId, now);
      if (active.length >= MAX_ACTIVE_SESSIONS) {
        const oldest = active[0];
        if (oldest !== undefined) {
          await store.deleteById(oldest.id);
        }
      }

      const record = await store.insert({
        tokenHash: sha256Hex(identifier),
        csrfToken,
        userId,
        expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
        lastUsedAt: now,
      });

      return { identifier, expiresAt: record.expiresAt };
    },

    async resolveIdentifier(identifier: string, now: Date): Promise<ResolvedSession | null> {
      const record = await store.findByTokenHash(sha256Hex(identifier));
      if (record === null) {
        return null;
      }

      const nowMs = now.getTime();

      // Absolute expiry wins over anything, including continuous activity.
      if (nowMs >= record.expiresAt.getTime()) {
        await store.deleteById(record.id);
        return null;
      }

      // Idle timeout: strictly more than 3 idle days is invalid. An idle session
      // is revoked now (not left for the TTL), so it can never authenticate
      // again even though the document may not be physically deleted yet.
      if (nowMs - record.lastUsedAt.getTime() > SESSION_IDLE_MS) {
        await store.deleteById(record.id);
        return null;
      }

      return {
        sessionId: record.id,
        userId: record.userId,
        lastUsedAt: record.lastUsedAt,
        expiresAt: record.expiresAt,
      };
    },

    async recordUsage(sessionId: string, now: Date): Promise<void> {
      // The store's `updateLastUsedAt` sets exactly one field. `expiresAt` is
      // untouched by construction, which is the guarantee the mandatory
      // "7-day lifetime cannot be extended" test pins down.
      await store.updateLastUsedAt(sessionId, now);
    },

    async revokeByIdentifier(identifier: string): Promise<void> {
      await store.deleteByTokenHash(sha256Hex(identifier));
    },

    async getCsrfToken(identifier: string): Promise<string> {
      const record = await store.findByTokenHash(sha256Hex(identifier));
      if (record === null) {
        // The authenticate middleware resolves the session first, so this is a
        // defensive branch, not a normal path. The message stays generic.
        throw ApiError.unauthenticated();
      }

      // Idempotent issuance: the token is created once per session and returned
      // as-is afterwards, so a second browser tab does not invalidate the first
      // tab's token mid-session.
      return record.csrfToken;
    },

    async validateCsrfToken(identifier: string, presentedToken: string): Promise<boolean> {
      const record = await store.findByTokenHash(sha256Hex(identifier));
      if (record === null) {
        return false;
      }
      return constantTimeEqualHex(record.csrfToken, presentedToken);
    },
  };
}