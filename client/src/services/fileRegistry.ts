/**
 * Holds the actual File/Blob objects for files referenced by id in Redux.
 * Blobs are not serializable so they must not live in the store.
 */
const registry = new Map<string, Blob>();
const objectUrls = new Map<string, string>();

export const fileRegistry = {
  set(id: string, blob: Blob) {
    registry.set(id, blob);
  },
  get(id: string): Blob | undefined {
    return registry.get(id);
  },
  has(id: string) {
    return registry.has(id);
  },
  remove(id: string) {
    registry.delete(id);
    const url = objectUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrls.delete(id);
    }
  },
  clear() {
    for (const id of [...registry.keys()]) this.remove(id);
  },
  /** Returns a cached object URL for the blob. Revoked on remove/clear. */
  objectUrl(id: string): string | undefined {
    const existing = objectUrls.get(id);
    if (existing) return existing;
    const blob = registry.get(id);
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    objectUrls.set(id, url);
    return url;
  },
  async bytes(id: string): Promise<Uint8Array> {
    const blob = registry.get(id);
    if (!blob) throw new Error('File is no longer available. Please upload it again.');
    return readBlobBytes(blob);
  },
};

import { readBlobBytes } from '@/utils/file';

/** Registry for output files of the last processing run (separate namespace). */
export const outputRegistry = {
  ...fileRegistry,
};
const outputMap = new Map<string, Blob>();
const outputUrls = new Map<string, string>();
outputRegistry.set = (id, blob) => {
  outputMap.set(id, blob);
};
outputRegistry.get = (id) => outputMap.get(id);
outputRegistry.has = (id) => outputMap.has(id);
outputRegistry.remove = (id) => {
  outputMap.delete(id);
  const url = outputUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    outputUrls.delete(id);
  }
};
outputRegistry.clear = () => {
  for (const id of [...outputMap.keys()]) outputRegistry.remove(id);
};
outputRegistry.objectUrl = (id) => {
  const existing = outputUrls.get(id);
  if (existing) return existing;
  const blob = outputMap.get(id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  outputUrls.set(id, url);
  return url;
};
outputRegistry.bytes = async (id) => {
  const blob = outputMap.get(id);
  if (!blob) throw new Error('Output file is no longer available.');
  return readBlobBytes(blob);
};
