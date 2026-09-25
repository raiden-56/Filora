import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { pdfService } from '../services/pdfService.js';
import { ok } from '../utils/response.js';
import { cleanupRequestFiles } from '../middleware/upload.js';
import { respondWithBuffers, respondWithPaths, withExt, firstUpload, withWorkDir } from './helpers.js';
import { compressPdf } from '../services/optimize/compress.js';
import { repairPdf } from '../services/optimize/repair.js';
import { ocrPdf } from '../services/optimize/ocr.js';
import { AppError } from '../utils/errors.js';
import { isValidLanguage } from '../services/optimize/languages.js';
import type { z } from 'zod';
import type { mergeSchema, splitSchema, pagesSchema, organizeSchema, compressSchema, ocrSchema } from '../validators/pdf.validators.js';

export async function info(req: Request, res: Response) {
  const f = firstUpload(req);
  const i = await pdfService.info(f.path);
  await cleanupRequestFiles(req);
  ok(res, { name: f.originalname, size: f.size, ...i });
}

export async function merge(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof mergeSchema>;
  let files = req.uploads;
  if (files.length < 2) throw new AppError('VALIDATION_ERROR', 'Upload at least two PDF files to merge.');
  if (opts.order?.length === files.length) files = opts.order.map((i) => files[i]).filter(Boolean);
  const data = await pdfService.merge(files.map((f) => f.path), opts.title);
  await respondWithBuffers(req, res, [{ data, name: withExt(files[0].originalname, '-merged', 'pdf'), mimeType: 'application/pdf' }], 'PDFs merged successfully');
}

export async function split(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof splitSchema>;
  const f = firstUpload(req);
  const mode = opts.mode === 'every' ? { type: 'every' as const } : opts.mode === 'ranges' ? { type: 'ranges' as const, ranges: opts.ranges } : opts.mode === 'pages' ? { type: 'pages' as const, pages: opts.pages } : { type: 'chunk' as const, size: opts.size };
  const outputs = await pdfService.split(f.path, mode, f.originalname);
  await respondWithBuffers(req, res, outputs.map((o) => ({ data: o.data, name: o.name, mimeType: 'application/pdf' })), `PDF split into ${outputs.length} file${outputs.length === 1 ? '' : 's'}`);
}

export async function removePagesCtrl(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof pagesSchema>;
  const f = firstUpload(req);
  const data = await pdfService.removePages(f.path, opts.pages);
  await respondWithBuffers(req, res, [{ data, name: withExt(f.originalname, '-pages-removed', 'pdf'), mimeType: 'application/pdf' }], 'Pages removed successfully');
}

export async function extractPagesCtrl(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof pagesSchema>;
  const f = firstUpload(req);
  const data = await pdfService.extractPages(f.path, opts.pages);
  await respondWithBuffers(req, res, [{ data, name: withExt(f.originalname, '-extracted', 'pdf'), mimeType: 'application/pdf' }], 'Pages extracted successfully');
}

export async function organize(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof organizeSchema>;
  const files = req.uploads;
  for (const p of opts.pages) if (p.source >= files.length) throw new AppError('VALIDATION_ERROR', `Unknown source document ${p.source}.`);
  const data = await pdfService.organize(files.map((f) => f.path), opts.pages);
  await respondWithBuffers(req, res, [{ data, name: withExt(files[0].originalname, '-organized', 'pdf'), mimeType: 'application/pdf' }], 'PDF organized successfully');
}

export async function compress(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof compressSchema>;
  const f = firstUpload(req);
  const originalSize = f.size;
  await withWorkDir('compress', async (dir) => {
    const result = await compressPdf(f.path, dir, { level: opts.level });
    const data = await readFile(result.pdfPath);
    const compressedSize = data.byteLength;
    const ratio = originalSize > 0 ? 1 - compressedSize / originalSize : 0;
    await respondWithBuffers(
      req,
      res,
      [{ data, name: withExt(f.originalname, '-compressed', 'pdf'), mimeType: 'application/pdf' }],
      'PDF compressed successfully',
      { meta: { originalSize, compressedSize, reductionPercent: Math.round(Math.max(0, ratio) * 100), level: opts.level, engine: result.engine }, warnings: result.warnings },
    );
  });
}

export async function repair(req: Request, res: Response) {
  const f = firstUpload(req);
  await withWorkDir('repair', async (dir) => {
    const result = await repairPdf(f.path, dir);
    if (!result.pdfPath) throw new AppError('REPAIR_FAILED', 'Unable to repair this PDF. The file may be too damaged or is not a PDF.', { details: result.notes.join('; ') });
    await respondWithPaths(req, res, [{ path: result.pdfPath, name: withExt(f.originalname, '-repaired', 'pdf'), mimeType: 'application/pdf', pageCount: result.pageCount }], result.repaired ? 'Repair completed' : 'No damage found', {
      meta: { repaired: result.repaired, engine: result.engine, notes: result.notes, pageCount: result.pageCount, status: result.repaired ? 'repaired' : 'healthy' },
      warnings: result.warnings,
    });
  });
}

export async function ocr(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof ocrSchema>;
  const f = firstUpload(req);
  const languages = opts.languages.filter(isValidLanguage);
  if (!languages.length) throw new AppError('VALIDATION_ERROR', 'Choose at least one supported OCR language.');
  await withWorkDir('ocr', async (dir) => {
    const result = await ocrPdf(f.path, dir, { languages, dpi: opts.dpi, skipText: opts.skipText });
    const outputs: { path: string; name: string; mimeType: string; pageCount?: number }[] = [
      { path: result.pdfPath, name: withExt(f.originalname, '-ocr', 'pdf'), mimeType: 'application/pdf', pageCount: result.pageCount },
    ];
    if (opts.includeText && result.textPath) outputs.push({ path: result.textPath, name: withExt(f.originalname, '-text', 'txt'), mimeType: 'text/plain' });
    await respondWithPaths(req, res, outputs, 'OCR completed', {
      meta: { engine: result.engine, languages, pagesProcessed: result.pagesProcessed, pagesSkipped: result.pagesSkipped, characters: result.characters, textPreview: result.textPreview },
      warnings: result.warnings,
    });
  });
}
