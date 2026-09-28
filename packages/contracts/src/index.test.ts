import { describe, expect, it } from 'vitest';

import { ERROR_CODES, ERROR_CODE_VALUES, errorCodeSchema, healthResponseSchema } from './index.js';

/**
 * These tests protect the contract itself rather than any consumer of it.
 * The API and the web app both import these definitions, so if a shape changes
 * here every consumer changes with it. That should fail loudly here first,
 * where the failure is easy to read.
 */
describe('healthResponseSchema', () => {
  const validBody = {
    success: true as const,
    data: {
      service: 'hireflow-api',
      status: 'ok' as const,
      timestamp: '2026-09-28T00:00:00.000Z',
      uptimeSeconds: 12.5,
      database: 'connected' as const,
    },
  };

  it('accepts a well-formed health response', () => {
    expect(healthResponseSchema.safeParse(validBody).success).toBe(true);
  });

  it('rejects a response whose status is not a known value', () => {
    const result = healthResponseSchema.safeParse({
      ...validBody,
      data: { ...validBody.data, status: 'probably-fine' },
    });

    expect(result.success).toBe(false);
  });

  it('rejects a response missing the database state', () => {
    const { database, ...withoutDatabase } = validBody.data;

    // Referenced so the destructured value is not reported as unused, and the
    // assertion documents what the omission actually removes.
    expect(database).toBe('connected');
    expect(healthResponseSchema.safeParse({ ...validBody, data: withoutDatabase }).success).toBe(
      false,
    );
  });

  it('rejects a negative uptime', () => {
    const result = healthResponseSchema.safeParse({
      ...validBody,
      data: { ...validBody.data, uptimeSeconds: -1 },
    });

    expect(result.success).toBe(false);
  });

  it('rejects a bare health payload with no success envelope', () => {
    // The envelope is what makes a response unambiguous to a client, so a
    // payload arriving without it is a contract violation.
    expect(healthResponseSchema.safeParse(validBody.data).success).toBe(false);
  });
});

describe('error codes', () => {
  it('exposes stable machine-readable codes', () => {
    expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });

  it('keeps the named map and the schema in step', () => {
    // The map exists for readability and the tuple exists for Zod. This is the
    // test that stops the two drifting apart at runtime as well as at compile
    // time.
    expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect([...ERROR_CODE_VALUES]).toContain(ERROR_CODES.VALIDATION_ERROR);
  });

  it('accepts every declared code and rejects anything else', () => {
    for (const code of ERROR_CODE_VALUES) {
      expect(errorCodeSchema.safeParse(code).success).toBe(true);
    }

    expect(errorCodeSchema.safeParse('TEAPOT').success).toBe(false);
  });
});
