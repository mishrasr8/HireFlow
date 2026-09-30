/**
 * Session -- the server-side authentication state (`D-011`, `DC-009`).
 *
 * Each document is one logged-in session. It lives in the shared database so
 * every API instance can resolve it (`DC-009`): no per-process memory, no
 * sticky routing, no mass logout on deploy.
 *
 * ## The stored value: a hash, never the identifier
 *
 * The client holds an opaque, high-entropy, random session identifier
 * (`FR-089`); this document stores a hash of it in `tokenHash`. Resolving a
 * request is one indexed lookup of `tokenHash`. Storing the hash (rather than
 * the raw value) means a database dump does not yield live credentials -- the
 * same reasoning as the invitation token (`NFR-S-019`). The raw identifier is
 * delivered only via the `HttpOnly` session cookie (`FR-090`) and is never
 * logged (`NFR-S-003`).
 *
 * ## The CSRF token is deliberately *not* hashed
 *
 * `csrfToken` is the synchronizer-token value (`NFR-S-018`): a separate random
 * value the server issues (via `GET /api/auth/csrf`), stored here, and expected
 * in the `X-CSRF-Token` header of every state-changing request. Unlike the
 * session identifier it is stored raw, and that asymmetry is intentional and
 * safe: a CSRF token is **not** an authenticator. Alone it grants nothing -- it
 * is only accepted together with the `HttpOnly` session cookie, and the cookie
 * identifier is stored hashed, so a database dump cannot yield a usable
 * cookie. Storing it raw (rather than hashed) is what lets the issuance
 * endpoint be idempotent: it returns the same token for the session's whole
 * life instead of rotating it and breaking a second browser tab. It is deleted
 * with the session on logout or expiry (`NFR-S-016`). The token never carries
 * the session identifier or any identity claim.
 *
 * ## No identity claims live here
 *
 * The session only points *at* a user. Identity, capabilities and company
 * membership are read from the User and CompanyMembership records on every
 * protected request (`FR-091`), so a capability change takes effect without a
 * re-login and the session carries nothing forgeable (`FR-089`).
 *
 * ## Lifecycle
 *
 *  - create: after successful authentication (`FR-094`);
 *  - resolve: lookup by `tokenHash`, `revokedAt`-free, `expiresAt` in the
 *    future, last used within 3 days (`FR-091`);
 *  - revoke: logout **deletes** the document immediately (`FR-092`,
 *    `FR-093`) -- deletion is the strongest form of invalidation, and a
 *    replayed identifier simply is not found;
 *  - expire: the TTL index on `expiresAt` deletes stale documents
 *    automatically (`NFR-S-016`: session records are *deleted* when they
 *    expire or are revoked, not retained -- hence no `revokedAt` field that
 *    would keep rows around).
 *
 * A session is valid only while it exists, has not reached its absolute expiry
 * of 7 days (`expiresAt`), and has been used within the last 3 days
 * (`lastUsedAt`, the idle timeout). An idle-invalid session is rejected on
 * resolution; the `expiresAt` TTL still deletes the record. The cost of
 * recording `lastUsedAt` -- one write per authenticated request -- is bounded
 * and documented; if that becomes a measured bottleneck, the write can be
 * rate-limited or batched (`NFR-SC-004`).
 */
import { Schema, model, type Model, type Types } from 'mongoose';

const SESSION_TTL_SECONDS = 0; // delete exactly when expiresAt passes

export interface SessionDoc {
  tokenHash: string;
  userId: Types.ObjectId;
  expiresAt: Date;
  lastUsedAt: Date;
  /** Raw synchronizer CSRF token for this session (`NFR-S-018`). See header. */
  csrfToken: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    // SHA-256 hex of the opaque session identifier (same hash rationale as the
    // invitation token; fixed length makes a stray raw value obvious).
    tokenHash: {
      type: String,
      required: true,
      minlength: 64,
      maxlength: 64,
      match: /^[a-f0-9]{64}$/,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
    // The synchronizer CSRF token, stored raw by design (see the module
    // comment): it is not an authenticator, and hashing it would make the
    // idempotent `GET /api/auth/csrf` issuance impossible.
    csrfToken: {
      type: String,
      required: true,
      minlength: 64,
      maxlength: 64,
      match: /^[a-f0-9]{64}$/,
    },
  },
  {
    timestamps: true,
    collection: 'sessions',
  },
);

/** Resolution key: every authenticated request arrives with the session identifier. */
sessionSchema.index({ tokenHash: 1 }, { unique: true });

/**
 * "Revoke all sessions for this user" (`FR-093`, and the basis of password
 * change invalidating sessions, `FR-110`). A user-first, non-unique index.
 */
sessionSchema.index({ userId: 1 });

/**
 * Expired records are deleted, not retained (`NFR-S-016`). The TTL monitor
 * removes a document as soon as `expiresAt` is in the past. Revoked records
 * are deleted explicitly by logout; there is no `revokedAt` retention.
 */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: SESSION_TTL_SECONDS });

export const Session: Model<SessionDoc> = model<SessionDoc>('Session', sessionSchema);
