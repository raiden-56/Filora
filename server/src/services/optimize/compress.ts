/**
 * PDF compression.
 *
 * Engines (first that works wins):
 *  1. Ghostscript `pdfwrite` with the matching -dPDFSETTINGS preset (when installed).
 *  2. Pure JS: pdf-lib + sharp. Embedded raster images (JPEG and uncompressed/Flate RGB or
 *     gray images) are downscaled and re-encoded as JPEG, then the document is re-saved
 *     with object streams. Images that are risky to touch (soft masks, indexed or CMYK
 *     colour spaces, unusual filters) are left untouched so the output is never broken.
 *
 * The output is always verified with pdf-lib before it is returned; if it is not smaller
 * than the input, the original file is returned unchanged with a warning.
 */
import path from 'node:path';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from 'pdf-lib';
import { detectTools } from '../../config/tools.js';
import { run } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import type { CompressOptions, CompressResult, CompressionLevel } from './types.js';

interface LevelSettings {
  /** longest image edge in pixels */
  maxEdge: number;
  /** JPEG quality 1-100 */
  quality: number;
  /** Ghostscript preset */
  gsPreset: string;
}

const LEVELS: Record<CompressionLevel, LevelSettings> = {
  low: { maxEdge: 2400, quality: 90, gsPreset: '/prepress' },
  medium: { maxEdge: 1600, quality: 75, gsPreset: '/ebook' },
  high: { maxEdge: 1200, quality: 55, gsPreset: '/screen' },
};

const ALREADY_OPTIMIZED = 'This PDF is already well optimized.';

export async function compressPdf(pdfPath: string, workDir: string, opts: CompressOptions): Promise<CompressResult> {
  const settings = LEVELS[opts.level] ?? LEVELS.medium;
  const warnings: string[] = [];
  const input = await readFile(pdfPath);
  if (!input.length) throw new AppError('EMPTY_FILE');

  // Make sure the input is something we can work with before spending time on it.
  const inputPages = await loadPageCount(input);
  if (inputPages === null) throw new AppError('CORRUPTED_PDF');

  const tools = await detectTools();
  if (tools.ghostscript) {
    const gsResult = await compressWithGhostscript(tools.ghostscript, pdfPath, workDir, settings, inputPages);
    if (gsResult) return finalize(pdfPath, workDir, gsResult.outPath, gsResult.size, input.length, 'ghostscript', warnings);
    warnings.push('Ghostscript could not process this file; a built-in compressor was used instead.');
  }

  const js = await compressWithJs(input, workDir, settings, inputPages, warnings);
  return finalize(pdfPath, workDir, js.outPath, js.size, input.length, 'js', warnings);
}

/** Decide between the produced file and the original, and return the result. */
async function finalize(pdfPath: string, workDir: string, outPath: string | null, outSize: number, inSize: number, engine: CompressResult['engine'], warnings: string[]): Promise<CompressResult> {
  if (outPath && outSize < inSize) return { pdfPath: outPath, engine, warnings };
  const original = path.join(workDir, 'original.pdf');
  await copyFile(pdfPath, original);
  if (!warnings.includes(ALREADY_OPTIMIZED)) warnings.push(ALREADY_OPTIMIZED);
  return { pdfPath: original, engine, warnings };
}

