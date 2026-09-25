import { get, set, del, keys, createStore, entries } from 'idb-keyval';
import type { HistoryItem } from '@/types';

/**
 * IndexedDB persistence for "My Files". Metadata is stored under `meta:<id>` and
 * blobs under `blob:<id>` so the list can be loaded without reading file contents.
 */
const store = typeof indexedDB !== 'undefined' ? createStore('pdfly', 'files') : undefined;

function available() {
  return Boolean(store);
}

export async function saveOutput(item: HistoryItem, blob: Blob): Promise<void> {
  if (!available()) return;
  await set(`blob:${item.id}`, blob, store);
  await set(`meta:${item.id}`, item, store);
}

export async function loadHistory(): Promise<HistoryItem[]> {
  if (!available()) return [];
  const all = await entries<string, HistoryItem>(store);
  return all.filter(([k]) => String(k).startsWith('meta:')).map(([, v]) => v);
}

export async function loadOutputBlob(id: string): Promise<Blob | undefined> {
  if (!available()) return undefined;
  return get<Blob>(`blob:${id}`, store);
}

export async function deleteOutput(id: string): Promise<void> {
  if (!available()) return;
  await del(`blob:${id}`, store);
  await del(`meta:${id}`, store);
}

export async function renameOutput(id: string, name: string): Promise<void> {
  if (!available()) return;
  const meta = await get<HistoryItem>(`meta:${id}`, store);
  if (meta) await set(`meta:${id}`, { ...meta, name }, store);
}

export async function clearOutputs(): Promise<void> {
  if (!available()) return;
  const all = await keys(store);
  await Promise.all(all.map((k) => del(k, store)));
}

/** Delete items older than `maxAgeMs`. Returns the ids removed. */
export async function purgeExpired(maxAgeMs: number): Promise<string[]> {
  if (!available() || maxAgeMs <= 0) return [];
  const items = await loadHistory();
  const now = Date.now();
  const expired = items.filter((i) => now - i.createdAt > maxAgeMs);
  await Promise.all(expired.map((i) => deleteOutput(i.id)));
  return expired.map((i) => i.id);
}
