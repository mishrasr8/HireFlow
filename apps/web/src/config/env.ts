/**
 * Build-time configuration for the browser app.
 *
 * Note what this is *not*: a secret store. Everything Vite exposes to the
 * browser is public. A value that reaches this file is readable by anyone who
 * opens developer tools. Secrets belong to the API, and the browser only ever
 * sends the API a credential it cannot read.
 */

/**
 * Base URL of the API, without a trailing slash.
 *
 * Trailing slashes are stripped here rather than at each call site so that
 * `'' + '/api/health'` can never accidentally produce a double slash. That is
 * not a cosmetic concern: some proxies treat `/api//health` as a different path
 * from `/api/health`.
 */
function readApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  const trimmed = typeof configured === 'string' ? configured.trim() : '';

  if (trimmed.length === 0) {
    // Failing here is better than failing later. A missing base URL would
    // otherwise surface as a confusing "Failed to fetch" in the browser console
    // with nothing in the code pointing at the cause.
    throw new Error(
      'VITE_API_BASE_URL is not set. Copy .env.example to .env in the repository root and set it.',
    );
  }

  return trimmed.replace(/\/+$/, '');
}

export const API_BASE_URL = readApiBaseUrl();
