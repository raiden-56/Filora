import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { AppError } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import { deleteFile, getFile, listFiles, renameStoredFile, toDto } from '../services/fileStore.js';

const ID_RE = /^[0-9a-f-]{36}$/i;

function requireFile(id: string) {
  if (!ID_RE.test(id)) throw new AppError('NOT_FOUND');
  const f = getFile(id);
  if (!f) throw new AppError('NOT_FOUND');
  return f;
}

export async function listStoredFiles(_req: Request, res: Response) {
  ok(res, { files: listFiles().map(toDto) });
}

export async function getStoredFile(req: Request, res: Response) {
  ok(res, { file: toDto(requireFile(String(req.params.id))) });
}

export async function downloadStoredFile(req: Request, res: Response) {
  const f = requireFile(String(req.params.id));
  res.setHeader('Content-Type', f.mimeType);
  res.setHeader('Content-Length', String(f.size));
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name).replace(/['()]/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(f.path);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

export async function renameFile(req: Request, res: Response) {
  requireFile(String(req.params.id));
  const f = await renameStoredFile(String(req.params.id), (req.options as { name: string }).name);
  if (!f) throw new AppError('NOT_FOUND');
  ok(res, { file: toDto(f) }, 'File renamed');
}

export async function deleteStoredFile(req: Request, res: Response) {
  requireFile(String(req.params.id));
  await deleteFile(String(req.params.id));
  ok(res, { id: req.params.id }, 'File deleted');
}
