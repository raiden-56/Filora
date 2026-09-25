/**
 * Pure geometry helpers for the PDF editor overlay. All coordinates are fractions (0-1)
 * of the visual page unless a name says `Px`.
 */
import type { Annotation, AnnotationType, Point } from '@/store/slices/editorSlice';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type LineHandleId = 'p1' | 'p2';

export const HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function clamp01(n: number) {
  return clamp(n, 0, 1);
}

/** Types drawn as a plain box (x, y, width, height). */
export function isBoxType(type: AnnotationType): boolean {
  return type !== 'line' && type !== 'arrow' && type !== 'draw';
}

export function isLineType(type: AnnotationType): boolean {
  return type === 'line' || type === 'arrow';
}

/** Build a normalized rect from two corners (any order), clamped to the page. */
export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  const ax = clamp01(Math.min(x1, x2));
  const ay = clamp01(Math.min(y1, y2));
  const bx = clamp01(Math.max(x1, x2));
  const by = clamp01(Math.max(y1, y2));
  return { x: ax, y: ay, width: bx - ax, height: by - ay };
}

/** Bounding box of any annotation (lines and drawings included). */
export function annotationBounds(a: Annotation): Rect {
  if (isLineType(a.type)) {
    return normalizeRect(a.x1 ?? a.x, a.y1 ?? a.y, a.x2 ?? a.x + a.width, a.y2 ?? a.y + a.height);
  }
  if (a.type === 'draw' && a.points?.length) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of a.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return { x: a.x, y: a.y, width: a.width, height: a.height };
}

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Does the point (fx, fy) hit the annotation? `widthPx/heightPx` is the rendered page size so
 * the tolerance can be expressed in screen pixels.
 */
export function hitTest(a: Annotation, fx: number, fy: number, widthPx: number, heightPx: number, tolerancePx = 6): boolean {
  const px = fx * widthPx;
  const py = fy * heightPx;
  if (isLineType(a.type)) {
    const x1 = (a.x1 ?? a.x) * widthPx;
    const y1 = (a.y1 ?? a.y) * heightPx;
    const x2 = (a.x2 ?? a.x + a.width) * widthPx;
    const y2 = (a.y2 ?? a.y + a.height) * heightPx;
    return distToSegment(px, py, x1, y1, x2, y2) <= tolerancePx + a.strokeWidth;
  }
  if (a.type === 'draw' && a.points?.length) {
    const tol = tolerancePx + Math.max(2, a.strokeWidth);
    if (a.points.length === 1) return Math.hypot(px - a.points[0].x * widthPx, py - a.points[0].y * heightPx) <= tol;
    for (let i = 1; i < a.points.length; i++) {
      const p = a.points[i - 1];
      const q = a.points[i];
      if (distToSegment(px, py, p.x * widthPx, p.y * heightPx, q.x * widthPx, q.y * heightPx) <= tol) return true;
    }
    return false;
  }
  const b = annotationBounds(a);
  const left = b.x * widthPx - tolerancePx;
  const top = b.y * heightPx - tolerancePx;
  const right = (b.x + b.width) * widthPx + tolerancePx;
  const bottom = (b.y + b.height) * heightPx + tolerancePx;
  return px >= left && px <= right && py >= top && py <= bottom;
}

/** Topmost annotation under the point (last in the array wins). */
export function hitTestAll(annotations: Annotation[], fx: number, fy: number, widthPx: number, heightPx: number, tolerancePx = 6): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (hitTest(annotations[i], fx, fy, widthPx, heightPx, tolerancePx)) return annotations[i];
  }
  return null;
}

/** Positions (fractions) of the 8 resize handles of a rect. */
export function handlePositions(r: Rect): { id: HandleId; x: number; y: number }[] {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const right = r.x + r.width;
  const bottom = r.y + r.height;
  return [
    { id: 'nw', x: r.x, y: r.y },
    { id: 'n', x: cx, y: r.y },
    { id: 'ne', x: right, y: r.y },
    { id: 'e', x: right, y: cy },
    { id: 'se', x: right, y: bottom },
    { id: 's', x: cx, y: bottom },
    { id: 'sw', x: r.x, y: bottom },
    { id: 'w', x: r.x, y: cy },
  ];
}

/** Which handle (if any) is under the pointer. */
export function hitHandle(r: Rect, fx: number, fy: number, widthPx: number, heightPx: number, sizePx = 10): HandleId | null {
  for (const h of handlePositions(r)) {
    if (Math.abs((h.x - fx) * widthPx) <= sizePx && Math.abs((h.y - fy) * heightPx) <= sizePx) return h.id;
  }
  return null;
}

