process.env.NODE_ENV = 'test';

import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { ensureTmpDirs } from '../utils/tmp.js';

// The convert/edit controllers pull in services that are developed independently of these
// routes; stub them so this suite only depends on the PDF and file routes under test.
function controllerStub() {
  return new Proxy({} as Record<string, unknown>, {
    has: () => true,
    get: (_t, key) => (typeof key === 'string' && key !== 'then' && key !== '__esModule' && key !== 'default' ? async () => undefined : undefined),
  });
}
vi.mock('../controllers/convert.controller.js', () => controllerStub());
vi.mock('../controllers/edit.controller.js', () => controllerStub());

let app: Express;
let pdfA: Buffer;
let pdfB: Buffer;
let imagePdf: Buffer;

async function makePdf(pages: number, label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([300, 400]).drawText(`${label} page ${i}`, { x: 20, y: 300, size: 16, font });
  return Buffer.from(await doc.save());
}

async function makeImagePdf(): Promise<Buffer> {
  const w = 1400;
  const h = 1400;
  const raw = Buffer.alloc(w * h * 3);
  let seed = 7;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = (i % 251) + (seed % 32);
  }
  const jpeg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpeg);
  doc.addPage([500, 500]).drawImage(img, { x: 0, y: 0, width: 500, height: 500 });
  return Buffer.from(await doc.save());
}

/** Download a stored file as raw bytes. */
async function download(url: string): Promise<{ status: number; body: Buffer; type: string }> {
  const res = await request(app)
    .get(url)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  return { status: res.status, body: res.body as Buffer, type: res.headers['content-type'] ?? '' };
}

interface FileDto {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  pageCount?: number;
}

function filesOf(res: request.Response): FileDto[] {
  expect(res.body.success).toBe(true);
  expect(Array.isArray(res.body.data.files)).toBe(true);
  return res.body.data.files as FileDto[];
}

async function expectPdfDownload(f: FileDto, pages?: number) {
  expect(f.url).toBe(`/api/files/${f.id}/download`);
  const dl = await download(f.url);
  expect(dl.status).toBe(200);
  expect(dl.type).toContain('application/pdf');
  expect(dl.body.subarray(0, 4).toString()).toBe('%PDF');
  const doc = await PDFDocument.load(dl.body);
  if (pages !== undefined) expect(doc.getPageCount()).toBe(pages);
  return doc;
}

beforeAll(async () => {
  await ensureTmpDirs();
  const { createApp } = await import('../app.js');
  app = createApp();
  pdfA = await makePdf(3, 'A');
  pdfB = await makePdf(2, 'B');
  imagePdf = await makeImagePdf();
});

describe('POST /api/pdf/info', () => {
  it('returns page count and file details', async () => {
    const res = await request(app).post('/api/pdf/info').attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pageCount).toBe(3);
    expect(res.body.data.name).toBe('a.pdf');
  });
});