async function loadPageCount(data: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

/** Verify a produced PDF loads and has the expected number of pages. */
async function verifyOutput(outPath: string, expectedPages: number): Promise<number | null> {
  try {
    const data = await readFile(outPath);
    if (!data.subarray(0, 1024).toString('latin1').includes('%PDF')) return null;
    const doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
    if (doc.getPageCount() !== expectedPages) return null;
    return data.length;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ghostscript
// ---------------------------------------------------------------------------

async function compressWithGhostscript(bin: string, pdfPath: string, workDir: string, settings: LevelSettings, inputPages: number): Promise<{ outPath: string; size: number } | null> {
  const outPath = path.join(workDir, 'compressed-gs.pdf');
  try {
    await run(bin, [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.5',
      `-dPDFSETTINGS=${settings.gsPreset}`,
      '-dNOPAUSE',
      '-dBATCH',
      '-dQUIET',
      '-dSAFER',
      '-dDetectDuplicateImages=true',
      `-sOutputFile=${outPath}`,
      pdfPath,
    ], { cwd: workDir });
  } catch {
    return null;
  }
  const size = await verifyOutput(outPath, inputPages);
  if (size === null) return null;
  return { outPath, size };
}

// ---------------------------------------------------------------------------
// Pure JS (pdf-lib + sharp)
// ---------------------------------------------------------------------------

type ImageColor = 'rgb' | 'gray';

async function compressWithJs(input: Buffer, workDir: string, settings: LevelSettings, inputPages: number, warnings: string[]): Promise<{ outPath: string | null; size: number }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    throw AppError.from(err, 'CORRUPTED_PDF');
  }
  if (doc.isEncrypted) {
    throw new AppError('CORRUPTED_PDF', 'This PDF is password protected or encrypted. Remove the password before compressing it.');
  }

  let optimized = 0;
  let skipped = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    try {
      const replaced = await recompressImage(doc, ref, obj, settings);
      if (replaced) optimized++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  } catch (err) {
    throw AppError.from(err, 'CONVERSION_FAILED', 'The PDF could not be re-saved. It may be damaged; try the Repair tool first.');
  }
  const outPath = path.join(workDir, 'compressed.pdf');
  await writeFile(outPath, bytes);
  const size = await verifyOutput(outPath, inputPages);
  if (size === null) {
    // Should not happen, but never hand out a broken file.
    warnings.push('The compressed file failed verification; the original was kept.');
    return { outPath: null, size: Number.POSITIVE_INFINITY };
  }
  if (optimized === 0 && skipped > 0) warnings.push('No images could be recompressed (they use masks or colour spaces that must be preserved).');
  return { outPath, size };
}

function readNumber(dict: PDFDict, key: string): number | null {
  const v = dict.lookup(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : null;
}

function filterNames(dict: PDFDict): string[] | null {
  const f = dict.lookup(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) {
    const names: string[] = [];
    for (let i = 0; i < f.size(); i++) {
      const n = f.lookup(i);
      if (!(n instanceof PDFName)) return null;
      names.push(n.decodeText());
    }
    return names;
  }
  return null;
}

/** Map a /ColorSpace entry to rgb/gray, or null when it must not be touched. */
function colorOf(doc: PDFDocument, dict: PDFDict): ImageColor | null {
  const cs = dict.lookup(PDFName.of('ColorSpace'));
  if (cs instanceof PDFName) {
    const n = cs.decodeText();
    if (n === 'DeviceRGB' || n === 'CalRGB') return 'rgb';
    if (n === 'DeviceGray' || n === 'CalGray') return 'gray';
    return null;
  }
  if (cs instanceof PDFArray && cs.size() >= 1) {
    const family = cs.lookup(0);
    if (!(family instanceof PDFName)) return null;
    const fam = family.decodeText();
    if (fam === 'CalRGB') return 'rgb';
    if (fam === 'CalGray') return 'gray';
    if (fam === 'ICCBased' && cs.size() >= 2) {
      const profile = doc.context.lookup(cs.get(1));
      if (!(profile instanceof PDFStream)) return null;
      const n = readNumber(profile.dict, 'N');
      if (n === 3) return 'rgb';
      if (n === 1) return 'gray';
      return null;
    }
    return null;
  }
  return null;
}

/** Undo PNG predictors (Predictor >= 10) on decoded Flate data. */
function unpredictPng(data: Uint8Array, columns: number, colors: number, rows: number): Uint8Array | null {
  const bpp = colors; // 8 bits per component
  const rowLen = columns * colors;
  if (data.length < rows * (rowLen + 1)) return null;
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowLen + 1)];
    const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      switch (ft) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          return null;
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  return out;
}