/**
 * Resize a rect by dragging one handle by (dx, dy) fractions. Keeps a minimum size and stays
 * inside the page. Returns a new rect.
 */
export function resizeRect(r: Rect, handle: HandleId, dx: number, dy: number, min: { w: number; h: number } = { w: 0.005, h: 0.005 }): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.width;
  let bottom = r.y + r.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min.w);
  if (handle.includes('e')) right = clamp(right + dx, left + min.w, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min.h);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min.h, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Move a rect by (dx, dy), clamped so it stays on the page. */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  const x = clamp(r.x + dx, 0, Math.max(0, 1 - r.width));
  const y = clamp(r.y + dy, 0, Math.max(0, 1 - r.height));
  return { ...r, x, y };
}

/** Map points from one bounding box into another (used to move/resize freehand drawings). */
export function fitPointsToBounds(points: Point[], from: Rect, to: Rect): Point[] {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return points.map((p) => ({ x: to.x + (p.x - from.x) * sx, y: to.y + (p.y - from.y) * sy }));
}

/**
 * Drop points that are closer than `minDistPx` to the previously kept point. The first and
 * last points are always kept.
 */
export function simplifyPoints(points: Point[], widthPx: number, heightPx: number, minDistPx = 1): Point[] {
  if (points.length <= 2) return points.slice();
  const out: Point[] = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = Math.hypot((p.x - last.x) * widthPx, (p.y - last.y) * heightPx);
    if (d >= minDistPx) {
      out.push(p);
      last = p;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Translate an annotation (any type) by a fraction delta. Returns a partial patch. */
export function movedPatch(a: Annotation, dx: number, dy: number): Partial<Annotation> {
  if (isLineType(a.type)) {
    const b = annotationBounds(a);
    const m = moveRect(b, dx, dy);
    const ddx = m.x - b.x;
    const ddy = m.y - b.y;
    return {
      x1: (a.x1 ?? a.x) + ddx,
      y1: (a.y1 ?? a.y) + ddy,
      x2: (a.x2 ?? a.x + a.width) + ddx,
      y2: (a.y2 ?? a.y + a.height) + ddy,
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
    };
  }
  if (a.type === 'draw' && a.points?.length) {
    const b = annotationBounds(a);
    const m = moveRect(b, dx, dy);
    return { points: fitPointsToBounds(a.points, b, m), x: m.x, y: m.y, width: m.width, height: m.height };
  }
  const m = moveRect({ x: a.x, y: a.y, width: a.width, height: a.height }, dx, dy);
  return { x: m.x, y: m.y };
}

/** Resize an annotation via a handle. Returns a partial patch. */
export function resizedPatch(a: Annotation, handle: HandleId, dx: number, dy: number, pageAspect = 1): Partial<Annotation> {
  const b = annotationBounds(a);
  const r = resizeRect(b, handle, dx, dy);
  if (a.type === 'draw' && a.points?.length) {
    return { points: fitPointsToBounds(a.points, b, r), x: r.x, y: r.y, width: r.width, height: r.height };
  }
  if (a.type === 'checkbox') {
    // keep it square on screen: height fraction = width fraction * (widthPx / heightPx)
    const width = handle === 'n' || handle === 's' ? r.height / pageAspect : r.width;
    const height = clamp(width * pageAspect, 0, 1 - r.y);
    return { x: r.x, y: r.y, width: height / pageAspect, height };
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Lines/arrows: move one endpoint. */
export function lineEndpointPatch(a: Annotation, which: LineHandleId, fx: number, fy: number): Partial<Annotation> {
  const x1 = which === 'p1' ? clamp01(fx) : (a.x1 ?? a.x);
  const y1 = which === 'p1' ? clamp01(fy) : (a.y1 ?? a.y);
  const x2 = which === 'p2' ? clamp01(fx) : (a.x2 ?? a.x + a.width);
  const y2 = which === 'p2' ? clamp01(fy) : (a.y2 ?? a.y + a.height);
  const b = normalizeRect(x1, y1, x2, y2);
  return { x1, y1, x2, y2, x: b.x, y: b.y, width: b.width, height: b.height };
}

/** Points of the arrow head polygon (in px) for an arrow from (x1,y1) to (x2,y2) in px. */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, strokePx: number): [number, number][] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const headLen = Math.max(8, strokePx * 4);
  const headW = headLen * 0.6;
  const bx = x2 - ux * headLen;
  const by = y2 - uy * headLen;
  return [
    [x2, y2],
    [bx - uy * headW, by + ux * headW],
    [bx + uy * headW, by - ux * headW],
  ];
}
