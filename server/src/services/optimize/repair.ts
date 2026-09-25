/**
 * PDF repair.
 *
 * Strategy chain (first success wins):
 *  a. qpdf  (rewrites the cross-reference table and object structure)
 *  b. Ghostscript pdfwrite rewrite
 *  c. pdf-lib lenient load + re-save (pure JS, always available)
 *  d. pdf.js rebuild: pages are rendered to images and a brand new PDF is built
 *
 * Before repairing, the file is inspected so a healthy PDF is reported as such
 * (`repaired: false`) while still returning a freshly written copy.
 * This function never throws for a damaged file; it only throws for internal errors.
 */
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { PDFDocument, PDFInvalidObject } from 'pdf-lib';
import { detectTools } from '../../config/tools.js';
import { run } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import { openPdfDocument, renderPdfPages } from '../render.js';
import type { RepairResult } from './types.js';

interface Inspection {
  /** problems found by structural checks and strict parsing */
  issues: string[];
  /** page count when strict parsing succeeded */
  strictPages: number | null;
  encrypted: boolean;
}

const REBUILD_DPI = 110;
const MAX_REBUILD_PAGES = 500;

export async function repairPdf(pdfPath: string, workDir: string): Promise<RepairResult> {
  const warnings: string[] = [];
  const notes: string[] = [];
  const failures: string[] = [];

  let input: Buffer;
  try {
    input = await readFile(pdfPath);
  } catch (err) {
    throw new AppError('SERVER_ERROR', 'The uploaded file could not be read.', { cause: err });
  }
  if (!input.length) return { pdfPath: null, repaired: false, engine: 'none', notes: ['The file is empty.'], warnings };

  const inspection = await inspect(input);
  const damaged = inspection.strictPages === null || inspection.issues.length > 0;
  notes.push(...inspection.issues);
  if (inspection.encrypted) warnings.push('This PDF is encrypted. The repaired copy keeps the encryption; open it with the same password.');

  const tools = await detectTools();

  // (a) qpdf ------------------------------------------------------------------
  if (tools.qpdf) {
    const outPath = path.join(workDir, 'repaired-qpdf.pdf');
    try {
      const res = await run(tools.qpdf, ['--warning-exit-0', pdfPath, outPath], { cwd: workDir, allowFailure: true });
      const qpdfWarned = /warning/i.test(res.stderr) || /warning/i.test(res.stdout);
      const pages = res.code === 0 ? await verify(outPath, inspection.strictPages) : null;
      if (pages !== null) {
        if (qpdfWarned) notes.push('qpdf reported and corrected structural warnings.');
        const repaired = damaged || qpdfWarned;
        if (!repaired) notes.push('No structural problems found');
        return { pdfPath: outPath, repaired, engine: 'qpdf', pageCount: pages, notes, warnings };
      }
      failures.push(`qpdf could not rewrite the file${res.stderr ? `: ${firstLine(res.stderr)}` : ''}.`);
    } catch (err) {
      failures.push(`qpdf failed: ${messageOf(err)}`);
    }
  }

  // (b) Ghostscript ------------------------------------------------------------
  if (tools.ghostscript) {
    const outPath = path.join(workDir, 'repaired-gs.pdf');
    try {
      await run(tools.ghostscript, ['-sDEVICE=pdfwrite', '-dNOPAUSE', '-dBATCH', '-dQUIET', '-dSAFER', `-sOutputFile=${outPath}`, pdfPath], { cwd: workDir });
      const pages = await verify(outPath, inspection.strictPages);
      if (pages !== null) {
        if (damaged) notes.push('The document was rewritten by Ghostscript.');
        else notes.push('No structural problems found');
        return { pdfPath: outPath, repaired: damaged, engine: 'ghostscript', pageCount: pages, notes, warnings };
      }
      failures.push('Ghostscript produced an unreadable file.');
    } catch (err) {
      failures.push(`Ghostscript failed: ${messageOf(err)}`);
    }
  }

  // (c) pdf-lib -----------------------------------------------------------------
  let salvaged: Buffer | null = null;
  try {
    const lenient = { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false } as const;
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(input, lenient);
    } catch (err) {
      // The trailer / xref section is unusable: rebuild it from the objects we can find.
      salvaged = salvageTrailer(input);
      if (!salvaged) throw err;
      doc = await PDFDocument.load(salvaged, lenient);
    }
    const lenientPages = doc.getPageCount();
    if (lenientPages < 1) throw new Error('The document has no pages');
    const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
    const outPath = path.join(workDir, 'repaired.pdf');
    await writeFile(outPath, bytes);
    const pages = await verify(outPath, inspection.strictPages ?? lenientPages);
    if (pages !== null) {
      let repaired = damaged;
      if (inspection.strictPages !== null && inspection.strictPages !== lenientPages) {
        notes.push(`Page count changed from ${inspection.strictPages} to ${lenientPages} after recovery.`);
        repaired = true;
      }
      if (salvaged) {
        repaired = true;
        notes.push('The trailer and cross-reference table were rebuilt from the recovered objects.');
      } else if (!repaired) notes.push('No structural problems found');
      else if (inspection.strictPages === null) notes.push('The document structure was rebuilt from the objects that could be recovered.');
      else notes.push('The cross-reference table and trailer were rewritten.');
      return { pdfPath: outPath, repaired, engine: 'pdf-lib', pageCount: pages, notes, warnings };
    }
    failures.push('The re-saved document failed verification.');
  } catch (err) {
    failures.push(`pdf-lib could not parse the file: ${messageOf(err)}`);
  }

  // (d) pdf.js rebuild ------------------------------------------------------------
  try {
    let rebuilt = await rebuildWithPdfJs(input, workDir).catch((err) => {
      failures.push(`pdf.js could not open the original bytes: ${messageOf(err)}`);
      return null;
    });
    if (!rebuilt) {
      salvaged ??= salvageTrailer(input);
      if (salvaged) rebuilt = await rebuildWithPdfJs(salvaged, workDir);
    }
    if (rebuilt) {
      notes.push('The original structure could not be recovered; the document was rebuilt from rendered page images.');
      warnings.push('The repaired file contains page images only: text is no longer selectable or searchable. Run OCR to restore a text layer.');
      if (rebuilt.truncated) warnings.push(`Only the first ${MAX_REBUILD_PAGES} pages were rebuilt.`);
      return { pdfPath: rebuilt.outPath, repaired: true, engine: 'pdfjs-rebuild', pageCount: rebuilt.pages, notes, warnings };
    }
    failures.push('pdf.js could not render any page.');
  } catch (err) {
    failures.push(`pdf.js rebuild failed: ${messageOf(err)}`);
  }

  if (!looksLikePdf(input)) notes.unshift('The file does not contain a PDF header; it may not be a PDF at all.');
  notes.push(...failures);
  return { pdfPath: null, repaired: false, engine: 'none', notes, warnings };
}

