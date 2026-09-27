import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { decodeHtmlEntities, htmlToBlocks, parseImageDataUri, plainTextToBlocks, sanitizeForFont, textToPdf, wrapText } from './textPdf';

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('htmlToBlocks', () => {
  it('converts simple HTML into structured blocks', () => {
    const html = `<!doctype html><html><head><title>Ignored</title><style>p{color:red}</style><script>alert(1)</script></head>
      <body><h1>Main &amp; Title</h1><p>First   paragraph<br>with break</p><h2>Sub</h2>
      <ul><li>One</li><li>Two &lt;b&gt;</li></ul><pre>  code
  block</pre><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><div>Tail &#169; &#x263A;</div></body></html>`;
    const blocks = htmlToBlocks(html);
    expect(blocks).toEqual([
      { text: 'Main & Title', style: 'h1' },
      { text: 'First paragraph\nwith break', style: 'p' },
      { text: 'Sub', style: 'h2' },
      { text: 'One', style: 'li' },
      { text: 'Two <b>', style: 'li' },
      { text: '  code\n  block', style: 'mono' },
      { text: 'A | B', style: 'p' },
      { text: '1 | 2', style: 'p' },
      { text: 'Tail ' + String.fromCharCode(169) + ' ' + String.fromCharCode(0x263a), style: 'p' },
    ]);
    expect(blocks.some((b) => b.text.includes('alert'))).toBe(false);
    expect(blocks.some((b) => b.text.includes('Ignored'))).toBe(false);
  });

  it('keeps PNG/JPEG data-URI images as image blocks and other images as alt text', () => {
    const html = `<p>Before</p><img src="data:image/png;base64,${TINY_PNG}" alt="dot"><img src="https://x/y.gif" alt="remote"><p>After</p>`;
    const blocks = htmlToBlocks(html);
    expect(blocks.map((b) => b.text)).toEqual(['Before', 'dot', '[remote]', 'After']);
    expect(blocks[1].image?.mimeType).toBe('image/png');
    expect(blocks[1].image?.data.length).toBeGreaterThan(20);
  });

  it('decodes entities and parses data URIs', () => {
    expect(decodeHtmlEntities('&lt;a&gt; &amp;&amp; &quot;q&quot; &#65;&#x42; &nbsp;x &unknown;')).toBe('<a> && "q" AB ' + String.fromCharCode(160) + 'x &unknown;');
    expect(parseImageDataUri(`data:image/jpeg;base64,${TINY_PNG}`)?.mimeType).toBe('image/jpeg');
    expect(parseImageDataUri('https://example.com/a.png')).toBeNull();
  });

  it('turns plain text into paragraphs', () => {
    expect(plainTextToBlocks('one\r\n\r\ntwo  \nthree\n\n\n')).toEqual([
      { text: 'one', style: 'p' },
      { text: 'two\nthree', style: 'p' },
    ]);
  });
});

describe('textToPdf', () => {
  it('renders blocks (including an image) to a multi-page PDF with page numbers', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph number ${i + 1} contains enough words to wrap across the page width when rendered at eleven points.`);
    const png = Uint8Array.from(atob(TINY_PNG), (c) => c.charCodeAt(0));
    const pdf = await textToPdf(
      [{ text: 'Hello Heading', style: 'h1' }, { text: 'img', image: { data: png, mimeType: 'image/png' } }, ...long.map((text) => ({ text })), { text: 'bullet item', style: 'li' as const }],
      { title: 'T', pageNumbers: true, header: 'Head', footer: 'Foot' },
    );
    expect(String.fromCharCode(...pdf.subarray(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe('T');
  });

  it('wraps long words and replaces unsupported characters instead of throwing', async () => {
    const pdf = await textToPdf([{ text: 'x'.repeat(400) + ' end ' + String.fromCharCode(0x4e2d, 0x6587) + ' ok ' + String.fromCharCode(0x219) }], { pageSize: 'Letter', landscape: true });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBe(792);
    expect(height).toBe(612);
  });

  it('wrapText respects the width and sanitizeForFont strips diacritics', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapText('The quick brown fox jumps over the lazy dog again and again', font, 12, 120);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(120);
    expect(sanitizeForFont('Café și 中', font)).toBe('Café si ?');
  });
});
