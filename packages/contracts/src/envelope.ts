/**
 * The response envelope every Hireflow API endpoint returns.
 *
 * A single envelope shape is a deliberate constraint. It means a client can
 * write one success check and one failure check for the whole API, and it means
 * `success` is never ambiguous. Two response shapes (a bare object on success,
 * a wrapped object on failure) is the most common source of inconsistent client
 * error handling, and it is much cheaper to prevent now than to retrofit later.
 *
 * Note what this file is NOT: it is not validation. These types are erased when
 * the code runs. The Zod schemas below are what actually guarantee that a
 * response body matches the shape the types describe.
 */
import { z } from 'zod';

/**
 * Every machine-readable error code the API can return, in one place.
 *
 * Declared as a tuple first because Zod's `z.enum` needs a readonly tuple of
 * literals, and as an object afterwards because `ERROR_CODES.NOT_FOUND` reads
 * better at a call site than a bare string. The object is checked with
 * `satisfies` against the derived union, so the two can never drift apart: add
 * a code to the tuple and the object fails to compile until it is updated.
 */
export const ERROR_CODE_VALUES = ['NOT_FOUND', 'VALIDATION_ERROR', 'INTERNAL_ERROR'] as const;

export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];

/** Runtime schema for `ErrorCode`. */
export const errorCodeSchema = z.enum(ERROR_CODE_VALUES);

/**
 * Named access to the same values.
 *
 * These strings are a public contract: clients branch on them, so renaming one
 * is a breaking change.
 */
export const ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} satisfies Record<ErrorCode, ErrorCode>;

/** The `error` member of a failed response. */
export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  /**
   * Correlation id for this request, echoed in server logs so a user-reported
   * failure can be traced. Present on every failure, including 500s, because
   * "something went wrong" with no identifier is unactionable.
   */
  requestId: z.string().min(1),
  /** Field-level detail, present only for validation failures. */
  details: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Build the success envelope around a payload schema.
 *
 * Factored out so every success response composes the *same* envelope rather
 * than restating it. That is what guarantees `success: true` is present on
 * every 2xx body, which is the property that lets a client write one success
 * check instead of one per endpoint.
 */
export const apiSuccessSchema = <TData extends z.ZodTypeAny>(dataSchema: TData) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

/** A failed response. */
export const apiFailureSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
});

export type ApiFailure = z.infer<typeof apiFailureSchema>;

/**
 * A successful response, named abstractly.
 *
 * Written by hand rather than derived from `apiSuccessSchema`, because a generic
 * schema's inferred type cannot be parameterised. Concrete endpoints infer
 * their own response type from their composed schema instead, which is why
 * `HealthResponse` is a real, checked type.
 */
export interface ApiSuccess<TData> {
  success: true;
  data: TData;
}

/** The full set of shapes the API can return, for callers that handle both. */
export type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;
