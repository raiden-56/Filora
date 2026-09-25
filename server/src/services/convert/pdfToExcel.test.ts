import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { pdfToExcel } from './pdfToExcel.js';

const GRID = [
  ['Item', 'Qty', 'Price'],
  ['Widget', '12', '1,234.50'],
  ['Gadget', '3', '-3'],
  ['Discount', '15%', '99'],
];
const PROSE_1 = 'This page contains only running prose without any tabular data at all.';
const PROSE_2 = 'It should still be exported one line per row so that nothing is lost.';

async function makePdf(dir: string): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([612, 792]);
  p1.drawText('Inventory table', { x: 72, y: 730, size: 16, font });
  const xs = [72, 250, 400];
  GRID.forEach((row, r) => {
    row.forEach((cell, c) => p1.drawText(cell, { x: xs[c], y: 680 - r * 20, size: 12, font }));
  });
  const p2 = pdf.addPage([612, 792]);
  p2.drawText(PROSE_1, { x: 72, y: 700, size: 12, font });
  p2.drawText(PROSE_2, { x: 72, y: 684, size: 12, font });
  const file = path.join(dir, 'in.pdf');
  await writeFile(file, await pdf.save());
  return file;
}

async function makeScannedPdf(dir: string): Promise<string> {
  const pdf = await PDFDocument.create();
  const p = pdf.addPage([612, 792]);
  p.drawRectangle({ x: 50, y: 50, width: 100, height: 100 });
  const file = path.join(dir, 'scan.pdf');
  await writeFile(file, await pdf.save());
  return file;
}

function sheetRows(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
}

describe('pdfToExcel', () => {
  let dir: string;
  let pdfPath: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pdfly-xlsx-'));
    pdfPath = await makePdf(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('detects the aligned grid as a table and stores numbers as numeric cells', async () => {
    const work = path.join(dir, 'perpage');
    await mkdir(work);
    const r = await pdfToExcel(pdfPath, work, { sheetPerPage: true });
    expect(r.xlsxPath).toBe(path.join(work, 'output.xlsx'));
    expect((await stat(r.xlsxPath)).size).toBeGreaterThan(0);
    expect(r.sheets).toBe(2);
    expect(r.tablesFound).toBeGreaterThanOrEqual(1);
    expect(r.warnings).not.toContain('No clear tables were detected; text was exported row by row.');

    const wb = XLSX.read(await readFile(r.xlsxPath), { type: 'buffer', cellStyles: true }); // cellStyles => '!cols' is read back
    expect(wb.SheetNames).toEqual(['Page 1', 'Page 2']);
    const rows = sheetRows(wb.Sheets['Page 1']);
    expect(rows[0][0]).toBe('Inventory table');
    expect(rows[0].slice(1).every((c) => c === '')).toBe(true); // title is a single-cell row
    const header = rows.findIndex((row) => row[0] === 'Item');
    expect(header).toBeGreaterThan(0);
    expect(rows[header]).toEqual(['Item', 'Qty', 'Price']);
    expect(rows[header + 1]).toEqual(['Widget', 12, 1234.5]);
    expect(rows[header + 2]).toEqual(['Gadget', 3, -3]);
    expect(rows[header + 3][0]).toBe('Discount');
    expect(rows[header + 3][1]).toBeCloseTo(0.15); // 15% stored as a percentage number
    expect(rows[header + 3][2]).toBe(99);
    expect(typeof rows[header + 1][2]).toBe('number');
    expect(wb.Sheets['Page 1']['!cols']?.length).toBe(3);

    // prose page: no table, but every line exported as a single-cell row
    const prose = sheetRows(wb.Sheets['Page 2']);
    expect(prose.map((r) => r[0])).toEqual([PROSE_1, PROSE_2]);
    expect(prose.every((r) => r.slice(1).every((c) => c === ''))).toBe(true);
  });

  it('single-sheet mode separates pages with a blank row; a prose-only PDF reports no tables', async () => {
    const work = path.join(dir, 'single');
    await mkdir(work);
    const r = await pdfToExcel(pdfPath, work, { sheetPerPage: false });
    expect(r.sheets).toBe(1);
    const wb = XLSX.read(await readFile(r.xlsxPath), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Data']);
    const rows = sheetRows(wb.Sheets.Data);
    const idx = rows.findIndex((row) => row[0] === PROSE_1);
    expect(idx).toBeGreaterThan(0);
    expect(rows[idx - 1].every((c) => c === '')).toBe(true); // blank separator row

    // prose only
    const prosePdf = await PDFDocument.create();
    const font = await prosePdf.embedFont(StandardFonts.Helvetica);
    const p = prosePdf.addPage([612, 792]);
    p.drawText(PROSE_1, { x: 72, y: 700, size: 12, font });
    p.drawText(PROSE_2, { x: 72, y: 684, size: 12, font });
    const prosePath = path.join(dir, 'prose.pdf');
    await writeFile(prosePath, await prosePdf.save());
    const work2 = path.join(dir, 'prose');
    await mkdir(work2);
    const r2 = await pdfToExcel(prosePath, work2, { sheetPerPage: true });
    expect(r2.tablesFound).toBe(0);
    expect(r2.warnings).toContain('No clear tables were detected; text was exported row by row.');
    const wb2 = XLSX.read(await readFile(r2.xlsxPath), { type: 'buffer' });
    expect(sheetRows(wb2.Sheets['Page 1'])).toEqual([[PROSE_1], [PROSE_2]]);
  });

  it('scanned PDF (no text layer) still yields a valid workbook with a note', async () => {
    const scan = await makeScannedPdf(dir);
    const work = path.join(dir, 'scan');
    await mkdir(work);
    const r = await pdfToExcel(scan, work, { sheetPerPage: true });
    expect(r.tablesFound).toBe(0);
    expect(r.warnings).toContain('No text layer found – run OCR first.');
    const wb = XLSX.read(await readFile(r.xlsxPath), { type: 'buffer' });
    expect(wb.SheetNames).toHaveLength(1);
    const rows = sheetRows(wb.Sheets[wb.SheetNames[0]]);
    expect(rows[0][0]).toBe('No text layer found – run OCR first.');
  });
});
