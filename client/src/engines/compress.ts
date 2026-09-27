/**
 * PDF compression in the browser (pdf-lib + canvas).
 *
 * Embedded raster images (JPEG and uncompressed/Flate RGB or gray images) are downscaled and
 * re-encoded as JPEG with the canvas encoder, then the document is re-saved with object
 * streams. Images that are risky to touch (soft masks, indexed or CMYK colour spaces, unusual
 * filters) are left untouched so the output is never broken.
 *
 * The output is always verified with pdf-lib before it is returned; if it is not smaller
 * than the input, the original file is returned unchanged with a warning.
 */
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from 'pdf-lib';
import { assertNotAborted, canvasToBlob, disposeCanvas, engineError, looksLikePdf } from './common';

export type CompressionLevel = 'low' | 'medium' | 'high';

export interface CompressOptions {
  level: CompressionLevel;
  signal?: AbortSignal;
  onProgress?: (stage: string, fraction: number | null) => void;
}

export interface CompressResult {
  pdf: Uint8Array;
  engine: 'js';
  warnings: string[];
}

interface LevelSettings {
  /** longest image edge in pixels */
  maxEdge: number;
  /** JPEG quality 1-100 */
  quality: number;
}

const LEVELS: Record<CompressionLevel, LevelSettings> = {
  low: { maxEdge: 2400, quality: 90 },
  medium: { maxEdge: 1600, quality: 75 },
  high: { maxEdge: 1200, quality: 55 },
};

/** Images above this many pixels are skipped: decoding them would exhaust memory on phones. */
const MAX_PIXELS = 40_000_000;

export const ALREADY_OPTIMIZED = 'This PDF is already well optimized.';

