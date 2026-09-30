/**
 * Test-only in-memory implementation of the session store.
 *
 * Kept in `testing/` (excluded from the production build like
 * `parseOrThrow.ts`) because it exists solely so the session service and the
 * HTTP layer can be exercised offline: the session *logic* (expiry, idle
 * timeout, cap eviction, hashing, CSRF) is what matters, not MongoDB.
 *
 * The store is deliberately a faithful model of the database boundary:
 *
 * - `insert` stamps `createdAt` (production stamps it via Mongoose timestamps);
 * - `updateLastUsedAt` mutates `lastUsedAt` and nothing else, so a test can
 *   assert that absolute expiry is never extended by activity (OQ-025);
 * - `findActiveByUserId` returns *non-expired* rows sorted oldest `createdAt`
 *   first, which is exactly the eviction query the cap policy depends on.
 *
 * The `records` array is exposed so tests can assert invariants directly (for
 * example "the evicted row was the oldest by `createdAt`, not the least
 * recently used").
 */
import {
  createSessionService,
  type NewSessionInput,
  type SessionRecord,
  type SessionService,
  type SessionStore,
} from '../services/session.service.js';

export interface FakeSessionStore extends SessionStore {
  /** Live records, readable/writable only through the store's own methods. */
  readonly records: SessionRecord[];
}

/**
 * Build an in-memory session store, optionally seeded with existing records
 * (used by the cap-eviction tests to control `createdAt`/`lastUsedAt` freely).
 */
export function createFakeSessionStore(seed: SessionRecord[] = []): FakeSessionStore {
  const records: SessionRecord[] = [...seed];
  let nextId = records.length + 1;

  return {
    records,

    async insert(input: NewSessionInput): Promise<SessionRecord> {
      const record: SessionRecord = {
        id: `session-${nextId.toString().padStart(3, '0')}`,
        tokenHash: input.tokenHash,
        csrfToken: input.csrfToken,
        userId: input.userId,
        expiresAt: input.expiresAt,
        lastUsedAt: input.lastUsedAt,
        // Mongoose's createdAt timestamps would stamp the insert moment; mirror
        // that here so eviction ordering behaves like production.
        createdAt: new Date(input.lastUsedAt.getTime()),
      };
      nextId += 1;
      records.push(record);
      return record;
    },

    async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
      return records.find((record) => record.tokenHash === tokenHash) ?? null;
    },

    async findActiveByUserId(userId: string, now: Date): Promise<SessionRecord[]> {
      return records
        .filter((record) => record.userId === userId && record.expiresAt.getTime() > now.getTime())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    async updateLastUsedAt(id: string, now: Date): Promise<void> {
      const record = records.find((candidate) => candidate.id === id);
      // Only ever `lastUsedAt`. There is deliberately no path that reaches
      // `expiresAt` -- the one-field `$set` in the MongoDB store is mirrored
      // here so the no-extension guarantee is provable in tests.
      if (record !== undefined) {
        record.lastUsedAt = new Date(now.getTime());
      }
    },

    async deleteById(id: string): Promise<void> {
      const index = records.findIndex((record) => record.id === id);
      if (index !== -1) {
        records.splice(index, 1);
      }
    },

    async deleteByTokenHash(tokenHash: string): Promise<void> {
      const index = records.findIndex((record) => record.tokenHash === tokenHash);
      if (index !== -1) {
        records.splice(index, 1);
      }
    },
  };
}

/** A ready-to-use session service backed by an in-memory store. */
export function createFakeSessionService(seed: SessionRecord[] = []): SessionService {
  return createSessionService(createFakeSessionStore(seed));
}