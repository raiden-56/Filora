import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { compressPdf } from './compress.js';

let dir: string;
let bigPdf: string;
let textPdf: string;

/** Build a 2000x2000 noisy gradient JPEG (noise defeats trivial recompression). */
async function makeBigJpeg(): Promise<Buffer> {
  const w = 2000;
  const h = 2000;
  const raw = Buffer.alloc(w * h * 3);
  let seed = 12345;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = seed % 64;
      const i = (y * w + x) * 3;
      raw[i] = ((x / w) * 255 + n) & 0xff;
      raw[i + 1] = ((y / h) * 255 + n) & 0xff;
      raw[i + 2] = (((x + y) / (w + h)) * 255 + n) & 0xff;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pdfly-compress-'));
  const jpeg = await makeBigJpeg();
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpeg);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 20, y: 100, width: 555, height: 555 });
  }
  // A second, gray Flate image on page 2.
  const grayRaw = Buffer.alloc(800 * 800);
  for (let i = 0; i < grayRaw.length; i++) grayRaw[i] = (i * 7) & 0xff;
  const grayPng = await sharp(grayRaw, { raw: { width: 800, height: 800, channels: 1 } }).png().toBuffer();
  const png = await doc.embedPng(grayPng);
  doc.getPage(1).drawImage(png, { x: 20, y: 660, width: 150, height: 150 });
  bigPdf = path.join(dir, 'big.pdf');
  await writeFile(bigPdf, await doc.save());

  const t = await PDFDocument.create();
  const font = await t.embedFont(StandardFonts.Helvetica);
  t.addPage([300, 300]).drawText('Hello compression', { x: 20, y: 150, size: 18, font });
  textPdf = path.join(dir, 'text.pdf');
  await writeFile(textPdf, await t.save({ useObjectStreams: true }));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('compressPdf (pure JS path)', () => {
  it('produces a smaller, valid PDF with the same page count at level high', async () => {
    const work = path.join(dir, 'work-high');
    await rm(work, { recursive: true, force: true });
    await (await import('node:fs/promises')).mkdir(work, { recursive: true });
    const res = await compressPdf(bigPdf, work, { level: 'high' });
    expect(['ghostscript', 'js']).toContain(res.engine);
    expect(res.pdfPath.startsWith(work)).toBe(true);
    const before = (await stat(bigPdf)).size;
    const after = (await stat(res.pdfPath)).size;
    expect(after).toBeLessThan(before);
    const out = await readFile(res.pdfPath);
    expect(out.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(res.warnings).not.toContain('This PDF is already well optimized.');
  });

  it('low level keeps more quality than high (larger output)', async () => {
    const workLow = path.join(dir, 'work-low');
    const workHigh = path.join(dir, 'work-high2');
    const fs = await import('node:fs/promises');
    await fs.mkdir(workLow, { recursive: true });
    await fs.mkdir(workHigh, { recursive: true });
    const low = await compressPdf(bigPdf, workLow, { level: 'low' });
    const high = await compressPdf(bigPdf, workHigh, { level: 'high' });
    expect((await stat(low.pdfPath)).size).toBeGreaterThan((await stat(high.pdfPath)).size);
  });

  it('returns the original with a warning when nothing can be gained', async () => {
    const work = path.join(dir, 'work-text');
    await (await import('node:fs/promises')).mkdir(work, { recursive: true });
    const res = await compressPdf(textPdf, work, { level: 'medium' });
    const out = await readFile(res.pdfPath);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    // A tiny text-only PDF is either unchanged or (barely) smaller; if unchanged we must say so.
    if ((await stat(res.pdfPath)).size >= (await stat(textPdf)).size) {
      expect(res.warnings).toContain('This PDF is already well optimized.');
    }
  });

  it('rejects garbage input with a CORRUPTED_PDF error', async () => {
    const work = path.join(dir, 'work-bad');
    await (await import('node:fs/promises')).mkdir(work, { recursive: true });
    const bad = path.join(dir, 'bad.pdf');
    await writeFile(bad, Buffer.from('this is not a pdf at all'));
    await expect(compressPdf(bad, work, { level: 'high' })).rejects.toMatchObject({ code: 'CORRUPTED_PDF' });
  });
});
