/**
 * Authentication API contracts: registration and login.
 *
 * This module is the wire surface for Phase 4.1. It defines exactly what the
 * client may send and exactly what the API promises to send back. Two rules
 * shape everything here:
 *
 *  - Request schemas necessarily carry the password: the client must supply it
 *    to register or log in. That is inbound only.
 *  - Response schemas must never contain `password`, `passwordHash`, `sessionId`
 *    or any future session secret (`FR-005`, `NFR-S-003`). The password hash is
 *    a server-side secret the client must not be able to learn, and a session
 *    identifier does not exist yet -- this phase verifies credentials but does
 *    not create a session (`D-011` scope: Phase 4.1 stops before sessions).
 *
 * The capability set also lives here now: registration puts capabilities on the
 * wire, so the wire enum is the source of truth and the persistence schema in
 * `apps/api/src/models/constants.ts` derives its values from it. If the two
 * ever disagreed, a client could be told "accepted" for a capability the
 * database would refuse to store, or vice versa.
 */
import { z } from 'zod';

import { apiSuccessSchema } from './envelope.js';

/**
 * The capabilities an account may hold in the MVP (`D-001`, `D-013`).
 *
 * Registration selects exactly one initial capability (`FR-002`, `FR-003`);
 * acquiring the other later is handled by the invitation flow, not by this
 * phase. Declared as a readonly tuple so `z.enum` accepts it directly.
 */
export const CAPABILITY_VALUES = ['CANDIDATE', 'RECRUITER'] as const;

/** Runtime schema for a capability value. */
export const capabilitySchema = z.enum(CAPABILITY_VALUES);

export type Capability = z.infer<typeof capabilitySchema>;

/**
 * Field bounds. Password length is a trade-off: a minimum of 8 rejects
 * trivially weak credentials, while the 128 maximum bounds how expensive one
 * hash can be (scrypt cost scales with input length, so an unbounded maximum
 * is a denial-of-service lever).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 320;

/**
 * Body of `POST /api/auth/register`.
 *
 * `trim()` is applied to `email` and `name` before the other checks run, so a
 * value padded with whitespace is neither accepted as valid nor stored with
 * the padding. Lowercasing the email is deliberately *not* done here: the
 * service normalizes it with the same rule the User schema applies when
 * storing, so the wire schema does not silently depend on service internals.
 */
export const registerRequestSchema = z.object({
  email: z.string().trim().email().max(EMAIL_MAX_LENGTH),
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  capability: capabilitySchema,
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/**
 * Body of `POST /api/auth/login`.
 *
 * The password bound repeats the registration maximum so oversized input is
 * rejected before any hashing happens (login does the same expensive
 * derivation as registration).
 */
export const loginRequestSchema = z.object({
  email: z.string().trim().email().max(EMAIL_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * The safe representation of a user that the API returns.
 *
 * This is the *only* user shape allowed on the wire. It carries identity and
 * capabilities -- nothing that is secret server-side. The absence of a
 * `passwordHash` field is enforced by tests on every auth endpoint, not just
 * stated here.
 */
export const userResponseSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  capabilities: z.array(capabilitySchema).min(1),
});

export type UserResponse = z.infer<typeof userResponseSchema>;

/** Full successful body of `POST /api/auth/register`. */
export const registerResponseSchema = apiSuccessSchema(userResponseSchema);

export type RegisterResponse = z.infer<typeof registerResponseSchema>;

/** Full successful body of `POST /api/auth/login`. */
export const loginResponseSchema = apiSuccessSchema(userResponseSchema);

export type LoginResponse = z.infer<typeof loginResponseSchema>;
