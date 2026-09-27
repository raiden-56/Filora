/**
 * Small helpers shared by the browser processing engines: cancellation, byte/string
 * conversions that Node's Buffer used to provide, inflate via DecompressionStream and
 * canvas encoding.
 */

export interface EngineError {
  code: string;
  message: string;
}

/** Throw an error object the workflow maps to a friendly message (see services/errors.ts). */
export function engineError(code: string, message: string): EngineError {
  return { code, message };
}

export function isEngineError(err: unknown): err is EngineError {
  return Boolean(err) && typeof err === 'object' && !(err instanceof Error) && 'code' in (err as object) && 'message' in (err as object);
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw engineError('CANCELLED', 'The operation was cancelled.');
}

export function messageOf(err: unknown): string {
  const m = err instanceof Error || isEngineError(err) ? err.message : String(err);
  return firstLine(m);
}

export function firstLine(s: string): string {
  return s.split(/\r?\n/)[0].trim().slice(0, 200);
}

/** Byte-exact ISO-8859-1 decoding (TextDecoder's "latin1" is really windows-1252). */
export function latin1Decode(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return out;
}

export function latin1Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8');

export function utf8Encode(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export function looksLikePdf(data: Uint8Array): boolean {
  return latin1Decode(data.subarray(0, 1024)).includes('%PDF-');
}

/** Inflate zlib ("deflate") or raw deflate data with the browser's DecompressionStream. */
export async function inflate(data: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be encoded.'))), type, quality);
  });
}

/** Release the memory of a canvas immediately instead of waiting for GC. */
export function disposeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Strip the extension and characters that are unsafe in file names. */
export function baseName(name: string): string {
  const idx = name.lastIndexOf('.');
  return (idx > 0 ? name.slice(0, idx) : name) || 'document';
}
