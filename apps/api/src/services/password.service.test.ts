/**
 * Tests for the password hashing boundary.
 *
 * These run the real `node:crypto` scrypt implementation -- the derivation
 * cost is a few tens of milliseconds per call, which is negligible for a test
 * suite. Hashing is the security primitive of this phase, so it is tested for
 * real rather than mocked: a mock would prove the code calls the function it
 * was written to call, not that passwords are actually protected.
 */
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password.service.js';

/** Mirror the module's promisified wrapper for the test that varies the cost. */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  cost: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, cost, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

const PASSWORD = 'correct-horse-battery-staple';

describe('hashPassword', () => {
  it('never returns the plaintext password', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).not.toContain(PASSWORD);
    expect(hash).not.toBe(PASSWORD);
  });

  it('returns the self-describing scrypt format', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash.split(':')).toHaveLength(6);
    expect(hash.startsWith('scrypt:')).toBe(true);
  });

  it('produces a different salt for every hash of the same password', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toBe(second);
  });

  it('produces a hash long enough for the User schema floor (60 chars)', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash.length).toBeGreaterThanOrEqual(60);
  });
});

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('verifies a hash produced with different, embedded cost parameters', async () => {
    // The stored string carries its own N/r/p, so a hash produced with a
    // different (here lower) cost still verifies. This is what makes raising
    // the cost in future non-breaking for existing users.
    const salt = randomBytes(16);
    const derived = await scryptAsync(PASSWORD, salt, 64, { N: 4096, r: 8, p: 1 });
    const stored = [
      'scrypt',
      '4096',
      '8',
      '1',
      salt.toString('base64url'),
      derived.toString('base64url'),
    ].join(':');

    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
    await expect(verifyPassword('not-it', stored)).resolves.toBe(false);
  });

  it('returns false, never throws, for a malformed stored value', async () => {
    await expect(verifyPassword(PASSWORD, 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD, '')).resolves.toBe(false);
    await expect(
      verifyPassword(PASSWORD, 'scrypt:16384:8:1:only-a-salt'.split(':').slice(0, 3).join(':')),
    ).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD, 'pbkdf2$1$2$3$x$y')).resolves.toBe(false);
  });

  it('rejects a stored value whose hash has the wrong length', async () => {
    // A truncated digest decodes to a short buffer; the length check must
    // reject it rather than comparing unequal-length buffers.
    const stored = 'scrypt:16384:8:1:' + 'a'.repeat(24) + ':' + 'b'.repeat(10);
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
  });
});
