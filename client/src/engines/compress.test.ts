import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ALREADY_OPTIMIZED, compressPdf, unpredictPng } from './compress';

describe('compressPdf', () => {
  it('returns the original with a warning when nothing can be gained (text-only PDF)', async () => {
    const t = await PDFDocument.create();
    const font = await t.embedFont(StandardFonts.Helvetica);
    t.addPage([300, 300]).drawText('Hello compression', { x: 20, y: 150, size: 18, font });
    const input = await t.save({ useObjectStreams: true });
    const res = await compressPdf(input, { level: 'medium' });
    expect(res.engine).toBe('js');
    const doc = await PDFDocument.load(res.pdf);
    expect(doc.getPageCount()).toBe(1);
    if (res.pdf.length >= input.length) expect(res.warnings).toContain(ALREADY_OPTIMIZED);
  });

  it('rejects garbage input with a CORRUPTED_PDF error', async () => {
    await expect(compressPdf(new TextEncoder().encode('this is not a pdf at all'), { level: 'high' })).rejects.toMatchObject({ code: 'CORRUPTED_PDF' });
  });

  it('rejects empty input', async () => {
    await expect(compressPdf(new Uint8Array(0), { level: 'high' })).rejects.toMatchObject({ code: 'EMPTY_FILE' });
  });

  it('unpredictPng undoes the Sub and Up filters', () => {
    // 2 rows x 3 gray pixels: row 0 uses Sub (1), row 1 uses Up (2)
    const data = Uint8Array.from([1, 10, 5, 5, 2, 1, 1, 1]);
    expect(Array.from(unpredictPng(data, 3, 1, 2)!)).toEqual([10, 15, 20, 11, 16, 21]);
    expect(unpredictPng(Uint8Array.from([9, 0, 0, 0]), 3, 1, 1)).toBeNull(); // unknown filter type
    expect(unpredictPng(Uint8Array.from([0, 0]), 3, 1, 1)).toBeNull(); // too short
  });
});
