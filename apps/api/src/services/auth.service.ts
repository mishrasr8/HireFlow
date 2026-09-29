/**
 * Authentication service: registration and credential verification.
 *
 * This phase verifies credentials; it does **not** create sessions, issue
 * identifiers or set cookies (that is the next step of Phase 4). The two
 * operations here prove two distinct facts:
 *
 *  - `registerUser` -- "this email is now an account with these credentials";
 *  - `verifyLogin` -- "these credentials are valid for this account".
 *
 * Neither proves "this browser is authenticated" -- that proof belongs to the
 * session phase (`FR-088` onwards, `D-011`).
 *
 * ## Dependencies are injected
 *
 * `createAuthService` takes the persistence boundary (`UserStore`) as an
 * argument instead of importing Mongoose. Two things fall out of that, exactly
 * as with `getDatabaseStatus` in the health service:
 *
 *  1. The service can be unit-tested with an in-memory fake store, so the
 *     login/registration logic is tested offline and deterministically.
 *  2. The HTTP layer never gains compile-time knowledge of Mongoose; the real
 *     store (`services/userStore.ts`) is wired in `server.ts` only.
 *
 * ## Duplicate email
 *
 * `registerUser` does not "check then insert": it attempts the insert and
 * translates the database's duplicate-key error into a `409 CONFLICT`. A
 * check-then-insert race (two requests both see "no account", both insert)
 * would be possible under concurrency -- the unique index is the final
 * authority (`FR-004`) and the duplicate-key error is how its decision is
 * reported back. The schema-level index is asserted in `models.test.ts`.
 *
 * ## One authentication failure message
 *
 * `FR-007` requires that a failed login not reveal whether the email exists.
 * Every failure path below throws the identical `401 UNAUTHENTICATED` with the
 * same message, so a client cannot distinguish "no such account" from "wrong
 * password" by reading the response. A separate concern is *timing*: a
 * nonexistent account would otherwise skip the expensive scrypt derivation and
 * respond measurably faster. `getDummyHash()` runs the derivation anyway and
 * discards the result, keeping the two paths close in duration.
 */
import type { LoginRequest, RegisterRequest, UserResponse } from '@hireflow/contracts';

import { ApiError } from '../errors/apiError.js';
import { hashPassword, verifyPassword } from './password.service.js';

/** A stored account with every field the auth logic needs. */
export interface UserAccount {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly capabilities: readonly ('CANDIDATE' | 'RECRUITER')[];
  readonly passwordHash: string;
}

/** Everything `insertAccount` needs to create a user. */
export interface NewUserInput {
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly capabilities: readonly ('CANDIDATE' | 'RECRUITER')[];
}

/**
 * The persistence boundary the auth logic depends on. Implemented for MongoDB
 * in `services/userStore.ts` and faked in tests.
 */
export interface UserStore {
  insertAccount(input: NewUserInput): Promise<UserAccount>;
  findByEmail(email: string): Promise<UserAccount | null>;
}

/** The operations the HTTP layer may invoke. */
export interface AuthService {
  registerUser(input: RegisterRequest): Promise<UserResponse>;
  verifyLogin(input: LoginRequest): Promise<UserResponse>;
}

/**
 * Normalize an email before any lookup or store, matching the User schema's
 * own `lowercase: true, trim: true` normalization. Idempotent, so applying it
 * twice is harmless; the guarantee is that the lookup key and the stored value
 * are always normalized the same way.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The only user shape allowed on the wire (the contract guarantees the rest).
 * Exported so tests can assert the mapping directly.
 */
export function toSafeUser(account: UserAccount): UserResponse {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    capabilities: [...account.capabilities],
  };
}

/**
 * MongoDB's error code for a unique-index violation. Deliberately not imported
 * from the driver: a fabricated error carrying this code is still a conflict,
 * and the auth layer does not need a dependency on MongoDB internals it does
 * not otherwise use.
 */
const DUPLICATE_KEY_ERROR_CODE = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE
  );
}

/**
 * A hash of a password that belongs to no account, derived lazily and cached.
 *
 * Used by `verifyLogin` when the email is unknown, so the "no such account"
 * path still performs the expensive scrypt derivation and does not answer
 * measurably faster than the "wrong password" path. The value never appears in
 * any response; it exists purely to equalize timing.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-that-belongs-to-no-account');
  return dummyHashPromise;
}

/** Build the auth service against a given store. */
export function createAuthService(store: UserStore): AuthService {
  return {
    async registerUser(input: RegisterRequest): Promise<UserResponse> {
      const email = normalizeEmail(input.email);
      const passwordHash = await hashPassword(input.password);

      try {
        const account = await store.insertAccount({
          email,
          name: input.name.trim(),
          passwordHash,
          capabilities: [input.capability],
        });

        return toSafeUser(account);
      } catch (error: unknown) {
        if (isDuplicateKeyError(error)) {
          throw ApiError.conflict('An account with this email already exists');
        }

        // Anything else is a genuine server failure; let the error handler
        // decide how it is surfaced (never as a leaked message).
        throw error;
      }
    },

    async verifyLogin(input: LoginRequest): Promise<UserResponse> {
      const email = normalizeEmail(input.email);
      const account = await store.findByEmail(email);

      // Verify against the real hash when the account exists; against a
      // dummy hash when it does not, so the "no such account" path costs a
      // derivation too. `credentialsValid` is false in both failure cases.
      const hash = account === null ? await getDummyHash() : account.passwordHash;
      const credentialsValid = await verifyPassword(input.password, hash);

      if (account === null || !credentialsValid) {
        // One message for every failure path (FR-007): wrong password and
        // unknown email are deliberately indistinguishable to the client.
        throw ApiError.unauthenticated('Invalid email or password');
      }

      return toSafeUser(account);
    },
  };
}
