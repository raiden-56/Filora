import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { htmlToPdf, closeBrowser, isPrivateAddress, assertSafeUrl, escapeHtml } from './htmlToPdf.js';
import { htmlToBlocks, textToPdf, wrapText, decodeHtmlEntities } from './textPdf.js';
import { detectTools } from '../../config/tools.js';
import { createWorkDir } from '../../utils/tmp.js';
import { extractText } from '../render.js';
import type { HtmlToPdfOptions } from './types.js';

const tools = await detectTools();
const OPTS: HtmlToPdfOptions = { pageSize: 'A4', orientation: 'portrait', margin: 15, printBackground: true, pageNumbers: false, scale: 1 };

let dir: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  const w = await createWorkDir('html-test');
  dir = w.dir;
  cleanup = w.cleanup;
});
afterAll(async () => {
  await closeBrowser();
  await cleanup();
});

async function pdfText(pdf: Uint8Array): Promise<{ pages: number; text: string }> {
  expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  const doc = await PDFDocument.load(pdf);
  const pages = await extractText(new Uint8Array(pdf));
  return { pages: doc.getPageCount(), text: pages.map((p) => p.text).join('\n') };
}

describe('htmlToBlocks / textToPdf (pure JS fallback)', () => {
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

  it('decodes entities', () => {
    expect(decodeHtmlEntities('&lt;a&gt; &amp;&amp; &quot;q&quot; &#65;&#x42; &nbsp;x &unknown;')).toBe('<a> && "q" AB ' + String.fromCharCode(160) + 'x &unknown;');
  });

  it('renders blocks to a multi-page PDF with wrapped text', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph number ${i + 1} contains enough words to wrap across the page width when rendered at eleven points.`);
    const pdf = await textToPdf([{ text: 'Hello Heading', style: 'h1' }, ...long.map((text) => ({ text })), { text: 'bullet item', style: 'li' as const }], { title: 'T', pageNumbers: true });
    const { pages, text } = await pdfText(pdf);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain('Hello Heading');
    expect(text).toContain('Paragraph number 60');
    expect(text).toContain('bullet item');
    expect(text).toContain('Page 1');
  });

  it('wraps long words and replaces unsupported characters instead of throwing', async () => {
    const pdf = await textToPdf([{ text: 'x'.repeat(400) + ' end ' + String.fromCharCode(0x4e2d, 0x6587) + ' ok ' + String.fromCharCode(0x219) }], { pageSize: 'Letter', landscape: true });
    const { pages, text } = await pdfText(pdf);
    expect(pages).toBe(1);
    expect(text).toContain('end');
    expect(text).toContain('ok');
    expect(text).toContain('s');
  });

  it('wrapText respects the width', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont('Helvetica');
    const lines = wrapText('the quick brown fox jumps over the lazy dog again and again', font, 12, 100);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(100);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog again and again');
  });

  it('escapes HTML for header/footer templates', () => {
    expect(escapeHtml('<b a="1">&\'</b>')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
  });
});

describe('htmlToPdf service (any engine)', () => {
  it('converts an HTML string using whatever engine is available', async () => {
    const r = await htmlToPdf({ html: '<html><head><title>Doc</title></head><body><h1>Hello</h1><p>World paragraph</p></body></html>' }, OPTS, dir);
    expect(['puppeteer', 'libreoffice', 'js']).toContain(r.engine);
    if (!tools.puppeteer && !tools.soffice) {
      expect(r.engine).toBe('js');
      expect(r.warnings).toContain('Rendered as plain text because no browser engine is available on the server.');
    }
    const { pages, text } = await pdfText(r.pdf);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(text).toContain('Hello');
    expect(text).toContain('World paragraph');
  });

  it('converts an uploaded HTML file', async () => {
    const file = path.join(dir, 'page.html');
    await writeFile(file, '<h2>From file</h2><ul><li>item A</li></ul><script>document.write("JS RAN")</script>', 'utf8');
    const r = await htmlToPdf({ filePath: file }, { ...OPTS, header: 'My <header>', footer: 'foot', pageNumbers: true, orientation: 'landscape' }, dir);
    const { text } = await pdfText(r.pdf);
    expect(text).toContain('From file');
    expect(text).toContain('item A');
    expect(text).not.toContain('JS RAN');
  });

  it('rejects missing input', async () => {
    await expect(htmlToPdf({}, OPTS, dir)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('SSRF protection', () => {
  it('classifies private and public addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.5.5', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.1.1', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '[::1]', 'fe80::1%eth0']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '93.184.216.34', '2001:db8::1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('rejects private, loopback and non-http URLs before any network access', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const bad = [
      'http://127.0.0.1/',
      'http://localhost:4000/admin',
      'http://sub.localhost/',
      'http://10.1.2.3/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://0.0.0.0/',
      'http://0/',
      'http://2130706433/',
      'http://user:pw@example.com/',
      'ftp://example.com/file',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ];
    for (const url of bad) {
      await expect(htmlToPdf({ url }, OPTS, dir), url).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(assertSafeUrl(url), url).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe.skipIf(!tools.puppeteer)('htmlToPdf with puppeteer', () => {
  it('renders <h1>Hello</h1> to a PDF', async () => {
    const r = await htmlToPdf({ html: '<h1>Hello</h1><p>Chromium paragraph</p>' }, OPTS, dir);
    expect(r.engine).toBe('puppeteer');
    expect(r.warnings).toEqual([]);
    const { pages, text } = await pdfText(r.pdf);
    expect(pages).toBe(1);
    expect(text).toContain('Hello');
    expect(text).toContain('Chromium paragraph');
  });

  it('applies landscape, header/footer and page numbers', async () => {
    const body = Array.from({ length: 80 }, (_, i) => `<p>Line ${i + 1}</p>`).join('');
    const r = await htmlToPdf({ html: body }, { ...OPTS, orientation: 'landscape', header: 'Header <text>', footer: 'Footer', pageNumbers: true, pageSize: 'Letter' }, dir);
    const doc = await PDFDocument.load(r.pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
    const { text } = await pdfText(r.pdf);
    expect(text).toContain('Header <text>');
    expect(text).toContain('Line 80');
  });
});
