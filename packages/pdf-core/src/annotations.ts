import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, degrees, BlendMode, LineCapStyle } from 'pdf-lib';
import { hexToRgb, normalizeAngle } from './utils';

export type AnnotationType =
  | 'text'
  | 'image'
  | 'draw'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'signature'
  | 'checkbox';

export interface AnnotationPoint {
  x: number;
  y: number;
}

/**
 * Annotation model shared by the client editor (Redux `editorSlice`) and the server.
 * All coordinates are fractions (0-1) of the *visual* page (i.e. after /Rotate is applied),
 * origin top-left, so they are resolution independent.
 */
export interface Annotation {
  id: string;
  type: AnnotationType;
  /** 1-based */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** hex color */
  color: string;
  /** 0-1 */
  opacity: number;
  /** stroke width in page points */
  strokeWidth: number;
  // text
  text?: string;
  /** page points */
  fontSize?: number;
  fontFamily?: 'Helvetica' | 'TimesRoman' | 'Courier';
  // image / signature
  imageId?: string;
  // draw: polyline points (fractions)
  points?: AnnotationPoint[];
  // line / arrow endpoints (fractions)
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  // shapes: fill color or null/undefined for no fill
  fill?: string | null;
  // checkbox
  checked?: boolean;
}

export type AnnotationImages = Record<string, Uint8Array | string>;

const HIGHLIGHT_COLOR = '#FFEB3B';
const HIGHLIGHT_OPACITY = 0.35;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface PageFrame {
  page: PDFPage;
  rot: number;
  /** visual (rotated) size in points */
  vw: number;
  vh: number;
  /** unrotated page size */
  pw: number;
  ph: number;
}

function frameOf(page: PDFPage): PageFrame {
  const rot = normalizeAngle(page.getRotation().angle);
  const { width: pw, height: ph } = page.getSize();
  const swapped = rot === 90 || rot === 270;
  return { page, rot, pw, ph, vw: swapped ? ph : pw, vh: swapped ? pw : ph };
}

/**
 * Map a point given in *visual* points (origin top-left of the page as displayed) to
 * unrotated page coordinates (origin bottom-left) that pdf-lib draws in.
 */
export function toPage(frame: PageFrame, vx: number, vyTop: number): { x: number; y: number } {
  const { rot, pw, ph, vh } = frame;
  const vy = vh - vyTop; // visual, bottom-left origin
  switch (rot) {
    case 90:
      return { x: pw - vy, y: vx };
    case 180:
      return { x: pw - vx, y: ph - vy };
    case 270:
      return { x: vy, y: ph - vx };
    default:
      return { x: vx, y: vy };
  }
}

/** Fraction -> visual points */
function fx(frame: PageFrame, f: number) {
  return f * frame.vw;
}
function fy(frame: PageFrame, f: number) {
  return f * frame.vh;
}

