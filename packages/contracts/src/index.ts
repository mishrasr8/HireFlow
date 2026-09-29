/**
 * Public surface of `@hireflow/contracts`.
 *
 * Everything the web app and the API are allowed to share goes through here.
 * Keeping the entry point explicit means neither app can reach into another
 * app's internals by accident.
 */

export {
  ERROR_CODES,
  ERROR_CODE_VALUES,
  errorCodeSchema,
  apiErrorSchema,
  apiFailureSchema,
  apiSuccessSchema,
  type ApiError,
  type ApiFailure,
  type ApiResponse,
  type ApiSuccess,
  type ErrorCode,
} from './envelope.js';

export {
  healthDataSchema,
  healthResponseSchema,
  type HealthData,
  type HealthResponse,
} from './health.js';

export {
  CAPABILITY_VALUES,
  capabilitySchema,
  registerRequestSchema,
  loginRequestSchema,
  userResponseSchema,
  registerResponseSchema,
  loginResponseSchema,
  type Capability,
  type RegisterRequest,
  type LoginRequest,
  type UserResponse,
  type RegisterResponse,
  type LoginResponse,
} from './auth.js';
