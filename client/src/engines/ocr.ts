/**
 * OCR in the browser: add a searchable text layer to a scanned PDF with tesseract.js
 * (WebAssembly). Language data is downloaded on first use and cached by the browser.
 *
 * Pages that already contain text are skipped (copied unchanged) when `skipText` is set.
 */
import { PDFDocument } from 'pdf-lib';
import type { Worker as TesseractWorker } from 'tesseract.js';
import { assertNotAborted, chunk, engineError, messageOf } from './common';
import { extractText, renderPdfPages } from './render';

/** Upper bound on pages recognised in one run (keeps total OCR time bounded). */
export const MAX_OCR_PAGES = 200;
/** Pages with more than this many non-whitespace characters count as "already has text". */
const TEXT_THRESHOLD = 20;
const PREVIEW_CHARS = 600;
const RENDER_BATCH = 4;
const WORKER_START_TIMEOUT_MS = 120_000;
const DOWNLOAD_ERROR = 'Could not download the OCR engine or its language data. Check your internet connection and try again.';

export interface OcrOptions {
  /** tesseract language codes, e.g. ['eng'] or ['eng','deu'] */
  languages: string[];
  dpi: number;
  /** skip pages that already have a text layer */
  skipText: boolean;
  signal?: AbortSignal;
  onProgress?: (stage: string, fraction: number | null) => void;
}

export interface OcrResult {
  /** searchable PDF */
  pdf: Uint8Array;
  /** plain text export (one section per page) */
  text: string;
  engine: 'tesseract.js';
  pageCount: number;
  pagesProcessed: number;
  pagesSkipped: number;
  characters: number;
  textPreview: string;
  warnings: string[];
}

interface Plan {
  pageCount: number;
  /** 1-based pages to recognise, in order */
  toProcess: number[];
  /** 1-based pages copied unchanged because they already have text */
  skipped: number[];
  /** existing text per page (from the text layer), for skipped pages */
  existingText: Map<number, string>;
  warnings: string[];
}

export async function ocrPdf(input: Uint8Array, opts: OcrOptions): Promise<OcrResult> {
  const languages = opts.languages.length ? opts.languages : ['eng'];
  const dpi = Math.min(400, Math.max(72, Math.round(opts.dpi || 200)));
  if (!input.length) throw engineError('EMPTY_FILE', 'The file is empty.');

  let original: PDFDocument;
  try {
    original = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw engineError('CORRUPTED_PDF', 'This PDF appears to be damaged or is not a valid PDF.');
  }
  if (original.isEncrypted) throw engineError('CORRUPTED_PDF', 'This PDF is password protected. Remove the password before running OCR.');
  const pageCount = original.getPageCount();
  if (pageCount < 1) throw engineError('CORRUPTED_PDF', 'The PDF contains no pages.');

  opts.onProgress?.('Analyzing...', null);
  const plan = await planPages(input, pageCount, opts.skipText);
  assertNotAborted(opts.signal);

  if (plan.toProcess.length === 0) {
    // Nothing to recognise: return the document as-is with its existing text.
    const pages = Array.from({ length: pageCount }, (_, i) => plan.existingText.get(i + 1) ?? '');
    plan.warnings.push('Every page already contains selectable text, so no OCR was needed.');
    return result(input, pages, pageCount, 0, plan.skipped.length, pages.join('\n'), plan.warnings);
  }

  opts.onProgress?.('Loading OCR engine...', null);
  const worker = await startWorker(languages, opts);
  const ocrPages = new Map<number, Uint8Array>();
  const texts = new Map<number, string>();
  try {
    try {
      await worker.setParameters({ user_defined_dpi: String(dpi) });
    } catch {
      /* older cores may reject the parameter; page sizes may then differ from the original */
    }
    let done = 0;
    for (const batch of chunk(plan.toProcess, RENDER_BATCH)) {
      assertNotAborted(opts.signal);
      const rendered = await renderPdfPages(input, { dpi, pages: batch, format: 'png', signal: opts.signal });
      for (const img of rendered) {
        assertNotAborted(opts.signal);
        opts.onProgress?.(`Recognizing text (page ${img.page})...`, done / plan.toProcess.length);
        let data: { pdf?: number[] | Uint8Array | null; text?: string };
        try {
          const res = await worker.recognize(img.blob, {}, { pdf: true, text: true });
          data = res.data as unknown as { pdf?: number[] | Uint8Array | null; text?: string };
        } catch (err) {
          assertNotAborted(opts.signal);
          throw engineError('OCR_FAILED', `Text recognition failed on page ${img.page} (${messageOf(err)}).`);
        }
        if (!data.pdf || !data.pdf.length) throw engineError('OCR_FAILED', `The OCR engine returned no output for page ${img.page}.`);
        ocrPages.set(img.page, data.pdf instanceof Uint8Array ? data.pdf : Uint8Array.from(data.pdf));
        texts.set(img.page, (data.text ?? '').trim());
        done++;
        opts.onProgress?.(`Recognizing text (page ${img.page})...`, done / plan.toProcess.length);
      }
    }
  } finally {
    await worker.terminate().catch(() => undefined);
  }
  opts.onProgress?.('Assembling PDF...', null);
  return assemble(original, plan, ocrPages, texts);
}

// -----------------------------------------------------------------------------
// Planning
// -----------------------------------------------------------------------------

