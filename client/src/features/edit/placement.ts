/**
 * Pure placement math shared by the Edit tools' live previews and their tests.
 *
 * All results are expressed in the *visual* frame of a page: origin top-left, x to the
 * right, y downwards, in PDF points (the same frame `@pdfly/core` uses for its
 * `visualBox` before mapping to the rotated page). Multiply by a scale to get CSS px.
 *
 * The functions mirror `addPageNumbers` / `addWatermark` in packages/pdf-core so the
 * previews match the produced PDF.
 */
import type { NumberPosition, WatermarkPosition } from '@pdfly/core';

export type StdFontName = 'Helvetica' | 'TimesRoman' | 'Courier';

/** CSS font-family equivalents of the three PDF standard fonts (used by canvas/HTML previews). */
export const STD_FONT_FAMILY: Record<StdFontName, string> = {
  Helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  TimesRoman: '"Times New Roman", Times, "Liberation Serif", serif',
  Courier: '"Courier New", Courier, "Liberation Mono", monospace',
};

/** Rough average glyph width factor per font, used before real metrics are available. */
const APPROX_WIDTH_FACTOR: Record<StdFontName, number> = { Helvetica: 0.55, TimesRoman: 0.5, Courier: 0.6 };

export function approxTextWidth(text: string, fontSize: number, font: StdFontName = 'Helvetica'): number {
  return text.length * fontSize * APPROX_WIDTH_FACTOR[font];
}

export interface NumberPositionInput {
  position: NumberPosition;
  /** margin from the page edge in points */
  margin: number;
  fontSize: number;
  /** width of the rendered text in points */
  textWidth: number;
  /** visual page size in points */
  pageW: number;
  pageH: number;
}

export interface NumberPlacement {
  /** left edge of the text */
  x: number;
  /** top of the em box (baseline - fontSize) */
  y: number;
  /** y of the text baseline (what pdf-lib's drawText uses) */
  baselineY: number;
  textWidth: number;
  fontSize: number;
}

/**
 * Where a page number lands, in visual top-left coordinates.
 * Mirrors the math in core `addPageNumbers` (which works with a bottom-left origin):
 *   bottom-left origin y = top ? pageH - margin - fontSize : margin  (baseline)
 */
export function numberPosition(input: NumberPositionInput): NumberPlacement {
  const { position, margin, fontSize, textWidth, pageW, pageH } = input;
  let x: number;
  if (position.endsWith('left')) x = margin;
  else if (position.endsWith('right')) x = pageW - margin - textWidth;
  else x = (pageW - textWidth) / 2;

  // baseline in bottom-left coordinates
  const baselineBottomLeft = position.startsWith('top') ? pageH - margin - fontSize : margin;
  const baselineY = pageH - baselineBottomLeft;
  return { x, y: baselineY - fontSize, baselineY, textWidth, fontSize };
}

export interface WatermarkBoxInput {
  position: Exclude<WatermarkPosition, 'tile'>;
  pageW: number;
  pageH: number;
  itemW: number;
  itemH: number;
  /** margin from the edges for the corner/edge positions (core default 36pt) */
  margin?: number;
}