/**
 * Re-encode one image XObject as a downscaled JPEG. Returns true when the object was replaced.
 */
async function recompressImage(doc: PDFDocument, ref: PDFRef, stream: PDFRawStream, settings: LevelSettings): Promise<boolean> {
  const dict = stream.dict;
  // Anything with transparency, stencil masks or inverted decode arrays is left alone.
  if (dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask')) || dict.has(PDFName.of('Decode'))) return false;
  const imageMask = dict.lookup(PDFName.of('ImageMask'));
  if (imageMask instanceof PDFBool && imageMask.asBoolean()) return false;

  const width = readNumber(dict, 'Width');
  const height = readNumber(dict, 'Height');
  if (!width || !height || width < 1 || height < 1) return false;
  // Tiny images are not worth touching.
  if (width * height < 64 * 64) return false;

  const filters = filterNames(dict);
  if (filters === null || filters.length > 1) return false;
  const filter = filters[0] ?? 'None';
  const color = colorOf(doc, dict);
  if (!color) return false;
  const channels = color === 'rgb' ? 3 : 1;

  let pipeline: sharp.Sharp;
  if (filter === 'DCTDecode') {
    pipeline = sharp(Buffer.from(stream.contents), { failOn: 'none' });
    const meta = await pipeline.metadata();
    if (!meta.width || !meta.height) return false;
    if (meta.space === 'cmyk') return false;
    // Nothing to gain if the JPEG is already small and small-dimensioned.
    if (Math.max(meta.width, meta.height) <= settings.maxEdge && stream.contents.length < 24 * 1024) return false;
  } else if (filter === 'FlateDecode' || filter === 'None') {
    const bpc = readNumber(dict, 'BitsPerComponent');
    if (bpc !== 8) return false;
    let raw: Uint8Array;
    if (filter === 'None') raw = stream.contents;
    else raw = decodePDFRawStream(stream).decode();
    const parms = dict.lookup(PDFName.of('DecodeParms'));
    if (parms instanceof PDFDict) {
      const predictor = readNumber(parms, 'Predictor') ?? 1;
      if (predictor >= 10) {
        const columns = readNumber(parms, 'Columns') ?? 1;
        const colors = readNumber(parms, 'Colors') ?? 1;
        if (columns !== width || colors !== channels) return false;
        const un = unpredictPng(raw, columns, colors, height);
        if (!un) return false;
        raw = un;
      } else if (predictor !== 1) return false;
    } else if (parms) return false;
    if (raw.length < width * height * channels) return false;
    pipeline = sharp(Buffer.from(raw.buffer, raw.byteOffset, width * height * channels), { raw: { width, height, channels } });
  } else {
    return false;
  }

  pipeline = pipeline.resize({ width: settings.maxEdge, height: settings.maxEdge, fit: 'inside', withoutEnlargement: true });
  pipeline = color === 'gray' ? pipeline.toColourspace('b-w') : pipeline.removeAlpha().toColourspace('srgb');
  const { data, info } = await pipeline.jpeg({ quality: settings.quality, mozjpeg: true, chromaSubsampling: settings.quality >= 90 ? '4:4:4' : '4:2:0' }).toBuffer({ resolveWithObject: true });

  if (data.length >= stream.contents.length) return false;
  const outColor: PDFName = info.channels === 1 ? PDFName.of('DeviceGray') : info.channels === 3 ? PDFName.of('DeviceRGB') : PDFName.of('');
  if (outColor === PDFName.of('')) return false;

  dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  dict.set(PDFName.of('Width'), PDFNumber.of(info.width));
  dict.set(PDFName.of('Height'), PDFNumber.of(info.height));
  dict.set(PDFName.of('ColorSpace'), outColor);
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  dict.delete(PDFName.of('DecodeParms'));
  dict.delete(PDFName.of('Interpolate'));
  doc.context.assign(ref, PDFRawStream.of(dict, new Uint8Array(data)));
  return true;
}
