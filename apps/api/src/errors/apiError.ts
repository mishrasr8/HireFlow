/**
 * The one error type the HTTP layer knows how to turn into a safe response.
 *
 * An error is "known" when we chose to throw it: the status code and the
 * message were written by us and are safe to show a client. Anything else that
 * reaches the error handler is treated as a bug, logged in full, and reported
 * to the client as a bare 500.
 *
 * This distinction is the reason the type exists. Without it, every layer would
 * have to guess whether `err.message` is safe to serialise, and the safe choice
 * (always send a generic message) would quietly make the API useless to
 * diagnose. See `middleware/errorHandler.ts`.
 */
import { ERROR_CODES, type ErrorCode } from '@hireflow/contracts';

/** Field-level detail, present only on validation failures. */
export interface ApiErrorDetail {
  readonly path: string;
  readonly message: string;
}

export class ApiError extends Error {
  /** HTTP status code to send. */
  readonly status: number;

  /** Stable machine-readable code from the shared contract. */
  readonly code: ErrorCode;

  /** Optional field-level detail. Never contains raw user input. */
  readonly details: readonly ApiErrorDetail[] | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: readonly ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;

    // Node/V8 only. Removes this constructor from the stack so the reported
    // location is the `throw`, not `new ApiError(...)`.
    Error.captureStackTrace(this, ApiError);
  }

  /** 404 for a resource that does not exist, or a route that was never defined. */
  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, ERROR_CODES.NOT_FOUND, message);
  }

  /** 400 for input that is understood but not acceptable. */
  static badRequest(message: string, details?: readonly ApiErrorDetail[]): ApiError {
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
  }

  /** 401 for missing or invalid credentials. One message, never "which part was wrong". */
  static unauthenticated(message = 'Authentication required'): ApiError {
    return new ApiError(401, ERROR_CODES.UNAUTHENTICATED, message);
  }

  /** 409 when the request conflicts with existing state, e.g. a duplicate email. */
  static conflict(message: string): ApiError {
    return new ApiError(409, ERROR_CODES.CONFLICT, message);
  }
}
