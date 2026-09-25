import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import { officeToPdf } from './office.js';
import { rtfToText, extractBinaryText, odfXmlToBlocks } from './office.js';
import { writeZip } from '../../utils/zip.js';
import { createWorkDir } from '../../utils/tmp.js';
import { extractText } from '../render.js';
import { closeBrowser } from './htmlToPdf.js';

let dir: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const w = await createWorkDir('office-test');
  dir = w.dir;
  cleanup = w.cleanup;
});

afterAll(async () => {
  await closeBrowser();
  await cleanup();
});

async function textOf(pdfPath: string): Promise<{ pages: number; text: string; doc: PDFDocument }> {
  const bytes = await readFile(pdfPath);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const doc = await PDFDocument.load(bytes);
  const pages = await extractText(new Uint8Array(bytes));
  return { pages: doc.getPageCount(), text: pages.map((p) => p.text).join('\n'), doc };
}

const SLIDE_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function slideXml(title: string, bullets: string[], extra = ''): string {
  const body = bullets.map((b) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${b}</a:t></a:r></a:p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${SLIDE_NS}><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>
${extra}
</p:spTree></p:cSld></p:sld>`;
}

describe('officeToPdf', () => {
  it('converts a .docx (word) to a PDF with the document text', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Quarterly Report', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('The revenue increased substantially this quarter.'),
            new Paragraph({ children: [new TextRun({ text: 'Second paragraph with ' }), new TextRun({ text: 'bold text', bold: true })] }),
            new Paragraph({ text: 'First bullet', bullet: { level: 0 } }),
            new Paragraph({ text: 'Second bullet', bullet: { level: 0 } }),
          ],
        },
      ],
    });
    const input = path.join(dir, 'report.docx');
    await writeFile(input, await Packer.toBuffer(doc));
    const r = await officeToPdf(input, 'Quarterly report.docx', 'word', dir);
    expect(['libreoffice', 'js']).toContain(r.engine);
    expect(r.pdfPath.startsWith(dir)).toBe(true);
    if (r.engine === 'js') expect(r.warnings).toContain('Converted without LibreOffice: layout fidelity is reduced.');
    const { pages, text } = await textOf(r.pdfPath);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(text).toContain('Quarterly Report');
    expect(text).toContain('revenue increased');
    expect(text).toContain('bold text');
    expect(text).toContain('Second bullet');
  });

  it('converts an .xlsx (excel) to a PDF with cell contents', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Qty', 'Price'],
      ['Widget', 3, 4.5],
      ['Gadget', 10, 12],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    const ws2 = XLSX.utils.aoa_to_sheet([['Only', 'Two'], ['a', 'b']]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Second');
    const input = path.join(dir, 'inventory.xlsx');
    await writeFile(input, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    const r = await officeToPdf(input, 'inventory.xlsx', 'excel', dir);
    expect(['libreoffice', 'js']).toContain(r.engine);
    const { pages, text } = await textOf(r.pdfPath);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Widget');
    expect(text).toContain('Gadget');
    expect(text).toContain('Inventory');
    expect(text).toContain('Second');
  });

  it('converts a wide .csv with many columns and rows (excel) and paginates', async () => {
    const cols = 20;
    const header = Array.from({ length: cols }, (_, i) => `Column${i + 1}`);
    const rows = Array.from({ length: 120 }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r + 1}c${c + 1}`));
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const input = path.join(dir, 'wide.csv');
    await writeFile(input, csv, 'utf8');
    const r = await officeToPdf(input, 'wide.csv', 'excel', dir);
    const { pages, text } = await textOf(r.pdfPath);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Column1');
    expect(text).toContain('Column20');
    expect(text).toContain('r120c20');
  });

  it('converts a hand-built .pptx (powerpoint) into one 16:9 page per slide', async () => {
    // tiny 1x1 PNG so the picture path is exercised
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr/></p:pic>`;
    const zip = writeZip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>' },
      { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${SLIDE_NS}></p:presentation>` },
      { name: 'ppt/slides/slide1.xml', data: slideXml('Welcome Slide', ['First bullet point', 'Second &amp; last']) },
      { name: 'ppt/slides/slide10.xml', data: slideXml('Tenth Slide', ['Sorted numerically']) },
      { name: 'ppt/slides/slide2.xml', data: slideXml('Picture Slide', ['Has an image'], pic) },
      { name: 'ppt/slides/_rels/slide2.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>' },
      { name: 'ppt/media/image1.png', data: png },
    ]);
    const input = path.join(dir, 'deck.pptx');
    await writeFile(input, zip);
    const r = await officeToPdf(input, 'deck.pptx', 'powerpoint', dir);
    const { pages, text, doc } = await textOf(r.pdfPath);
    expect(pages).toBe(3);
    if (r.engine === 'js') {
      const { width, height } = doc.getPage(0).getSize();
      expect(width).toBe(960);
      expect(height).toBe(540);
      const pageTexts = await extractText(new Uint8Array(await readFile(r.pdfPath)));
      expect(pageTexts[0].text).toContain('Welcome Slide');
      expect(pageTexts[1].text).toContain('Picture Slide');
      expect(pageTexts[2].text).toContain('Tenth Slide');
    }
    expect(text).toContain('Welcome Slide');
    expect(text).toContain('First bullet point');
    expect(text).toContain('Second & last');
    expect(text).toContain('Has an image');
  });

  it('converts an .rtf (word) via the RTF text extractor', async () => {
    const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\fswiss Arial;}}{\colortbl;\red0\green0\blue0;}{\*\generator PDFly test;}\pard\f0\fs24 Hello from RTF\par Caf\'e9 with {\b bold} words\line and a line break\par}`;
    expect(rtfToText(rtf)).toBe('Hello from RTF\nCaf' + String.fromCharCode(233) + ' with bold words\nand a line break\n');
    const input = path.join(dir, 'note.rtf');
    await writeFile(input, rtf, 'latin1');
    const r = await officeToPdf(input, 'note.rtf', 'word', dir);
    const { pages, text } = await textOf(r.pdfPath);
    expect(pages).toBe(1);
    expect(text).toContain('Hello from RTF');
    expect(text).toContain('bold words');
    expect(text).not.toContain('generator');
    expect(text).not.toContain('Arial');
  });

  it('converts an .odt (word) by reading content.xml from the zip', async () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:automatic-styles><style:style/></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">ODT Heading</text:h><text:p>Body paragraph from ODT &amp; entities.</text:p><text:list><text:list-item><text:p>List item one</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`;
    const blocks = odfXmlToBlocks(content);
    expect(blocks).toEqual([
      { text: 'ODT Heading', style: 'h1' },
      { text: 'Body paragraph from ODT & entities.', style: 'p' },
      { text: 'List item one', style: 'li' },
    ]);
    const zip = writeZip([
      { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
      { name: 'content.xml', data: content },
    ]);
    const input = path.join(dir, 'doc.odt');
    await writeFile(input, zip);
    const r = await officeToPdf(input, 'doc.odt', 'word', dir);
    const { text } = await textOf(r.pdfPath);
    expect(text).toContain('ODT Heading');
    expect(text).toContain('Body paragraph from ODT');
    expect(text).toContain('List item one');
  });

  it('extracts readable text from a legacy binary .doc (best effort) with a warning', async () => {
    const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const junk = Buffer.alloc(600, 0);
    const ascii = Buffer.from('Legacy document text here.\r', 'latin1');
    const utf16 = Buffer.from('A unicode run inside the file', 'utf16le');
    const buf = Buffer.concat([header, junk, ascii, Buffer.alloc(9, 0), utf16, Buffer.alloc(64, 0), Buffer.from('Times New Roman', 'latin1'), Buffer.alloc(4, 0)]);
    const lines = extractBinaryText(buf);
    expect(lines).toContain('Legacy document text here.');
    expect(lines).toContain('A unicode run inside the file');
    expect(lines).not.toContain('Times New Roman');
    const input = path.join(dir, 'old.doc');
    await writeFile(input, buf);
    const r = await officeToPdf(input, 'old.doc', 'word', dir);
    if (r.engine === 'js') {
      expect(r.warnings.some((w) => /legacy/i.test(w))).toBe(true);
      const { text } = await textOf(r.pdfPath);
      expect(text).toContain('Legacy document text here.');
    }
  });

  it('throws NO_FILE for a missing input', async () => {
    await expect(officeToPdf(path.join(dir, 'missing.docx'), 'missing.docx', 'word', dir)).rejects.toMatchObject({ code: 'NO_FILE' });
  });
});
