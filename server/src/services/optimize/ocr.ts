/**
 * OCR: add a searchable text layer to a scanned PDF.
 *
 * Engines (first available wins):
 *  1. ocrmypdf (best quality, keeps the original page content)
 *  2. native tesseract binary: pages are rendered, recognised one by one and merged
 *  3. tesseract.js (pure JS/WASM, always available; language data is downloaded
 *     to `config.tessdataDir` on first use)
 *
 * Pages that already contain text are skipped (copied unchanged) when `skipText` is set.
 */
import path from 'node:path';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { config } from '../../config/index.js';
import { detectTools } from '../../config/tools.js';
import { run } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import { extractText, renderPdfPages } from '../render.js';
import type { OcrOptions, OcrResult } from './types.js';

/** Upper bound on pages recognised in one request (keeps total OCR time bounded). */
export const MAX_OCR_PAGES = 200;
/** Pages with more than this many non-whitespace characters count as "already has text". */
const TEXT_THRESHOLD = 20;
const PREVIEW_CHARS = 600;
const RENDER_BATCH = 4;

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

export async function ocrPdf(pdfPath: string, workDir: string, opts: OcrOptions): Promise<OcrResult> {
  const languages = opts.languages.length ? opts.languages : ['eng'];
  const dpi = Math.min(400, Math.max(72, Math.round(opts.dpi || 200)));
  const input = await readFile(pdfPath);
  if (!input.length) throw new AppError('EMPTY_FILE');

  let original: PDFDocument;
  try {
    original = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    throw AppError.from(err, 'CORRUPTED_PDF');
  }
  if (original.isEncrypted) throw new AppError('CORRUPTED_PDF', 'This PDF is password protected. Remove the password before running OCR.');
  const pageCount = original.getPageCount();
  if (pageCount < 1) throw new AppError('CORRUPTED_PDF', 'The PDF contains no pages.');

  const plan = await planPages(input, pageCount, opts.skipText);
  const tools = await detectTools();

  if (plan.toProcess.length === 0) {
    // Nothing to recognise: return the document as-is with its existing text.
    const outPath = path.join(workDir, 'ocr.pdf');
    await writeFile(outPath, input);
    const pages = Array.from({ length: pageCount }, (_, i) => plan.existingText.get(i + 1) ?? '');
    const textPath = await writeText(workDir, pages);
    const text = pages.join('\n');
    plan.warnings.push('Every page already contains selectable text, so no OCR was needed.');
    return result(outPath, textPath, tools.ocrmypdf ? 'ocrmypdf' : tools.tesseract ? 'tesseract' : 'tesseract.js', pageCount, 0, plan.skipped.length, text, plan.warnings);
  }

  if (tools.ocrmypdf) {
    try {
      return await withOcrmypdf(tools.ocrmypdf, pdfPath, workDir, languages, opts.skipText, plan);
    } catch (err) {
      plan.warnings.push(`ocrmypdf could not process this file (${messageOf(err)}); falling back to the built-in engine.`);
    }
  }
  if (tools.tesseract) {
    try {
      return await withTesseractBinary(tools.tesseract, input, original, workDir, languages, dpi, plan);
    } catch (err) {
      if (err instanceof AppError && err.code === 'TIMEOUT') throw err;
      plan.warnings.push(`Tesseract could not process this file (${messageOf(err)}); falling back to the built-in engine.`);
    }
  }
  return withTesseractJs(input, original, workDir, languages, dpi, plan);
}

// -----------------------------------------------------------------------------
// Planning
// -----------------------------------------------------------------------------

