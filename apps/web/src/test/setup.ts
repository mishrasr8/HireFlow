/**
 * Test setup, run before every test file.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Set before any module under test reads it.
 *
 * These three imports do not touch `import.meta.env`, so this assignment is the
 * first thing that does -- and it runs before the test file's own imports,
 * because setup files are evaluated first. The alternative would be to depend on
 * a developer's local `.env`, which is gitignored, so a fresh clone would fail
 * its own test suite for no good reason.
 */
import.meta.env.VITE_API_BASE_URL = 'http://localhost:4000';

// Unmount between tests. Without this, components from one test stay in the
// document and queries match text from the previous test.
afterEach(cleanup);