// -----------------------------------------------------------------------------
// Inspection
// -----------------------------------------------------------------------------

function looksLikePdf(data: Buffer): boolean {
  return data.subarray(0, 1024).toString('latin1').includes('%PDF-');
}

/** Structural checks + strict parse. Never throws. */
async function inspect(data: Buffer): Promise<Inspection> {
  const issues: string[] = [];
  let encrypted = false;

  if (!looksLikePdf(data)) issues.push('Missing PDF header.');
  else if (!data.subarray(0, 8).toString('latin1').startsWith('%PDF-')) issues.push('The PDF header is not at the start of the file.');

  const tail = data.subarray(Math.max(0, data.length - 2048)).toString('latin1');
  if (!tail.includes('%%EOF')) issues.push('Missing end-of-file marker (%%EOF).');

  const sx = tail.lastIndexOf('startxref');
  if (sx < 0) issues.push('Missing startxref pointer.');
  else {
    const m = /startxref\s+(\d+)/.exec(tail.slice(sx));
    if (!m) issues.push('The startxref pointer is not a valid offset.');
    else {
      const offset = Number(m[1]);
      if (!Number.isFinite(offset) || offset <= 0 || offset >= data.length) issues.push('The startxref pointer is outside the file.');
      else {
        const at = data.subarray(offset, offset + 64).toString('latin1').trimStart();
        if (!at.startsWith('xref') && !/^\d+\s+\d+\s+obj/.test(at)) issues.push('The cross-reference table is damaged (startxref does not point to an xref section).');
      }
    }
  }

  let strictPages: number | null = null;
  try {
    const doc = await PDFDocument.load(data, { throwOnInvalidObject: true, updateMetadata: false, ignoreEncryption: true });
    encrypted = doc.isEncrypted;
    strictPages = doc.getPageCount();
    let invalid = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) if (obj instanceof PDFInvalidObject) invalid++;
    if (invalid) issues.push(`${invalid} unreadable object${invalid === 1 ? '' : 's'} found.`);
    if (strictPages < 1) issues.push('The document contains no pages.');
  } catch (err) {
    strictPages = null;
    issues.push(`The document could not be parsed strictly: ${messageOf(err)}`);
  }
  return { issues, strictPages, encrypted };
}

/**
 * Rebuild a missing/broken trailer: keep everything up to the last `endobj`, then append a
 * trailer pointing at the first object that looks like the document catalog. pdf-lib parses
 * objects sequentially and does not depend on xref offsets, so this is enough for it to
 * recover the page tree. Returns null when no catalog object can be located.
 */
export function salvageTrailer(data: Buffer): Buffer | null {
  const text = data.toString('latin1');
  const end = text.lastIndexOf('endobj');
  if (end < 0) return null;
  // Drop any truncated trailing object (e.g. a cut-off xref/object stream from a partial download).
  const body = text.slice(0, end + 'endobj'.length);
  const root = findCatalogRef(body) ?? findCatalogInObjectStreams(body);
  if (!root) return null;
  let maxObj = 0;
  for (const m of body.matchAll(/(?:^|[^0-9])(\d+)\s+\d+\s+obj\b/g)) maxObj = Math.max(maxObj, Number(m[1]));
  return Buffer.from(`${body}\ntrailer\n<< /Root ${root} /Size ${Math.max(maxObj, 1) + 1} >>\nstartxref\n0\n%%EOF\n`, 'latin1');
}

