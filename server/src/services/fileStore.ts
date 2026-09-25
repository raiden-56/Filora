import { randomUUID } from 'node:crypto';
import { copyFile, readFile, rename, rm, stat, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { OUTPUT_DIR } from '../utils/tmp.js';
import { sanitizeFilename } from '../middleware/upload.js';

export interface StoredFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  expiresAt: string;
  pageCount?: number;
  /** absolute path on disk */
  path: string;
}

export interface StoredFileDto {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  pageCount?: number;
}

/**
 * In-memory index of output files on disk. Files expire after `fileTtlMinutes` and are
 * removed by the cleanup job. The index is rebuilt from disk metadata on startup.
 */
const index = new Map<string, StoredFile>();

function ttlMs() {
  return config.fileTtlMinutes * 60 * 1000;
}

function metaPath(id: string) {
  return path.join(OUTPUT_DIR, `${id}.json`);
}

async function persistMeta(f: StoredFile) {
  await writeFile(metaPath(f.id), JSON.stringify(f), 'utf8');
}

export function toDto(f: StoredFile): StoredFileDto {
  return {
    id: f.id,
    name: f.name,
    size: f.size,
    mimeType: f.mimeType,
    url: `/api/files/${f.id}/download`,
    createdAt: f.createdAt,
    expiresAt: f.expiresAt,
    pageCount: f.pageCount,
  };
}

export interface StoreInput {
  name: string;
  mimeType: string;
  pageCount?: number;
}

/** Store a buffer as an output file. */
export async function storeBuffer(data: Uint8Array | Buffer, input: StoreInput): Promise<StoredFile> {
  const id = randomUUID();
  const name = sanitizeFilename(input.name, 'output');
  const target = path.join(OUTPUT_DIR, `${id}${path.extname(name)}`);
  await writeFile(target, data);
  const now = Date.now();
  const f: StoredFile = {
    id,
    name,
    size: data.byteLength,
    mimeType: input.mimeType,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs()).toISOString(),
    pageCount: input.pageCount,
    path: target,
  };
  index.set(id, f);
  await persistMeta(f);
  return f;
}

/** Move (or copy) an existing file on disk into the store. */
export async function storeFile(src: string, input: StoreInput, { move = true }: { move?: boolean } = {}): Promise<StoredFile> {
  const id = randomUUID();
  const name = sanitizeFilename(input.name, 'output');
  const target = path.join(OUTPUT_DIR, `${id}${path.extname(name)}`);
  if (move) {
    try {
      await rename(src, target);
    } catch {
      await copyFile(src, target);
      await rm(src, { force: true }).catch(() => undefined);
    }
  } else await copyFile(src, target);
  const s = await stat(target);
  const now = Date.now();
  const f: StoredFile = {
    id,
    name,
    size: s.size,
    mimeType: input.mimeType,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs()).toISOString(),
    pageCount: input.pageCount,
    path: target,
  };
  index.set(id, f);
  await persistMeta(f);
  return f;
}

export function getFile(id: string): StoredFile | undefined {
  const f = index.get(id);
  if (!f) return undefined;
  if (new Date(f.expiresAt).getTime() < Date.now()) {
    void deleteFile(id);
    return undefined;
  }
  return f;
}

export function listFiles(): StoredFile[] {
  const now = Date.now();
  return [...index.values()].filter((f) => new Date(f.expiresAt).getTime() >= now).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteFile(id: string): Promise<boolean> {
  const f = index.get(id);
  index.delete(id);
  if (!f) return false;
  await rm(f.path, { force: true }).catch(() => undefined);
  await rm(metaPath(id), { force: true }).catch(() => undefined);
  return true;
}

export async function renameStoredFile(id: string, name: string): Promise<StoredFile | undefined> {
  const f = index.get(id);
  if (!f) return undefined;
  f.name = sanitizeFilename(name, f.name);
  await persistMeta(f);
  return f;
}

/** Remove expired files. Returns number removed. */
export async function purgeExpiredFiles(): Promise<number> {
  const now = Date.now();
  let removed = 0;
  for (const f of [...index.values()]) {
    if (new Date(f.expiresAt).getTime() < now) {
      await deleteFile(f.id);
      removed++;
    }
  }
  // Orphans on disk (e.g. after a crash) older than TTL
  try {
    for (const name of await readdir(OUTPUT_DIR)) {
      const id = name.replace(/\.[^.]+$/, '');
      if (index.has(id)) continue;
      const full = path.join(OUTPUT_DIR, name);
      const s = await stat(full).catch(() => null);
      if (s && now - s.mtimeMs > ttlMs()) {
        await rm(full, { force: true }).catch(() => undefined);
        removed++;
      }
    }
  } catch {
    /* ignore */
  }
  return removed;
}

/** Rebuild the index from *.json metadata on startup. */
export async function restoreIndex(): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(OUTPUT_DIR);
  } catch {
    return;
  }
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(await readFile(path.join(OUTPUT_DIR, n), 'utf8')) as StoredFile;
      const s = await stat(meta.path).catch(() => null);
      if (s && new Date(meta.expiresAt).getTime() > Date.now()) index.set(meta.id, meta);
      else await rm(path.join(OUTPUT_DIR, n), { force: true }).catch(() => undefined);
    } catch {
      /* skip */
    }
  }
}

export function clearIndexForTests() {
  index.clear();
}