export async function compressPdf(input: Uint8Array, opts: CompressOptions): Promise<CompressResult> {
  const settings = LEVELS[opts.level] ?? LEVELS.medium;
  const warnings: string[] = [];
  if (!input.length) throw engineError('EMPTY_FILE', 'The file is empty.');

  // Make sure the input is something we can work with before spending time on it.
  opts.onProgress?.('Analyzing...', null);
  const inputPages = await loadPageCount(input);
  if (inputPages === null) throw engineError('CORRUPTED_PDF', 'This PDF appears to be damaged or is not a valid PDF.');

  const js = await compressWithJs(input, settings, inputPages, warnings, opts);
  if (js.pdf && js.pdf.length < input.length) return { pdf: js.pdf, engine: 'js', warnings };
  if (!warnings.includes(ALREADY_OPTIMIZED)) warnings.push(ALREADY_OPTIMIZED);
  return { pdf: input, engine: 'js', warnings };
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
async function verifyOutput(data: Uint8Array, expectedPages: number): Promise<boolean> {
  try {
    if (!looksLikePdf(data)) return false;
    const doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount() === expectedPages;
  } catch {
    return false;
  }
}

type ImageColor = 'rgb' | 'gray';

async function compressWithJs(input: Uint8Array, settings: LevelSettings, inputPages: number, warnings: string[], opts: CompressOptions): Promise<{ pdf: Uint8Array | null }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    throw engineError('CORRUPTED_PDF', 'This PDF appears to be damaged or is not a valid PDF.');
  }
  if (doc.isEncrypted) {
    throw engineError('CORRUPTED_PDF', 'This PDF is password protected or encrypted. Remove the password before compressing it.');
  }

  const images: [PDFRef, PDFRawStream][] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image')) images.push([ref, obj]);
  }

  let optimized = 0;
  let skipped = 0;
  for (let i = 0; i < images.length; i++) {
    assertNotAborted(opts.signal);
    const [ref, stream] = images[i];
    try {
      const replaced = await recompressImage(doc, ref, stream, settings);
      if (replaced) optimized++;
      else skipped++;
    } catch {
      skipped++;
    }
    opts.onProgress?.('Optimizing images...', (i + 1) / images.length);
  }

  opts.onProgress?.('Saving...', null);
  let bytes: Uint8Array;
  try {
    bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  } catch {
    throw engineError('CONVERSION_FAILED', 'The PDF could not be re-saved. It may be damaged; try the Repair tool first.');
  }
  if (!(await verifyOutput(bytes, inputPages))) {
    // Should not happen, but never hand out a broken file.
    warnings.push('The compressed file failed verification; the original was kept.');
    return { pdf: null };
  }
  if (optimized === 0 && skipped > 0) warnings.push('No images could be recompressed (they use masks or colour spaces that must be preserved).');
  return { pdf: bytes };
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
export function unpredictPng(data: Uint8Array, columns: number, colors: number, rows: number): Uint8Array | null {
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

async function decodeJpeg(bytes: Uint8Array): Promise<ImageBitmap | null> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
  try {
    // EXIF orientation must not be applied: the PDF positions the raw pixels itself.
    return await createImageBitmap(blob, { imageOrientation: 'none' });
  } catch {
    try {
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }
}

/** Expand 8-bit gray/RGB samples to RGBA for the canvas. */
function toImageData(raw: Uint8Array, width: number, height: number, channels: 1 | 3): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const n = width * height;
  if (channels === 3) {
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) {
      rgba[j] = raw[k];
      rgba[j + 1] = raw[k + 1];
      rgba[j + 2] = raw[k + 2];
      rgba[j + 3] = 255;
    }
  } else {
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const g = raw[i];
      rgba[j] = g;
      rgba[j + 1] = g;
      rgba[j + 2] = g;
      rgba[j + 3] = 255;
    }
  }
  return new ImageData(rgba, width, height);
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
  // Tiny images are not worth touching; huge ones would exhaust memory.
  if (width * height < 64 * 64 || width * height > MAX_PIXELS) return false;

  const filters = filterNames(dict);
  if (filters === null || filters.length > 1) return false;
  const filter = filters[0] ?? 'None';
  const color = colorOf(doc, dict);
  if (!color) return false;
  const channels: 1 | 3 = color === 'rgb' ? 3 : 1;

  let source: ImageBitmap | ImageData;
  if (filter === 'DCTDecode') {
    const bitmap = await decodeJpeg(stream.contents);
    if (!bitmap) return false;
    // Nothing to gain if the JPEG is already small and small-dimensioned.
    if (Math.max(bitmap.width, bitmap.height) <= settings.maxEdge && stream.contents.length < 24 * 1024) {
      bitmap.close();
      return false;
    }
    source = bitmap;
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
    source = toImageData(raw, width, height, channels);
  } else {
    return false;
  }

  const srcW = source.width;
  const srcH = source.height;
  const scale = Math.min(1, settings.maxEdge / Math.max(srcW, srcH));
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    if (source instanceof ImageBitmap) source.close();
    return false;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  if (source instanceof ImageData) {
    if (scale === 1) ctx.putImageData(source, 0, 0);
    else {
      const tmp = document.createElement('canvas');
      tmp.width = srcW;
      tmp.height = srcH;
      tmp.getContext('2d')?.putImageData(source, 0, 0);
      ctx.drawImage(tmp, 0, 0, outW, outH);
      disposeCanvas(tmp);
    }
  } else {
    ctx.drawImage(source, 0, 0, outW, outH);
    source.close();
  }
  let data: Uint8Array;
  try {
    const blob = await canvasToBlob(canvas, 'image/jpeg', settings.quality / 100);
    data = new Uint8Array(await blob.arrayBuffer());
  } finally {
    disposeCanvas(canvas);
  }

  if (data.length >= stream.contents.length) return false;

  // The canvas encoder always produces a 3-channel JPEG.
  dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  dict.set(PDFName.of('Width'), PDFNumber.of(outW));
  dict.set(PDFName.of('Height'), PDFNumber.of(outH));
  dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  dict.delete(PDFName.of('DecodeParms'));
  dict.delete(PDFName.of('Interpolate'));
  doc.context.assign(ref, PDFRawStream.of(dict, data));
  return true;
}