/** Find "N G R" of the object whose (uncompressed) dictionary is the document catalog. */
function findCatalogRef(text: string): string | null {
  const catalogAt = text.search(/\/Type\s*\/Catalog\b/);
  if (catalogAt < 0) return null;
  const before = text.slice(Math.max(0, catalogAt - 4096), catalogAt);
  let root: string | null = null;
  for (const m of before.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) root = `${m[1]} ${m[2]} R`;
  return root;
}

/**
 * Modern PDFs keep the catalog inside a compressed object stream (/Type /ObjStm).
 * Inflate every object stream, locate the catalog and map it back to its object number
 * using the stream's "objnum offset" header pairs.
 */
function findCatalogInObjectStreams(text: string): string | null {
  const re = /(\d+)\s+(\d+)\s+obj\s*<<([\s\S]{0,2000}?)>>\s*stream\r?\n/g;
  for (const m of text.matchAll(re)) {
    const dict = m[3];
    if (!/\/Type\s*\/ObjStm\b/.test(dict)) continue;
    const start = m.index! + m[0].length;
    const stop = text.indexOf('endstream', start);
    if (stop < 0) continue;
    let raw = Buffer.from(text.slice(start, stop), 'latin1');
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        raw = inflateSync(raw);
      } catch {
        try {
          raw = inflateRawSync(raw);
        } catch {
          continue;
        }
      }
    }
    const content = raw.toString('latin1');
    const catalogAt = content.search(/\/Type\s*\/Catalog\b/);
    if (catalogAt < 0) continue;
    const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? NaN);
    const count = Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? NaN);
    if (!Number.isFinite(first) || !Number.isFinite(count)) continue;
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    let best: number | null = null;
    for (let i = 0; i + 1 < header.length && i / 2 < count; i += 2) {
      const objNum = header[i];
      const offset = first + header[i + 1];
      if (offset <= catalogAt && (best === null || offset > (first + header[best * 2 + 1]))) best = i / 2;
    }
    if (best !== null) return `${header[best * 2]} 0 R`;
  }
  return null;
}

/** Load a produced file with pdf-lib; returns its page count or null when unusable. */
async function verify(outPath: string, expectedPages: number | null): Promise<number | null> {
  try {
    const data = await readFile(outPath);
    if (!looksLikePdf(data)) return null;
    const doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
    const pages = doc.getPageCount();
    if (pages < 1) return null;
    if (expectedPages !== null && expectedPages > 0 && pages !== expectedPages) return null;
    return pages;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// pdf.js rebuild
// -----------------------------------------------------------------------------

async function rebuildWithPdfJs(input: Buffer, workDir: string): Promise<{ outPath: string; pages: number; truncated: boolean } | null> {
  const doc = await openPdfDocument(input);
  let total: number;
  try {
    total = doc.numPages;
  } finally {
    await doc.destroy();
  }
  if (!total) return null;
  const truncated = total > MAX_REBUILD_PAGES;
  const count = Math.min(total, MAX_REBUILD_PAGES);

  const out = await PDFDocument.create();
  out.setProducer('PDFly');
  let rendered = 0;
  // Render in small batches to bound memory.
  const BATCH = 8;
  for (let start = 1; start <= count; start += BATCH) {
    const pages = Array.from({ length: Math.min(BATCH, count - start + 1) }, (_, i) => start + i);
    let images: Awaited<ReturnType<typeof renderPdfPages>> = [];
    try {
      images = await renderPdfPages(input, { dpi: REBUILD_DPI, pages, format: 'png' }, workDir);
    } catch {
      // Try page by page so one bad page does not sink the whole document.
      for (const p of pages) {
        try {
          images.push(...(await renderPdfPages(input, { dpi: REBUILD_DPI, pages: [p], format: 'png' }, workDir)));
        } catch {
          /* skip page */
        }
      }
    }
    for (const img of images) {
      const png = await out.embedPng(img.data);
      const w = (img.width * 72) / REBUILD_DPI;
      const h = (img.height * 72) / REBUILD_DPI;
      const page = out.addPage([w, h]);
      page.drawImage(png, { x: 0, y: 0, width: w, height: h });
      rendered++;
    }
  }
  if (!rendered) return null;
  const outPath = path.join(workDir, 'rebuilt.pdf');
  await writeFile(outPath, await out.save({ useObjectStreams: true }));
  return { outPath, pages: rendered, truncated };
}

function messageOf(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return firstLine(m);
}

function firstLine(s: string): string {
  return s.split(/\r?\n/)[0].trim().slice(0, 200);
}
