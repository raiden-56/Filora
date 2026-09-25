import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { pdfToImages } from './pdfToImages.js';
import { AppError } from '../../utils/errors.js';

async function makePdf(dir: string): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const page = pdf.addPage([612, 792]); // Letter
    page.drawText(`Page ${i}`, { x: 72, y: 700, size: 24, font });
  }
  const file = path.join(dir, 'in.pdf');
  await writeFile(file, await pdf.save());
  return file;
}

describe('pdfToImages', () => {
  let dir: string;
  let pdfPath: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pdfly-img-'));
    pdfPath = await makePdf(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renders every page to JPG at 72 dpi with the page dimensions', async () => {
    const work = path.join(dir, 'w1');
    await (await import('node:fs/promises')).mkdir(work);
    const r = await pdfToImages(pdfPath, work, { format: 'jpg', quality: 80, dpi: 72 });
    expect(r.files).toHaveLength(2);
    expect(['pdfjs', 'pdftoppm']).toContain(r.engine);
    expect(r.files.map((f) => f.page)).toEqual([1, 2]);
    for (const f of r.files) {
      expect(f.name).toMatch(/^page-\d+\.jpg$/);
      expect((await stat(f.path)).size).toBeGreaterThan(0);
      const meta = await sharp(f.path).metadata();
      expect(meta.format).toBe('jpeg');
      expect(Math.abs((meta.width ?? 0) - 612)).toBeLessThanOrEqual(1);
      expect(Math.abs((meta.height ?? 0) - 792)).toBeLessThanOrEqual(1);
      expect(f.width).toBe(meta.width);
      expect(f.height).toBe(meta.height);
    }
  });

  it('honours the page selection and PNG format, dropping out-of-range pages', async () => {
    const work = path.join(dir, 'w2');
    await (await import('node:fs/promises')).mkdir(work);
    const r = await pdfToImages(pdfPath, work, { format: 'png', quality: 80, dpi: 72, pages: [2, 99] });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].page).toBe(2);
    expect(r.files[0].name).toBe('page-2.png');
    const meta = await sharp(r.files[0].path).metadata();
    expect(meta.format).toBe('png');
  });

  it('throws a validation error when no selected page exists', async () => {
    const work = path.join(dir, 'w3');
    await (await import('node:fs/promises')).mkdir(work);
    await expect(pdfToImages(pdfPath, work, { format: 'jpg', quality: 80, dpi: 72, pages: [5] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' } satisfies Partial<AppError>);
  });
});
