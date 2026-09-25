import type { AcceptKind, FileMeta } from '@/types';
import { ACCEPT_MAP, ACCEPT_LABEL } from '@/constants/tools';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@/constants/limits';
import { formatBytes } from '@pdfly/core';
import { newId } from './id';

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

export function acceptedExtensions(kinds: AcceptKind[]): string[] {
  return kinds.flatMap((k) => Object.values(ACCEPT_MAP[k]).flat());
}

export function acceptedMimeTypes(kinds: AcceptKind[]): string[] {
  return kinds.flatMap((k) => Object.keys(ACCEPT_MAP[k]));
}

/** react-dropzone accept object */
export function dropzoneAccept(kinds: AcceptKind[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of kinds) Object.assign(out, ACCEPT_MAP[k]);
  return out;
}

export function acceptLabel(kinds: AcceptKind[]): string {
  return kinds.map((k) => ACCEPT_LABEL[k]).join(', ');
}

/**
 * Sniff the real content type from magic bytes. Returns undefined when unknown.
 * Never trust the file extension alone.
 */
/** Read blob bytes with a FileReader fallback for environments without Blob.arrayBuffer. */
export function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function sniffMimeType(file: Blob): Promise<string | undefined> {
  const head = await readBlobBytes(file.slice(0, 16));
  const ascii = String.fromCharCode(...head.slice(0, 8));
  if (ascii.startsWith('%PDF')) return 'application/pdf';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png';
  if (ascii.startsWith('RIFF') && String.fromCharCode(...head.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'application/zip'; // docx/xlsx/pptx
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'application/x-ole'; // doc/xls/ppt
  const text = new TextDecoder().decode(await readBlobBytes(file.slice(0, 512))).trimStart().toLowerCase();
  if (text.startsWith('<!doctype html') || text.startsWith('<html') || text.includes('<html')) return 'text/html';
  if (text.startsWith('{\\rtf')) return 'application/rtf';
  return undefined;
}

function kindForExtension(ext: string): AcceptKind | undefined {
  for (const [kind, map] of Object.entries(ACCEPT_MAP) as [AcceptKind, Record<string, string[]>][]) {
    if (Object.values(map).some((exts) => exts.includes(ext))) return kind;
  }
  return undefined;
}

export async function validateFile(file: File, kinds: AcceptKind[]): Promise<ValidationResult> {
  if (file.size === 0) return { ok: false, error: `"${file.name}" is empty.` };
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `"${file.name}" exceeds the ${MAX_FILE_SIZE_MB} MB limit (${formatBytes(file.size)}).` };
  }
  if (kinds.includes('any')) return { ok: true };
  const ext = extensionOf(file.name);
  const kind = kindForExtension(ext);
  if (!kind || !kinds.includes(kind)) {
    return { ok: false, error: `"${file.name}" is not a supported format. Accepted: ${acceptLabel(kinds)}.` };
  }
  // Magic byte check where the format allows it.
  const sniffed = await sniffMimeType(file);
  if (kind === 'pdf' && sniffed !== 'application/pdf') {
    return { ok: false, error: `"${file.name}" is not a valid PDF file.` };
  }
  if (kind === 'image' && sniffed && !sniffed.startsWith('image/')) {
    return { ok: false, error: `"${file.name}" is not a valid image.` };
  }
  if ((kind === 'word' || kind === 'excel' || kind === 'powerpoint') && sniffed === 'application/pdf') {
    return { ok: false, error: `"${file.name}" is actually a PDF. Please use a PDF tool.` };
  }
  return { ok: true };
}

export function normalizeMime(file: File): string {
  if (file.type) return file.type;
  const ext = extensionOf(file.name);
  for (const map of Object.values(ACCEPT_MAP)) {
    for (const [mime, exts] of Object.entries(map)) if (exts.includes(ext)) return mime;
  }
  return 'application/octet-stream';
}

export function toFileMeta(file: File): FileMeta {
  return {
    id: newId(),
    name: file.name,
    size: file.size,
    type: normalizeMime(file),
    lastModified: file.lastModified,
    addedAt: Date.now(),
    rotation: 0,
  };
}

export function isImageMime(type: string) {
  return type.startsWith('image/');
}

export function isPdfMime(type: string) {
  return type === 'application/pdf';
}

/** Read the intrinsic size of an image blob. */
export function readImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

/** Decode an image blob, falling back to an <img> element when createImageBitmap refuses it. */
async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch (first) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(first);
        el.src = url;
      });
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Convert any browser-decodable image (including WEBP) to JPEG or PNG bytes so it can be
 * embedded with pdf-lib. Also applies quality and optional max dimension.
 */
export async function normalizeImageForPdf(
  blob: Blob,
  opts: { quality?: number; maxDimension?: number; preferPng?: boolean; forceJpeg?: boolean } = {},
): Promise<{ data: Uint8Array; mimeType: 'image/jpeg' | 'image/png' }> {
  const type = blob.type;
  const quality = opts.quality ?? 0.92;
  const needsReencode =
    !(type === 'image/jpeg' || type === 'image/png') ||
    (opts.quality !== undefined && opts.quality < 1) ||
    !!opts.maxDimension ||
    (opts.forceJpeg && type !== 'image/jpeg');
  if (!needsReencode) {
    return { data: await readBlobBytes(blob), mimeType: type as 'image/jpeg' | 'image/png' };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeImage(blob);
  } catch (err) {
    // Chromium refuses some unusual-but-valid encodings; pdf-lib can still embed plain PNG/JPEG bytes.
    if (type === 'image/jpeg' || type === 'image/png') return { data: await readBlobBytes(blob), mimeType: type };
    throw err;
  }
  let { width, height } = bitmap;
  const max = opts.maxDimension;
  if (max && (width > max || height > max)) {
    const s = max / Math.max(width, height);
    width = Math.round(width * s);
    height = Math.round(height * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const usePng = opts.preferPng || type === 'image/png';
  if (!usePng) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const mimeType = usePng ? 'image/png' : 'image/jpeg';
  const out: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image conversion failed'))), mimeType, quality),
  );
  return { data: new Uint8Array(await out.arrayBuffer()), mimeType };
}

export function fileKindLabel(mime: string, name = ''): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return mime.split('/')[1].toUpperCase().replace('JPEG', 'JPG');
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'Word';
  if (mime.includes('presentationml') || mime === 'application/vnd.ms-powerpoint') return 'PowerPoint';
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return 'Excel';
  if (mime === 'application/zip') return 'ZIP';
  if (mime === 'text/plain') return 'Text';
  if (mime === 'text/html') return 'HTML';
  const ext = extensionOf(name).replace('.', '').toUpperCase();
  return ext || 'File';
}
