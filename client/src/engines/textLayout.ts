/**
 * Shared text-layout reconstruction from the pdf.js text layer.
 *
 * `extractTextBlocks(doc, pageNumber)` returns positioned lines (with "cells" = runs of text
 * separated by wide gaps) and paragraph-like blocks for one page. All units are PDF points with
 * the origin at the top-left corner of the page (y grows downwards), so callers can map them
 * straight onto Word/PowerPoint/Excel coordinates.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export interface TextCell {
  /** left edge (pt, from page left) */
  x: number;
  /** top edge (pt, from page top) */
  y: number;
  w: number;
  h: number;
  fontSize: number;
  text: string;
  bold: boolean;
}

export interface TextLine {
  x: number;
  y: number;
  w: number;
  h: number;
  /** dominant font size on the line */
  fontSize: number;
  /** baseline position (pt from page top) */
  baseline: number;
  text: string;
  bold: boolean;
  /** runs of text separated by wide horizontal gaps (table cells, key/value pairs) */
  cells: TextCell[];
}

export type BlockKind = 'paragraph' | 'heading' | 'bullet' | 'numbered';

export interface TextBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  /** paragraph text, lines joined with a single space */
  text: string;
  bold: boolean;
  kind: BlockKind;
  /** 1 = largest heading … 3 = smallest; only for kind 'heading' */
  headingLevel?: 1 | 2 | 3;
  lines: TextLine[];
  /** distance between consecutive baselines (pt); equals fontSize * 1.2 for single lines */
  linePitch: number;
}

export interface PageTextLayout {
  /** page width in points (after rotation) */
  width: number;
  /** page height in points (after rotation) */
  height: number;
  lines: TextLine[];
  blocks: TextBlock[];
  /** character-weighted median font size on the page (0 when there is no text) */
  medianFontSize: number;
  /** median glyph advance (pt) – useful for column clustering */
  medianCharWidth: number;
  hasText: boolean;
}

interface RawItem {
  x: number;
  baseline: number;
  w: number;
  fontSize: number;
  text: string;
  bold: boolean;
}

const BULLET_RE = /^([•·\-–—▪○●◦■□➢➤►*])\s+/;
const NUMBERED_RE = /^(\(?\d{1,3}[.)]|[a-zA-Z][.)]|\(?[ivxIVX]{1,5}\))\s+/;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Weighted median: each value counts `weight` times. */
function weightedMedian(pairs: { value: number; weight: number }[]): number {
  if (!pairs.length) return 0;
  const s = [...pairs].sort((a, b) => a.value - b.value);
  const total = s.reduce((acc, p) => acc + p.weight, 0);
  let acc = 0;
  for (const p of s) {
    acc += p.weight;
    if (acc >= total / 2) return p.value;
  }
  return s[s.length - 1].value;
}

async function fontIsBold(page: PDFPageProxy, fontName: string, cache: Map<string, boolean>, ensureFonts: () => Promise<void>): Promise<boolean> {
  const hit = cache.get(fontName);
  if (hit !== undefined) return hit;
  let bold = false;
  try {
    if (!page.commonObjs.has(fontName)) await ensureFonts();
    if (page.commonObjs.has(fontName)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const font = page.commonObjs.get(fontName) as any;
      const name: string = font?.name ?? '';
      bold = Boolean(font?.bold) || /bold|black|heavy|semibold|demibold|extrabold/i.test(name);
    }
  } catch {
    bold = false;
  }
  cache.set(fontName, bold);
  return bold;
}

/**
 * Extract positioned text items from one page and group them into lines / cells / blocks.
 */