describe('POST /api/pdf/merge', () => {
  it('merges two PDFs and the result downloads as a PDF', async () => {
    const res = await request(app).post('/api/pdf/merge').attach('files', pdfA, 'a.pdf').attach('files', pdfB, 'b.pdf');
    expect(res.status).toBe(200);
    const [f] = filesOf(res);
    expect(f.name).toBe('a-merged.pdf');
    expect(f.pageCount).toBe(5);
    await expectPdfDownload(f, 5);
  });

  it('rejects a single file', async () => {
    const res = await request(app).post('/api/pdf/merge').attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/pdf/split', () => {
  it('splits every page into its own file', async () => {
    const res = await request(app).post('/api/pdf/split').field('mode', 'every').attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(200);
    const files = filesOf(res);
    expect(files).toHaveLength(3);
    await expectPdfDownload(files[0], 1);
  });

  it('splits by ranges', async () => {
    const res = await request(app).post('/api/pdf/split').field('mode', 'ranges').field('ranges', '1-2,3').attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(200);
    const files = filesOf(res);
    expect(files).toHaveLength(2);
    await expectPdfDownload(files[0], 2);
  });
});

describe('POST /api/pdf/remove-pages and /extract-pages', () => {
  it('removes the given pages', async () => {
    const res = await request(app).post('/api/pdf/remove-pages').field('pages', '[2]').attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(200);
    const [f] = filesOf(res);
    await expectPdfDownload(f, 2);
  });

  it('extracts the given pages', async () => {
    const res = await request(app).post('/api/pdf/extract-pages').field('pages', JSON.stringify([1, 3])).attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(200);
    const [f] = filesOf(res);
    await expectPdfDownload(f, 2);
  });

  it('validates the pages option', async () => {
    const res = await request(app).post('/api/pdf/remove-pages').field('pages', 'abc').attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/pdf/organize', () => {
  it('reorders pages across documents', async () => {
    const pages = [
      { source: 1, page: 2 },
      { source: 0, page: 1, rotate: 90 },
      { source: 0, page: 3 },
    ];
    const res = await request(app).post('/api/pdf/organize').field('pages', JSON.stringify(pages)).attach('files', pdfA, 'a.pdf').attach('files', pdfB, 'b.pdf');
    expect(res.status).toBe(200);
    const [f] = filesOf(res);
    const doc = await expectPdfDownload(f, 3);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  it('rejects an unknown source document', async () => {
    const res = await request(app).post('/api/pdf/organize').field('pages', JSON.stringify([{ source: 4, page: 1 }])).attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/pdf/compress', () => {
  it('compresses an image-heavy PDF and reports sizes', async () => {
    const res = await request(app).post('/api/pdf/compress').field('level', 'high').attach('files', imagePdf, 'photo.pdf');
    expect(res.status).toBe(200);
    const [f] = filesOf(res);
    expect(f.name).toBe('photo-compressed.pdf');
    expect(res.body.data.meta.originalSize).toBe(imagePdf.length);
    expect(res.body.data.meta.compressedSize).toBeLessThan(imagePdf.length);
    expect(res.body.data.meta.reductionPercent).toBeGreaterThan(0);
    expect(['ghostscript', 'js']).toContain(res.body.data.meta.engine);
    await expectPdfDownload(f, 1);
  });

  it('rejects an invalid level', async () => {
    const res = await request(app).post('/api/pdf/compress').field('level', 'extreme').attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/pdf/repair', () => {
  it('reports a healthy file as healthy', async () => {
    const res = await request(app).post('/api/pdf/repair').attach('files', pdfA, 'a.pdf');
    expect(res.status).toBe(200);
    const [f] = filesOf(res);
    expect(f.name).toBe('a-repaired.pdf');
    expect(res.body.data.meta.repaired).toBe(false);
    expect(res.body.data.meta.status).toBe('healthy');
    await expectPdfDownload(f, 3);
  });

  it('repairs a file with a broken xref', async () => {
    const broken = Buffer.from(pdfA.toString('latin1').replace(/startxref\s+\d+/, 'startxref 42'), 'latin1');
    const res = await request(app).post('/api/pdf/repair').attach('files', broken, 'broken.pdf');
    expect(res.status).toBe(200);
    const [f] = filesOf(res);
    expect(res.body.data.meta.repaired).toBe(true);
    expect(res.body.data.meta.status).toBe('repaired');
    await expectPdfDownload(f, 3);
  });

  it('fails cleanly for a file that is a PDF only by name', async () => {
    // Starts with %PDF so it passes upload validation but has no usable objects.
    const junk = Buffer.from('%PDF-1.4\n' + 'x'.repeat(2000));
    const res = await request(app).post('/api/pdf/repair').attach('files', junk, 'junk.pdf');
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('REPAIR_FAILED');
  });
});

describe('/api/files', () => {
  it('gets, downloads and deletes a stored file', async () => {
    const created = await request(app).post('/api/pdf/extract-pages').field('pages', '[1]').attach('files', pdfB, 'b.pdf');
    const [f] = filesOf(created);

    const meta = await request(app).get(`/api/files/${f.id}`);
    expect(meta.status).toBe(200);
    expect(meta.body.data.file.id).toBe(f.id);
    expect(meta.body.data.file.name).toBe('b-extracted.pdf');

    const dl = await download(`/api/files/${f.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.body.subarray(0, 4).toString()).toBe('%PDF');

    const del = await request(app).delete(`/api/files/${f.id}`);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const gone = await request(app).get(`/api/files/${f.id}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('NOT_FOUND');
    const goneDl = await request(app).get(`/api/files/${f.id}/download`);
    expect(goneDl.status).toBe(404);
  });

  it('returns 404 for an unknown or malformed id', async () => {
    const res = await request(app).get('/api/files/not-a-real-id');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('upload validation', () => {
  it('returns 400 NO_FILE when no file is attached', async () => {
    const res = await request(app).post('/api/pdf/info');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NO_FILE');
    expect(typeof res.body.error.message).toBe('string');
  });

  it('rejects a non-PDF file that is named .pdf', async () => {
    const res = await request(app).post('/api/pdf/info').attach('files', Buffer.from('hello, this is plain text'), 'fake.pdf');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_FILE');
  });

  it('rejects an unsupported extension', async () => {
    const res = await request(app).post('/api/pdf/info').attach('files', pdfA, 'a.txt');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('rejects an empty file', async () => {
    const res = await request(app).post('/api/pdf/info').attach('files', Buffer.alloc(0), 'empty.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_FILE');
  });

  it('returns 404 JSON for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
