/**
 * Unit tests for the authentication service.
 *
 * The store is faked in memory, so these tests are offline and deterministic;
 * hashing is real (see `password.service.test.ts`). The production store
 * (`services/userStore.ts`) is exercised against MongoDB manually, exactly like
 * the Phase 3 index behaviour -- uniqueness under concurrency is a property of
 * the database, asserted by the index test in `models.test.ts` and verified
 * against a live database in the manual verification step.
 */
import { describe, expect, it } from 'vitest';

import { ApiError } from '../errors/apiError.js';
import {
  createAuthService,
  normalizeEmail,
  toSafeUser,
  type NewUserInput,
  type UserAccount,
  type UserStore,
} from './auth.service.js';
import { hashPassword } from './password.service.js';

const PASSWORD = 'correct-horse-battery-staple';

/** Capture the rejection of a promise so its value can be asserted precisely. */
async function captureError<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

interface FakeStore {
  readonly store: UserStore;
  readonly inserted: NewUserInput[];
  readonly findCalls: string[];
}

/**
 * An in-memory store. `insertAccount` throws a simulated MongoDB duplicate-key
 * error when the email already exists, so the service's error translation can
 * be tested the same way production hits it (relying on the unique index, not
 * on a pre-check).
 */
function createFakeStore(seed: UserAccount[] = []): FakeStore {
  const records: UserAccount[] = [...seed];
  const inserted: NewUserInput[] = [];
  const findCalls: string[] = [];

  return {
    inserted,
    findCalls,
    store: {
      insertAccount(input) {
        inserted.push(input);
        if (records.some((account) => account.email === input.email)) {
          const error = new Error(
            'E11000 duplicate key error collection: hireflow.users index: email_1',
          );
          Object.assign(error, { name: 'MongoServerError', code: 11000 });
          throw error;
        }

        const account: UserAccount = {
          id: 'user-new',
          email: input.email,
          name: input.name,
          capabilities: [...input.capabilities],
          passwordHash: input.passwordHash,
        };
        records.push(account);
        return Promise.resolve(account);
      },

      findByEmail(email) {
        findCalls.push(email);
        return Promise.resolve(records.find((account) => account.email === email) ?? null);
      },

      findById(id) {
        findCalls.push(`id:${id}`);
        return Promise.resolve(records.find((account) => account.id === id) ?? null);
      },
    },
  };
}

