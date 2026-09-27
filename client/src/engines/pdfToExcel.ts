/**
 * PDF -> XLSX (SheetJS). Tables are detected from the positions of the text runs:
 * rows = lines, columns = clustered x-start positions, a table = >= 3 consecutive rows with
 * >= 2 cells aligned to the shared columns. Everything else is exported row by row so no
 * text is lost.
 */
import type * as XLSXTypes from 'xlsx';
import { assertNotAborted, engineError } from './common';
import { openPdfDocument } from './render';
import { extractTextBlocks, parseNumeric, type PageTextLayout, type TextLine } from './textLayout';

export interface PdfToExcelOptions {
  sheetPerPage: boolean;
  signal?: AbortSignal;
  onProgress?: (stage: string, fraction: number | null) => void;
}

export interface PdfToExcelResult {
  blob: Blob;
  warnings: string[];
  sheets: number;
  tablesFound: number;
}

type CellValue = string | number | XLSXTypes.CellObject;
type Row = CellValue[];

const NO_TEXT_WARNING = 'No text layer found – run OCR first.';
const NO_TABLE_WARNING = 'No clear tables were detected; text was exported row by row.';
const COLUMN_TOLERANCE = 8; // pt
const MIN_TABLE_ROWS = 3;

export async function pdfToExcel(bytes: Uint8Array, opts: PdfToExcelOptions): Promise<PdfToExcelResult> {
  const XLSX = await import('xlsx');
  const doc = await openPdfDocument(bytes);
  const warnings: string[] = [];
  try {
    opts.onProgress?.('Reading text...', 0);
    const layouts: PageTextLayout[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      assertNotAborted(opts.signal);
      try {
        layouts.push(await extractTextBlocks(doc, p));
      } catch {
        throw engineError('CONVERSION_FAILED', `The text of page ${p} could not be read.`);
      }
      opts.onProgress?.('Reading text...', p / doc.numPages);
    }

    opts.onProgress?.('Detecting tables...', null);
    const wb = XLSX.utils.book_new();
    let tablesFound = 0;
    const anyText = layouts.some((l) => l.hasText);
    const pagesWithoutText = layouts.map((l, i) => (l.hasText ? 0 : i + 1)).filter(Boolean);

    const makeSheet = (rows: Row[]): XLSXTypes.WorkSheet => {
      const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['']]);
      const colCount = rows.reduce((acc, r) => Math.max(acc, r.length), 1);
      const widths: number[] = new Array(colCount).fill(0);
      for (const r of rows) {
        r.forEach((c, i) => {
          const len = cellText(c).length;
          if (len > widths[i]) widths[i] = len;
        });
      }
      ws['!cols'] = widths.map((w) => ({ wch: Math.min(80, Math.max(8, w + 2)) }));
      return ws;
    };

    if (!anyText) {
      const ws = XLSX.utils.aoa_to_sheet([[NO_TEXT_WARNING]]);
      ws['!cols'] = [{ wch: 40 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Data');
      warnings.push(NO_TEXT_WARNING);
    } else {
      const perPage = layouts.map((layout) => pageToRows(layout));
      tablesFound = perPage.reduce((acc, p) => acc + p.tables, 0);
      if (opts.sheetPerPage) {
        perPage.forEach((p, i) => {
          const rows = p.rows.length ? p.rows : [[layouts[i].hasText ? '' : NO_TEXT_WARNING]];
          XLSX.utils.book_append_sheet(wb, makeSheet(rows), `Page ${i + 1}`);
        });
      } else {
        const all: Row[] = [];
        perPage.forEach((p, i) => {
          if (i > 0) all.push([]);
          if (p.rows.length) all.push(...p.rows);
          else all.push([layouts[i].hasText ? '' : `Page ${i + 1}: ${NO_TEXT_WARNING}`]);
        });
        XLSX.utils.book_append_sheet(wb, makeSheet(all), 'Data');
      }
      if (pagesWithoutText.length) warnings.push(`No text layer on page${pagesWithoutText.length > 1 ? 's' : ''} ${pagesWithoutText.join(', ')} – run OCR first.`);
      if (!tablesFound) warnings.push(NO_TABLE_WARNING);
    }

    assertNotAborted(opts.signal);
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    return { blob, warnings, sheets: wb.SheetNames.length, tablesFound };
  } finally {
    await doc.destroy();
  }
}

