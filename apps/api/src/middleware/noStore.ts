/**
 * Turn off the browser's HTTP cache for API responses.
 *
 * ## Why this is necessary
 *
 * This was found by making a real request rather than by reading the code: the
 * browser sent `If-None-Match` to `GET /api/health`, proving it had stored the
 * response and was revalidating it. A revalidation that returns `304 Not
 * Modified` makes the browser transparently replay the *stored* body, so the
 * client would see a frozen `timestamp` and `uptimeSeconds` -- and, worse, a
 * `status: "ok"` that stopped being true some time after the fact.
 *
 * ## The real problem
 *
 * There are two caches in play, and they do not know about each other:
 *
 *  1. the browser's HTTP cache, below the Fetch API and invisible to JavaScript;
 *  2. TanStack Query's cache, which the application can see and control.
 *
 * Two independent caches of the same resource is a well-known source of
 * "impossible" staleness bugs, because only one of them can be reasoned about
 * from application code.
 *
 * ## Why the API decides, not the client
 *
 * The API owns its representation, so the API is where the caching policy
 * belongs. This also covers the `curl` case, where there is no application
 * cache to compensate. Browsers do not cache a `no-store` response, and
 * TanStack Query's `staleTime` then becomes the single, visible source of truth
 * for how long data is considered fresh.
 */
import type { NextFunction, Request, Response } from 'express';

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  // `no-store` is stronger than `no-cache`: it also forbids writing the
  // response to disk, which matters more on shared machines than the extra
  // revalidation round trip costs.
  res.setHeader('Cache-Control', 'no-store');
  next();
}