async function planPages(input: Uint8Array, pageCount: number, skipText: boolean): Promise<Plan> {
  const warnings: string[] = [];
  const existingText = new Map<number, string>();
  const skipped: number[] = [];
  let candidates = Array.from({ length: pageCount }, (_, i) => i + 1);

  if (skipText) {
    try {
      const texts = await extractText(input);
      for (const t of texts) {
        if (t.text.replace(/\s+/g, '').length > TEXT_THRESHOLD) {
          skipped.push(t.page);
          existingText.set(t.page, t.text.trim());
        }
      }
      const skipSet = new Set(skipped);
      candidates = candidates.filter((p) => !skipSet.has(p));
    } catch {
      warnings.push('Existing text could not be detected; all pages were processed.');
    }
  }

  let toProcess = candidates;
  if (candidates.length > MAX_OCR_PAGES) {
    toProcess = candidates.slice(0, MAX_OCR_PAGES);
    const rest = candidates.slice(MAX_OCR_PAGES);
    skipped.push(...rest);
    warnings.push(`Only the first ${MAX_OCR_PAGES} pages were recognised; ${rest.length} page${rest.length === 1 ? '' : 's'} were left unchanged. Split the document to OCR the rest.`);
  }
  skipped.sort((a, b) => a - b);
  return { pageCount, toProcess, skipped, existingText, warnings };
}

// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

/**
 * Start a tesseract.js worker. Errors raised inside the worker are routed through
 * `errorHandler`, and a timeout guards against the start-up promise never settling
 * (e.g. when the language data download stalls).
 */
async function startWorker(languages: string[], opts: OcrOptions): Promise<TesseractWorker> {
  const { createWorker } = await import('tesseract.js');
  let fail!: (err: unknown) => void;
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The OCR engine did not start in time.')), WORKER_START_TIMEOUT_MS);
  });
  const aborted = new Promise<never>((_, reject) => {
    opts.signal?.addEventListener('abort', () => reject(engineError('CANCELLED', 'The operation was cancelled.')), { once: true });
  });
  let worker: TesseractWorker | null = null;
  const starting = createWorker(languages.join('+'), 1, {
    logger: (m) => {
      if (m.status === 'loading language traineddata' || m.status === 'loading tesseract core') opts.onProgress?.('Downloading language data...', m.progress ?? null);
    },
    errorHandler: (err: unknown) => fail(err),
  }).then((w) => {
    worker = w;
    return w;
  });
  try {
    const w = await Promise.race([starting, failed, timedOut, aborted]);
    opts.signal?.addEventListener('abort', () => void w.terminate().catch(() => undefined), { once: true });
    return w;
  } catch (err) {
    // Don't leak a worker that finished starting after we gave up on it.
    void starting.then((w) => w.terminate()).catch(() => undefined);
    if (worker) void (worker as TesseractWorker).terminate().catch(() => undefined);
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const msg = messageOf(err);
    if (/fetch|network|traineddata|load|failed/i.test(msg)) throw engineError('OCR_FAILED', DOWNLOAD_ERROR);
    throw engineError('OCR_FAILED', `The OCR engine could not be started (${msg}).`);
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------

/** Merge original (skipped) pages and OCR'd single-page PDFs in document order. */
async function assemble(original: PDFDocument, plan: Plan, ocrPages: Map<number, Uint8Array>, texts: Map<number, string>): Promise<OcrResult> {
  const out = await PDFDocument.create();
  out.setProducer('PDFly OCR');
  const title = original.getTitle();
  if (title) out.setTitle(title);

  const pageTexts: string[] = [];
  let processed = 0;
  let failed = 0;
  for (let p = 1; p <= plan.pageCount; p++) {
    const ocr = ocrPages.get(p);
    let copied = false;
    if (ocr) {
      try {
        const src = await PDFDocument.load(ocr, { ignoreEncryption: true, updateMetadata: false });
        if (src.getPageCount() >= 1) {
          const [page] = await out.copyPages(src, [0]);
          out.addPage(page);
          copied = true;
          processed++;
        }
      } catch {
        /* fall back to the original page below */
      }
    }
    if (!copied) {
      if (ocr) failed++;
      const [page] = await out.copyPages(original, [p - 1]);
      out.addPage(page);
    }
    pageTexts.push(copied ? (texts.get(p) ?? '') : (plan.existingText.get(p) ?? texts.get(p) ?? ''));
  }
  if (failed) plan.warnings.push(`${failed} page${failed === 1 ? '' : 's'} could not be converted and were kept without a text layer.`);

  const pdf = await out.save({ useObjectStreams: true });
  const ocrText = plan.toProcess.map((p) => texts.get(p) ?? '').join('\n');
  return result(pdf, pageTexts, plan.pageCount, processed, plan.pageCount - processed, ocrText, plan.warnings);
}

function result(pdf: Uint8Array, pageTexts: string[], pageCount: number, pagesProcessed: number, pagesSkipped: number, text: string, warnings: string[]): OcrResult {
  const clean = text.replace(/\s+/g, ' ').trim();
  return {
    pdf,
    text: pageTexts.map((t, i) => `----- Page ${i + 1} -----\n\n${t}`).join('\n\n'),
    engine: 'tesseract.js',
    pageCount,
    pagesProcessed,
    pagesSkipped,
    characters: text.replace(/\s+/g, '').length ? text.trim().length : 0,
    textPreview: clean.slice(0, PREVIEW_CHARS),
    warnings,
  };
}
