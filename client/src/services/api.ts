import axios, { AxiosError, type AxiosProgressEvent } from 'axios';
import type { ApiResponse, AppError, ServerFile, ServerProcessResult } from '@/types';

export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 10 * 60 * 1000, // long-running conversions
});

const FRIENDLY: Record<string, string> = {
  INVALID_FILE: 'The uploaded file is not supported.',
  FILE_TOO_LARGE: 'The file is too large.',
  UNSUPPORTED_FORMAT: 'Unsupported file format.',
  CORRUPTED_PDF: 'This PDF appears to be damaged or is not a valid PDF.',
  EMPTY_FILE: 'The file is empty.',
  CONVERSION_FAILED: 'The conversion failed. Please try another file.',
  OCR_FAILED: 'Text recognition failed for this document.',
  TOOL_UNAVAILABLE: 'This feature is not available on the server right now.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  NOT_FOUND: 'The file was not found. It may have expired.',
  NETWORK: 'Could not reach the server. Check your connection and try again.',
  TIMEOUT: 'The request took too long. Try a smaller file.',
  CANCELLED: 'The operation was cancelled.',
  SERVER_ERROR: 'Something went wrong on our side. Please try again.',
};

export function toAppError(err: unknown): AppError {
  if (axios.isCancel(err)) return { code: 'CANCELLED', message: FRIENDLY.CANCELLED };
  if (err && typeof err === 'object' && 'code' in err && 'message' in err && !(err instanceof Error)) {
    const e = err as AppError;
    return { code: e.code, message: e.message, details: e.details };
  }
  if (err instanceof AxiosError) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return { code: 'TIMEOUT', message: FRIENDLY.TIMEOUT };
    if (!err.response) return { code: 'NETWORK', message: FRIENDLY.NETWORK };
    const status = err.response.status;
    const body = err.response.data as ApiResponse<unknown> | undefined;
    if (body && typeof body === 'object' && 'success' in body && body.success === false) {
      const code = body.error.code || 'SERVER_ERROR';
      return {
        code,
        message: body.error.message || FRIENDLY[code] || FRIENDLY.SERVER_ERROR,
        details: body.error.details,
      };
    }
    if (status === 413) return { code: 'FILE_TOO_LARGE', message: FRIENDLY.FILE_TOO_LARGE };
    if (status === 429) return { code: 'RATE_LIMITED', message: FRIENDLY.RATE_LIMITED };
    if (status === 404) return { code: 'NOT_FOUND', message: FRIENDLY.NOT_FOUND };
    return { code: 'SERVER_ERROR', message: FRIENDLY.SERVER_ERROR };
  }
  if (err instanceof Error) {
    return { code: 'CLIENT_ERROR', message: err.message || FRIENDLY.SERVER_ERROR };
  }
  return { code: 'UNKNOWN', message: FRIENDLY.SERVER_ERROR };
}

export interface ProcessRequestOptions {
  /** field name -> File(s) */
  files: { field: string; file: Blob; name: string }[];
  /** extra JSON-serializable options, sent as form fields */
  fields?: Record<string, string | number | boolean | undefined | null | object>;
  onUploadProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Upload files to a processing endpoint and return the server result. */
export async function processOnServer(endpoint: string, opts: ProcessRequestOptions): Promise<ServerProcessResult> {
  const form = new FormData();
  for (const f of opts.files) form.append(f.field, f.file, f.name);
  if (opts.fields) {
    for (const [k, v] of Object.entries(opts.fields)) {
      if (v === undefined || v === null) continue;
      form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  }
  const res = await api.post<ApiResponse<ServerProcessResult>>(endpoint, form, {
    signal: opts.signal,
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (opts.onUploadProgress && e.total) opts.onUploadProgress(Math.min(1, e.loaded / e.total));
    },
  });
  const body = res.data;
  if (!body.success) throw toAppError({ code: body.error.code, message: body.error.message });
  return body.data;
}

/** POST JSON (no files). */
export async function postJson<T>(endpoint: string, data: unknown, signal?: AbortSignal): Promise<T> {
  const res = await api.post<ApiResponse<T>>(endpoint, data, { signal });
  if (!res.data.success) throw toAppError({ code: res.data.error.code, message: res.data.error.message });
  return res.data.data;
}

/** Download a server file as a Blob with progress. */
export async function downloadServerFile(
  file: ServerFile,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  // `file.url` is server-relative ("/api/files/:id/download"); the axios instance already
  // has the API base, so strip the "/api" prefix unless the URL is absolute.
  const url = file.url.startsWith('http') ? file.url : file.url.replace(/^\/api(?=\/)/, '');
  const res = await api.get<Blob>(url, {
    responseType: 'blob',
    signal,
    onDownloadProgress: (e) => {
      const total = e.total ?? file.size;
      if (onProgress && total) onProgress(Math.min(1, e.loaded / total));
    },
  });
  return res.data;
}

export async function listServerFiles(): Promise<ServerFile[]> {
  const res = await api.get<ApiResponse<{ files: ServerFile[] }>>('/files');
  if (!res.data.success) throw toAppError(res.data.error);
  return res.data.data.files;
}

export async function deleteServerFile(id: string): Promise<void> {
  await api.delete(`/files/${encodeURIComponent(id)}`);
}

export interface ServerCapabilities {
  libreoffice: boolean;
  ghostscript: boolean;
  qpdf: boolean;
  tesseract: boolean;
  puppeteer: boolean;
  maxFileSizeMb: number;
  ocrLanguages: { code: string; name: string }[];
  fileTtlMinutes: number;
}

export async function getServerCapabilities(): Promise<ServerCapabilities> {
  const res = await api.get<ApiResponse<ServerCapabilities>>('/health', { timeout: 8000 });
  if (!res.data.success) throw toAppError(res.data.error);
  return res.data.data;
}