/** Axis-aligned page-space rectangle for a visual fraction box. */
function pageRect(frame: PageFrame, a: { x: number; y: number; width: number; height: number }) {
  const p1 = toPage(frame, fx(frame, a.x), fy(frame, a.y));
  const p2 = toPage(frame, fx(frame, a.x + a.width), fy(frame, a.y + a.height));
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  return { x, y, width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
}

function pointToPage(frame: PageFrame, p: AnnotationPoint) {
  return toPage(frame, fx(frame, p.x), fy(frame, p.y));
}

function pathFromPagePoints(pts: { x: number; y: number }[], close = false): string {
  if (!pts.length) return '';
  const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
  let d = `M ${fmt(pts[0].x)} ${fmt(-pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${fmt(pts[i].x)} ${fmt(-pts[i].y)}`;
  if (close) d += ' Z';
  return d;
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

// ---------------------------------------------------------------------------
// Text wrapping
// ---------------------------------------------------------------------------

/**
 * Greedy word wrap. Explicit newlines are honoured, words longer than the box are broken
 * by character. Returns the lines to draw.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const width = (s: string) => {
    try {
      return font.widthOfTextAtSize(s, size);
    } catch {
      return s.length * size * 0.5;
    }
  };
  const lines: string[] = [];
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');
  for (const para of paragraphs) {
    const words = para.split(/[ \t]+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (width(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      if (width(word) <= maxWidth) {
        line = word;
        continue;
      }
      // The word alone does not fit: break it by characters.
      let chunk = '';
      for (const ch of word) {
        if (chunk && width(chunk + ch) > maxWidth) {
          lines.push(chunk);
          chunk = '';
        }
        chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  if (typeof globalThis.atob === 'function') {
    const bin = globalThis.atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node without atob (very old) - Buffer is available there.
  const B = (globalThis as unknown as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (B) return new Uint8Array(B.from(clean, 'base64'));
  throw new Error('Cannot decode base64 image data');
}

/** Accepts raw bytes or a data URL / bare base64 string. */
export function imageBytes(src: Uint8Array | string): Uint8Array {
  if (typeof src !== 'string') return src;
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
  if (m) {
    if (m[2]) return decodeBase64(m[3]);
    const text = decodeURIComponent(m[3]);
    return new TextEncoder().encode(text);
  }
  return decodeBase64(src);
}

function isPng(b: Uint8Array) {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}
function isJpeg(b: Uint8Array) {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

async function embedImage(doc: PDFDocument, src: Uint8Array | string): Promise<PDFImage> {
  const bytes = imageBytes(src);
  if (isPng(bytes)) return doc.embedPng(bytes);
  if (isJpeg(bytes)) return doc.embedJpg(bytes);
  throw new Error('Images must be PNG or JPEG.');
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function stdFont(name: Annotation['fontFamily']) {
  switch (name) {
    case 'TimesRoman':
      return StandardFonts.TimesRoman;
    case 'Courier':
      return StandardFonts.Courier;
    default:
      return StandardFonts.Helvetica;
  }
}

function drawText(frame: PageFrame, a: Annotation, font: PDFFont) {
  const text = a.text ?? '';
  if (!text.trim()) return;
  const size = Math.max(1, a.fontSize ?? 14);
  const lineHeight = size * 1.2;
  const boxW = Math.max(size, fx(frame, a.width));
  const boxH = fy(frame, a.height);
  const lines = wrapText(text, font, size, boxW);
  const left = fx(frame, a.x);
  const top = fy(frame, a.y);
  const color = hexToRgb(a.color || '#000000');
  const maxLines = boxH > 0 ? Math.max(1, Math.floor((boxH + lineHeight * 0.3) / lineHeight)) : lines.length;
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const line = lines[i];
    if (!line) continue;
    // baseline (visual, top-left origin): top of the line + ascender (~ font size)
    const baselineTop = top + i * lineHeight + size * 0.92;
    const p = toPage(frame, left, baselineTop);
    frame.page.drawText(line, {
      x: p.x,
      y: p.y,
      size,
      font,
      color,
      opacity: a.opacity,
      rotate: degrees(frame.rot),
    });
  }
}

function drawImage(frame: PageFrame, a: Annotation, image: PDFImage) {
  const boxW = fx(frame, a.width);
  const boxH = fy(frame, a.height);
  if (boxW <= 0 || boxH <= 0) return;
  const s = Math.min(boxW / image.width, boxH / image.height);
  const w = image.width * s;
  const h = image.height * s;
  const left = fx(frame, a.x) + (boxW - w) / 2;
  const top = fy(frame, a.y) + (boxH - h) / 2;
  // pdf-lib anchors images at their bottom-left corner.
  const p = toPage(frame, left, top + h);
  frame.page.drawImage(image, { x: p.x, y: p.y, width: w, height: h, opacity: a.opacity, rotate: degrees(frame.rot) });
}

function drawPolyline(frame: PageFrame, a: Annotation) {
  const pts = (a.points ?? []).map((p) => pointToPage(frame, p));
  if (pts.length === 0) return;
  const color = hexToRgb(a.color);
  if (pts.length === 1) {
    frame.page.drawCircle({ x: pts[0].x, y: pts[0].y, size: Math.max(0.5, a.strokeWidth / 2), color, opacity: a.opacity });
    return;
  }
  frame.page.drawSvgPath(pathFromPagePoints(pts), {
    x: 0,
    y: 0,
    borderColor: color,
    borderWidth: Math.max(0.1, a.strokeWidth),
    borderOpacity: a.opacity,
    borderLineCap: LineCapStyle.Round,
  });
}

function drawHighlight(frame: PageFrame, a: Annotation) {
  const r = pageRect(frame, a);
  frame.page.drawRectangle({
    ...r,
    color: hexToRgb(a.color || HIGHLIGHT_COLOR),
    opacity: Math.min(a.opacity, HIGHLIGHT_OPACITY) || HIGHLIGHT_OPACITY,
    blendMode: BlendMode.Multiply,
  });
}

function drawHorizontalLine(frame: PageFrame, a: Annotation, atFraction: number) {
  const yTop = fy(frame, a.y + a.height * atFraction);
  const p1 = toPage(frame, fx(frame, a.x), yTop);
  const p2 = toPage(frame, fx(frame, a.x + a.width), yTop);
  frame.page.drawLine({ start: p1, end: p2, thickness: Math.max(0.5, a.strokeWidth), color: hexToRgb(a.color), opacity: a.opacity });
}

function drawRect(frame: PageFrame, a: Annotation) {
  const r = pageRect(frame, a);
  const fill = a.fill ? hexToRgb(a.fill) : undefined;
  const border = a.strokeWidth > 0 ? a.strokeWidth : undefined;
  frame.page.drawRectangle({
    ...r,
    color: fill,
    opacity: a.opacity,
    borderColor: border ? hexToRgb(a.color) : undefined,
    borderWidth: border,
    borderOpacity: a.opacity,
  });
}

function drawEllipse(frame: PageFrame, a: Annotation) {
  const r = pageRect(frame, a);
  const fill = a.fill ? hexToRgb(a.fill) : undefined;
  const border = a.strokeWidth > 0 ? a.strokeWidth : undefined;
  frame.page.drawEllipse({
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    xScale: r.width / 2,
    yScale: r.height / 2,
    color: fill,
    opacity: a.opacity,
    borderColor: border ? hexToRgb(a.color) : undefined,
    borderWidth: border,
    borderOpacity: a.opacity,
  });
}

function lineEndpoints(frame: PageFrame, a: Annotation) {
  const x1 = a.x1 ?? a.x;
  const y1 = a.y1 ?? a.y;
  const x2 = a.x2 ?? a.x + a.width;
  const y2 = a.y2 ?? a.y + a.height;
  return { p1: toPage(frame, fx(frame, x1), fy(frame, y1)), p2: toPage(frame, fx(frame, x2), fy(frame, y2)) };
}

function drawLine(frame: PageFrame, a: Annotation, arrow: boolean) {
  const { p1, p2 } = lineEndpoints(frame, a);
  const color = hexToRgb(a.color);
  const thickness = Math.max(0.5, a.strokeWidth);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (arrow && len > 0) {
    const headLen = Math.max(8, thickness * 4);
    const headW = headLen * 0.6;
    const ux = dx / len;
    const uy = dy / len;
    // Shorten the shaft so it does not poke through the arrow head.
    const shaftEnd = { x: p2.x - ux * headLen * 0.8, y: p2.y - uy * headLen * 0.8 };
    frame.page.drawLine({ start: p1, end: shaftEnd, thickness, color, opacity: a.opacity });
    const base = { x: p2.x - ux * headLen, y: p2.y - uy * headLen };
    const left = { x: base.x - uy * headW, y: base.y + ux * headW };
    const right = { x: base.x + uy * headW, y: base.y - ux * headW };
    frame.page.drawSvgPath(pathFromPagePoints([p2, left, right], true), { x: 0, y: 0, color, opacity: a.opacity });
    return;
  }
  frame.page.drawLine({ start: p1, end: p2, thickness, color, opacity: a.opacity });
}

function drawCheckbox(frame: PageFrame, a: Annotation) {
  const size = Math.min(fx(frame, a.width), fy(frame, a.height));
  if (size <= 0) return;
  const box = { x: a.x, y: a.y, width: size / frame.vw, height: size / frame.vh };
  const r = pageRect(frame, box);
  const color = hexToRgb(a.color);
  frame.page.drawRectangle({
    ...r,
    borderColor: color,
    borderWidth: Math.max(0.5, Math.min(a.strokeWidth, size / 8)),
    borderOpacity: a.opacity,
    color: a.fill ? hexToRgb(a.fill) : undefined,
    opacity: a.opacity,
  });
  if (a.checked) {
    const pts = [
      { x: 0.2, y: 0.52 },
      { x: 0.42, y: 0.75 },
      { x: 0.82, y: 0.27 },
    ].map((p) => toPage(frame, fx(frame, box.x) + p.x * size, fy(frame, box.y) + p.y * size));
    frame.page.drawSvgPath(pathFromPagePoints(pts), {
      x: 0,
      y: 0,
      borderColor: color,
      borderWidth: Math.max(1, size / 8),
      borderOpacity: a.opacity,
      borderLineCap: LineCapStyle.Round,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Burn annotations into a PDF. Pages' /Rotate attribute is respected so that everything
 * lands where the user saw it. `images` maps `imageId` -> PNG/JPEG bytes or a data URL.
 */
export async function applyAnnotations(pdf: Uint8Array, annotations: Annotation[], images: AnnotationImages = {}): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    throw new Error(`Unable to read PDF: ${err instanceof Error ? err.message : String(err)}`);
  }
  const pageCount = doc.getPageCount();
  const fonts = new Map<string, PDFFont>();
  const fontFor = async (name: Annotation['fontFamily']) => {
    const key = name ?? 'Helvetica';
    let f = fonts.get(key);
    if (!f) {
      f = await doc.embedFont(stdFont(name));
      fonts.set(key, f);
    }
    return f;
  };
  const embedded = new Map<string, PDFImage>();
  const imageFor = async (id: string | undefined) => {
    if (!id) return null;
    let img = embedded.get(id);
    if (img) return img;
    const src = images[id] ?? (id.startsWith('data:') ? id : undefined);
    if (!src) return null;
    img = await embedImage(doc, src);
    embedded.set(id, img);
    return img;
  };

  const frames = new Map<number, PageFrame>();

  for (const raw of annotations) {
    if (!raw || !Number.isInteger(raw.page) || raw.page < 1 || raw.page > pageCount) continue;
    const a: Annotation = {
      ...raw,
      x: clamp01(raw.x),
      y: clamp01(raw.y),
      width: Math.max(0, Math.min(1, Number.isFinite(raw.width) ? raw.width : 0)),
      height: Math.max(0, Math.min(1, Number.isFinite(raw.height) ? raw.height : 0)),
      opacity: clamp01(raw.opacity ?? 1),
      strokeWidth: Math.max(0, Number.isFinite(raw.strokeWidth) ? raw.strokeWidth : 2),
      color: raw.color || '#000000',
    };
    let frame = frames.get(a.page);
    if (!frame) {
      frame = frameOf(doc.getPage(a.page - 1));
      frames.set(a.page, frame);
    }
    switch (a.type) {
      case 'text':
        drawText(frame, a, await fontFor(a.fontFamily));
        break;
      case 'image':
      case 'signature': {
        const img = await imageFor(a.imageId);
        if (img) drawImage(frame, a, img);
        break;
      }
      case 'draw':
        drawPolyline(frame, a);
        break;
      case 'highlight':
        drawHighlight(frame, a);
        break;
      case 'underline':
        drawHorizontalLine(frame, a, 1);
        break;
      case 'strikeout':
        drawHorizontalLine(frame, a, 0.5);
        break;
      case 'rect':
        drawRect(frame, a);
        break;
      case 'ellipse':
        drawEllipse(frame, a);
        break;
      case 'line':
        drawLine(frame, a, false);
        break;
      case 'arrow':
        drawLine(frame, a, true);
        break;
      case 'checkbox':
        drawCheckbox(frame, a);
        break;
      default:
        break;
    }
  }
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}
