import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import type { z } from 'zod';
import { pdfService } from '../services/pdfService.js';
import { respondWithBuffers, respondWithPaths, withExt, firstUpload, withWorkDir } from './helpers.js';
import { AppError } from '../utils/errors.js';
import { config } from '../config/index.js';
import { officeToPdf } from '../services/convert/office.js';
import { htmlToPdf } from '../services/convert/htmlToPdf.js';
import { pdfToImages } from '../services/convert/pdfToImages.js';
import { pdfToWord } from '../services/convert/pdfToWord.js';
import { pdfToPptx } from '../services/convert/pdfToPpt.js';
import { pdfToExcel } from '../services/convert/pdfToExcel.js';
import { pdfToPdfa } from '../services/convert/pdfToPdfa.js';
import type { OfficeKind } from '../services/convert/types.js';
import type { imagesToPdfSchema, htmlToPdfSchema, pdfToImagesSchema, pdfToWordSchema, pdfToPptSchema, pdfToExcelSchema, pdfToPdfaSchema } from '../validators/convert.validators.js';
import sharp from 'sharp';

export async function jpgToPdf(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof imagesToPdfSchema>;
  let files = req.uploads;
  if (opts.order?.length === files.length) files = opts.order.map((i) => files[i]).filter(Boolean);
  const images = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let data: Buffer = await readFile(f.path);
    const meta = await sharp(data).metadata().catch(() => null);
    if (!meta) throw new AppError('INVALID_FILE', `"${f.originalname}" is not a valid image.`);
    let mimeType: 'image/jpeg' | 'image/png' = meta.format === 'png' ? 'image/png' : 'image/jpeg';
    // Re-encode WEBP (unsupported by pdf-lib), or when a quality reduction was requested.
    if (meta.format === 'webp' || (opts.quality < 100 && meta.format !== 'png') || (meta.format !== 'png' && meta.format !== 'jpeg')) {
      const hasAlpha = Boolean(meta.hasAlpha) && meta.format !== 'jpeg';
      data = hasAlpha ? await sharp(data).png().toBuffer() : await sharp(data).rotate().jpeg({ quality: opts.quality, mozjpeg: true }).toBuffer();
      mimeType = hasAlpha ? 'image/png' : 'image/jpeg';
    } else if (meta.format === 'jpeg' && meta.orientation && meta.orientation > 1) {
      data = await sharp(data).rotate().jpeg({ quality: 95 }).toBuffer(); // bake EXIF orientation
    }
    images.push({ data: new Uint8Array(data), mimeType, rotation: opts.rotations?.[i] ?? 0, name: f.originalname });
  }
  const pdf = await pdfService.imagesToPdf(images, {
    pageSize: opts.pageSize,
    orientation: opts.orientation,
    margin: opts.margin,
    fit: opts.fit,
    customSize: opts.customWidth && opts.customHeight ? { width: opts.customWidth, height: opts.customHeight } : undefined,
    title: opts.title,
  });
  const name = files.length === 1 ? withExt(files[0].originalname, '', 'pdf') : `${opts.title?.trim() || 'images'}.pdf`;
  await respondWithBuffers(req, res, [{ data: pdf, name, mimeType: 'application/pdf', pageCount: images.length }], 'PDF generated successfully');
}

async function officeCtrl(req: Request, res: Response, kind: OfficeKind) {
  const files = req.uploads;
  await withWorkDir(kind, async (dir) => {
    const outputs: { path: string; name: string; mimeType: string }[] = [];
    const warnings: string[] = [];
    let engine = '';
    for (const f of files) {
      const r = await officeToPdf(f.path, f.originalname, kind, dir);
      engine = r.engine;
      warnings.push(...r.warnings.map((w) => (files.length > 1 ? `${f.originalname}: ${w}` : w)));
      outputs.push({ path: r.pdfPath, name: withExt(f.originalname, '', 'pdf'), mimeType: 'application/pdf' });
    }
    await respondWithPaths(req, res, outputs, 'Converted to PDF successfully', { meta: { engine }, warnings: [...new Set(warnings)] });
  });
}

export const wordToPdf = (req: Request, res: Response) => officeCtrl(req, res, 'word');
export const pptToPdf = (req: Request, res: Response) => officeCtrl(req, res, 'powerpoint');
export const excelToPdf = (req: Request, res: Response) => officeCtrl(req, res, 'excel');

