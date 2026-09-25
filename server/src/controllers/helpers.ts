import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { getPdfInfo } from '@pdfly/core';
import { storeBuffer, storeFile, toDto, type StoredFileDto } from '../services/fileStore.js';
import { ok } from '../utils/response.js';
import { cleanupRequestFiles } from '../middleware/upload.js';
import { createWorkDir } from '../utils/tmp.js';

export interface ProcessResponse {
  files: StoredFileDto[];
  meta?: Record<string, unknown>;
  warnings?: string[];
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function withExt(name: string, suffix: string, ext: string) {
  return `${baseName(name)}${suffix}.${ext}`;
}

export async function pageCountOf(data: Uint8Array): Promise<number | undefined> {
  try {
    return (await getPdfInfo(data)).pageCount;
  } catch {
    return undefined;
  }
}

/** Store output buffers and send the standard success response. */
export async function respondWithBuffers(
  req: Request,
  res: Response,
  outputs: { data: Uint8Array | Buffer; name: string; mimeType: string; pageCount?: number }[],
  message: string,
  extra: { meta?: Record<string, unknown>; warnings?: string[] } = {},
) {
  const files: StoredFileDto[] = [];
  for (const o of outputs) {
    const pageCount = o.pageCount ?? (o.mimeType === 'application/pdf' ? await pageCountOf(o.data) : undefined);
    files.push(toDto(await storeBuffer(o.data, { name: o.name, mimeType: o.mimeType, pageCount })));
  }
  await cleanupRequestFiles(req);
  const body: ProcessResponse = { files, meta: extra.meta, warnings: extra.warnings?.length ? extra.warnings : undefined };
  ok(res, body, message);
}

/** Store output files already on disk (moved into the store) and respond. */
export async function respondWithPaths(
  req: Request,
  res: Response,
  outputs: { path: string; name: string; mimeType: string; pageCount?: number }[],
  message: string,
  extra: { meta?: Record<string, unknown>; warnings?: string[] } = {},
) {
  const files: StoredFileDto[] = [];
  for (const o of outputs) {
    let pageCount = o.pageCount;
    if (pageCount === undefined && o.mimeType === 'application/pdf') pageCount = await pageCountOf(await readFile(o.path));
    files.push(toDto(await storeFile(o.path, { name: o.name, mimeType: o.mimeType, pageCount })));
  }
  await cleanupRequestFiles(req);
  const body: ProcessResponse = { files, meta: extra.meta, warnings: extra.warnings?.length ? extra.warnings : undefined };
  ok(res, body, message);
}

/** Run `fn` inside a temporary work dir that is always cleaned up. */
export async function withWorkDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const { dir, cleanup } = await createWorkDir(prefix);
  try {
    return await fn(dir);
  } finally {
    await cleanup();
  }
}

export function firstUpload(req: Request) {
  const f = req.uploads?.[0];
  if (!f) throw new Error('No file');
  return f;
}
