export type ErrorCode =
  | 'INVALID_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'CORRUPTED_PDF'
  | 'EMPTY_FILE'
  | 'NO_FILE'
  | 'VALIDATION_ERROR'
  | 'CONVERSION_FAILED'
  | 'OCR_FAILED'
  | 'REPAIR_FAILED'
  | 'TOOL_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'SERVER_ERROR';

const STATUS: Record<ErrorCode, number> = {
  INVALID_FILE: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FORMAT: 415,
  CORRUPTED_PDF: 422,
  EMPTY_FILE: 400,
  NO_FILE: 400,
  VALIDATION_ERROR: 400,
  CONVERSION_FAILED: 422,
  OCR_FAILED: 422,
  REPAIR_FAILED: 422,
  TOOL_UNAVAILABLE: 501,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  TIMEOUT: 504,
  SERVER_ERROR: 500,
};

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  INVALID_FILE: 'The uploaded file is not supported.',
  FILE_TOO_LARGE: 'The file is too large.',
  UNSUPPORTED_FORMAT: 'Unsupported file format.',
  CORRUPTED_PDF: 'This PDF appears to be damaged or is not a valid PDF.',
  EMPTY_FILE: 'The uploaded file is empty.',
  NO_FILE: 'Please upload a file.',
  VALIDATION_ERROR: 'Some options are invalid.',
  CONVERSION_FAILED: 'The conversion failed. Please try another file.',
  OCR_FAILED: 'Text recognition failed for this document.',
  REPAIR_FAILED: 'Unable to repair this PDF.',
  TOOL_UNAVAILABLE: 'This feature is not available on the server.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  NOT_FOUND: 'The file was not found. It may have expired.',
  TIMEOUT: 'Processing took too long. Try a smaller file.',
  SERVER_ERROR: 'Something went wrong on our side. Please try again.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: string;
  /** internal cause, never sent to clients */
  readonly cause?: unknown;

  constructor(code: ErrorCode, message?: string, options: { details?: string; cause?: unknown; status?: number } = {}) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? STATUS[code];
    this.details = options.details;
    this.cause = options.cause;
  }

  static from(err: unknown, fallback: ErrorCode = 'SERVER_ERROR', message?: string): AppError {
    if (err instanceof AppError) return err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/password|encrypted/i.test(msg)) return new AppError('CORRUPTED_PDF', 'This PDF is password protected. Please remove the password first.', { cause: err });
    if (/Unable to read PDF|invalid pdf|xref|trailer|not a pdf|Failed to parse PDF/i.test(msg)) return new AppError('CORRUPTED_PDF', undefined, { cause: err });
    if (/timed? ?out/i.test(msg)) return new AppError('TIMEOUT', undefined, { cause: err });
    return new AppError(fallback, message, { cause: err });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
