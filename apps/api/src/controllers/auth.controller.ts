/**
 * HTTP adapter for registration and login.
 *
 * A controller's responsibility is translating HTTP into a call and a result
 * back into HTTP. Everything else -- hashing, duplicate handling, the generic
 * failure message -- lives in the service. Validation happens here by parsing
 * the request body against the shared contract; a `ZodError` thrown by
 * `.parse()` flows to `next(error)` and is turned into a 400 with field-level
 * detail by the centralized error handler.
 *
 * No session is created in either handler: this phase proves the credentials
 * are valid, it does not authenticate the browser (`FR-088` is a later step).
 */
import type { NextFunction, Request, Response } from 'express';

import {
  loginRequestSchema,
  registerRequestSchema,
  type LoginResponse,
  type RegisterResponse,
} from '@hireflow/contracts';

import type { AuthService } from '../services/auth.service.js';

export function createAuthController(auth: AuthService) {
  async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = registerRequestSchema.parse(req.body);
      const data = await auth.registerUser(input);
      const body: RegisterResponse = { success: true, data };
      res.status(201).json(body);
    } catch (error: unknown) {
      next(error);
    }
  }

  async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginRequestSchema.parse(req.body);
      const data = await auth.verifyLogin(input);
      const body: LoginResponse = { success: true, data };
      res.status(200).json(body);
    } catch (error: unknown) {
      next(error);
    }
  }

  return { register, login };
}
