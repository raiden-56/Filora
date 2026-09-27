import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { extractBinaryText, odfXmlToBlocks, parsePptxSlide, rtfToText, sheetsToPdf, slidesToPdf } from './office';

const SLIDE_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function slideXml(title: string, bullets: string[], extra = ''): string {
  const body = bullets.map((b) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${b}</a:t></a:r></a:p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${SLIDE_NS}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>
${extra}
</p:spTree></p:cSld></p:sld>`;
}

describe('office text extractors', () => {
  it('rtfToText strips control words, groups and decodes escapes', () => {
    const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\fswiss Arial;}}{\colortbl;\red0\green0\blue0;}{\*\generator PDFly test;}\pard\f0\fs24 Hello from RTF\par Caf\'e9 with {\b bold} words\line and a line break\par}`;
    expect(rtfToText(rtf)).toBe('Hello from RTF\nCaf' + String.fromCharCode(233) + ' with bold words\nand a line break\n');
  });

  it('odfXmlToBlocks maps headings, paragraphs and lists', () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:automatic-styles><style:style/></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">ODT Heading</text:h><text:p>Body paragraph from ODT &amp; entities.</text:p><text:list><text:list-item><text:p>List item one</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`;
    expect(odfXmlToBlocks(content)).toEqual([
      { text: 'ODT Heading', style: 'h1' },
      { text: 'Body paragraph from ODT & entities.', style: 'p' },
      { text: 'List item one', style: 'li' },
    ]);
  });

  it('extractBinaryText keeps readable 8-bit and UTF-16 runs and drops noise', () => {
    const header = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    const ascii = [...'Legacy document text here.\r'].map((c) => c.charCodeAt(0));
    const utf16: number[] = [];
    for (const ch of 'A unicode run inside the file') utf16.push(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8);
    const noise = [...'Times New Roman'].map((c) => c.charCodeAt(0));
    const buf = Uint8Array.from([...header, ...new Array(600).fill(0), ...ascii, ...new Array(9).fill(0), ...utf16, ...new Array(64).fill(0), ...noise, 0, 0, 0, 0]);
    const lines = extractBinaryText(buf);
    expect(lines).toContain('Legacy document text here.');
    expect(lines).toContain('A unicode run inside the file');
    expect(lines).not.toContain('Times New Roman');
  });

  it('parsePptxSlide reads the title, bullets, tables and the picture relationship', () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr/></p:pic>`;
    const tbl = `<p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Cell A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Cell B</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>`;
    const parsed = parsePptxSlide(slideXml('Welcome Slide', ['First bullet', 'Second &amp; last'], pic + tbl));
    expect(parsed.title).toBe('Welcome Slide');
    expect(parsed.blocks).toEqual([
      { text: 'First bullet', style: 'li' },
      { text: 'Second & last', style: 'li' },
      { text: 'Cell A | Cell B', style: 'p' },
    ]);
    expect(parsed.imageRel).toBe('rId2');
    expect(parsed.hidden).toBe(false);
  });
});

describe('office PDF renderers', () => {
  it('slidesToPdf renders one 16:9 page per slide', async () => {
    const pdf = await slidesToPdf([{ title: 'One', blocks: [{ text: 'Point', style: 'li' }] }, { title: 'Two', blocks: [] }], 'Deck');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 960, height: 540 });
    expect(doc.getTitle()).toBe('Deck');
  });

  it('sheetsToPdf paginates wide and long sheets', async () => {
    const cols = 20;
    const header = Array.from({ length: cols }, (_, i) => `Column${i + 1}`);
    const rows = Array.from({ length: 120 }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r + 1}c${c + 1}`));
    const pdf = await sheetsToPdf([{ name: 'Wide', rows: [header, ...rows] }, { name: 'Empty', rows: [] }], 'Book');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(5);
    // 20 columns > 6 -> landscape
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });
});
