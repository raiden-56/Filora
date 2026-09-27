/**
 * Image format conversion in the browser: HEIC/HEIF, JPG and PNG -> JPG or PNG.
 *
 * HEIC/HEIF is decoded natively where the browser supports it (Safari) and otherwise with
 * libheif compiled to WebAssembly (the `heic-to` package, ~3 MB, loaded on first use only).
 * JPG/PNG are decoded by the browser. The pixels are drawn onto a canvas and re-encoded.
 */
import { HEIF_BRANDS } from '@/utils/file';
import { assertNotAborted, canvasToBlob, disposeCanvas, engineError, latin1Decode } from './common';

export type ImageTarget = 'jpeg' | 'png';

export interface ConvertImageOptions {
  target: ImageTarget;
  /** JPEG quality 1-100 (ignored for PNG) */
  quality: number;
  /** CSS colour painted behind transparent pixels when the target is JPEG */
  background?: string;
  signal?: AbortSignal;
}

export interface ConvertImageResult {
  blob: Blob;
  width: number;
  height: number;
  /** true when the image had to be scaled down to fit the browser's canvas limit */
  downscaled: boolean;
  decoder: 'browser' | 'libheif';
}

/**
 * Largest canvas every mainstream browser can encode (iOS Safari caps canvases at 16.7 MP).
 * Bigger images are tried at full size first and only scaled down when that fails.
 */
export const SAFE_CANVAS_PIXELS = 16_777_216;

/** True for HEIC/HEIF bytes (ISO-BMFF "ftyp" box with an image brand). */
export function isHeifBytes(head: Uint8Array): boolean {
  return head.length >= 12 && latin1Decode(head.subarray(4, 8)) === 'ftyp' && HEIF_BRANDS.has(latin1Decode(head.subarray(8, 12)));
}

/** Scale (w, h) down proportionally so that w * h <= maxPixels. */
export function fitWithinPixels(width: number, height: number, maxPixels: number): { width: number; height: number } {
  if (width * height <= maxPixels) return { width, height };
  const s = Math.sqrt(maxPixels / (width * height));
  return { width: Math.max(1, Math.floor(width * s)), height: Math.max(1, Math.floor(height * s)) };
}

/** Output file name for a converted image: "IMG_0001.HEIC" -> "IMG_0001.jpg". */
export function convertedName(name: string, target: ImageTarget): string {
  const idx = name.lastIndexOf('.');
  const base = (idx > 0 ? name.slice(0, idx) : name) || 'image';
  return `${base}.${target === 'jpeg' ? 'jpg' : 'png'}`;
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void; decoder: ConvertImageResult['decoder'] };

async function decodeWithBrowser(blob: Blob): Promise<Decoded | null> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close(), decoder: 'browser' };
  } catch {
    // Some browsers refuse valid-but-unusual files in createImageBitmap; an <img> element is more lenient.
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('decode failed'));
        el.src = url;
      });
      if (!img.naturalWidth || !img.naturalHeight) return null;
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined, decoder: 'browser' };
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function decodeHeif(blob: Blob): Promise<Decoded> {
  // Safari (macOS 11+/iOS 11+) decodes HEIC itself: fast and no download.
  const native = await decodeWithBrowser(new Blob([blob], { type: 'image/heic' }));
  if (native) return native;
  let heicTo: typeof import('heic-to').heicTo;
  try {
    ({ heicTo } = await import('heic-to'));
  } catch {
    throw engineError('CONVERSION_FAILED', 'The HEIC decoder could not be loaded. Check your internet connection and reload the page.');
  }
  try {
    const bitmap = await heicTo({ blob, type: 'bitmap' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close(), decoder: 'libheif' };
  } catch {
    throw engineError('CONVERSION_FAILED', 'This HEIC/HEIF image could not be decoded. It may be damaged or use an unsupported codec.');
  }
}

async function encode(decoded: Decoded, width: number, height: number, opts: ConvertImageOptions): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d', { alpha: opts.target === 'png' });
    if (!ctx) return null;
    if (opts.target === 'jpeg') {
      ctx.fillStyle = opts.background || '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const type = opts.target === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvasToBlob(canvas, type, Math.min(100, Math.max(1, opts.quality)) / 100).catch(() => null);
    // A canvas over the browser's size limit silently produces an empty/blank image.
    return blob && blob.size > 0 && blob.type === type ? blob : null;
  } finally {
    disposeCanvas(canvas);
  }
}

export async function convertImage(blob: Blob, opts: ConvertImageOptions): Promise<ConvertImageResult> {
  assertNotAborted(opts.signal);
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const decoded = isHeifBytes(head) ? await decodeHeif(blob) : await decodeWithBrowser(blob);
  if (!decoded) throw engineError('CONVERSION_FAILED', 'This image could not be decoded. It may be damaged.');
  try {
    assertNotAborted(opts.signal);
    let out = await encode(decoded, decoded.width, decoded.height, opts);
    let size = { width: decoded.width, height: decoded.height };
    let downscaled = false;
    if (!out && decoded.width * decoded.height > SAFE_CANVAS_PIXELS) {
      size = fitWithinPixels(decoded.width, decoded.height, SAFE_CANVAS_PIXELS);
      out = await encode(decoded, size.width, size.height, opts);
      downscaled = true;
    }
    if (!out) throw engineError('CONVERSION_FAILED', 'The browser could not encode this image (it may be too large for this device).');
    return { blob: out, width: size.width, height: size.height, downscaled, decoder: decoded.decoder };
  } finally {
    decoded.close();
  }
}
