import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { repairPdf, salvageTrailer } from './repair';
import { concatBytes, latin1Decode, latin1Encode } from './common';

// pdf.js cannot render in jsdom; the rebuild path is exercised through this stub.
vi.mock('@/services/pdfjs', () => ({
  openPdf: vi.fn(async () => {
    throw new Error('Could not open this PDF.');
  }),
}));

let healthy: Uint8Array;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) doc.addPage([400, 500]).drawText(`Page ${i}`, { x: 30, y: 400, size: 20, font });
  healthy = await doc.save({ useObjectStreams: false });
});

describe('repairPdf', () => {
  it('reports a healthy PDF as not repaired and still returns a file', async () => {
    const res = await repairPdf(healthy);
    expect(res.pdf).toBeTruthy();
    expect(res.repaired).toBe(false);
    expect(res.engine).toBe('pdf-lib');
    expect(res.pageCount).toBe(3);
    expect(res.notes).toContain('No structural problems found');
    expect((await PDFDocument.load(res.pdf!)).getPageCount()).toBe(3);
  });

  it('repairs a PDF whose xref offsets and trailer are corrupted', async () => {
    let text = latin1Decode(healthy);
    // Point startxref at garbage and chop the trailer/EOF.
    text = text.replace(/startxref\s+\d+/, 'startxref 999999999');
    const eof = text.lastIndexOf('%%EOF');
    text = text.slice(0, eof) + 'GARBAGE';
    const stages: string[] = [];
    const res = await repairPdf(latin1Encode(text), { onProgress: (s) => stages.push(s) });
    expect(res.pdf).toBeTruthy();
    expect(res.engine).toBe('pdf-lib');
    expect(res.repaired).toBe(true);
    expect((await PDFDocument.load(res.pdf!)).getPageCount()).toBe(3);
    expect(res.pageCount).toBe(3);
    expect(res.notes.join(' ')).toMatch(/cross-reference|EOF|startxref/i);
    expect(stages).toContain('Analyzing PDF...');
  });

  it('repairs a PDF with a truncated xref table by rebuilding the trailer', async () => {
    // Cut in the middle of the cross-reference table: no trailer, no startxref.
    const text = latin1Decode(healthy);
    const idx = text.lastIndexOf('\nxref');
    expect(idx).toBeGreaterThan(0);
    const truncated = concatBytes([healthy.subarray(0, idx + 12), latin1Encode('\n%%EOF\n')]);
    expect(await salvageTrailer(truncated)).not.toBeNull();
    const res = await repairPdf(truncated);
    expect(res.pdf).toBeTruthy();
    expect((await PDFDocument.load(res.pdf!)).getPageCount()).toBe(3);
    expect(res.repaired).toBe(true);
  });

  it('returns engine none and no file for total garbage', async () => {
    const junk = new Uint8Array(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 31 + 7) & 0xff;
    const res = await repairPdf(junk);
    expect(res.pdf).toBeNull();
    expect(res.engine).toBe('none');
    expect(res.repaired).toBe(false);
    expect(res.notes[0]).toMatch(/does not contain a PDF header/);
  });

  it('honours cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(repairPdf(healthy, { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
