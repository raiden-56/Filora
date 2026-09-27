/**
 * Render PDF pages to raster images and read their text in the browser (pdf.js + canvas).
 */
import { openPdf } from '@/services/pdfjs';
import { assertNotAborted, canvasToBlob, disposeCanvas, engineError } from './common';

export interface RenderOptions {
  /** dots per inch (72 = 1:1) */
  dpi?: number;
  /** 1-based pages; omit for all */
  pages?: number[];
  format?: 'png' | 'jpeg';
  /** jpeg quality 1-100 */
  quality?: number;
  /** max pixels on the longest edge (safety cap) */
  maxDimension?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface RenderedPage {
  page: number;
  blob: Blob;
  width: number;
  height: number;
}

export async function openPdfDocument(data: Uint8Array) {
  try {
    return (await openPdf(data)).doc;
  } catch (err) {
    throw engineError('CORRUPTED_PDF', err instanceof Error ? err.message : 'This PDF appears to be damaged or is not a valid PDF.');
  }
}

/** Count pages without rendering anything. */
export async function getPageCount(data: Uint8Array): Promise<number> {
  const doc = await openPdfDocument(data);
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

/** Extract the text content of every page (used for OCR detection and conversions). */
export async function extractText(data: Uint8Array, pages?: number[]): Promise<{ page: number; text: string }[]> {
  const doc = await openPdfDocument(data);
  try {
    const list = pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
    const out: { page: number; text: string }[] = [];
    for (const p of list) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str;
          if (item.hasEOL) text += '\n';
        }
      }
      out.push({ page: p, text });
      page.cleanup();
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/** Render pages of a PDF to PNG or JPEG blobs. */
export async function renderPdfPages(data: Uint8Array, opts: RenderOptions = {}): Promise<RenderedPage[]> {
  const doc = await openPdfDocument(data);
  const dpi = opts.dpi ?? 150;
  const format = opts.format ?? 'png';
  const quality = Math.min(100, Math.max(1, opts.quality ?? 90));
  const maxDim = opts.maxDimension ?? 10000;
  try {
    const pages = (opts.pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)).filter((p) => p >= 1 && p <= doc.numPages);
    const out: RenderedPage[] = [];
    for (let i = 0; i < pages.length; i++) {
      assertNotAborted(opts.signal);
      const page = await doc.getPage(pages[i]);
      let scale = dpi / 72;
      const base = page.getViewport({ scale: 1 });
      const longest = Math.max(base.width, base.height) * scale;
      if (longest > maxDim) scale *= maxDim / longest;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Canvas is not supported in this browser.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const task = page.render({ canvasContext: ctx, viewport, canvas });
      opts.signal?.addEventListener('abort', () => task.cancel(), { once: true });
      try {
        await task.promise;
      } catch (err) {
        assertNotAborted(opts.signal);
        throw err;
      }
      const blob = await canvasToBlob(canvas, format === 'jpeg' ? 'image/jpeg' : 'image/png', quality / 100);
      out.push({ page: pages[i], blob, width: canvas.width, height: canvas.height });
      disposeCanvas(canvas);
      page.cleanup();
      opts.onProgress?.(i + 1, pages.length);
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

export async function renderedBytes(page: RenderedPage): Promise<Uint8Array> {
  return new Uint8Array(await page.blob.arrayBuffer());
}
