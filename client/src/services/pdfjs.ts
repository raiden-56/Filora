/**
 * Lazy loader for PDF.js. The library (and its worker) are only downloaded when a
 * PDF actually needs to be rendered, keeping the initial bundle small.
 */
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

/** CMaps and standard fonts are served from /pdfjs/* (see the pdfjsAssets plugin in vite.config.ts). */
const ASSET_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/pdfjs/`;
const CMAP_URL = `${ASSET_BASE}cmaps/`;
const FONT_URL = `${ASSET_BASE}standard_fonts/`;

export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      const pdfjs = mod;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  numPages: number;
}

export async function openPdf(data: Blob | Uint8Array | ArrayBuffer): Promise<LoadedPdf> {
  const pdfjs = await loadPdfJs();
  let bytes: Uint8Array;
  if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else bytes = new Uint8Array(data); // copy: pdf.js transfers the buffer to the worker
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: FONT_URL,
  });
  try {
    const doc = await task.promise;
    return { doc, numPages: doc.numPages };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (import.meta.env.DEV) console.error('[pdfjs] failed to open document:', err);
    if (/password/i.test(msg)) throw new Error('This PDF is password protected. Please remove the password first.');
    if (/invalid|corrupt|xref|missing/i.test(msg)) throw new Error('This PDF appears to be damaged or is not a valid PDF.');
    throw new Error('Could not open this PDF.');
  }
}

/** Cache of open PDF.js documents keyed by an arbitrary key (usually the file id). */
const docCache = new Map<string, Promise<LoadedPdf>>();

export function getCachedPdf(key: string, loader: () => Promise<Blob | Uint8Array>): Promise<LoadedPdf> {
  let p = docCache.get(key);
  if (!p) {
    p = loader().then((data) => openPdf(data));
    p.catch(() => docCache.delete(key));
    docCache.set(key, p);
  }
  return p;
}

export function evictCachedPdf(key: string) {
  const p = docCache.get(key);
  docCache.delete(key);
  p?.then((l) => l.doc.destroy()).catch(() => undefined);
}

export function clearPdfCache() {
  for (const key of [...docCache.keys()]) evictCachedPdf(key);
}

export interface RenderOptions {
  /** target width in CSS pixels */
  width?: number;
  /** or explicit scale */
  scale?: number;
  /** extra rotation (clockwise) added to the page's own rotation */
  rotation?: number;
  /** device pixel ratio multiplier for crisp output */
  dpr?: number;
  signal?: AbortSignal;
}

/** Render a page into a canvas. Returns the canvas and the viewport used. */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  opts: RenderOptions = {},
): Promise<{ width: number; height: number; task: RenderTask }> {
  const rotation = ((page.rotate + (opts.rotation ?? 0)) % 360 + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const scale = opts.scale ?? (opts.width ? opts.width / base.width : 1);
  const dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * dpr, rotation });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas not supported');
  const task = page.render({ canvasContext: ctx, viewport, canvas });
  opts.signal?.addEventListener('abort', () => task.cancel(), { once: true });
  await task.promise;
  return { width: viewport.width / dpr, height: viewport.height / dpr, task };
}

// ---------------------------------------------------------------------------
// Thumbnail generation with a small concurrency queue and an in-memory cache.
// ---------------------------------------------------------------------------

const thumbCache = new Map<string, string>();
const MAX_THUMBS = 600;
let running = 0;
const MAX_CONCURRENT = 3;
const queue: (() => void)[] = [];

function next() {
  if (running >= MAX_CONCURRENT) return;
  const job = queue.shift();
  if (job) job();
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running--;
          next();
        });
    });
    next();
  });
}

export async function renderThumbnail(
  key: string,
  loaded: LoadedPdf,
  pageNumber: number,
  width = 160,
  rotation = 0,
): Promise<string> {
  const cacheKey = `${key}:${pageNumber}:${width}:${rotation}`;
  const cached = thumbCache.get(cacheKey);
  if (cached) return cached;
  return enqueue(async () => {
    const again = thumbCache.get(cacheKey);
    if (again) return again;
    const page = await loaded.doc.getPage(pageNumber);
    const canvas = document.createElement('canvas');
    await renderPageToCanvas(page, canvas, { width, rotation, dpr: 1.5 });
    const url = canvas.toDataURL('image/jpeg', 0.8);
    canvas.width = 0;
    canvas.height = 0;
    if (thumbCache.size >= MAX_THUMBS) {
      const first = thumbCache.keys().next().value;
      if (first) thumbCache.delete(first);
    }
    thumbCache.set(cacheKey, url);
    return url;
  });
}

export function clearThumbnailCache(prefix?: string) {
  if (!prefix) {
    thumbCache.clear();
    return;
  }
  for (const k of [...thumbCache.keys()]) if (k.startsWith(prefix + ':')) thumbCache.delete(k);
}

/** Extract all text of a page (used for search). */
export async function getPageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  return content.items
    .map((it) => ('str' in it ? it.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** Render a page to a PNG blob at a given scale (used for exports and OCR fallbacks). */
export async function renderPageToBlob(
  page: PDFPageProxy,
  scale: number,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  await renderPageToCanvas(page, canvas, { scale, dpr: 1 });
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to render page'))), type, quality);
  });
}
