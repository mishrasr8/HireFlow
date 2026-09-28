/**
 * Assigns a correlation id to every request.
 *
 * Registered *before* everything that can fail, including the JSON body parser,
 * so that even a malformed request gets an id and therefore a log line that can
 * be found by the id quoted in the error response.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Response header carrying the correlation id. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();

  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);

  next();
}
