/**
 * Contract tests for the authentication endpoints.
 *
 * These tests protect the *contract* itself: the request shapes the API
 * accepts and the response shapes it promises. Convincing the schemas is the
 * first line of defence, so a schema that lets a malformed body through shows
 * up here before any endpoint exists to be attacked.
 *
 * One security property needs explaining: `userResponseSchema` is not strict,
 * so an object *with* an extra `passwordHash` key would still parse (Zod strips
 * unknown keys by default). The "never expose the hash" guarantee therefore
 * has two layers: the response schema omits the field, and the API tests assert
 * that the serialized response really does not contain it. The schema test
 * below asserts the strip behaviour -- an incoming extra field is never passed
 * through to the caller (`NFR-S-004`).
 */
import { describe, expect, it } from 'vitest';

import {
  loginRequestSchema,
  registerRequestSchema,
  registerResponseSchema,
  userResponseSchema,
} from './index.js';

const VALID_REGISTER = {
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  password: 'correct-horse-battery',
  capability: 'CANDIDATE',
} as const;

describe('registerRequestSchema', () => {
  it('accepts a valid registration body', () => {
    expect(registerRequestSchema.safeParse(VALID_REGISTER).success).toBe(true);
  });

  it('trims whitespace from email and name before validation', () => {
    const result = registerRequestSchema.safeParse({
      ...VALID_REGISTER,
      email: '  ada@example.com ',
      name: '  Ada  ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('ada@example.com');
      expect(result.data.name).toBe('Ada');
    }
  });

  it('rejects an invalid email', () => {
    const result = registerRequestSchema.safeParse({ ...VALID_REGISTER, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing or blank name', () => {
    expect(registerRequestSchema.safeParse({ ...VALID_REGISTER, name: '' }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...VALID_REGISTER, name: '   ' }).success).toBe(false);
  });

  it('rejects a password below the minimum length and above the maximum', () => {
    expect(registerRequestSchema.safeParse({ ...VALID_REGISTER, password: 'short' }).success).toBe(
      false,
    );
    expect(
      registerRequestSchema.safeParse({ ...VALID_REGISTER, password: 'x'.repeat(129) }).success,
    ).toBe(false);
  });

  it('rejects an unknown capability value (closed set, D-001)', () => {
    const result = registerRequestSchema.safeParse({ ...VALID_REGISTER, capability: 'ADMIN' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing capability', () => {
    const { capability: _capability, ...withoutCapability } = VALID_REGISTER;
    expect(registerRequestSchema.safeParse(withoutCapability).success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  const valid = { email: 'ada@example.com', password: 'correct-horse-battery' } as const;

  it('accepts valid credentials', () => {
    expect(loginRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a missing email or password', () => {
    const { password: _password, ...withoutPassword } = valid;
    const { email: _email, ...withoutEmail } = valid;

    expect(loginRequestSchema.safeParse(withoutPassword).success).toBe(false);
    expect(loginRequestSchema.safeParse(withoutEmail).success).toBe(false);
  });

  it('rejects an invalid email shape', () => {
    expect(loginRequestSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
  });
});

describe('userResponseSchema', () => {
  const validUser = {
    id: '507f1f77bcf86cd799439011',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    capabilities: ['CANDIDATE'],
  } as const;

  it('accepts a safe user representation', () => {
    expect(userResponseSchema.safeParse(validUser).success).toBe(true);
  });

  it('rejects a user with no capabilities', () => {
    expect(userResponseSchema.safeParse({ ...validUser, capabilities: [] }).success).toBe(false);
  });

  it('never passes through fields that were not part of the contract', () => {
    // NFR-S-004: unknown fields are not passed through. A payload that tries
    // to smuggle a hash is stripped, so the parsed value cannot contain it.
    const parsed = userResponseSchema.parse({ ...validUser, passwordHash: 'x'.repeat(60) });

    expect(parsed).not.toHaveProperty('passwordHash');
    expect(Object.keys(parsed)).toEqual(['id', 'email', 'name', 'capabilities']);
  });
});

describe('registerResponseSchema', () => {
  it('wraps a safe user in the success envelope', () => {
    const result = registerResponseSchema.safeParse({
      success: true,
      data: {
        id: '507f1f77bcf86cd799439011',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        capabilities: ['RECRUITER'],
      },
    });

    expect(result.success).toBe(true);
  });

  it('strips a smuggled passwordHash from the parsed response data', () => {
    // A server bug that accidentally serialised the hash would send this shape.
    // The successful parse must not retain the field, and the API tests pin the
    // serialised body on top of this.
    const parsed = registerResponseSchema.parse({
      success: true,
      data: {
        id: '507f1f77bcf86cd799439011',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        capabilities: ['CANDIDATE'],
        passwordHash: 'x'.repeat(60),
      },
    });

    expect(parsed.data).not.toHaveProperty('passwordHash');
    expect(Object.keys(parsed.data)).toEqual(['id', 'email', 'name', 'capabilities']);
  });
});
