import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { repairPdf } from './repair.js';

let dir: string;
let healthy: Buffer;

async function work(name: string) {
  const d = path.join(dir, name);
  await mkdir(d, { recursive: true });
  return d;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pdfly-repair-'));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) doc.addPage([400, 500]).drawText(`Page ${i}`, { x: 30, y: 400, size: 20, font });
  healthy = Buffer.from(await doc.save({ useObjectStreams: false }));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('repairPdf', () => {
  it('reports a healthy PDF as not repaired and still returns a file', async () => {
    const input = path.join(dir, 'healthy.pdf');
    await writeFile(input, healthy);
    const res = await repairPdf(input, await work('w-healthy'));
    expect(res.pdfPath).toBeTruthy();
    expect(res.repaired).toBe(false);
    expect(res.engine).not.toBe('none');
    expect(res.pageCount).toBe(3);
    expect(res.notes).toContain('No structural problems found');
    const doc = await PDFDocument.load(await readFile(res.pdfPath as string));
    expect(doc.getPageCount()).toBe(3);
  });

  it('repairs a PDF whose xref offsets and trailer are corrupted', async () => {
    let text = healthy.toString('latin1');
    // Point startxref at garbage and chop the trailer/EOF.
    text = text.replace(/startxref\s+\d+/, 'startxref 999999999');
    const eof = text.lastIndexOf('%%EOF');
    text = text.slice(0, eof) + 'GARBAGE';
    const input = path.join(dir, 'broken-xref.pdf');
    await writeFile(input, Buffer.from(text, 'latin1'));

    const res = await repairPdf(input, await work('w-xref'));
    expect(res.pdfPath).toBeTruthy();
    expect(res.engine).not.toBe('none');
    expect(res.repaired).toBe(true);
    const doc = await PDFDocument.load(await readFile(res.pdfPath as string));
    expect(doc.getPageCount()).toBe(3);
    expect(res.pageCount).toBe(3);
    expect(res.notes.join(' ')).toMatch(/cross-reference|EOF|startxref/i);
  });

  it('repairs a PDF with a truncated xref table', async () => {
    // Cut in the middle of the cross-reference table: no trailer, no startxref.
    const idx = healthy.lastIndexOf('\nxref');
    expect(idx).toBeGreaterThan(0);
    const truncated = Buffer.concat([healthy.subarray(0, idx + 12), Buffer.from('\n%%EOF\n')]);
    const input = path.join(dir, 'truncated.pdf');
    await writeFile(input, truncated);
    const res = await repairPdf(input, await work('w-trunc'));
    expect(res.pdfPath).toBeTruthy();
    const doc = await PDFDocument.load(await readFile(res.pdfPath as string));
    expect(doc.getPageCount()).toBe(3);
    expect(res.repaired).toBe(true);
  });

  it('returns engine none and no path for total garbage', async () => {
    const input = path.join(dir, 'garbage.pdf');
    const junk = Buffer.alloc(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 31 + 7) & 0xff;
    await writeFile(input, junk);
    const res = await repairPdf(input, await work('w-garbage'));
    expect(res.pdfPath).toBeNull();
    expect(res.engine).toBe('none');
    expect(res.repaired).toBe(false);
    expect(res.notes.length).toBeGreaterThan(0);
  });
});
