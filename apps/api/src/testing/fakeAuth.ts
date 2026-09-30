/**
 * Test-only fake of the auth service.
 *
 * Kept in `testing/` (excluded from the production build, like
 * `parseOrThrow.ts`) because it exists solely so `createApp` can be built
 * offline: the HTTP layer's behaviour under test is the pipeline, the Zod
 * schemas and the error handler, not the service's database access. Service
 * logic itself is tested for real in `services/auth.service.test.ts` with an
 * in-memory store.
 */
import type { UserResponse } from '@hireflow/contracts';

import type { AuthService } from '../services/auth.service.js';

/** A default identity both fake operations return unless overridden. */
const FAKE_USER: UserResponse = {
  id: '507f1f77bcf86cd799439011',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  capabilities: ['CANDIDATE'],
};

/**
 * Build a fake auth service. Pass an override (for example
 * `{ registerUser: async () => { throw ApiError.conflict(...) } }`) to shape a
 * specific test.
 */
export function createFakeAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    registerUser: () => Promise.resolve({ ...FAKE_USER }),
    verifyLogin: () => Promise.resolve({ ...FAKE_USER }),
    getUserById: () => Promise.resolve({ ...FAKE_USER }),
    ...overrides,
  };
}
