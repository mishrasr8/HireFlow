/**
 * User -- the account.
 *
 * One document per human, keyed by a unique normalized email (`FR-004`,
 * `OQ-014`). This collection is deliberately small and is read on every
 * authenticated request; large, rarely-read profile data lives in
 * `CandidateProfile`, and the per-company relationship lives in
 * `CompanyMembership`.
 *
 * ## Capabilities, not a role
 *
 * `capabilities` is an array of values from a closed enum (`D-001`, `D-013`).
 * An account may hold both Candidate and Recruiter (`FR-010`, `FR-096`), which
 * a single `user.role === 'RECRUITER'` field cannot express. The array is the
 * DC-001-extensible shape: a third capability is a new enum value, not a
 * migration. There is deliberately *no* company reference here -- membership is
 * a separate relationship (`DC-012`).
 *
 * Capabilities are mutated with `$addToSet` by the authorization service so
 * the set can never contain duplicates; the schema also validates the invariant
 * so a buggy write cannot corrupt it silently.
 *
 * ## Password handling
 *
 * Only `passwordHash` is stored (`FR-005`, `NFR-S-002`); the raw password never
 * exists in MongoDB. The hash is produced by the authentication service
 * (`services/password.service.ts`, scrypt) and verified there; this schema only
 * demands a plausible hash and forbids plaintext in responses. Serialization is
 * additionally guarded at the schema level by a `toJSON` transform that deletes
 * the hash, so even a future code path that serializes a whole document cannot
 * accidentally ship it (defence in depth -- the service layer never returns it
 * in the first place).
 *
 * ## Email normalization
 *
 * `lowercase: true` and `trim: true` normalize the stored value, so the unique
 * index on `email` is case-insensitive by construction: `A@B.com` and
 * `a@b.com` cannot both be stored. The account's display name is the separate
 * `name` field, so losing the original casing of the email is acceptable
 * (see `docs/database-design.md` for the alternative that was rejected).
 */
import { Schema, model, type Model } from 'mongoose';

import { CAPABILITIES, type Capability } from './constants.js';

export interface UserDoc {
  email: string;
  name: string;
  passwordHash: string;
  capabilities: Capability[];
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 320 },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    passwordHash: {
      type: String,
      required: true,
      // A scrypt hash in this project's stored format is ~130 characters; the
      // 60-character floor still stands as the check that rejects a plaintext
      // or a corrupted short value. See `services/password.service.ts`.
      minlength: 60,
      maxlength: 255,
    },
    capabilities: {
      type: [{ type: String, enum: [...CAPABILITIES] }],
      required: true,
      validate: [
        {
          // A user must hold at least one capability (FR-002, FR-003).
          // Mongoose treats an *empty* array as satisfying `required`, so this
          // is the check that actually enforces "at least one".
          validator: (value: Capability[]) => value.length >= 1,
          message: 'capabilities must contain at least one capability',
        },
        {
          // A set, never a list: ['CANDIDATE','CANDIDATE'] is invalid. The
          // service uses $addToSet for this reason; this validator catches a
          // bug that bypasses it.
          validator: (value: Capability[]) => new Set(value).size === value.length,
          message: 'capabilities must not contain duplicates',
        },
      ],
    },
  },
  {
    timestamps: true,
    collection: 'users',
  },
);

/**
 * The only unique constraint on users: one account per email address
 * (`FR-004`, `OQ-014`). Values are already lowercased by the schema, so the
 * index is unique over normalized emails only. There is deliberately no index
 * on `capabilities`: the authorization query is by `_id` (already indexed),
 * not by capability, and "which users hold Recruiter?" is not an MVP query.
 */
userSchema.index({ email: 1 }, { unique: true });

// Serialization guard: a serialized user document must never carry the hash
// (FR-005, NFR-S-002). This is defence in depth -- the auth service already
// maps to a safe shape before anything is sent -- but it means a future code
// path that passes a whole document to `res.json()` still cannot leak it.
userSchema.set('toJSON', {
  transform: (_doc, ret, _options) => {
    // Destructure-and-discard removes the hash from the serialized
    // representation while leaving every other field untouched.
    const { passwordHash: _passwordHash, ...safe } = ret;
    return safe;
  },
});

export const User: Model<UserDoc> = model<UserDoc>('User', userSchema);
