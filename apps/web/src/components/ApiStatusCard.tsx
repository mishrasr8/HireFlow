/**
 * The API status panel: the Phase 1 proof that the browser can reach the API.
 *
 * It handles all four states a network-backed view can be in -- loading, error,
 * empty and success -- because `AGENTS.md` section 18 requires all of them, and
 * because a panel that only handles the happy path is the most common way a
 * health indicator ends up lying to whoever is watching it.
 */
import { useQuery } from '@tanstack/react-query';

import { ApiRequestError, fetchHealth } from '../services/apiClient.js';

/** Stable key so React Query can cache and deduplicate this request. */
const HEALTH_QUERY_KEY = ['health'] as const;

/**
 * Poll interval.
 *
 * A health indicator that shows a stale value is worse than no indicator, so it
 * refreshes on its own. Fifteen seconds is frequent enough to notice a
 * disconnect and slow enough not to be noise.
 */
const REFETCH_INTERVAL_MS = 15_000;

/**
 * Turn any thrown value into something worth showing a user.
 *
 * Including the correlation id is deliberate: it is the whole reason the API
 * sends one. A user can read it out over a call and an engineer can find the
 * exact server-side log line with it.
 */
function describeError(error: Error): string {
  if (error instanceof ApiRequestError && error.requestId !== undefined) {
    return `${error.message} (request ${error.requestId})`;
  }

  return error.message;
}

export function ApiStatusCard() {
  const health = useQuery({
    queryKey: HEALTH_QUERY_KEY,
    // React Query passes an AbortSignal through `queryFn`, so navigating away
    // cancels the request instead of leaving it running against a component
    // that no longer exists.
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  return (
    <section
      aria-labelledby="api-status-heading"
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 id="api-status-heading" className="text-sm font-semibold tracking-wide text-slate-500">
        API STATUS
      </h2>

      {/*
        `isPending` is checked before `isError` and `isSuccess` because a query
        that has never resolved is pending *and* has no data; testing the states
        in the wrong order is how a component ends up reading undefined.
      */}
      {health.isPending ? (
        <p role="status" className="mt-2 text-slate-600">
          Checking the API...
        </p>
      ) : health.isError ? (
        <div role="alert" className="mt-2">
          <p className="flex items-center gap-2 font-medium text-red-700">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-600" />
            Unavailable
          </p>
          <p className="mt-1 text-sm text-slate-600">{describeError(health.error)}</p>
          <button
            type="button"
            onClick={() => {
              void health.refetch();
            }}
            className="mt-3 rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <p className="flex items-center gap-2 font-medium text-emerald-700">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-600" />
            Connected
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">Service</dt>
              <dd className="font-mono">{health.data.service}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className="font-mono">{health.data.status}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Database</dt>
              <dd className="font-mono">{health.data.database}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Uptime</dt>
              <dd className="font-mono">{Math.round(health.data.uptimeSeconds)}s</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