export async function extractTextBlocks(doc: PDFDocumentProxy, pageNumber: number): Promise<PageTextLayout> {
  const page = await doc.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const width = viewport.width;
    const height = viewport.height;
    const content = await page.getTextContent();
    const vt = viewport.transform; // maps PDF user space → top-left device space (scale 1)

    const boldCache = new Map<string, boolean>();
    let fontsLoaded = false;
    const ensureFonts = async () => {
      if (fontsLoaded) return;
      fontsLoaded = true;
      try {
        await page.getOperatorList(); // loads the page fonts into commonObjs (best effort)
      } catch {
        /* ignore – bold detection is optional */
      }
    };

    const items: RawItem[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const text = it.str;
      if (!text || !text.trim()) continue; // pdf.js inserts synthetic whitespace items for gaps
      const t = it.transform;
      // combined matrix = viewport × text matrix
      const a = vt[0] * t[0] + vt[2] * t[1];
      const b = vt[1] * t[0] + vt[3] * t[1];
      const c = vt[0] * t[2] + vt[2] * t[3];
      const d = vt[1] * t[2] + vt[3] * t[3];
      const x = vt[0] * t[4] + vt[2] * t[5] + vt[4];
      const y = vt[1] * t[4] + vt[3] * t[5] + vt[5];
      const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 10;
      if (!(fontSize > 0.5)) continue;
      const w = it.width > 0 ? it.width : (it.height || fontSize) * 0.5 * text.length;
      const bold = await fontIsBold(page, it.fontName, boldCache, ensureFonts);
      items.push({ x, baseline: y, w, fontSize, text, bold });
    }

    const medianFontSize = weightedMedian(items.map((i) => ({ value: i.fontSize, weight: i.text.length })));
    const medianCharWidth = median(items.filter((i) => i.text.trim().length > 0).map((i) => i.w / Math.max(1, i.text.length)));

    const lines = buildLines(items);
    const blocks = buildBlocks(lines, medianFontSize);
    return { width, height, lines, blocks, medianFontSize, medianCharWidth, hasText: items.length > 0 };
  } finally {
    page.cleanup();
  }
}

/** Group items into lines by baseline (tolerance 0.5 × font size), then into cells by gap. */
function buildLines(items: RawItem[]): TextLine[] {
  const sorted = [...items].sort((p, q) => p.baseline - q.baseline || p.x - q.x);
  const groups: RawItem[][] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g) {
      const ref = g[g.length - 1];
      const tol = 0.5 * Math.min(ref.fontSize, it.fontSize);
      // Compare with the running average baseline so slightly super/subscripted items still join.
      const avg = g.reduce((acc, r) => acc + r.baseline, 0) / g.length;
      if (Math.abs(it.baseline - avg) <= Math.max(tol, 1.5)) {
        g.push(it);
        continue;
      }
    }
    groups.push([it]);
  }

  const lines: TextLine[] = [];
  for (const g of groups) {
    g.sort((p, q) => p.x - q.x);
    const fontSize = weightedMedian(g.map((i) => ({ value: i.fontSize, weight: i.text.length })));
    const baseline = g.reduce((acc, r) => acc + r.baseline, 0) / g.length;
    const cells: TextCell[] = [];
    let cur: { x: number; right: number; parts: string[]; fontSize: number; boldChars: number; chars: number } | null = null;
    for (const it of g) {
      const gap = cur ? it.x - cur.right : 0;
      const cellBreak = cur ? gap > 1.2 * Math.max(it.fontSize, cur.fontSize) : false;
      if (!cur || cellBreak) {
        if (cur) cells.push(finishCell(cur, baseline));
        cur = { x: it.x, right: it.x + it.w, parts: [it.text], fontSize: it.fontSize, boldChars: it.bold ? it.text.length : 0, chars: it.text.length };
        continue;
      }
      const needsSpace = gap > 0.2 * Math.min(it.fontSize, cur.fontSize) && !/\s$/.test(cur.parts[cur.parts.length - 1]) && !/^\s/.test(it.text);
      cur.parts.push(needsSpace ? ` ${it.text}` : it.text);
      cur.right = Math.max(cur.right, it.x + it.w);
      cur.fontSize = Math.max(cur.fontSize, it.fontSize);
      cur.chars += it.text.length;
      if (it.bold) cur.boldChars += it.text.length;
    }
    if (cur) cells.push(finishCell(cur, baseline));
    if (!cells.length) continue;
    const x = cells[0].x;
    const right = Math.max(...cells.map((c) => c.x + c.w));
    const chars = cells.reduce((acc, c) => acc + c.text.length, 0);
    const boldChars = cells.reduce((acc, c) => acc + (c.bold ? c.text.length : 0), 0);
    lines.push({
      x,
      y: baseline - fontSize * 0.8,
      w: right - x,
      h: fontSize,
      fontSize,
      baseline,
      text: cells.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim(),
      bold: chars > 0 && boldChars / chars >= 0.6,
      cells,
    });
  }
  return lines;
}

function finishCell(c: { x: number; right: number; parts: string[]; fontSize: number; boldChars: number; chars: number }, baseline: number): TextCell {
  const text = c.parts.join('').replace(/\s+/g, ' ').trim();
  return { x: c.x, y: baseline - c.fontSize * 0.8, w: Math.max(1, c.right - c.x), h: c.fontSize, fontSize: c.fontSize, text, bold: c.chars > 0 && c.boldChars / c.chars >= 0.6 };
}

