import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  mergePdfs,
  splitPdf,
  removePages,
  extractPages,
  organizePdf,
  rotatePdf,
  addPageNumbers,
  addWatermark,
  cropPdf,
  imagesToPdf,
  getPdfInfo,
  formatPageNumber,
  insertBlankPage,
} from './operations';
import { listFormFields, fillFormFields, addFormFields } from './forms';

async function makePdf(pages: number, label = 'doc'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`${label} page ${i}`, { x: 40, y: 500, size: 20, font });
  }
  return doc.save();
}

// 1x1 red pixel PNG
const PNG_1x1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

describe('getPdfInfo', () => {
  it('reports page count and sizes', async () => {
    const info = await getPdfInfo(await makePdf(3));
    expect(info.pageCount).toBe(3);
    expect(info.pages[0]).toEqual({ width: 400, height: 600, rotation: 0 });
  });

  it('throws a friendly error for invalid data', async () => {
    await expect(getPdfInfo(new TextEncoder().encode('not a pdf'))).rejects.toThrow(/Unable to read PDF/);
  });
});

describe('mergePdfs', () => {
  it('concatenates pages in order', async () => {
    const merged = await mergePdfs([await makePdf(2, 'a'), await makePdf(3, 'b')]);
    const info = await getPdfInfo(merged);
    expect(info.pageCount).toBe(5);
  });
  it('rejects empty input', async () => {
    await expect(mergePdfs([])).rejects.toThrow();
  });
});

describe('splitPdf', () => {
  it('splits every page', async () => {
    const out = await splitPdf(await makePdf(3), { type: 'every' }, 'test.pdf');
    expect(out).toHaveLength(3);
    expect(out[0].name).toBe('test-page-1.pdf');
    expect((await getPdfInfo(out[2].data)).pageCount).toBe(1);
  });
  it('splits by ranges', async () => {
    const out = await splitPdf(await makePdf(10), { type: 'ranges', ranges: '1-3\n5-7\n10' }, 'r.pdf');
    expect(out.map((o) => o.name)).toEqual(['r-pages-1-3.pdf', 'r-pages-5-7.pdf', 'r-page-10.pdf']);
    expect((await getPdfInfo(out[0].data)).pageCount).toBe(3);
  });
  it('splits into chunks', async () => {
    const out = await splitPdf(await makePdf(5), { type: 'chunk', size: 2 });
    expect(out).toHaveLength(3);
    expect((await getPdfInfo(out[2].data)).pageCount).toBe(1);
  });
  it('splits selected pages', async () => {
    const out = await splitPdf(await makePdf(5), { type: 'pages', pages: [2, 4] });
    expect(out).toHaveLength(2);
  });
});

describe('removePages / extractPages', () => {
  it('removes selected pages', async () => {
    const out = await removePages(await makePdf(5), [1, 3]);
    expect((await getPdfInfo(out)).pageCount).toBe(3);
  });
  it('refuses to remove every page', async () => {
    await expect(removePages(await makePdf(2), [1, 2])).rejects.toThrow();
  });
  it('extracts selected pages in order', async () => {
    const out = await extractPages(await makePdf(5), [5, 2]);
    expect((await getPdfInfo(out)).pageCount).toBe(2);
  });
  it('validates page range', async () => {
    await expect(extractPages(await makePdf(2), [3])).rejects.toThrow(/out of range/);
  });
});

describe('organizePdf', () => {
  it('reorders, duplicates, rotates and inserts from another doc', async () => {
    const a = await makePdf(3, 'a');
    const b = await makePdf(1, 'b');
    const out = await organizePdf({
      sources: [a, b],
      pages: [
        { source: 0, page: 3 },
        { source: 0, page: 1, rotate: 90 },
        { source: 1, page: 1 },
        { source: 0, page: 1 },
      ],
    });
    const info = await getPdfInfo(out);
    expect(info.pageCount).toBe(4);
    expect(info.pages[1].rotation).toBe(90);
  });
});

describe('rotatePdf', () => {
  it('rotates all pages and wraps around 360', async () => {
    const out = await rotatePdf(await makePdf(2), { angle: 270 });
    const again = await rotatePdf(out, { angle: 180 });
    const info = await getPdfInfo(again);
    expect(info.pages.every((p) => p.rotation === 90)).toBe(true);
  });
  it('rotates selected pages only', async () => {
    const out = await rotatePdf(await makePdf(3), { angle: 90, pages: [2] });
    const info = await getPdfInfo(out);
    expect(info.pages.map((p) => p.rotation)).toEqual([0, 90, 0]);
  });
});

describe('addPageNumbers', () => {
  it('formats numbers', () => {
    expect(formatPageNumber('Page {n} of {total}', 2, 10)).toBe('Page 2 of 10');
  });
  it('adds numbers without breaking the document', async () => {
    const out = await addPageNumbers(await makePdf(3), {
      position: 'bottom-center',
      format: 'Page {n} of {total}',
      startNumber: 1,
    });
    expect((await getPdfInfo(out)).pageCount).toBe(3);
    expect(out.byteLength).toBeGreaterThan(0);
  });
  it('works on rotated pages', async () => {
    const rotated = await rotatePdf(await makePdf(1), { angle: 90 });
    const out = await addPageNumbers(rotated, { position: 'top-right' });
    expect((await getPdfInfo(out)).pages[0].rotation).toBe(90);
  });
});