function cellText(c: CellValue): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  return c.w ?? (c.v === undefined ? '' : String(c.v));
}

function toCell(text: string): CellValue {
  const num = parseNumeric(text);
  if (!num) return text;
  if (num.percent) return { t: 'n', v: num.value / 100, z: Number.isInteger(num.value) ? '0%' : '0.00%' } satisfies XLSXTypes.CellObject;
  return num.value;
}

/** 1-D clustering of x positions; returns sorted cluster centres. */
function clusterColumns(xs: number[], gapThreshold: number): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const centres: number[] = [];
  let cluster: number[] = [];
  for (const x of sorted) {
    if (cluster.length && x - cluster[cluster.length - 1] > gapThreshold) {
      centres.push(cluster.reduce((a, b) => a + b, 0) / cluster.length);
      cluster = [];
    }
    cluster.push(x);
  }
  if (cluster.length) centres.push(cluster.reduce((a, b) => a + b, 0) / cluster.length);
  return centres;
}

function nearestColumn(x: number, columns: number[]): { index: number; distance: number } {
  let best = 0;
  let bestD = Infinity;
  columns.forEach((c, i) => {
    const d = Math.abs(x - c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return { index: best, distance: bestD };
}

export function pageToRows(layout: PageTextLayout): { rows: Row[]; tables: number } {
  const lines = layout.lines;
  if (!lines.length) return { rows: [], tables: 0 };
  const gap = Math.max(4, 1.2 * (layout.medianCharWidth || 5));
  const columns = clusterColumns(
    lines.flatMap((l) => l.cells.map((c) => c.x)),
    gap,
  );

  // Candidate table rows: >= 2 cells, each aligned with a shared column boundary.
  const isCandidate = (line: TextLine) => line.cells.length >= 2 && line.cells.every((c) => nearestColumn(c.x, columns).distance <= COLUMN_TOLERANCE);

  const rows: Row[] = [];
  let tables = 0;
  let i = 0;
  while (i < lines.length) {
    if (!isCandidate(lines[i])) {
      rows.push([lines[i].text]);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && isCandidate(lines[j])) j++;
    const region = lines.slice(i, j);
    if (region.length >= MIN_TABLE_ROWS && sharesColumns(region, columns)) {
      tables++;
      rows.push(...regionToRows(region, columns));
    } else {
      for (const line of region) rows.push([line.text]);
    }
    i = j;
  }
  return { rows, tables };
}

/** A real table region reuses the same columns across rows (not just any multi-cell lines). */
function sharesColumns(region: TextLine[], columns: number[]): boolean {
  const usage = new Map<number, number>();
  for (const line of region) {
    const used = new Set(line.cells.map((c) => nearestColumn(c.x, columns).index));
    for (const idx of used) usage.set(idx, (usage.get(idx) ?? 0) + 1);
  }
  const shared = [...usage.values()].filter((n) => n >= 2).length;
  return shared >= 2;
}

function regionToRows(region: TextLine[], columns: number[]): Row[] {
  const used = new Set<number>();
  const mapped = region.map((line) => line.cells.map((c) => ({ col: nearestColumn(c.x, columns).index, text: c.text })));
  for (const m of mapped) for (const c of m) used.add(c.col);
  const order = [...used].sort((a, b) => a - b);
  const position = new Map(order.map((col, i) => [col, i]));
  return mapped.map((cells) => {
    const row: string[] = new Array(order.length).fill('');
    for (const c of cells) {
      const p = position.get(c.col) ?? 0;
      row[p] = row[p] ? `${row[p]} ${c.text}` : c.text;
    }
    return row.map((t) => toCell(t));
  });
}
