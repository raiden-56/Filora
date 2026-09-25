import { rgb } from 'pdf-lib';
import type { PageSizeName, Orientation } from './types';

/** Page sizes in PDF points (1/72 inch) as [width, height] portrait. */
export const PAGE_SIZES: Record<Exclude<PageSizeName, 'Fit' | 'Custom'>, [number, number]> = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  Letter: [612, 792],
  Legal: [612, 1008],
};

export function resolvePageSize(
  name: PageSizeName,
  orientation: Orientation,
  custom?: { width: number; height: number },
): [number, number] {
  let size: [number, number];
  if (name === 'Custom' && custom) size = [custom.width, custom.height];
  else if (name === 'Fit' || name === 'Custom') size = PAGE_SIZES.A4;
  else size = PAGE_SIZES[name];
  const [w, h] = size;
  if (orientation === 'landscape') return w > h ? [w, h] : [h, w];
  return w > h ? [h, w] : [w, h];
}

/**
 * Parse a page selection string such as "1-3, 5, 8-10" into a sorted, de-duplicated
 * list of 1-based page numbers. Pages outside 1..total are dropped.
 * Throws on syntactically invalid input.
 */
export function parsePageSelection(input: string, total: number): number[] {
  const result = new Set<number>();
  const parts = input
    .split(/[,\s\n;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`Invalid page selection "${part}"`);
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    for (let i = start; i <= end; i++) {
      if (i >= 1 && i <= total) result.add(i);
    }
  }
  return [...result].sort((x, y) => x - y);
}

/**
 * Parse page range groups. Each group (separated by newline, comma or semicolon) becomes its own list.
 * "1-3\n5-7\n10" -> [[1,2,3],[5,6,7],[10]]
 */
export function parsePageRangeGroups(input: string, total: number): number[][] {
  const groups = input
    .split(/[\n,;]+/)
    .map((g) => g.trim())
    .filter(Boolean);
  const out: number[][] = [];
  for (const g of groups) {
    const pages = parsePageSelection(g, total);
    if (pages.length) out.push(pages);
  }
  return out;
}

export function hexToRgb(hex: string) {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return rgb(0, 0, 0);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${sizes[i]}`;
}

/** Make a filename safe for downloads and for the filesystem. */
export function sanitizeFilename(name: string, fallback = 'file'): string {
  const base = (name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim();
  const trimmed = base.slice(0, 180);
  return trimmed || fallback;
}

export function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

export function withSuffix(name: string, suffix: string, ext = 'pdf'): string {
  return `${sanitizeFilename(stripExtension(name), 'document')}${suffix}.${ext}`;
}

export function normalizeAngle(angle: number): number {
  const a = Math.round(angle / 90) * 90;
  return ((a % 360) + 360) % 360;
}

export function assertPages(pages: number[], total: number) {
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 1 || p > total) {
      throw new Error(`Page ${p} is out of range (1-${total})`);
    }
  }
}
