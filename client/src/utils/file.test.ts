import { describe, it, expect } from 'vitest';
import { validateFile, sniffMimeType, extensionOf, acceptedExtensions, toFileMeta, fileKindLabel, dropzoneAccept } from './file';

function file(name: string, content: Uint8Array | string, type = ''): File {
  return new File([content as BlobPart], name, { type });
}

const PDF_HEAD = new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe('sniffMimeType', () => {
  it('detects pdf, png, jpeg and html', async () => {
    expect(await sniffMimeType(new Blob([PDF_HEAD]))).toBe('application/pdf');
    expect(await sniffMimeType(new Blob([PNG_HEAD]))).toBe('image/png');
    expect(await sniffMimeType(new Blob([JPG_HEAD]))).toBe('image/jpeg');
    expect(await sniffMimeType(new Blob(['<!DOCTYPE html><html></html>']))).toBe('text/html');
    expect(await sniffMimeType(new Blob(['plain text']))).toBeUndefined();
  });
});

describe('validateFile', () => {
  it('accepts a real PDF for pdf tools', async () => {
    expect(await validateFile(file('a.pdf', PDF_HEAD, 'application/pdf'), ['pdf'])).toEqual({ ok: true });
  });
  it('rejects empty files', async () => {
    const r = await validateFile(file('a.pdf', new Uint8Array(0)), ['pdf']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });
  it('rejects unsupported extensions with a friendly message', async () => {
    const r = await validateFile(file('notes.txt', 'hello'), ['pdf']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a supported format/i);
  });
  it('does not trust the extension alone', async () => {
    const r = await validateFile(file('fake.pdf', 'not a pdf at all'), ['pdf']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a valid PDF/i);
    const img = await validateFile(file('fake.png', PDF_HEAD), ['image']);
    expect(img.ok).toBe(false);
  });
  it('rejects oversized files', async () => {
    const big = { name: 'big.pdf', size: 51 * 1024 * 1024, slice: () => new Blob([PDF_HEAD]) } as unknown as File;
    const r = await validateFile(big, ['pdf']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exceeds the 50 MB limit/);
  });
  it('accepts images for image tools', async () => {
    expect((await validateFile(file('p.png', PNG_HEAD, 'image/png'), ['image'])).ok).toBe(true);
    expect((await validateFile(file('p.jpg', JPG_HEAD, 'image/jpeg'), ['image'])).ok).toBe(true);
  });
});

describe('helpers', () => {
  it('extensionOf / acceptedExtensions / dropzoneAccept', () => {
    expect(extensionOf('Report.Final.PDF')).toBe('.pdf');
    expect(extensionOf('noext')).toBe('');
    expect(acceptedExtensions(['pdf', 'image'])).toEqual(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);
    expect(Object.keys(dropzoneAccept(['word']))).toContain('application/msword');
  });
  it('toFileMeta normalizes mime from extension', () => {
    const meta = toFileMeta(file('doc.docx', 'x'));
    expect(meta.type).toContain('wordprocessingml');
    expect(meta.rotation).toBe(0);
    expect(meta.id).toBeTruthy();
  });
  it('fileKindLabel', () => {
    expect(fileKindLabel('application/pdf')).toBe('PDF');
    expect(fileKindLabel('image/jpeg')).toBe('JPG');
    expect(fileKindLabel('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('Excel');
    expect(fileKindLabel('', 'x.pptx')).toBe('PPTX');
  });
});
