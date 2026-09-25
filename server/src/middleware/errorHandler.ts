import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { fail } from '../utils/response.js';
import { cleanupRequestFiles } from './upload.js';
import { config } from '../config/index.js';

export function notFoundHandler(_req: Request, res: Response) {
  fail(res, 404, 'NOT_FOUND', 'Route not found.');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  void cleanupRequestFiles(req);
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => `${i.path.join('.') || 'options'}: ${i.message}`).join('; ');
    return fail(res, 400, 'VALIDATION_ERROR', 'Some options are invalid.', details);
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return fail(res, 400, 'VALIDATION_ERROR', 'Malformed request body.');
  }
  const appErr = err instanceof AppError ? err : AppError.from(err);
  if (appErr.status >= 500 || config.env !== 'production') {
    const cause = appErr.cause instanceof Error ? appErr.cause.stack ?? appErr.cause.message : appErr.cause;
    console.error(`[${appErr.code}] ${req.method} ${req.originalUrl}:`, appErr.message, cause ?? '');
  }
  // Never leak raw internal errors; details only in non-production.
  const details = config.env === 'production' ? undefined : appErr.details;
  return fail(res, appErr.status, appErr.code, appErr.message, details);
}
