import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { ocrPdf } from './ocr.js';

let dir: string;

async function work(name: string) {
  const d = path.join(dir, name);
  await mkdir(d, { recursive: true });
  return d;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pdfly-ocr-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ocrPdf', () => {
  it('skips pages that already contain text when skipText is true', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([400, 400]).drawText('This page already has a real text layer with plenty of characters.', { x: 20, y: 200, size: 10, font });
    const input = path.join(dir, 'text.pdf');
    await writeFile(input, await doc.save());

    const res = await ocrPdf(input, await work('w-skip'), { languages: ['eng'], dpi: 150, skipText: true });
    expect(res.pageCount).toBe(1);
    expect(res.pagesSkipped).toBe(1);
    expect(res.pagesProcessed).toBe(0);
    expect(res.pdfPath).toBeTruthy();
    const out = await PDFDocument.load(await readFile(res.pdfPath));
    expect(out.getPageCount()).toBe(1);
    const text = await readFile(res.textPath, 'utf8');
    expect(text).toContain('----- Page 1 -----');
    expect(text).toContain('real text layer');
  });

  it('rejects non-PDF input with CORRUPTED_PDF', async () => {
    const input = path.join(dir, 'junk.pdf');
    await writeFile(input, Buffer.from('nope'));
    await expect(ocrPdf(input, await work('w-junk'), { languages: ['eng'], dpi: 150, skipText: true })).rejects.toMatchObject({ code: 'CORRUPTED_PDF' });
  });

  // Needs network access the first time (tesseract.js downloads language data).
  it.skipIf(!process.env.RUN_OCR_TESTS)('recognises text on an image-only page with tesseract.js', async () => {
    // Render some text to a PNG with sharp (SVG), embed it as an image-only page.
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="100%" height="100%" fill="white"/><text x="40" y="150" font-family="Arial, Helvetica, sans-serif" font-size="64" fill="black">HELLO WORLD</text></svg>`,
    );
    const png = await sharp(svg).png().toBuffer();
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    const page = doc.addPage([600, 225]);
    page.drawRectangle({ x: 0, y: 0, width: 600, height: 225, color: rgb(1, 1, 1) });
    page.drawImage(img, { x: 0, y: 0, width: 600, height: 225 });
    const input = path.join(dir, 'scan.pdf');
    await writeFile(input, await doc.save());

    const res = await ocrPdf(input, await work('w-ocr'), { languages: ['eng'], dpi: 200, skipText: true });
    expect(res.engine).toBeTruthy();
    expect(res.pagesProcessed).toBe(1);
    expect(res.pagesSkipped).toBe(0);
    expect(res.textPreview.toUpperCase()).toContain('HELLO');
    const out = await PDFDocument.load(await readFile(res.pdfPath));
    expect(out.getPageCount()).toBe(1);
  }, 300_000);
});
