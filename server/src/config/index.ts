import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 4000),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean),
  /** where uploads and outputs live (auto-cleaned) */
  tmpDir: path.resolve(process.env.TMP_DIR ?? path.join(os.tmpdir(), 'pdfly')),
  maxFileSizeMb: num('MAX_FILE_SIZE_MB', 50),
  maxFilesPerRequest: num('MAX_FILES_PER_REQUEST', 50),
  /** minutes an output file stays downloadable */
  fileTtlMinutes: num('FILE_TTL_MINUTES', 60),
  /** cleanup interval */
  cleanupIntervalMinutes: num('CLEANUP_INTERVAL_MINUTES', 5),
  rateLimitWindowMinutes: num('RATE_LIMIT_WINDOW_MINUTES', 15),
  rateLimitMax: num('RATE_LIMIT_MAX', 300),
  /** ms before an external process is killed */
  processTimeoutMs: num('PROCESS_TIMEOUT_MS', 5 * 60 * 1000),
  /** explicit binary paths (optional) */
  bin: {
    soffice: process.env.SOFFICE_PATH,
    ghostscript: process.env.GHOSTSCRIPT_PATH,
    qpdf: process.env.QPDF_PATH,
    tesseract: process.env.TESSERACT_PATH,
    pdftoppm: process.env.PDFTOPPM_PATH,
    ocrmypdf: process.env.OCRMYPDF_PATH,
  },
  /** allow HTML-to-PDF from URLs (SSRF risk: only enable in trusted deployments) */
  allowUrlFetch: bool('ALLOW_URL_FETCH', true),
  /** directory to cache tesseract.js language data */
  tessdataDir: path.resolve(process.env.TESSDATA_DIR ?? path.join(os.tmpdir(), 'pdfly-tessdata')),
  serveClient: bool('SERVE_CLIENT', false),
  clientDist: path.resolve(process.env.CLIENT_DIST ?? path.join(process.cwd(), '..', 'client', 'dist')),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};

export type AppConfig = typeof config;
export const MAX_FILE_SIZE_BYTES = config.maxFileSizeMb * 1024 * 1024;
