/**
 * PDF -> JPG/PNG (pdf.js + canvas).
 */
import { engineError } from './common';
import { getPageCount, renderPdfPages, type RenderedPage } from './render';

export interface PdfToImagesOptions {
  format: 'jpg' | 'png';
  quality: number;
  dpi: number;
  pages?: number[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface PdfToImagesResult {
  files: (RenderedPage & { name: string })[];
  engine: 'pdfjs';
}

export async function pdfToImages(bytes: Uint8Array, opts: PdfToImagesOptions): Promise<PdfToImagesResult> {
  const total = await getPageCount(bytes);
  let pages: number[] | undefined;
  if (opts.pages?.length) {
    pages = [...new Set(opts.pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= total))].sort((a, b) => a - b);
    if (!pages.length) throw engineError('VALIDATION_ERROR', 'No valid pages selected.');
  }
  const ext = opts.format === 'png' ? 'png' : 'jpg';
  let rendered: RenderedPage[];
  try {
    rendered = await renderPdfPages(bytes, { dpi: opts.dpi, pages, format: opts.format === 'png' ? 'png' : 'jpeg', quality: opts.quality, signal: opts.signal, onProgress: opts.onProgress });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    throw engineError('CONVERSION_FAILED', 'The pages could not be rendered.');
  }
  if (!rendered.length) throw engineError('CONVERSION_FAILED', 'No pages could be rendered.');
  return { files: rendered.map((r) => ({ ...r, name: `page-${r.page}.${ext}` })), engine: 'pdfjs' };
}
