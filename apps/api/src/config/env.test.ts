/**
 * Configuration validation tests.
 *
 * These are the clearest demonstration of the rule that compile-time and
 * runtime safety are separate concerns: `process.env` is `string | undefined`
 * to TypeScript, and none of the failures below could ever be caught by `tsc`.
 */
import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

/** A configuration that is valid, used as the base for each case. */
const VALID_ENV = {
  NODE_ENV: 'development',
  PORT: '4000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/hireflow',
  CORS_ORIGINS: 'http://localhost:5173',
} satisfies Record<string, string>;

describe('parseEnv', () => {
  it('returns a typed config when every value is valid', () => {
    const env = parseEnv(VALID_ENV);

    expect(env.NODE_ENV).toBe('development');
    // The string "4000" became the number 4000, which is the whole point of
    // coercing here and validating the result.
    expect(env.PORT).toBe(4000);
    expect(env.MONGODB_URI).toBe('mongodb://127.0.0.1:27017/hireflow');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('coerces PORT to a number rather than leaving it a string', () => {
    expect(typeof parseEnv(VALID_ENV).PORT).toBe('number');
  });

  it('accepts a mongodb+srv connection string for a hosted database', () => {
    const env = parseEnv({
      ...VALID_ENV,
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.mongodb.net/hireflow',
    });

    expect(env.MONGODB_URI).toMatch(/^mongodb\+srv:\/\//);
  });

  it('defaults NODE_ENV to development when it is absent', () => {
    const { NODE_ENV, ...withoutNodeEnv } = VALID_ENV;

    expect(NODE_ENV).toBe('development');
    expect(parseEnv(withoutNodeEnv).NODE_ENV).toBe('development');
  });

  it('parses several origins and trims stray whitespace', () => {
    const env = parseEnv({
      ...VALID_ENV,
      CORS_ORIGINS: 'http://localhost:5173 , https://hireflow.example ,',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://hireflow.example']);
  });

  it('rejects a configuration that is missing a required variable', () => {
    // Built by omission rather than by spreading an empty override: spreading
    // `{}` over the valid config changes nothing, so the test would pass
    // without ever testing anything.
    const { MONGODB_URI, ...withoutDatabase } = VALID_ENV;

    expect(MONGODB_URI).toBeTruthy();
    expect(() => parseEnv(withoutDatabase)).toThrow('MONGODB_URI');
  });

  it.each([
    ['a non-numeric PORT', { PORT: 'four thousand' }, 'PORT'],
    ['a PORT above the valid range', { PORT: '70000' }, 'PORT'],
    ['a fractional PORT', { PORT: '80.5' }, 'PORT'],
    [
      'a MongoDB URI with the wrong scheme',
      { MONGODB_URI: 'postgres://localhost/hire' },
      'MONGODB_URI',
    ],
    ['an empty origin list', { CORS_ORIGINS: '   ' }, 'CORS_ORIGINS'],
    ['an unknown NODE_ENV', { NODE_ENV: 'staging' }, 'NODE_ENV'],
  ] as const)('rejects %s', (_label, overrides, expectedKey) => {
    const attempt = () => parseEnv({ ...VALID_ENV, ...overrides });

    expect(attempt).toThrow();
    expect(attempt).toThrow(expectedKey);
  });

  it('explains how to fix the problem, not just that there is one', () => {
    // A zod error dump would tell a developer that a string failed a union.
    // This message names the variable and points at .env.example.
    expect(() => parseEnv({})).toThrow(/Copy \.env\.example to \.env/);
  });
});
