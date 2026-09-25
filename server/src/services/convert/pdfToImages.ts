/**
 * PDF -> JPG/PNG. Uses `renderPdfPages` (pdftoppm when installed, otherwise pdf.js + canvas).
 */
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { detectTools } from '../../config/tools.js';
import { getPageCount, renderPdfPages } from '../render.js';
import { AppError } from '../../utils/errors.js';
import type { PdfToImagesOptions, PdfToImagesResult } from './types.js';

export async function pdfToImages(pdfPath: string, workDir: string, opts: PdfToImagesOptions): Promise<PdfToImagesResult> {
  const bytes = await readFile(pdfPath);
  const total = await getPageCount(bytes);
  let pages: number[] | undefined;
  if (opts.pages?.length) {
    pages = [...new Set(opts.pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= total))].sort((a, b) => a - b);
    if (!pages.length) throw new AppError('VALIDATION_ERROR', 'No valid pages selected.');
  }
  const format = opts.format === 'png' ? 'png' : 'jpeg';
  const ext = opts.format === 'png' ? 'png' : 'jpg';
  let rendered;
  try {
    rendered = await renderPdfPages(pdfPath, { dpi: opts.dpi, pages, format, quality: opts.quality }, workDir);
  } catch (err) {
    throw AppError.from(err, 'CONVERSION_FAILED');
  }
  const tools = await detectTools();
  const files: PdfToImagesResult['files'] = [];
  for (const r of rendered) {
    const name = `page-${r.page}.${ext}`;
    const out = path.join(workDir, name);
    await writeFile(out, r.data);
    files.push({ path: out, name, page: r.page, width: r.width, height: r.height });
  }
  return { files, engine: tools.pdftoppm ? 'pdftoppm' : 'pdfjs' };
}