export async function htmlToPdfCtrl(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof htmlToPdfSchema>;
  const file = req.uploads?.[0];
  if (!file && !opts.html?.trim() && !opts.url) throw new AppError('VALIDATION_ERROR', 'Provide HTML, upload an HTML file or enter a URL.');
  if (opts.url && !config.allowUrlFetch) throw new AppError('TOOL_UNAVAILABLE', 'Converting from URLs is disabled on this server.');
  await withWorkDir('html', async (dir) => {
    const r = await htmlToPdf({ html: opts.html, url: opts.url, filePath: file?.path }, opts, dir);
    let name = 'document.pdf';
    if (file) name = withExt(file.originalname, '', 'pdf');
    else if (opts.url) {
      try {
        name = `${new URL(opts.url).hostname.replace(/[^a-z0-9.-]/gi, '_')}.pdf`;
      } catch {
        /* keep default */
      }
    }
    await respondWithBuffers(req, res, [{ data: r.pdf, name, mimeType: 'application/pdf' }], 'PDF generated successfully', { meta: { engine: r.engine }, warnings: r.warnings });
  });
}

export async function pdfToJpg(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof pdfToImagesSchema>;
  const f = firstUpload(req);
  await withWorkDir('pdf2img', async (dir) => {
    const r = await pdfToImages(f.path, dir, opts);
    if (!r.files.length) throw new AppError('CONVERSION_FAILED', 'No pages could be rendered.');
    const base = withExt(f.originalname, '', '').replace(/\.$/, '');
    await respondWithPaths(
      req,
      res,
      r.files.map((x) => ({ path: x.path, name: `${base}-page-${x.page}.${opts.format}`, mimeType: opts.format === 'png' ? 'image/png' : 'image/jpeg' })),
      `Converted ${r.files.length} page${r.files.length === 1 ? '' : 's'} to ${opts.format.toUpperCase()}`,
      { meta: { engine: r.engine, pages: r.files.length, dpi: opts.dpi } },
    );
  });
}

export async function pdfToWordCtrl(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof pdfToWordSchema>;
  const f = firstUpload(req);
  await withWorkDir('pdf2docx', async (dir) => {
    const r = await pdfToWord(f.path, dir, opts);
    await respondWithPaths(req, res, [{ path: r.docxPath, name: withExt(f.originalname, '', 'docx'), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pageCount: r.pageCount }], 'Converted to Word successfully', { meta: { engine: r.engine }, warnings: r.warnings });
  });
}

export async function pdfToPptCtrl(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof pdfToPptSchema>;
  const f = firstUpload(req);
  await withWorkDir('pdf2pptx', async (dir) => {
    const r = await pdfToPptx(f.path, dir, opts);
    await respondWithPaths(req, res, [{ path: r.pptxPath, name: withExt(f.originalname, '', 'pptx'), mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pageCount: r.slides }], 'Converted to PowerPoint successfully', { meta: { slides: r.slides }, warnings: r.warnings });
  });
}

export async function pdfToExcelCtrl(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof pdfToExcelSchema>;
  const f = firstUpload(req);
  await withWorkDir('pdf2xlsx', async (dir) => {
    const r = await pdfToExcel(f.path, dir, opts);
    await respondWithPaths(req, res, [{ path: r.xlsxPath, name: withExt(f.originalname, '', 'xlsx'), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }], 'Converted to Excel successfully', { meta: { sheets: r.sheets, tablesFound: r.tablesFound }, warnings: r.warnings });
  });
}

export async function pdfToPdfaCtrl(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof pdfToPdfaSchema>;
  const f = firstUpload(req);
  await withWorkDir('pdfa', async (dir) => {
    const r = await pdfToPdfa(f.path, dir, opts);
    await respondWithPaths(req, res, [{ path: r.pdfPath, name: withExt(f.originalname, `-pdfa-${r.level}`, 'pdf'), mimeType: 'application/pdf' }], r.validation.valid ? 'Converted to PDF/A successfully' : 'Converted with warnings', { meta: { engine: r.engine, level: r.level, validation: r.validation }, warnings: r.warnings });
  });
}
