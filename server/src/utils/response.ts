import type { Response } from 'express';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: string };
}

export function ok<T>(res: Response, data: T, message?: string, status = 200) {
  const body: ApiSuccess<T> = { success: true, data, message };
  return res.status(status).json(body);
}

export function fail(res: Response, status: number, code: string, message: string, details?: string) {
  const body: ApiFailure = { success: false, error: { code, message, details } };
  return res.status(status).json(body);
}
