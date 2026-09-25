import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { pdfToPptx } from './pdfToPpt.js';

/** Minimal ZIP reader (central directory + stored/deflate entries). */
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

const TITLE = 'Slide One Title';
const BODY = 'Some body text on the first page';
const P2 = 'Second page content';

async function makePdf(dir: string): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const p1 = pdf.addPage([792, 612]); // landscape Letter
  p1.drawText(TITLE, { x: 60, y: 540, size: 28, font: bold });
  p1.drawText(BODY, { x: 60, y: 480, size: 14, font });
  const p2 = pdf.addPage([792, 612]);
  p2.drawText(P2, { x: 60, y: 540, size: 20, font });
  const file = path.join(dir, 'in.pdf');
  await writeFile(file, await pdf.save());
  return file;
}

const slideEntries = (zip: Map<string, Buffer>) => [...zip.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort();

describe('pdfToPptx', () => {
  let dir: string;
  let pdfPath: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pdfly-pptx-'));
    pdfPath = await makePdf(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('image mode: one image slide per page, layout follows the page aspect ratio', async () => {
    const work = path.join(dir, 'image');
    await mkdir(work);
    const r = await pdfToPptx(pdfPath, work, { mode: 'image', dpi: 72 });
    expect(r.slides).toBe(2);
    expect(r.pptxPath).toBe(path.join(work, 'output.pptx'));
    expect((await stat(r.pptxPath)).size).toBeGreaterThan(0);
    const zip = readZip(await readFile(r.pptxPath));
    expect(slideEntries(zip)).toHaveLength(2);
    const media = [...zip.keys()].filter((k) => k.startsWith('ppt/media/'));
    expect(media.length).toBeGreaterThanOrEqual(2);
    const pres = zip.get('ppt/presentation.xml')!.toString('utf8');
    const m = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres);
    expect(m).not.toBeNull();
    // 11in x 8.5in in EMU (914400 per inch)
    expect(Number(m![1])).toBe(11 * 914400);
    expect(Number(m![2])).toBe(8.5 * 914400);
    expect(zip.get('ppt/slides/slide1.xml')!.toString('utf8')).toContain('<p:pic>');
  });

  it('text mode: places the page text into editable text boxes', async () => {
    const work = path.join(dir, 'text');
    await mkdir(work);
    const r = await pdfToPptx(pdfPath, work, { mode: 'text', dpi: 150 });
    expect(r.slides).toBe(2);
    const zip = readZip(await readFile(r.pptxPath));
    expect(slideEntries(zip)).toHaveLength(2);
    const s1 = zip.get('ppt/slides/slide1.xml')!.toString('utf8');
    expect(s1).toContain(TITLE);
    expect(s1).toContain(BODY);
    expect(s1).toContain('<p:sp>');
    expect(s1).not.toContain('<p:pic>');
    const s2 = zip.get('ppt/slides/slide2.xml')!.toString('utf8');
    expect(s2).toContain(P2);
  });

  it('both mode: page image as background plus text boxes', async () => {
    const work = path.join(dir, 'both');
    await mkdir(work);
    const r = await pdfToPptx(pdfPath, work, { mode: 'both', dpi: 96 });
    expect(r.slides).toBe(2);
    const zip = readZip(await readFile(r.pptxPath));
    expect(slideEntries(zip)).toHaveLength(2);
    const s1 = zip.get('ppt/slides/slide1.xml')!.toString('utf8');
    expect(s1).toContain(TITLE);
    expect(s1).toContain('<p:bg>');
    const rels = zip.get('ppt/slides/_rels/slide1.xml.rels')!.toString('utf8');
    expect(rels).toMatch(/relationships\/image" Target="[^"]*media\/[^"]+\.png"/);
  });
});
