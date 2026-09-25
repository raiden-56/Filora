import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { pdfToWord } from './pdfToWord.js';

/** Minimal ZIP reader (central directory + stored/deflate entries) – enough for OOXML packages. */
function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const ln = buf.readUInt16LE(localOff + 26);
    const le = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + ln + le;
    const data = buf.subarray(start, start + csize);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const HEADING = 'Quarterly Report Overview';
const PARA1_L1 = 'This document summarises the results of the quarter in detail and';
const PARA1_L2 = 'explains the main drivers behind the numbers reported below today.';
const PARA2_L1 = 'A second paragraph follows after a larger vertical gap and it also';
const PARA2_L2 = 'spans exactly two lines to exercise the paragraph merging logic.';
const BULLET1 = 'First bullet item';
const BULLET2 = 'Second bullet item';

async function makePdf(dir: string): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  page.drawText(HEADING, { x: 72, y: 720, size: 24, font: bold });
  page.drawText(PARA1_L1, { x: 72, y: 680, size: 12, font });
  page.drawText(PARA1_L2, { x: 72, y: 664, size: 12, font });
  page.drawText(PARA2_L1, { x: 72, y: 630, size: 12, font });
  page.drawText(PARA2_L2, { x: 72, y: 614, size: 12, font });
  page.drawText(`• ${BULLET1}`, { x: 90, y: 580, size: 12, font });
  page.drawText(`• ${BULLET2}`, { x: 90, y: 564, size: 12, font });
  // second page: only a rectangle, no text (simulates a scanned page)
  const p2 = pdf.addPage([612, 792]);
  p2.drawRectangle({ x: 100, y: 100, width: 200, height: 300 });
  const file = path.join(dir, 'in.pdf');
  await writeFile(file, await pdf.save());
  return file;
}

function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('pdfToWord (js engine)', () => {
  let dir: string;
  let pdfPath: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pdfly-docx-'));
    pdfPath = await makePdf(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('text mode: builds a DOCX with heading, merged paragraphs and bullets', async () => {
    const work = path.join(dir, 'text');
    await mkdir(work);
    const r = await pdfToWord(pdfPath, work, { mode: 'text' });
    expect(r.docxPath).toBe(path.join(work, 'output.docx'));
    expect((await stat(r.docxPath)).size).toBeGreaterThan(0);
    expect(r.pageCount).toBe(2);
    expect(['js', 'libreoffice']).toContain(r.engine);
    if (r.engine !== 'js') return; // LibreOffice output structure is not ours to assert on

    const zip = readZip(await readFile(r.docxPath));
    const xml = zip.get('word/document.xml')?.toString('utf8');
    expect(xml).toBeDefined();
    const text = xmlText(xml!);
    expect(text).toContain(HEADING);
    // the two lines of each paragraph are merged into one paragraph
    expect(text).toContain(`${PARA1_L1} ${PARA1_L2}`);
    expect(text).toContain(`${PARA2_L1} ${PARA2_L2}`);
    expect(text).toContain(BULLET1);
    expect(text).toContain(BULLET2);
    // heading style + numbering (bullets) present
    expect(xml).toMatch(/w:pStyle w:val="Heading[123]"/);
    expect(xml).toContain('<w:numPr>');
    // paragraphs are separate: paragraph 1 and paragraph 2 are not in the same <w:p>
    const paras = xml!.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
    const p1 = paras.find((p) => xmlText(p).includes(PARA1_L1));
    expect(p1).toBeDefined();
    expect(xmlText(p1!)).not.toContain(PARA2_L1);
    // bullet marker was stripped from the run text
    expect(text).not.toContain(`• ${BULLET1}`);
    // one section per page => two <w:sectPr>
    expect((xml!.match(/<w:sectPr/g) ?? []).length).toBe(2);
    // scanned page produced the OCR note and a warning
    expect(text).toContain('No text layer found on this page');
    expect(r.warnings.some((w) => /No text layer/.test(w))).toBe(true);
    expect(zip.has('word/numbering.xml')).toBe(true);
  });

  it('layout mode: embeds the page image before the editable text', async () => {
    const work = path.join(dir, 'layout');
    await mkdir(work);
    const r = await pdfToWord(pdfPath, work, { mode: 'layout' });
    expect((await stat(r.docxPath)).size).toBeGreaterThan(0);
    if (r.engine !== 'js') return;
    const zip = readZip(await readFile(r.docxPath));
    const xml = zip.get('word/document.xml')!.toString('utf8');
    const text = xmlText(xml);
    expect(text).toContain(HEADING);
    expect(text).toContain(`${PARA1_L1} ${PARA1_L2}`);
    const media = [...zip.keys()].filter((k) => k.startsWith('word/media/'));
    expect(media.length).toBeGreaterThanOrEqual(2); // one image per page
    expect(xml).toContain('<w:drawing>');
    expect(xml.indexOf('<w:drawing>')).toBeLessThan(xml.indexOf(HEADING));
  });
});
