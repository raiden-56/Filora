import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

/**
 * Parse options sent as multipart form fields (strings) or JSON. Numbers/booleans/JSON
 * strings are coerced before validation so the same schema works for both.
 */
export function coerceFormValue(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s === '') return undefined;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      return JSON.parse(s);
    } catch {
      return v;
    }
  }
  return v;
}

export function parseOptions<T extends ZodTypeAny>(schema: T, body: Record<string, unknown> | undefined): z.infer<T> {
  const coerced: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) coerced[k] = coerceFormValue(v);
  return schema.parse(coerced);
}

/** Middleware that validates `req.body` with a zod schema and stores the result on `req.options`. */
export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.options = parseOptions(schema, req.body as Record<string, unknown>);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Wrap async route handlers so rejections reach the error handler. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: any;
    }
  }
}