describe('addWatermark', () => {
  it('adds text watermark', async () => {
    const out = await addWatermark(await makePdf(2), {
      type: 'text',
      text: 'CONFIDENTIAL',
      rotation: 45,
      opacity: 0.4,
    });
    expect((await getPdfInfo(out)).pageCount).toBe(2);
  });
  it('adds tiled image watermark', async () => {
    const out = await addWatermark(await makePdf(1), {
      type: 'image',
      image: PNG_1x1,
      imageType: 'image/png',
      position: 'tile',
      scale: 0.2,
    });
    expect(out.byteLength).toBeGreaterThan(0);
  });
  it('rejects empty text', async () => {
    await expect(addWatermark(await makePdf(1), { type: 'text', text: '  ' })).rejects.toThrow();
  });
});

describe('cropPdf', () => {
  it('crops page to a fraction of its size', async () => {
    const out = await cropPdf(await makePdf(1), { box: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 } });
    const info = await getPdfInfo(out);
    expect(Math.round(info.pages[0].width)).toBe(200);
    expect(Math.round(info.pages[0].height)).toBe(300);
  });
  it('maps crop box on rotated pages', async () => {
    const rotated = await rotatePdf(await makePdf(1), { angle: 90 });
    // visual page is 600 wide x 400 tall; crop 50% width x 25% height
    const out = await cropPdf(rotated, { box: { x: 0, y: 0, width: 0.5, height: 0.25 } });
    const info = await getPdfInfo(out);
    expect(Math.round(info.pages[0].width)).toBe(100); // page width = visual height
    expect(Math.round(info.pages[0].height)).toBe(300);
  });
  it('rejects empty box', async () => {
    await expect(cropPdf(await makePdf(1), { box: { x: 0, y: 0, width: 0, height: 0 } })).rejects.toThrow();
  });
});

describe('imagesToPdf', () => {
  it('creates one page per image with the requested size', async () => {
    const out = await imagesToPdf(
      [
        { data: PNG_1x1, mimeType: 'image/png' },
        { data: PNG_1x1, mimeType: 'image/png', rotation: 90 },
      ],
      { pageSize: 'Letter', orientation: 'landscape', margin: 20, fit: 'fit' },
    );
    const info = await getPdfInfo(out);
    expect(info.pageCount).toBe(2);
    expect(info.pages[0].width).toBe(792);
    expect(info.pages[0].height).toBe(612);
  });
  it('supports fit-to-image page size and fill mode', async () => {
    const out = await imagesToPdf([{ data: PNG_1x1, mimeType: 'image/png' }], { pageSize: 'Fit', margin: 10 });
    const info = await getPdfInfo(out);
    expect(info.pages[0].width).toBe(21);
    const filled = await imagesToPdf([{ data: PNG_1x1, mimeType: 'image/png' }], { fit: 'fill', pageSize: 'A4' });
    expect((await getPdfInfo(filled)).pageCount).toBe(1);
  });
  it('rejects non-image data', async () => {
    await expect(
      imagesToPdf([{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', name: 'x.jpg' }]),
    ).rejects.toThrow(/Could not read image/);
  });
});

describe('insertBlankPage', () => {
  it('inserts a page at index', async () => {
    const out = await insertBlankPage(await makePdf(2), 1);
    expect((await getPdfInfo(out)).pageCount).toBe(3);
  });
});

describe('forms', () => {
  it('adds, lists and fills fields', async () => {
    const base = await makePdf(1);
    const withFields = await addFormFields(base, [
      { kind: 'text', name: 'fullName', page: 1, rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 } },
      { kind: 'checkbox', name: 'agree', page: 1, rect: { x: 0.1, y: 0.2, width: 0.05, height: 0.03 } },
      { kind: 'dropdown', name: 'country', page: 1, rect: { x: 0.1, y: 0.3, width: 0.4, height: 0.05 }, options: ['IN', 'US'] },
      { kind: 'radio', name: 'gender', page: 1, rect: { x: 0.1, y: 0.4, width: 0.05, height: 0.1 }, options: ['A', 'B'] },
    ]);
    const fields = await listFormFields(withFields);
    expect(fields.map((f) => f.name).sort()).toEqual(['agree', 'country', 'fullName', 'gender']);
    expect(fields.find((f) => f.name === 'fullName')?.widgets[0].page).toBe(1);

    const filled = await fillFormFields(withFields, { fullName: 'Ada', agree: true, country: 'US', gender: 'B' });
    const after = await listFormFields(filled);
    expect(after.find((f) => f.name === 'fullName')?.value).toBe('Ada');
    expect(after.find((f) => f.name === 'agree')?.value).toBe(true);
    expect(after.find((f) => f.name === 'country')?.value).toBe('US');
    expect(after.find((f) => f.name === 'gender')?.value).toBe('B');

    const flat = await fillFormFields(withFields, { fullName: 'Ada' }, { flatten: true });
    expect(await listFormFields(flat)).toHaveLength(0);
  });
});
