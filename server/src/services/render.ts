/**
 * Render PDF pages to raster images on the server.
 *
 * Primary engine: pdf.js (legacy build) + @napi-rs/canvas (pure JS/N-API, no system deps).
 * If Poppler's `pdftoppm` is installed it is used instead for speed on large documents.
 */
import path from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { detectTools } from '../config/tools.js';
import { run } from '../utils/exec.js';
import { AppError } from '../utils/errors.js';

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
}

export interface RenderedPage {
  page: number;
  data: Buffer;
  width: number;
  height: number;
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(ctx: { canvas: Canvas }, width: number, height: number) {
    ctx.canvas.width = Math.max(1, Math.floor(width));
    ctx.canvas.height = Math.max(1, Math.floor(height));
  }
  destroy(ctx: { canvas: Canvas | null }) {
    if (ctx.canvas) {
      ctx.canvas.width = 0;
      ctx.canvas.height = 0;
    }
    ctx.canvas = null;
  }
}

export async function openPdfDocument(data: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const cmapDir = path.join(path.dirname(require_resolve('pdfjs-dist/package.json')), 'cmaps') + '/';
  const fontDir = path.join(path.dirname(require_resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
  try {
    const task = pdfjs.getDocument({
      data: new Uint8Array(data),
      cMapUrl: cmapDir,
      cMapPacked: true,
      standardFontDataUrl: fontDir,
      useSystemFonts: false,
      verbosity: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CanvasFactory: NodeCanvasFactory as any,
    });
    return await task.promise;
  } catch (err) {
    throw AppError.from(err, 'CORRUPTED_PDF');
  }
}

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
function require_resolve(spec: string) {
  return require_.resolve(spec);
}

/** Count pages without fully parsing content. */
export async function getPageCount(data: Uint8Array): Promise<number> {
  const doc = await openPdfDocument(data);
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

/** Extract the text content of every page (used for OCR detection, PDF->Word/Excel). */
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

async function renderWithPdfJs(data: Uint8Array, opts: RenderOptions): Promise<RenderedPage[]> {
  const doc = await openPdfDocument(data);
  const dpi = opts.dpi ?? 150;
  const format = opts.format ?? 'png';
  const quality = Math.min(100, Math.max(1, opts.quality ?? 90));
  const maxDim = opts.maxDimension ?? 10000;
  try {
    const pages = (opts.pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)).filter((p) => p >= 1 && p <= doc.numPages);
    const out: RenderedPage[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = await doc.getPage(pages[i]);
      let scale = dpi / 72;
      const base = page.getViewport({ scale: 1 });
      const longest = Math.max(base.width, base.height) * scale;
      if (longest > maxDim) scale *= maxDim / longest;
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.render({ canvasContext: ctx as any, viewport, canvas: canvas as any }).promise;
      let buf: Buffer;
      if (format === 'jpeg') buf = await sharp(canvas.toBuffer('image/png')).jpeg({ quality, mozjpeg: true }).toBuffer();
      else buf = canvas.toBuffer('image/png');
      out.push({ page: pages[i], data: buf, width: canvas.width, height: canvas.height });
      page.cleanup();
      opts.onProgress?.(i + 1, pages.length);
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

async function renderWithPdftoppm(bin: string, pdfPath: string, workDir: string, opts: RenderOptions, total: number): Promise<RenderedPage[]> {
  const dpi = opts.dpi ?? 150;
  const format = opts.format ?? 'png';
  const pages = (opts.pages ?? Array.from({ length: total }, (_, i) => i + 1)).filter((p) => p >= 1 && p <= total);
  const out: RenderedPage[] = [];
  // Render contiguous ranges to limit process spawns.
  const ranges: [number, number][] = [];
  for (const p of pages) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === p - 1) last[1] = p;
    else ranges.push([p, p]);
  }
  let done = 0;
  for (const [f, l] of ranges) {
    const prefix = path.join(workDir, `pg-${f}`);
    await run(bin, ['-r', String(dpi), '-f', String(f), '-l', String(l), format === 'jpeg' ? '-jpeg' : '-png', ...(format === 'jpeg' ? ['-jpegopt', `quality=${opts.quality ?? 90}`] : []), pdfPath, prefix]);
    const files = (await readdir(workDir)).filter((n) => n.startsWith(`pg-${f}-`)).sort();
    for (const name of files) {
      const m = /-(\d+)\.(png|jpg)$/.exec(name);
      if (!m) continue;
      const data = await readFile(path.join(workDir, name));
      const meta = await sharp(data).metadata();
      out.push({ page: Number(m[1]), data, width: meta.width ?? 0, height: meta.height ?? 0 });
      done++;
      opts.onProgress?.(done, pages.length);
    }
  }
  out.sort((a, b) => a.page - b.page);
  return out;
}

/**
 * Render pages of a PDF. `source` may be a file path or bytes. `workDir` is required when
 * an external renderer may be used.
 */
export async function renderPdfPages(source: string | Uint8Array, opts: RenderOptions = {}, workDir?: string): Promise<RenderedPage[]> {
  const data = typeof source === 'string' ? await readFile(source) : source;
  const tools = await detectTools();
  if (tools.pdftoppm && workDir) {
    try {
      const total = await getPageCount(data);
      const pdfPath = typeof source === 'string' ? source : path.join(workDir, 'render-input.pdf');
      if (typeof source !== 'string') await writeFile(pdfPath, data);
      return await renderWithPdftoppm(tools.pdftoppm, pdfPath, workDir, opts, total);
    } catch (err) {
      if (err instanceof AppError && err.code === 'CORRUPTED_PDF') throw err;
      // fall through to pdf.js
    }
  }
  return renderWithPdfJs(data, opts);
}
