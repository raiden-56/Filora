import { PAGE_SIZES, resolvePageSize, type ImageFit, type Orientation, type PageSizeName } from '@pdfly/core';

/** Points per millimetre (1 in = 72 pt = 25.4 mm). */
export const PT_PER_MM = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

/** Margin presets in points (matches the "None / Small / Medium / Large" options). */
export const MARGIN_PRESETS = { none: 0, small: 18, medium: 36, large: 54 } as const;
export type MarginPreset = keyof typeof MARGIN_PRESETS;

export interface PlacementInput {
  /** visual (already rotated) image size, in points */
  imgW: number;
  imgH: number;
  pageW: number;
  pageH: number;
  margin: number;
  fit: ImageFit;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the image is drawn on the page. Mirrors the math of `imagesToPdf` in @pdfly/core
 * (image centred inside the content box) but with a top-left origin so it can be used for
 * CSS previews. For `fill` the returned rect can exceed the content box: clip it to
 * `contentBox()` when drawing.
 */
export function computeImagePlacement({ imgW, imgH, pageW, pageH, margin, fit }: PlacementInput): Rect {
  const m = Math.max(0, margin);
  const availW = Math.max(1, pageW - m * 2);
  const availH = Math.max(1, pageH - m * 2);
  const iw = Math.max(1, imgW);
  const ih = Math.max(1, imgH);

  let width: number;
  let height: number;
  if (fit === 'original') {
    // Native size at 72 dpi, but never larger than the content box.
    const s = Math.min(1, availW / iw, availH / ih);
    width = iw * s;
    height = ih * s;
  } else if (fit === 'fill') {
    const s = Math.max(availW / iw, availH / ih);
    width = iw * s;
    height = ih * s;
  } else {
    const s = Math.min(availW / iw, availH / ih);
    width = iw * s;
    height = ih * s;
  }
  return { x: pageW / 2 - width / 2, y: pageH / 2 - height / 2, width, height };
}

/** The printable area inside the margins (top-left origin). */
export function contentBox(pageW: number, pageH: number, margin: number): Rect {
  const m = Math.max(0, margin);
  return { x: m, y: m, width: Math.max(1, pageW - m * 2), height: Math.max(1, pageH - m * 2) };
}

export interface PageDimsInput {
  pageSize: PageSizeName;
  orientation: Orientation | 'auto';
  /** custom size in points (used when pageSize === 'Custom') */
  customWidth?: number;
  customHeight?: number;
  /** visual (rotated) image size in points, used for 'Fit' and 'auto' orientation */
  imgW: number;
  imgH: number;
  margin: number;
}

/** Resolve the page size the same way `imagesToPdf` does. Returns [width, height] in points. */
export function resolvePageDims({ pageSize, orientation, customWidth, customHeight, imgW, imgH, margin }: PageDimsInput): [number, number] {
  if (pageSize === 'Fit') return [imgW + margin * 2, imgH + margin * 2];
  const o: Orientation = orientation === 'auto' ? (imgW > imgH ? 'landscape' : 'portrait') : orientation;
  const custom = customWidth && customHeight ? { width: customWidth, height: customHeight } : undefined;
  return resolvePageSize(pageSize, o, custom);
}

/** Human readable size, e.g. "210 × 297 mm". */
export function formatPageDims(pageW: number, pageH: number): string {
  return `${Math.round(ptToMm(pageW))} × ${Math.round(ptToMm(pageH))} mm`;
}

export { PAGE_SIZES };
