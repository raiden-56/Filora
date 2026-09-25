import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sanitizeFilename, validateUploadedFile, extensionOf } from './upload.js';
import { ensureTmpDirs } from '../utils/tmp.js';
import { AppError } from '../utils/errors.js';

let dir: string;
beforeAll(async () => {
  await ensureTmpDirs();
  dir = await mkdtemp(path.join(os.tmpdir(), 'pdfly-upload-test-'));
});

async function fakeUpload(name: string, content: Buffer | string): Promise<Express.Multer.File> {
  const p = path.join(dir, `${Math.random().toString(36).slice(2)}${extensionOf(name)}`);
  await writeFile(p, content);
  const size = Buffer.byteLength(content);
  return { fieldname: 'files', originalname: name, encoding: '7bit', mimetype: 'application/octet-stream', size, destination: dir, filename: path.basename(p), path: p, buffer: Buffer.alloc(0), stream: undefined as never };
}

describe('sanitizeFilename', () => {
  it('strips paths, traversal and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\x\\report:v2?.pdf')).toBe('report_v2_.pdf');
    expect(sanitizeFilename('a\u0000b.pdf')).toBe('a_b.pdf');
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('.hidden')).toBe('hidden');
  });
});

describe('validateUploadedFile', () => {
  it('accepts real PDFs and rejects fakes by content', async () => {
    await expect(validateUploadedFile(await fakeUpload('ok.pdf', '%PDF-1.4\n1 0 obj\n'), ['pdf'])).resolves.toBeUndefined();
    await expect(validateUploadedFile(await fakeUpload('fake.pdf', 'hello world'), ['pdf'])).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });
  it('rejects empty files and wrong extensions', async () => {
    await expect(validateUploadedFile(await fakeUpload('empty.pdf', ''), ['pdf'])).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    await expect(validateUploadedFile(await fakeUpload('notes.txt', 'text'), ['pdf'])).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
  });
  it('validates images by magic bytes', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    await expect(validateUploadedFile(await fakeUpload('p.png', png), ['image'])).resolves.toBeUndefined();
    await expect(validateUploadedFile(await fakeUpload('p.jpg', '%PDF-1.4'), ['image'])).rejects.toBeInstanceOf(AppError);
  });
  it('accepts html and csv text, rejects a PDF renamed as docx', async () => {
    await expect(validateUploadedFile(await fakeUpload('page.html', '<!doctype html><html><body>hi</body></html>'), ['html'])).resolves.toBeUndefined();
    await expect(validateUploadedFile(await fakeUpload('data.csv', 'a,b\n1,2'), ['excel'])).resolves.toBeUndefined();
    await expect(validateUploadedFile(await fakeUpload('doc.docx', '%PDF-1.4 x'), ['word'])).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });
});