function classify(line: TextLine, medianFontSize: number): { kind: BlockKind; headingLevel?: 1 | 2 | 3 } {
  if (BULLET_RE.test(line.text)) return { kind: 'bullet' };
  if (NUMBERED_RE.test(line.text) && line.text.length > 3) return { kind: 'numbered' };
  if (medianFontSize > 0 && line.fontSize >= 1.3 * medianFontSize && line.text.length <= 200) {
    const ratio = line.fontSize / medianFontSize;
    return { kind: 'heading', headingLevel: ratio >= 1.8 ? 1 : ratio >= 1.5 ? 2 : 3 };
  }
  return { kind: 'paragraph' };
}

/** Merge consecutive lines into paragraphs / headings / list items. */
function buildBlocks(lines: TextLine[], medianFontSize: number): TextBlock[] {
  const blocks: TextBlock[] = [];
  if (!lines.length) return blocks;
  const columnRight = Math.max(...lines.map((l) => l.x + l.w));
  const columnLeft = Math.min(...lines.map((l) => l.x));
  const columnWidth = Math.max(1, columnRight - columnLeft);

  let cur: TextBlock | null = null;
  let curKind: { kind: BlockKind; headingLevel?: 1 | 2 | 3 } | null = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
    curKind = null;
  };

  for (const line of lines) {
    const cls = classify(line, medianFontSize);
    if (cur && curKind) {
      const prev = cur.lines[cur.lines.length - 1];
      const gap = line.baseline - prev.baseline;
      const lh = Math.max(prev.fontSize, line.fontSize);
      const sameSize = Math.abs(line.fontSize - prev.fontSize) <= 0.15 * lh;
      const endsSentence = /[.!?:;]["'”’)\]]?$/.test(prev.text);
      const prevShort = prev.x + prev.w < columnRight - 0.2 * columnWidth;
      const indented = line.x - prev.x > 1.5 * lh;
      const continuesList = (curKind.kind === 'bullet' || curKind.kind === 'numbered') && cls.kind === 'paragraph' && line.x > prev.x + 0.5 * lh;
      let merge = gap > 0 && gap < 1.6 * lh && sameSize && !indented;
      if (merge && cls.kind !== 'paragraph') merge = false; // a heading/bullet always starts a block
      if (merge && curKind.kind === 'heading') merge = false; // headings stay single-line (a 2nd big line starts a new one)
      if (merge && (curKind.kind === 'bullet' || curKind.kind === 'numbered') && !continuesList) merge = false;
      if (merge && endsSentence && prevShort) merge = false;
      if (merge) {
        cur.lines.push(line);
        cur.text = `${cur.text} ${line.text}`.replace(/\s+/g, ' ').trim();
        cur.x = Math.min(cur.x, line.x);
        cur.w = Math.max(cur.x + cur.w, line.x + line.w) - cur.x;
        cur.h = line.y + line.h - cur.y;
        cur.linePitch = (line.baseline - cur.lines[0].baseline) / (cur.lines.length - 1);
        continue;
      }
      flush();
    }
    let text = line.text;
    if (cls.kind === 'bullet') text = text.replace(BULLET_RE, '');
    else if (cls.kind === 'numbered') text = text.replace(NUMBERED_RE, '');
    cur = {
      x: line.x,
      y: line.y,
      w: line.w,
      h: line.h,
      fontSize: line.fontSize,
      text,
      bold: line.bold || cls.kind === 'heading',
      kind: cls.kind,
      headingLevel: cls.headingLevel,
      lines: [line],
      linePitch: line.fontSize * 1.2,
    };
    curKind = cls;
  }
  flush();
  return blocks;
}

/** Parse a cell string into a number when it looks numeric ("1,234.50", "12%", "-3", "(45)"). */
export function parseNumeric(text: string): { value: number; percent: boolean } | null {
  const s = text.trim();
  if (!s || s.length > 40) return null;
  const m = /^([-+−]?)\(?\s*([$€£¥₹]?)\s*(\d{1,3}(?:[,\s]\d{3})+|\d+)(\.\d+)?\s*(%?)\s*\)?$/.exec(s);
  if (!m) return null;
  const negativeParens = /^\(.*\)$/.test(s);
  const sign = m[1] === '-' || m[1] === '−' || negativeParens ? -1 : 1;
  const intPart = m[3].replace(/[,\s]/g, '');
  const value = sign * Number(`${intPart}${m[4] ?? ''}`);
  if (!Number.isFinite(value)) return null;
  return { value, percent: m[5] === '%' };
}
