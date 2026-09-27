import type { AppError } from '@/types';

const FRIENDLY: Record<string, string> = {
  INVALID_FILE: 'The file is not supported.',
  FILE_TOO_LARGE: 'The file is too large.',
  UNSUPPORTED_FORMAT: 'Unsupported file format.',
  CORRUPTED_PDF: 'This PDF appears to be damaged or is not a valid PDF.',
  EMPTY_FILE: 'The file is empty.',
  CONVERSION_FAILED: 'The conversion failed. Please try another file.',
  OCR_FAILED: 'Text recognition failed for this document.',
  REPAIR_FAILED: 'Unable to repair this PDF. The file may be too damaged or is not a PDF.',
  VALIDATION_ERROR: 'Please check the options and try again.',
  CANCELLED: 'The operation was cancelled.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

/** Map anything thrown by a tool (Error, `{code, message}` objects, DOM exceptions) to a friendly AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof DOMException && err.name === 'AbortError') return { code: 'CANCELLED', message: FRIENDLY.CANCELLED };
  if (err && typeof err === 'object' && 'code' in err && 'message' in err && !(err instanceof Error)) {
    const e = err as AppError;
    const code = typeof e.code === 'string' ? e.code : 'UNKNOWN';
    return { code, message: (typeof e.message === 'string' && e.message) || FRIENDLY[code] || FRIENDLY.UNKNOWN, details: e.details };
  }
  if (err instanceof Error) {
    if (/out of memory|allocation failed|array buffer allocation/i.test(err.message)) {
      return { code: 'OUT_OF_MEMORY', message: 'The browser ran out of memory while processing this file. Try a smaller file or fewer pages.' };
    }
    return { code: 'CLIENT_ERROR', message: err.message || FRIENDLY.UNKNOWN };
  }
  return { code: 'UNKNOWN', message: FRIENDLY.UNKNOWN };
}
