/**
 * Centralised error handling.
 *
 * By the time anything reaches these two functions, no route produced a
 * response. This is the single place where a failure becomes JSON, which is
 * what makes the failure shape predictable for clients.
 *
 * ## Why a stack trace is never in the response
 *
 * A stack trace reveals file paths, dependency versions, internal function
 * names and sometimes configuration values. That is reconnaissance for an
 * attacker, and it turns a bug report from a user into a map of the system.
 * So the rule is absolute: the client gets a stable code, a human message, and
 * a correlation id. The id is echoed in the server log, where the full error --
 * including the stack -- is recorded. `NFR-S-004` requires this.
 */
import { ERROR_CODES, type ApiFailure, type ErrorCode } from '@hireflow/contracts';
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

import { ApiError, type ApiErrorDetail } from '../errors/apiError.js';

/**
 * Express marks a path as failed by calling `next(error)`. If no route matched
 * and nothing called `next()`, a request would hang until the client timed out.
 * Converting "no route matched" into a thrown `ApiError` here means it flows
 * through exactly the same path as every other failure.
 */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  // The message is deliberately generic. Echoing the requested path back would
  // reflect unvalidated input into the response body, which is unnecessary when
  // the request id already identifies the request in the logs.
  next(ApiError.notFound('Route not found'));
};

/** Narrow an `unknown` thrown value to something we can inspect safely. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Detect the error `express.json()` throws for a malformed JSON body.
 *
 * Without this branch a syntax error in a request body would be reported as a
 * 500, telling the caller the server broke when in fact the caller sent
 * something unparseable. It is a small branch with an outsized effect on how
 * correct the API feels.
 */
function isBodyParseError(error: unknown): boolean {
  return isRecord(error) && error['type'] === 'entity.parse.failed';
}

function sendFailure(
  res: Response,
  requestId: string,
  status: number,
  code: ErrorCode,
  message: string,
  details?: readonly ApiErrorDetail[],
): void {
  const body: ApiFailure = {
    success: false,
    error: {
      code,
      message,
      requestId,
      // Spread rather than `details: undefined`: the key is omitted entirely
      // when there is no detail, so the JSON matches the contract exactly.
      ...(details === undefined ? {} : { details: details.map((detail) => ({ ...detail })) }),
    },
  };

  res.status(status).json(body);
}

/**
 * Express recognises error middleware by arity, so the unused fourth parameter
 * must stay. It is named with a leading underscore, which is how both TypeScript
 * (`noUnusedParameters`) and ESLint are told that its absence is deliberate.
 */
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req,
  res,
  _next: Parameters<ErrorRequestHandler>[3],
): void => {
  const { requestId } = req;

  if (error instanceof ApiError) {
    sendFailure(res, requestId, error.status, error.code, error.message, error.details);
    return;
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));

    sendFailure(
      res,
      requestId,
      400,
      ERROR_CODES.VALIDATION_ERROR,
      'Request validation failed',
      details,
    );
    return;
  }

  if (isBodyParseError(error)) {
    sendFailure(
      res,
      requestId,
      400,
      ERROR_CODES.VALIDATION_ERROR,
      'Request body is not valid JSON',
    );
    return;
  }

  // Nothing below this line is expected. Log everything; tell the client only
  // what it needs to report the problem.
  console.error(`[api] unhandled error (requestId=${requestId})`, error);

  sendFailure(res, requestId, 500, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred');
};
