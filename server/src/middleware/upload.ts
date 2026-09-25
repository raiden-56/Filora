import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { config, MAX_FILE_SIZE_BYTES } from '../config/index.js';
import { UPLOAD_DIR, safeUnlink } from '../utils/tmp.js';
import { AppError } from '../utils/errors.js';

export type UploadKind = 'pdf' | 'image' | 'word' | 'powerpoint' | 'excel' | 'html' | 'any';

const EXT_BY_KIND: Record<UploadKind, string[]> = {
  pdf: ['.pdf'],
  image: ['.jpg', '.jpeg', '.png', '.webp'],
  word: ['.doc', '.docx', '.odt', '.rtf'],
  powerpoint: ['.ppt', '.pptx', '.odp'],
  excel: ['.xls', '.xlsx', '.ods', '.csv'],
  html: ['.html', '.htm'],
  any: [],
};

/** Make an uploaded filename safe (no paths, control chars, length-limited). */
export function sanitizeFilename(name: string, fallback = 'file'): string {
  const base = path.basename(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  return base.slice(0, 180) || fallback;
}

export function extensionOf(name: string): string {
  return path.extname(name || '').toLowerCase();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${extensionOf(file.originalname) || ''}`),
});

const baseUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: config.maxFilesPerRequest, fields: 50, fieldSize: 2 * 1024 * 1024 },
});

/** Sniff the real type of an uploaded file from its first bytes. */
export async function sniffFile(filePath: string): Promise<{ mime?: string; ext?: string; head: Buffer }> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(4100);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead);
    const ft = await fileTypeFromBuffer(head);
    return { mime: ft?.mime, ext: ft?.ext, head };
  } finally {
    await fh.close();
  }
}

function looksLikeHtml(head: Buffer) {
  const text = head.toString('utf8').trimStart().toLowerCase();
  return text.startsWith('<!doctype html') || text.startsWith('<html') || text.includes('<html') || text.includes('<body');
}

function looksLikeText(head: Buffer) {
  for (const b of head) if (b === 0) return false;
  return true;
}

/** Validate that the content of `file` matches one of the accepted kinds. Throws AppError. */
export async function validateUploadedFile(file: Express.Multer.File, kinds: UploadKind[]): Promise<void> {
  if (!file.size) throw new AppError('EMPTY_FILE', `"${file.originalname}" is empty.`);
  if (kinds.includes('any')) return;
  const ext = extensionOf(file.originalname);
  const kind = (Object.keys(EXT_BY_KIND) as UploadKind[]).find((k) => EXT_BY_KIND[k].includes(ext));
  if (!kind || !kinds.includes(kind)) {
    throw new AppError('UNSUPPORTED_FORMAT', `"${file.originalname}" is not a supported format.`);
  }
  const { mime, head } = await sniffFile(file.path);
  switch (kind) {
    case 'pdf':
      if (mime !== 'application/pdf' && !head.subarray(0, 1024).toString('latin1').includes('%PDF')) {
        throw new AppError('INVALID_FILE', `"${file.originalname}" is not a valid PDF file.`);
      }
      break;
    case 'image':
      if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        throw new AppError('INVALID_FILE', `"${file.originalname}" is not a valid image.`);
      }
      break;
    case 'word':
    case 'powerpoint':
    case 'excel': {
      // OOXML/ODF are zip; legacy Office is OLE (x-cfb); RTF and CSV are text.
      const okMime = ['application/zip', 'application/x-cfb', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/rtf', 'text/rtf'];
      const textOk = (ext === '.rtf' && head.toString('latin1').startsWith('{\\rtf')) || (ext === '.csv' && looksLikeText(head));
      if (mime === 'application/pdf') throw new AppError('INVALID_FILE', `"${file.originalname}" is actually a PDF.`);
      if (!textOk && mime && !okMime.includes(mime)) throw new AppError('INVALID_FILE', `"${file.originalname}" does not look like a valid ${kind} document.`);
      if (!textOk && !mime && !looksLikeText(head)) throw new AppError('INVALID_FILE', `"${file.originalname}" does not look like a valid ${kind} document.`);
      break;
    }
    case 'html':
      if (!looksLikeText(head) || (!looksLikeHtml(head) && mime)) throw new AppError('INVALID_FILE', `"${file.originalname}" is not an HTML file.`);
      break;
  }
}

export interface UploadOptions {
  field?: string;
  kinds: UploadKind[];
  multiple?: boolean;
  maxCount?: number;
  required?: boolean;
  /** additional named single-file fields, e.g. a watermark image */
  extra?: { field: string; kinds: UploadKind[]; required?: boolean }[];
}

/** Remove all uploaded temp files for a request. */
export async function cleanupRequestFiles(req: Request) {
  const files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files) for (const arr of Object.values(req.files)) files.push(...arr);
  await Promise.all(files.map((f) => safeUnlink(f.path)));
}

/**
 * Express middleware: accepts uploads under `field` (default "files"), validates each file's
 * real content type, and normalizes `req.uploads` (array) and `req.extraUploads` (by field).
 */
export function upload(opts: UploadOptions): RequestHandler {
  const field = opts.field ?? 'files';
  const maxCount = opts.multiple === false ? 1 : (opts.maxCount ?? config.maxFilesPerRequest);
  const fields = [{ name: field, maxCount }, ...(opts.extra ?? []).map((e) => ({ name: e.field, maxCount: 1 }))];
  const mw = baseUpload.fields(fields);
  return (req: Request, res: Response, next: NextFunction) => {
    mw(req, res, async (err: unknown) => {
      try {
        if (err) {
          const e = err as { code?: string; message?: string };
          if (e.code === 'LIMIT_FILE_SIZE') throw new AppError('FILE_TOO_LARGE', `File size exceeds the ${config.maxFileSizeMb} MB limit.`);
          if (e.code === 'LIMIT_FILE_COUNT') throw new AppError('VALIDATION_ERROR', `You can upload up to ${maxCount} files at once.`);
          if (e.code === 'LIMIT_UNEXPECTED_FILE') throw new AppError('VALIDATION_ERROR', `Unexpected upload field "${(err as { field?: string }).field ?? ''}".`);
          throw new AppError('INVALID_FILE', undefined, { cause: err });
        }
        const map = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
        const main = map[field] ?? [];
        if (opts.required !== false && main.length === 0) throw new AppError('NO_FILE');
        for (const f of main) {
          f.originalname = sanitizeFilename(f.originalname);
          await validateUploadedFile(f, opts.kinds);
        }
        const extraUploads: Record<string, Express.Multer.File | undefined> = {};
        for (const e of opts.extra ?? []) {
          const f = map[e.field]?.[0];
          if (!f && e.required) throw new AppError('NO_FILE', `Missing file "${e.field}".`);
          if (f) {
            f.originalname = sanitizeFilename(f.originalname);
            await validateUploadedFile(f, e.kinds);
          }
          extraUploads[e.field] = f;
        }
        req.uploads = main;
        req.extraUploads = extraUploads;
        next();
      } catch (e) {
        await cleanupRequestFiles(req);
        next(e);
      }
    });
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uploads: Express.Multer.File[];
      extraUploads: Record<string, Express.Multer.File | undefined>;
    }
  }
}
