import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { applyAnnotations, imageBytes, wrapText, type Annotation } from './annotations';

async function makePdf(rotateSecond = true): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const p2 = doc.addPage([595, 842]);
  if (rotateSecond) p2.setRotation(degrees(90));
  return doc.save();
}

async function makePng(): Promise<Uint8Array> {
  // Build a tiny PNG by drawing a page with pdf-lib is not possible; use a hard-coded 1x1 red PNG.
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  return imageBytes(`data:image/png;base64,${b64}`);
}

function base(type: Annotation['type'], page: number, extra: Partial<Annotation> = {}): Annotation {
  return { id: `${type}-${page}`, type, page, x: 0.1, y: 0.1, width: 0.3, height: 0.1, color: '#DC2626', opacity: 1, strokeWidth: 2, ...extra };
}

function allTypes(page: number): Annotation[] {
  return [
    base('text', page, { text: 'Hello world, this is a fairly long sentence that should wrap inside the box.', fontSize: 12, fontFamily: 'TimesRoman' }),
    base('image', page, { imageId: 'img1', y: 0.25 }),
    base('signature', page, { imageId: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', y: 0.4 }),
    base('draw', page, { points: [{ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.55 }, { x: 0.3, y: 0.5 }] }),
    base('highlight', page, { color: '#FFEB3B', opacity: 0.35, y: 0.6 }),
    base('underline', page, { y: 0.65 }),
    base('strikeout', page, { y: 0.7 }),
    base('rect', page, { fill: '#00FF00', y: 0.75 }),
    base('ellipse', page, { fill: null, y: 0.8 }),
    base('line', page, { x1: 0.5, y1: 0.1, x2: 0.9, y2: 0.2 }),
    base('arrow', page, { x1: 0.5, y1: 0.3, x2: 0.9, y2: 0.4 }),
    base('checkbox', page, { x: 0.5, y: 0.5, width: 0.03, height: 0.02, checked: true }),
  ];
}

describe('applyAnnotations', () => {
  it('burns one of every annotation type into normal and rotated pages', async () => {
    const input = await makePdf();
    const png = await makePng();
    const out = await applyAnnotations(input, [...allTypes(1), ...allTypes(2)], { img1: png });
    expect(out.length).toBeGreaterThan(input.length);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    // Fonts and images were embedded (object streams are compressed, so inspect parsed objects)
    const objects = doc.context.enumerateIndirectObjects().map(([, o]) => o.toString()).join('\n');
    expect(objects).toContain('Times-Roman');
    expect(objects).toContain('/Image');
  });

  it('skips annotations on pages that do not exist and tolerates empty input', async () => {
    const input = await makePdf(false);
    const out = await applyAnnotations(input, [base('rect', 99), base('text', 0, { text: 'x' })], {});
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    const empty = await applyAnnotations(input, []);
    expect((await PDFDocument.load(empty)).getPageCount()).toBe(2);
  });

  it('rejects images that are not PNG or JPEG', async () => {
    const input = await makePdf(false);
    await expect(applyAnnotations(input, [base('image', 1, { imageId: 'bad' })], { bad: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) })).rejects.toThrow(/PNG or JPEG/);
  });

  it('fails clearly on an invalid PDF', async () => {
    await expect(applyAnnotations(new Uint8Array([1, 2, 3]), [])).rejects.toThrow(/Unable to read PDF/);
  });
});

describe('imageBytes', () => {
  it('decodes data URLs and raw base64', () => {
    const b64 = Buffer.from('hello').toString('base64');
    expect(Buffer.from(imageBytes(`data:image/png;base64,${b64}`)).toString()).toBe('hello');
    expect(Buffer.from(imageBytes(b64)).toString()).toBe('hello');
    const raw = new Uint8Array([1, 2]);
    expect(imageBytes(raw)).toBe(raw);
  });
});

describe('wrapText', () => {
  it('wraps words to the available width and honours newlines', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapText('The quick brown fox jumps over the lazy dog', font, 12, 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(100);
    expect(lines.join(' ')).toBe('The quick brown fox jumps over the lazy dog');

    expect(wrapText('a\nb\n\nc', font, 12, 500)).toEqual(['a', 'b', '', 'c']);
  });

  it('breaks words that are longer than the box', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Courier);
    const lines = wrapText('Supercalifragilisticexpialidocious', font, 12, 50);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('Supercalifragilisticexpialidocious');
    for (const l of lines) expect(font.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(50);
  });
});
