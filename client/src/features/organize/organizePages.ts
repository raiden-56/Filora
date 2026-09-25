/**
 * Pure helpers shared by the Organize PDF tools. No React, no DOM: everything here is
 * unit-testable and operates on plain data.
 */
import type { SplitMode } from '@pdfly/core';
import { parsePageRangeGroups } from '@pdfly/core';

// ---------------------------------------------------------------------------
// Page list (Organize PDF)
// ---------------------------------------------------------------------------

/** One page in the organizer. `source` indexes the list of source documents. */
export interface OrganizePageItem {
  /** unique key (pages can be duplicated so the (source, page) pair is not unique) */
  key: string;
  /** index into the sources array (0 = uploaded file) */
  source: number;
  /** 1-based page number in the source document */
  page: number;
  /** extra clockwise rotation in degrees (0, 90, 180, 270) */
  rotate: number;
}

let keyCounter = 0;

/** Returns a unique key for a new page entry. */
export function newPageKey(prefix = 'p'): string {
  keyCounter += 1;
  return `${prefix}${keyCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeRotation(deg: number): number {
  const r = Math.round(deg / 90) * 90;
  return ((r % 360) + 360) % 360;
}

/** Creates the initial page list for a source document with `count` pages. */
export function createPages(source: number, count: number): OrganizePageItem[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({ key: newPageKey(), source, page: i + 1, rotate: 0 }));
}

/** Reorders the list to match `keys`. Unknown keys are ignored, missing pages are appended. */
export function reorderPages(pages: OrganizePageItem[], keys: string[]): OrganizePageItem[] {
  const byKey = new Map(pages.map((p) => [p.key, p]));
  const seen = new Set<string>();
  const out: OrganizePageItem[] = [];
  for (const k of keys) {
    const p = byKey.get(k);
    if (p && !seen.has(k)) {
      out.push(p);
      seen.add(k);
    }
  }
  for (const p of pages) if (!seen.has(p.key)) out.push(p);
  return out;
}

/** Moves one page by `delta` positions (negative = left). Clamped to the list bounds. */
export function movePage(pages: OrganizePageItem[], key: string, delta: number): OrganizePageItem[] {
  const from = pages.findIndex((p) => p.key === key);
  if (from < 0) return pages;
  const to = Math.max(0, Math.min(pages.length - 1, from + delta));
  if (to === from) return pages;
  const next = [...pages];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Adds `delta` degrees of rotation to every page whose key is in `keys`. */
export function rotatePages(pages: OrganizePageItem[], keys: Iterable<string>, delta: number): OrganizePageItem[] {
  const set = new Set(keys);
  if (!set.size) return pages;
  return pages.map((p) => (set.has(p.key) ? { ...p, rotate: normalizeRotation(p.rotate + delta) } : p));
}

/** Removes every page whose key is in `keys`. */
export function deletePages(pages: OrganizePageItem[], keys: Iterable<string>): OrganizePageItem[] {
  const set = new Set(keys);
  if (!set.size) return pages;
  return pages.filter((p) => !set.has(p.key));
}

/** Inserts a copy directly after each page whose key is in `keys`. Returns the new list and the copies' keys. */
export function duplicatePages(pages: OrganizePageItem[], keys: Iterable<string>): { pages: OrganizePageItem[]; newKeys: string[] } {
  const set = new Set(keys);
  const newKeys: string[] = [];
  if (!set.size) return { pages, newKeys };
  const out: OrganizePageItem[] = [];
  for (const p of pages) {
    out.push(p);
    if (set.has(p.key)) {
      const copy = { ...p, key: newPageKey() };
      newKeys.push(copy.key);
      out.push(copy);
    }
  }
  return { pages: out, newKeys };
}

/** Inserts `items` after the page with key `afterKey` (or at the end when null / not found). */
export function insertPagesAfter(pages: OrganizePageItem[], afterKey: string | null, items: OrganizePageItem[]): OrganizePageItem[] {
  if (!items.length) return pages;
  const idx = afterKey ? pages.findIndex((p) => p.key === afterKey) : -1;
  if (idx < 0) return [...pages, ...items];
  return [...pages.slice(0, idx + 1), ...items, ...pages.slice(idx + 1)];
}

export function reversePages(pages: OrganizePageItem[]): OrganizePageItem[] {
  return [...pages].reverse();
}

/** Keeps only the given keys, in list order (used by "Extract selected"). */
export function pickPages(pages: OrganizePageItem[], keys: Iterable<string>): OrganizePageItem[] {
  const set = new Set(keys);
  return pages.filter((p) => set.has(p.key));
}

/** Converts the page list into the `pages` argument of `organizePdf`. */
export function toOrganizeOps(pages: OrganizePageItem[]): { source: number; page: number; rotate: number }[] {
  return pages.map((p) => ({ source: p.source, page: p.page, rotate: normalizeRotation(p.rotate) }));
}

/** The last key of `selection` that occurs in `pages` (list order), or null. */
export function lastSelectedKey(pages: OrganizePageItem[], selection: Iterable<string>): string | null {
  const set = new Set(selection);
  for (let i = pages.length - 1; i >= 0; i--) if (set.has(pages[i].key)) return pages[i].key;
  return null;
}

// ---------------------------------------------------------------------------
// Undo / redo history
// ---------------------------------------------------------------------------

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 50;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Records a new state. A no-op when `next` is the same reference as the current state. */
export function commitHistory<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [] };
}

export function undoHistory<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const past = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1];
  return { past, present, future: [h.present, ...h.future] };
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const [present, ...future] = h.future;
  return { past: [...h.past, h.present], present, future };
}

export function canUndo<T>(h: History<T>) {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>) {
  return h.future.length > 0;
}

// ---------------------------------------------------------------------------
// Sources (extra PDFs / blank pages added to the organizer)
// ---------------------------------------------------------------------------

export const SOURCE_COLORS = ['#0284C7', '#059669', '#EA580C', '#DB2777', '#7C3AED', '#CA8A04', '#0D9488', '#DC2626'];

/** Badge color for the n-th additional source (index 1 = first added file). */
export function sourceColor(index: number): string {
  return SOURCE_COLORS[(Math.max(1, index) - 1) % SOURCE_COLORS.length];
}

/** Short label for a file name used in badges: extension stripped, truncated. */
export function shortName(name: string, max = 14): string {
  const idx = name.lastIndexOf('.');
  const base = idx > 0 ? name.slice(0, idx) : name;
  if (base.length <= max) return base || 'file';
  return `${base.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// Split helpers
// ---------------------------------------------------------------------------

/**
 * Computes the page groups a split will produce (mirrors `splitPdf` in @pdfly/core) so the
 * UI can show how many files will be created. Throws on invalid range text.
 */
export function splitGroups(mode: SplitMode, total: number): number[][] {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  switch (mode.type) {
    case 'every':
      return all.map((p) => [p]);
    case 'pages':
      return [...new Set(mode.pages)].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b).map((p) => [p]);
    case 'ranges':
      return parsePageRangeGroups(mode.ranges, total);
    case 'chunk': {
      const size = Math.max(1, Math.floor(mode.size || 1));
      const groups: number[][] = [];
      for (let i = 0; i < total; i += size) groups.push(all.slice(i, i + size));
      return groups;
    }
  }
}

/** Human summary of what a split will produce. */
export function describeSplit(groupCount: number, total: number): string {
  if (!total) return 'No pages';
  if (!groupCount) return 'No files will be produced';
  return `${groupCount} PDF file${groupCount === 1 ? '' : 's'} will be produced from ${total} page${total === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Scan to PDF helpers
// ---------------------------------------------------------------------------

/** Rectangle in fractions (0-1) of the image width/height, origin top-left. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_CROP = 0.02;

/** Clamps a crop rectangle into the unit square and enforces a minimum size. */
export function clampCrop(r: CropRect): CropRect {
  const width = Math.min(1, Math.max(MIN_CROP, r.width));
  const height = Math.min(1, Math.max(MIN_CROP, r.height));
  const x = Math.min(1 - width, Math.max(0, r.x));
  const y = Math.min(1 - height, Math.max(0, r.y));
  return { x, y, width, height };
}

/** Builds a normalized rectangle from two corner points (fractions). */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): CropRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return clampCrop({ x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
}

/** True when the crop covers (almost) the whole image, i.e. it can be dropped. */
export function isFullCrop(r: CropRect | null | undefined, eps = 0.005): boolean {
  if (!r) return true;
  return r.x <= eps && r.y <= eps && r.width >= 1 - eps && r.height >= 1 - eps;
}

/** Pixel crop for an image of the given size. */
export function cropToPixels(r: CropRect, width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  const c = clampCrop(r);
  const sx = Math.round(c.x * width);
  const sy = Math.round(c.y * height);
  const sw = Math.max(1, Math.round(c.width * width));
  const sh = Math.max(1, Math.round(c.height * height));
  return { sx, sy, sw: Math.min(sw, width - sx), sh: Math.min(sh, height - sy) };
}

export type ScanMargin = 'none' | 'small' | 'medium';

export const SCAN_MARGIN_POINTS: Record<ScanMargin, number> = { none: 0, small: 18, medium: 36 };

/** CSS/canvas filter string for the auto-enhance options. */
export function enhanceFilter(enhance: boolean, grayscale: boolean): string {
  const parts: string[] = [];
  if (enhance) parts.push('contrast(1.25)', 'brightness(1.05)');
  if (grayscale) parts.push('grayscale(1)');
  return parts.join(' ') || 'none';
}

/** File name for a scan created "now": scan-YYYY-MM-DD.pdf */
export function scanFileName(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `scan-${y}-${m}-${d}.pdf`;
}
