/**
 * Module-level store for images placed in the editor (data URLs keyed by `imageId`).
 * Kept outside Redux because data URLs are large and never need to be serialized.
 */
import { newId } from '@/utils/id';

export const imageStore = new Map<string, string>();

export function storeImage(dataUrl: string): string {
  const id = newId('img');
  imageStore.set(id, dataUrl);
  return id;
}

export function clearImageStore() {
  imageStore.clear();
}

/** Collect the data URLs referenced by the given annotations (for saving). */
export function collectImages(imageIds: (string | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of imageIds) {
    if (!id) continue;
    const url = imageStore.get(id);
    if (url) out[id] = url;
  }
  return out;
}

/** Read an image's intrinsic size from a data URL. */
export function dataUrlSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = dataUrl;
  });
}

/** Convert any browser-decodable image blob (PNG/JPG/WEBP...) into a PNG data URL. */
export async function blobToPngDataUrl(blob: Blob, maxDimension = 2000): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  let { width, height } = bitmap;
  if (width > maxDimension || height > maxDimension) {
    const s = maxDimension / Math.max(width, height);
    width = Math.max(1, Math.round(width * s));
    height = Math.max(1, Math.round(height * s));
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}