export interface WatermarkBox {
  /** top-left corner of the *unrotated* item box (visual top-left frame) */
  x: number;
  y: number;
  /** centre of the item; rotation happens around this point */
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * Where a (non-tiled) watermark item sits, in visual top-left coordinates. The item is
 * rotated around its centre (cx, cy) by the watermark rotation, counter-clockwise for
 * positive angles (pdf-lib convention). Mirrors core `positionFor` + the centre math.
 */
export function watermarkBox(input: WatermarkBoxInput): WatermarkBox {
  const { position, pageW, pageH, itemW, itemH, margin = 36 } = input;
  // bottom-left origin, like core
  let x = (pageW - itemW) / 2;
  let yBottom = (pageH - itemH) / 2;
  if (position.startsWith('top')) yBottom = pageH - itemH - margin;
  if (position.startsWith('bottom')) yBottom = margin;
  if (position.endsWith('left')) x = margin;
  if (position.endsWith('right')) x = pageW - itemW - margin;
  const y = pageH - yBottom - itemH;
  return { x, y, cx: x + itemW / 2, cy: y + itemH / 2, width: itemW, height: itemH };
}

export interface TileOrigin {
  /** origin of the item in visual top-left coordinates; for text this is the baseline start */
  x: number;
  y: number;
}

/**
 * Origins of the tiled text watermark, mirroring core: steps of (textWidth + 80, fontSize + 100)
 * starting one step outside the page. Each origin is the baseline-left of the text and the text
 * is rotated around that origin.
 */
export function textTileOrigins(pageW: number, pageH: number, textWidth: number, fontSize: number): TileOrigin[] {
  const stepX = textWidth + 80;
  const stepY = fontSize + 100;
  const out: TileOrigin[] = [];
  if (stepX <= 0 || stepY <= 0) return out;
  for (let yy = -stepY; yy < pageH + stepY; yy += stepY) {
    for (let xx = -stepX; xx < pageW + stepX; xx += stepX) {
      out.push({ x: xx, y: pageH - yy });
    }
  }
  return out;
}

/**
 * Origins of the tiled image watermark, mirroring core: steps of (w + 60, h + 60) starting at
 * the page origin. Each origin is the bottom-left corner of the image (visual frame) and the
 * image is rotated around that corner.
 */
export function imageTileOrigins(pageW: number, pageH: number, w: number, h: number): TileOrigin[] {
  const out: TileOrigin[] = [];
  if (w <= 0 || h <= 0) return out;
  for (let yy = 0; yy < pageH; yy += h + 60) {
    for (let xx = 0; xx < pageW; xx += w + 60) {
      out.push({ x: xx, y: pageH - yy });
    }
  }
  return out;
}

/** Size of an image watermark in points for a given page width and scale fraction (core: w = pageW * scale). */
export function imageWatermarkSize(pageW: number, scale: number, imageW: number, imageH: number): { width: number; height: number } {
  const s = Math.min(1, Math.max(0.02, scale));
  const width = pageW * s;
  const height = imageW > 0 ? (imageH / imageW) * width : width;
  return { width, height };
}

// ---------------------------------------------------------------------------
// Crop helpers
// ---------------------------------------------------------------------------

export interface FractionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_RECT: FractionRect = { x: 0, y: 0, width: 1, height: 1 };
export const MIN_CROP_FRACTION = 0.02;

/** Clamp a fraction rectangle into the page and to a minimum size. */
export function clampRect(r: FractionRect, minSize = MIN_CROP_FRACTION): FractionRect {
  const width = Math.min(1, Math.max(minSize, r.width));
  const height = Math.min(1, Math.max(minSize, r.height));
  const x = Math.min(1 - width, Math.max(0, r.x));
  const y = Math.min(1 - height, Math.max(0, r.y));
  return { x, y, width, height };
}

export interface ImageDataLike {
  data: Uint8ClampedArray | Uint8Array | number[];
  width: number;
  height: number;
}

/**
 * Find the bounding box of non-white content in an RGBA bitmap. Returns fractions of the
 * bitmap size (origin top-left) padded by `padding` (fraction of the page), or null when the
 * page is blank. A pixel counts as content when any channel is darker than `threshold`
 * (and it is not transparent).
 */
export function detectContentBounds(img: ImageDataLike, opts: { threshold?: number; padding?: number; stride?: number } = {}): FractionRect | null {
  const { threshold = 245, padding = 0.02, stride = 1 } = opts;
  const { data, width, height } = img;
  if (!width || !height) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += stride) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += stride) {
      const i = row + x * 4;
      const a = data[i + 3];
      if (a === 0) continue;
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  const rect: FractionRect = {
    x: minX / width - padding,
    y: minY / height - padding,
    width: (maxX - minX + 1) / width + padding * 2,
    height: (maxY - minY + 1) / height + padding * 2,
  };
  // keep inside the page
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(1, rect.x + rect.width);
  const bottom = Math.min(1, rect.y + rect.height);
  return clampRect({ x, y, width: right - x, height: bottom - y });
}

/** Convert points to millimetres. */
export function ptToMm(pt: number): number {
  return (pt * 25.4) / 72;
}

export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type CropDragMode = CropHandle | 'move';

/** Apply a drag delta (fractions of the page) to a crop rect for a handle or a move. */
export function applyDrag(start: FractionRect, mode: CropDragMode, dx: number, dy: number, min = MIN_CROP_FRACTION): FractionRect {
  if (mode === 'move') {
    return { ...start, x: Math.min(1 - start.width, Math.max(0, start.x + dx)), y: Math.min(1 - start.height, Math.max(0, start.y + dy)) };
  }
  let { x, y, width, height } = start;
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  if (mode.includes('w')) {
    x = Math.min(right - min, Math.max(0, start.x + dx));
    width = right - x;
  }
  if (mode.includes('e')) {
    width = Math.min(1 - start.x, Math.max(min, start.width + dx));
  }
  if (mode.includes('n')) {
    y = Math.min(bottom - min, Math.max(0, start.y + dy));
    height = bottom - y;
  }
  if (mode.includes('s')) {
    height = Math.min(1 - start.y, Math.max(min, start.height + dy));
  }
  return clampRect({ x, y, width, height }, min);
}