async function planPages(input: Buffer, pageCount: number, skipText: boolean): Promise<Plan> {
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
// Engines
// -----------------------------------------------------------------------------

async function withOcrmypdf(bin: string, pdfPath: string, workDir: string, languages: string[], skipText: boolean, plan: Plan): Promise<OcrResult> {
  const outPath = path.join(workDir, 'ocr.pdf');
  const sidecar = path.join(workDir, 'sidecar.txt');
  const args = ['-l', languages.join('+'), '--output-type', 'pdf', '--sidecar', sidecar, '--quiet'];
  args.push(skipText ? '--skip-text' : '--force-ocr');
  if (plan.pageCount > MAX_OCR_PAGES) args.push('--pages', `1-${MAX_OCR_PAGES}`);
  args.push(pdfPath, outPath);
  await run(bin, args, { cwd: workDir });
  const outBytes = await readFile(outPath);
  const pages = (await PDFDocument.load(outBytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  let sidecarText = '';
  try {
    sidecarText = await readFile(sidecar, 'utf8');
  } catch {
    /* sidecar is optional */
  }
  // ocrmypdf separates pages with form feeds.
  const perPage = sidecarText.split('\f');
  const pageTexts = Array.from({ length: pages }, (_, i) => (perPage[i] ?? '').trim() || plan.existingText.get(i + 1) || '');
  const textPath = await writeText(workDir, pageTexts);
  return result(outPath, textPath, 'ocrmypdf', pages, plan.toProcess.length, plan.skipped.length, pageTexts.join('\n'), plan.warnings);
}

async function withTesseractBinary(bin: string, input: Buffer, original: PDFDocument, workDir: string, languages: string[], dpi: number, plan: Plan): Promise<OcrResult> {
  const ocrPages = new Map<number, Uint8Array>();
  const texts = new Map<number, string>();
  for (const batch of chunk(plan.toProcess, RENDER_BATCH)) {
    const rendered = await renderPdfPages(input, { dpi, pages: batch, format: 'png' }, workDir);
    for (const img of rendered) {
      const imgPath = path.join(workDir, `page-${img.page}.png`);
      const outBase = path.join(workDir, `ocr-${img.page}`);
      await writeFile(imgPath, img.data);
      await run(bin, [imgPath, outBase, '-l', languages.join('+'), '--dpi', String(dpi), 'pdf', 'txt'], { cwd: workDir });
      ocrPages.set(img.page, await readFile(`${outBase}.pdf`));
      texts.set(img.page, (await readFile(`${outBase}.txt`, 'utf8').catch(() => '')).trim());
    }
  }
  return assemble('tesseract', original, workDir, plan, ocrPages, texts);
}

/** CDN tesseract.js itself uses for LSTM language data. */
const LANG_DATA_CDN = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
const LANG_DOWNLOAD_TIMEOUT_MS = 120_000;
const WORKER_START_TIMEOUT_MS = 90_000;
const DOWNLOAD_ERROR = 'Could not download OCR language data. Check the server internet connection.';

/**
 * Make sure `<tessdataDir>/<lang>.traineddata` exists for every language so the tesseract.js
 * worker only ever reads from its cache. Downloading here (instead of inside the worker)
 * gives us a timeout and a clear error: a failed download inside the worker leaves
 * `createWorker()` pending forever.
 */
async function ensureLanguageData(languages: string[]): Promise<void> {
  await mkdir(config.tessdataDir, { recursive: true });
  for (const lang of languages) {
    const target = path.join(config.tessdataDir, `${lang}.traineddata`);
    const existing = await stat(target).catch(() => null);
    if (existing && existing.size > 1024) continue;
    const url = `${LANG_DATA_CDN}/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
    let data: Buffer;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(LANG_DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      data = Buffer.from(await res.arrayBuffer());
      if (data.length < 1024) throw new Error(`Unexpectedly small download for ${lang}`);
    } catch (err) {
      throw new AppError('OCR_FAILED', DOWNLOAD_ERROR, { cause: err, details: `${lang}: ${messageOf(err)}` });
    }
    // The worker detects gzip by magic bytes, so the file can be stored as downloaded.
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    try {
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      const now = await stat(target).catch(() => null);
      if (!now || now.size <= 1024) throw new AppError('OCR_FAILED', DOWNLOAD_ERROR, { cause: err });
    }
  }
}

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

/**
 * Start a tesseract.js worker. Errors raised inside the worker are routed through
 * `errorHandler` (without it tesseract.js throws from an event handler and would crash the
 * process), and a timeout guards against the start-up promise never settling.
 */
async function startWorker(languages: string[]): Promise<TesseractWorker> {
  const { createWorker } = await import('tesseract.js');
  let fail!: (err: unknown) => void;
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The OCR engine did not start in time.')), WORKER_START_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      createWorker(languages.join('+'), 1, { cachePath: config.tessdataDir, logger: () => {}, errorHandler: (err: unknown) => fail(err) }),
      failed,
      timedOut,
    ]);
  } catch (err) {
    const msg = messageOf(err);
    if (/fetch|network|traineddata|ENOTFOUND|ECONN/i.test(msg)) throw new AppError('OCR_FAILED', DOWNLOAD_ERROR, { cause: err, details: msg });
    throw new AppError('OCR_FAILED', 'The OCR engine could not be started.', { cause: err, details: msg });
  } finally {
    clearTimeout(timer);
  }
}

async function withTesseractJs(input: Buffer, original: PDFDocument, workDir: string, languages: string[], dpi: number, plan: Plan): Promise<OcrResult> {
  await ensureLanguageData(languages);
  const worker = await startWorker(languages);

  const ocrPages = new Map<number, Uint8Array>();
  const texts = new Map<number, string>();
  try {
    try {
      await worker.setParameters({ user_defined_dpi: String(dpi) });
    } catch {
      /* older cores may reject the parameter; page sizes may then differ from the original */
    }
    for (const batch of chunk(plan.toProcess, RENDER_BATCH)) {
      const rendered = await renderPdfPages(input, { dpi, pages: batch, format: 'png' }, workDir);
      for (const img of rendered) {
        let data: { pdf?: number[] | Uint8Array | null; text?: string };
        try {
          const res = await worker.recognize(img.data, {}, { pdf: true, text: true });
          data = res.data as unknown as { pdf?: number[] | Uint8Array | null; text?: string };
        } catch (err) {
          throw new AppError('OCR_FAILED', `Text recognition failed on page ${img.page}.`, { cause: err });
        }
        if (!data.pdf || !data.pdf.length) throw new AppError('OCR_FAILED', `The OCR engine returned no output for page ${img.page}.`);
        ocrPages.set(img.page, data.pdf instanceof Uint8Array ? data.pdf : Uint8Array.from(data.pdf));
        texts.set(img.page, (data.text ?? '').trim());
      }
    }
  } finally {
    await worker.terminate().catch(() => undefined);
  }
  return assemble('tesseract.js', original, workDir, plan, ocrPages, texts);
}

// -----------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------

/** Merge original (skipped) pages and OCR'd single-page PDFs in document order. */
async function assemble(engine: OcrResult['engine'], original: PDFDocument, workDir: string, plan: Plan, ocrPages: Map<number, Uint8Array>, texts: Map<number, string>): Promise<OcrResult> {
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

  const outPath = path.join(workDir, 'ocr.pdf');
  await writeFile(outPath, await out.save({ useObjectStreams: true }));
  const textPath = await writeText(workDir, pageTexts);
  const ocrText = plan.toProcess.map((p) => texts.get(p) ?? '').join('\n');
  return result(outPath, textPath, engine, plan.pageCount, processed, plan.pageCount - processed, ocrText, plan.warnings);
}

async function writeText(workDir: string, pageTexts: string[]): Promise<string> {
  const textPath = path.join(workDir, 'text.txt');
  const body = pageTexts.map((t, i) => `----- Page ${i + 1} -----\n\n${t}`).join('\n\n');
  await writeFile(textPath, body, 'utf8');
  return textPath;
}

function result(pdfPath: string, textPath: string, engine: OcrResult['engine'], pageCount: number, pagesProcessed: number, pagesSkipped: number, text: string, warnings: string[]): OcrResult {
  const clean = text.replace(/\s+/g, ' ').trim();
  return {
    pdfPath,
    textPath,
    engine,
    pageCount,
    pagesProcessed,
    pagesSkipped,
    characters: text.replace(/\s+/g, '').length ? text.trim().length : 0,
    textPreview: clean.slice(0, PREVIEW_CHARS),
    warnings,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function messageOf(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.split(/\r?\n/)[0].trim().slice(0, 160);
}