describe('registerUser', () => {
  it('creates an account with a normalized email and the selected capability', async () => {
    const { store, inserted } = createFakeStore();
    const auth = createAuthService(store);

    const user = await auth.registerUser({
      email: '  Ada@Example.COM ',
      name: '  Ada Lovelace  ',
      password: PASSWORD,
      capability: 'CANDIDATE',
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.email).toBe('ada@example.com');
    expect(inserted[0]?.name).toBe('Ada Lovelace');
    expect(inserted[0]?.capabilities).toEqual(['CANDIDATE']);
    expect(user.email).toBe('ada@example.com');
    expect(user.capabilities).toEqual(['CANDIDATE']);
  });

  it('stores a hash, never the plaintext password', async () => {
    const { store, inserted } = createFakeStore();
    const auth = createAuthService(store);

    await auth.registerUser({
      email: 'ada@example.com',
      name: 'Ada',
      password: PASSWORD,
      capability: 'RECRUITER',
    });

    const storedHash = inserted[0]?.passwordHash;
    expect(storedHash).toBeDefined();
    expect(storedHash).not.toBe(PASSWORD);
    expect(storedHash).not.toContain(PASSWORD);
    expect(storedHash?.startsWith('scrypt:')).toBe(true);
  });

  it('returns exactly the safe user fields and never the hash', async () => {
    const { store } = createFakeStore();
    const auth = createAuthService(store);

    const user = await auth.registerUser({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      password: PASSWORD,
      capability: 'CANDIDATE',
    });

    expect(Object.keys(user)).toEqual(['id', 'email', 'name', 'capabilities']);
    expect(user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(user)).not.toContain('passwordHash');
  });

  it('maps the database duplicate-key error to a 409 conflict', async () => {
    // Seed an account so the store's unique rule fires, exactly as MongoDB's
    // unique index would.
    const { store } = createFakeStore([
      {
        id: 'existing-user',
        email: 'ada@example.com',
        name: 'Ada',
        capabilities: ['CANDIDATE'],
        passwordHash: 'x'.repeat(60),
      },
    ]);
    const auth = createAuthService(store);

    const error = await captureError(
      auth.registerUser({
        email: 'ADA@example.com',
        name: 'Another Ada',
        password: PASSWORD,
        capability: 'RECRUITER',
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('lets unexpected store errors propagate untouched', async () => {
    const failingStore: UserStore = {
      insertAccount: () => Promise.reject(new Error('connection pool exhausted at 10.0.0.5:27017')),
      findByEmail: () => Promise.resolve(null),
      findById: () => Promise.resolve(null),
    };
    const auth = createAuthService(failingStore);

    const error = await captureError(
      auth.registerUser({
        email: 'ada@example.com',
        name: 'Ada',
        password: PASSWORD,
        capability: 'CANDIDATE',
      }),
    );

    // Not translated into an ApiError: the error handler decides how it is
    // surfaced (a bare 500, never a leaked message).
    expect(error instanceof ApiError).toBe(false);
    expect(error).toMatchObject({ message: 'connection pool exhausted at 10.0.0.5:27017' });
  });
});

describe('verifyLogin', () => {
  function seededAuth(hash: string) {
    const fake = createFakeStore([
      {
        id: 'the-user',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        capabilities: ['CANDIDATE', 'RECRUITER'],
        passwordHash: hash,
      },
    ]);
    return { auth: createAuthService(fake.store), fake };
  }

  it('returns the safe user for valid credentials', async () => {
    const hash = await hashPassword(PASSWORD);
    const { auth, fake } = seededAuth(hash);

    const user = await auth.verifyLogin({ email: 'ADA@Example.COM', password: PASSWORD });

    // The lookup used the same normalization the schema applies when storing.
    expect(fake.findCalls).toEqual(['ada@example.com']);
    expect(user.id).toBe('the-user');
    expect(user.capabilities).toEqual(['CANDIDATE', 'RECRUITER']);
    expect(Object.keys(user)).toEqual(['id', 'email', 'name', 'capabilities']);
  });

  it('rejects a wrong password with the generic authentication failure', async () => {
    const hash = await hashPassword(PASSWORD);
    const { auth } = seededAuth(hash);

    const error = await captureError(
      auth.verifyLogin({ email: 'ada@example.com', password: 'not-the-password' }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password',
    });
  });

  it('rejects an unknown account with the identical generic failure', async () => {
    const hash = await hashPassword(PASSWORD);
    const { auth } = seededAuth(hash);

    const error = await captureError(
      auth.verifyLogin({ email: 'nobody@example.com', password: PASSWORD }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password',
    });
  });

  it('makes wrong-password and unknown-account failures indistinguishable (FR-007)', async () => {
    const hash = await hashPassword(PASSWORD);
    const { auth } = seededAuth(hash);

    const wrongPassword = await captureError(
      auth.verifyLogin({ email: 'ada@example.com', password: 'wrong' }),
    );
    const unknownAccount = await captureError(
      auth.verifyLogin({ email: 'nobody@example.com', password: PASSWORD }),
    );

    const shape = (error: unknown) => {
      const apiError = error as ApiError;
      return { status: apiError.status, code: apiError.code, message: apiError.message };
    };

    expect(shape(wrongPassword)).toEqual(shape(unknownAccount));
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases, matching the User schema normalization', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(normalizeEmail('ada@example.com')).toBe('ada@example.com');
  });
});

describe('toSafeUser', () => {
  it('drops the hash and copies capabilities', () => {
    const safe = toSafeUser({
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada',
      capabilities: ['CANDIDATE'],
      passwordHash: 'x'.repeat(60),
    });

    expect(safe).toEqual({
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada',
      capabilities: ['CANDIDATE'],
    });
    expect(safe).not.toHaveProperty('passwordHash');
  });
});

describe('getUserById', () => {
  it('returns the safe user (never the hash) for a known id', async () => {
    const { store } = createFakeStore([
      {
        id: 'the-user',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        capabilities: ['CANDIDATE', 'RECRUITER'],
        passwordHash: 'a'.repeat(64),
      },
    ]);
    const auth = createAuthService(store);

    const user = await auth.getUserById('the-user');

    expect(user).not.toBeNull();
    if (user !== null) {
      expect(user.email).toBe('ada@example.com');
      expect(user.capabilities).toEqual(['CANDIDATE', 'RECRUITER']);
    }
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('returns null for an unknown id', async () => {
    const { store } = createFakeStore();
    const auth = createAuthService(store);

    expect(await auth.getUserById('missing-user')).toBeNull();
  });
});
