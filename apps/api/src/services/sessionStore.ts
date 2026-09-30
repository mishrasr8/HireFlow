/**
 * The MongoDB implementation of the session service's persistence boundary.
 *
 * Mirrors `services/userStore.ts`: everything this module knows about (Mongoose,
 * the `Session` model, document mapping) is hidden from the HTTP layer, which
 * only ever sees the `SessionStore` interface. The mapping to a plain
 * `SessionRecord` copies exactly the fields the service is allowed to see; the
 * raw session identifier is never stored here, only its SHA-256 hash.
 *
 * Indexes: `tokenHash` (unique) is the resolution key of every authenticated
 * request (`FR-091`); `userId` supports "revoke all sessions" (`FR-110`) and the
 * session-cap eviction query; the `expiresAt` TTL deletes expired records
 * (`NFR-S-016`). All are declared in `models/session.model.ts`.
 */
import type { HydratedDocument } from 'mongoose';

import type { SessionDoc } from '../models/session.model.js';
import { Session } from '../models/session.model.js';
import type {
  NewSessionInput,
  SessionRecord,
  SessionStore,
} from './session.service.js';

type SessionDocument = HydratedDocument<SessionDoc>;

function toRecord(doc: SessionDocument): SessionRecord {
  return {
    // `_id` is typed (`Types.ObjectId`) on a hydrated document; the virtual
    // `id` getter is typed `any` and would trip the repo-wide no-unsafe rules.
    id: doc._id.toString(),
    tokenHash: doc.tokenHash,
    csrfToken: doc.csrfToken,
    userId: doc.userId.toString(),
    expiresAt: doc.expiresAt,
    lastUsedAt: doc.lastUsedAt,
    createdAt: doc.createdAt,
  };
}

/** The production store backed by the `sessions` collection. */
export function createSessionStore(): SessionStore {
  return {
    async insert(input: NewSessionInput): Promise<SessionRecord> {
      // `new ... save()` instead of `Model.create()`: `create` resolves to `any`
      // in Mongoose's typings, which the repo's lint rejects.
      const session = new Session({
        tokenHash: input.tokenHash,
        csrfToken: input.csrfToken,
        userId: input.userId,
        expiresAt: input.expiresAt,
        lastUsedAt: input.lastUsedAt,
      });

      const doc = await session.save();
      return toRecord(doc);
    },

    async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
      const doc = await Session.findOne({ tokenHash });
      return doc === null ? null : toRecord(doc);
    },

    async findActiveByUserId(userId: string, now: Date): Promise<SessionRecord[]> {
      const docs = await Session.find({ userId, expiresAt: { $gt: now } })
        .sort({ createdAt: 1 })
        .exec();
      return docs.map(toRecord);
    },

    async updateLastUsedAt(id: string, now: Date): Promise<void> {
      // One `$set` on one field. `expiresAt` is never part of this update, so a
      // refresh can never extend the 7-day absolute lifetime (OQ-025).
      await Session.updateOne({ _id: id }, { $set: { lastUsedAt: now } }).exec();
    },

    async deleteById(id: string): Promise<void> {
      await Session.deleteOne({ _id: id }).exec();
    },

    async deleteByTokenHash(tokenHash: string): Promise<void> {
      // Deletion is the strongest form of invalidation (FR-092): a replayed
      // identifier simply is not found. Idempotent -- deleting twice is a no-op.
      await Session.deleteOne({ tokenHash }).exec();
    },
  };
}