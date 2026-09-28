/**
 * The single place the browser talks to the API.
 *
 * Two rules are enforced here so that no component ever has to remember them:
 *
 *  1. **Never trust a response.** Every response is validated against the
 *     shared Zod contract from `@hireflow/contracts` before any component sees
 *     it. A `HealthData` type says nothing about whether the server actually
 *     sent that shape -- a stale deploy, a proxy that rewrites bodies, or a bug
 *     in a controller would all be invisible to TypeScript. Zod is what turns
 *     "the compiler agrees" into "the bytes agree".
 *
 *  2. **Never let a raw failure escape.** Everything is normalised into
 *     `ApiRequestError`, so a component handles a network failure, a timeout, a
 *     cancellation and a server error through one code path instead of four.
 *
 * Keeping this in one module is what `AGENTS.md` section 20 asks for: raw HTTP
 * calls do not belong scattered through components.
 */
import { apiFailureSchema, healthResponseSchema, type HealthData } from '@hireflow/contracts';

import { API_BASE_URL } from '../config/env.js';

/**
 * Abort a request that has not answered within this long.
 *
 * Without a timeout, a request to an unreachable host can hang until the browser
 * gives up, leaving the UI in a "checking" state with no explanation.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** Every failure this client can produce, in one shape. */
export class ApiRequestError extends Error {
  /** HTTP status, or 0 when the request never produced a response. */
  readonly status: number;

  /** Server error code when the failure came from the API. */
  readonly code: string;

  /** Correlation id, when the API sent one. */
  readonly requestId: string | undefined;

  constructor(
    message: string,
    options: { readonly status: number; readonly code: string; readonly requestId?: string },
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Perform a GET and return the parsed body, whatever its status.
 *
 * The status check is separated from contract validation on purpose. The caller
 * needs to know the difference between "the API said 404" and "the API said 200
 * with something unexpected", and collapsing them into one generic error would
 * throw that away.
 */
async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    // A distinguishable reason is what lets the catch below tell our own
    // timeout apart from a cancellation requested by the caller.
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, REQUEST_TIMEOUT_MS);

  const abortFromCaller = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  if (signal?.aborted) {
    abortFromCaller();
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // Phase 0 decision `D-011` authenticates with an httpOnly session cookie,
      // so credentials are sent from the start. Adding this later would mean
      // touching every call site, and forgetting one is an invisible bug.
      credentials: 'include',
      signal: controller.signal,
    });

    // `json()` rejects on an empty or non-JSON body. That is not exceptional
    // here -- a proxy error page arrives as HTML -- so it becomes `undefined`
    // and is reported as an unhelpful response below rather than as a crash.
    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      // Reuse the server's own error envelope when it is well formed, so the
      // UI can show the message the API chose to show.
      const failure = apiFailureSchema.safeParse(body);

      if (failure.success) {
        throw new ApiRequestError(failure.data.error.message, {
          status: response.status,
          code: failure.data.error.code,
          requestId: failure.data.error.requestId,
        });
      }

      throw new ApiRequestError(`Request failed with status ${response.status}`, {
        status: response.status,
        code: 'HTTP_ERROR',
      });
    }

    return body;
  } catch (error: unknown) {
    if (isAbortError(error)) {
      const reason: unknown = controller.signal.reason;

      if (reason instanceof DOMException && reason.name === 'TimeoutError') {
        throw new ApiRequestError('The API did not respond in time.', {
          status: 0,
          code: 'TIMEOUT',
        });
      }

      // A genuine cancellation (the component unmounted, the user navigated).
      // Rethrowing unchanged lets the caller recognise it and stay quiet
      // instead of showing an error for something the user did not ask for.
      throw error;
    }

    if (error instanceof ApiRequestError) {
      throw error;
    }

    // DNS failure, connection refused, mixed-content block, CORS rejection.
    throw new ApiRequestError('The API could not be reached.', {
      status: 0,
      code: 'NETWORK_ERROR',
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Fetch and validate the API health snapshot. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthData> {
  const body = await getJson('/api/health', signal);
  const parsed = healthResponseSchema.safeParse(body);

  if (!parsed.success) {
    // The server answered 200 with something that is not the agreed shape.
    // That is a genuine fault worth surfacing, and it is exactly the case that
    // a TypeScript-only client would silently render as a broken page.
    throw new ApiRequestError('The API returned an unexpected response shape.', {
      status: 0,
      code: 'INVALID_RESPONSE',
    });
  }

  return parsed.data.data;
}
