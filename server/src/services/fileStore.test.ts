import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ensureTmpDirs } from '../utils/tmp.js';
import { storeBuffer, getFile, listFiles, deleteFile, renameStoredFile, purgeExpiredFiles, toDto, clearIndexForTests, restoreIndex } from './fileStore.js';

beforeAll(async () => {
  await ensureTmpDirs();
});
afterEach(() => clearIndexForTests());

describe('fileStore', () => {
  it('stores, lists, downloads, renames and deletes files', async () => {
    const f = await storeBuffer(Buffer.from('%PDF-test'), { name: '../evil/../out.pdf', mimeType: 'application/pdf', pageCount: 2 });
    expect(f.name).toBe('out.pdf');
    expect(f.size).toBe(9);
    expect(getFile(f.id)?.id).toBe(f.id);
    expect(listFiles().some((x) => x.id === f.id)).toBe(true);
    expect((await readFile(f.path)).toString()).toBe('%PDF-test');
    const dto = toDto(f);
    expect(dto.url).toBe(`/api/files/${f.id}/download`);
    expect(dto.pageCount).toBe(2);
    await renameStoredFile(f.id, 'renamed.pdf');
    expect(getFile(f.id)?.name).toBe('renamed.pdf');
    expect(await deleteFile(f.id)).toBe(true);
    expect(getFile(f.id)).toBeUndefined();
    expect(await deleteFile(f.id)).toBe(false);
  });

  it('expires files past their TTL', async () => {
    const f = await storeBuffer(Buffer.from('x'), { name: 'a.bin', mimeType: 'application/octet-stream' });
    // force expiry
    (f as { expiresAt: string }).expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(getFile(f.id)).toBeUndefined();
    const g = await storeBuffer(Buffer.from('y'), { name: 'b.bin', mimeType: 'application/octet-stream' });
    (g as { expiresAt: string }).expiresAt = new Date(Date.now() - 1000).toISOString();
    const removed = await purgeExpiredFiles();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(listFiles().some((x) => x.id === g.id)).toBe(false);
  });

  it('restores the index from disk metadata', async () => {
    const f = await storeBuffer(Buffer.from('z'), { name: 'c.txt', mimeType: 'text/plain' });
    clearIndexForTests();
    expect(getFile(f.id)).toBeUndefined();
    await restoreIndex();
    expect(getFile(f.id)?.name).toBe('c.txt');
    await deleteFile(f.id);
  });
});
