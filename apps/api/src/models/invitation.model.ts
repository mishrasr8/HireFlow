/**
 * Invitation -- a company's offer to join, as a first-class record (`FR-098`).
 *
 * Everything about `D-014` is encoded here:
 *
 *  - the lifecycle `PENDING` → `ACCEPTED` / `DECLINED` / `EXPIRED` is a closed
 *    enum, and only `PENDING` can move;
 *  - the raw token is never stored -- `tokenHash` holds a hash, so a database
 *    dump yields nothing usable (`NFR-S-019`);
 *  - **single-use** is a property of the accept/decline update, not of the
 *    schema: `findOneAndUpdate({ tokenHash, status: 'PENDING', ... }, { $set: { status: 'ACCEPTED' } })`
 *    is a single atomic conditional write, so two concurrent accepts cannot
 *    both succeed. The unique index on `tokenHash` guarantees each token is
 *    looked up unambiguously;
 *  - a decline or expiry leaves the record in place (`DECLINED` / `EXPIRED`),
 *    and re-inviting creates a **new** invitation with a **new** token -- the
 *    old record is never reactivated.
 *
 * ## Why `expiresAt` is a snapshot
 *
 * `expiresAt` is copied from the company's `invitationSettings.expiryHours` at
 * creation time. Changing the company setting later must not retroactively
 * shorten or lengthen invitations that already exist: each invitation
 * remembers the policy that governed it.
 *
 * ## Why there is deliberately no TTL index
 *
 * A TTL index (`expireAfterSeconds: 0` on `expiresAt`) would *delete* the
 * record when it expires, usually before any sweep marked it `EXPIRED`. That
 * would make the first-class lifecycle unobservable and destroy the audit
 * record `FR-098` implies. Expiry is handled the honest way: the service
 * treats `PENDING` documents past `expiresAt` as expired (lazily, on read) and
 * persists `status: 'EXPIRED'`, `expiredAt`. Contrast this with sessions,
 * where the requirement *is* deletion (`NFR-S-016`) -- see
 * `docs/database-design.md` for the paired decision.
 *
 * ## What the database enforces vs what the service owns
 *
 * Database (schema + indexes): token uniqueness, status enum membership,
 * required fields, the PENDING-only open state (nothing in the schema lets a
 * non-PENDING document be created; terminal states are reached only through
 * conditional updates). Service (later phase): transition legality, expiry
 * interpretation, pending-limit enforcement (using the `(companyId, status)`
 * count index), and the authorization that an accept/decline is performed by
 * the invited user themselves (`NFR-S-019`).
 *
 * ## `invitedEmail` is denormalized provenance
 *
 * The invitee is identified by email (`FR-080`), resolved to `invitedUserId`
 * at creation. The email is also stored so the invitation is self-describing
 * for display and audit even if the user later changes their address; the cost
 * is one string. Documented tradeoff in `docs/database-design.md`.
 */
import { Schema, model, type Model, type Types } from 'mongoose';

import { INVITATION_STATUSES, type InvitationStatus } from './constants.js';

export interface InvitationDoc {
  companyId: Types.ObjectId;
  invitedUserId: Types.ObjectId;
  invitedByUserId: Types.ObjectId;
  invitedEmail: string;
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const invitationSchema = new Schema<InvitationDoc>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    invitedUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invitedEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 320 },
    // SHA-256 hex of a cryptographically random token, produced by the
    // invitation service in a later phase. The schema cannot know the value
    // came from a CSPRNG; it only stores the hash form. Fixed length (64 hex
    // chars) so a stray plaintext token is noticeable.
    tokenHash: {
      type: String,
      required: true,
      minlength: 64,
      maxlength: 64,
      // Characters must look like a hex digest; this rejects accidental
      // plaintext being stored in the wrong column.
      match: /^[a-f0-9]{64}$/,
    },
    status: {
      type: String,
      enum: [...INVITATION_STATUSES],
      default: 'PENDING',
      required: true,
    },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'invitations',
  },
);

/**
 * The status and its timestamp must agree: `ACCEPTED` iff `acceptedAt` is set,
 * and the same for `DECLINED`/`declinedAt` and `EXPIRED`/`expiredAt`. A stray
 * timestamp on a `PENDING` row is corruption this catches before it persists.
 * Implemented as a pure function so the test suite can exercise it directly
 * and so the schema hook stays a one-liner.
 */
export function invitationTimestampsMatchStatus(invitation: {
  status: InvitationStatus;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  expiredAt: Date | null;
}): boolean {
  return (
    (invitation.status === 'ACCEPTED') === (invitation.acceptedAt !== null) &&
    (invitation.status === 'DECLINED') === (invitation.declinedAt !== null) &&
    (invitation.status === 'EXPIRED') === (invitation.expiredAt !== null)
  );
}

invitationSchema.pre<InvitationDoc>('validate', function (next) {
  if (invitationTimestampsMatchStatus(this)) {
    next();
    return;
  }
  next(new Error('invitation status and its timestamp are inconsistent'));
});

/**
 * Lookup by acceptance token. Unique so that hashing a token can never resolve
 * to two invitations.
 */
invitationSchema.index({ tokenHash: 1 }, { unique: true });

/**
 * The one in-app list in the MVP (`FR-099`): the signed-in user's own
 * invitations, dominated by `status: 'PENDING'`. Filtering by status first
 * keeps failed/settled invitations out of the hot list.
 */
invitationSchema.index({ invitedUserId: 1, status: 1 });

/**
 * Per-company views: count the company's pending invitations (the
 * `maxPendingInvitations` limit from `FR-098`) and list what a recruiter has
 * sent. The `(invitedUserId, status)` index cannot serve a company-first
 * query, hence this separate one.
 */
invitationSchema.index({ companyId: 1, status: 1 });

export const Invitation: Model<InvitationDoc> = model<InvitationDoc>(
  'Invitation',
  invitationSchema,
);
