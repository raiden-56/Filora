import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';

export const UPLOAD_DIR = path.join(config.tmpDir, 'uploads');
export const OUTPUT_DIR = path.join(config.tmpDir, 'outputs');
export const WORK_DIR = path.join(config.tmpDir, 'work');

export async function ensureTmpDirs() {
  await Promise.all([UPLOAD_DIR, OUTPUT_DIR, WORK_DIR].map((d) => mkdir(d, { recursive: true })));
}

/** Create an isolated working directory for one job. Always `cleanup()` it in a finally block. */
export async function createWorkDir(prefix = 'job'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = path.join(WORK_DIR, `${prefix}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export async function safeUnlink(file: string | undefined | null) {
  if (!file) return;
  await rm(file, { force: true }).catch(() => undefined);
}

/** Remove files/dirs older than `maxAgeMs` inside `dir`. */
export async function purgeOlderThan(dir: string, maxAgeMs: number): Promise<number> {
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const name of entries) {
    const full = path.join(dir, name);
    try {
      const s = await stat(full);
      if (now - s.mtimeMs > maxAgeMs) {
        await rm(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}
