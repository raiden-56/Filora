/**
 * HTML -> PDF.
 *
 * Engines, in order of preference:
 *   1. puppeteer (headless Chromium) when its browser binary is present
 *   2. LibreOffice (`soffice --convert-to pdf` on an .html file)
 *   3. pure JS: HTML -> text blocks -> pdf-lib (layout is lost, content is kept)
 *
 * URL inputs are guarded against SSRF: only http(s), the host is resolved and rejected when
 * it points at a loopback/private/link-local address, and sub-resource requests to such
 * addresses are aborted as well.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Browser, Page, HTTPRequest, PDFOptions } from 'puppeteer';
import { detectTools } from '../../config/tools.js';
import { config } from '../../config/index.js';
import { run } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import { htmlToBlocks, textToPdf, type TextPageSize } from './textPdf.js';
import type { HtmlToPdfInput, HtmlToPdfOptions, HtmlToPdfResult } from './types.js';

const NAV_TIMEOUT_MS = 45_000;
const OP_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 PDFly/1.0';
const TEXT_FALLBACK_WARNING = 'Rendered as plain text because no browser engine is available on the server.';

// ---------------------------------------------------------------------------------------
// SSRF guards
// ---------------------------------------------------------------------------------------

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 ("this" network)
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** Expand an IPv6 literal into 8 groups (16-bit each); null when malformed. */
function expandIpv6(addr: string): number[] | null {
  let a = addr;
  // embedded dotted IPv4 tail (::ffff:1.2.3.4)
  const v4tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (v4tail) {
    const p = parseIpv4(v4tail[1]);
    if (!p) return null;
    a = a.slice(0, -v4tail[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array(missing).fill('0'), ...tail].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.every((g) => Number.isInteger(g)) ? groups : null;
}

/** True for loopback, private, link-local, unspecified and multicast addresses (v4 or v6). */
export function isPrivateAddress(ip: string): boolean {
  let addr = ip.trim().toLowerCase();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  const v4 = parseIpv4(addr);
  if (v4) return isPrivateIpv4(v4);
  if (isIP(addr) !== 6) return true; // not an IP literal at all: unsafe where an IP is expected
  const g = expandIpv6(addr);
  if (!g) return true;
  const allZeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroPrefix(7) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if (allZeroPrefix(5) && (g[5] === 0xffff || g[5] === 0)) return isPrivateIpv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]); // v4-mapped / v4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIpv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]); // NAT64
  if (g[0] === 0x2002) return isPrivateIpv4([g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal';
}

const NOT_ALLOWED = () => new AppError('VALIDATION_ERROR', 'This URL is not allowed.');

/**
 * Validate a user supplied URL: http(s) only, hostname must not resolve to a private,
 * loopback or link-local address. Returns the parsed URL.
 */
export async function assertSafeUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Please enter a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError('VALIDATION_ERROR', 'Only http and https URLs are supported.');
  if (url.username || url.password) throw NOT_ALLOWED();
  const host = url.hostname;
  if (!host || isBlockedHostname(host)) throw NOT_ALLOWED();
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(literal)) {
    if (isPrivateAddress(literal)) throw NOT_ALLOWED();
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new AppError('VALIDATION_ERROR', 'The URL host could not be resolved.');
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw NOT_ALLOWED();
  return url;
}

/** Decide whether a sub-resource request may proceed (no DNS here: block IP literals + localhost). */
function isRequestUrlAllowed(u: string, mode: 'public' | 'none'): boolean {
  if (u.startsWith('data:') || u.startsWith('about:blank')) return true;
  if (mode === 'none') return false;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname;
  if (isBlockedHostname(host)) return false;
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(literal) && isPrivateAddress(literal)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------
// Browser lifecycle (single shared instance)
// ---------------------------------------------------------------------------------------

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = (await import('puppeteer')).default;
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'],
        timeout: OP_TIMEOUT_MS,
        protocolTimeout: OP_TIMEOUT_MS * 2,
      });
      browser.on('disconnected', () => {
        browserPromise = null;
      });
      return browser;
    })();
    browserPromise.catch(() => {
      browserPromise = null;
    });
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      // puppeteer itself kills the browser on SIGINT/SIGTERM/SIGHUP (handleSIGINT etc. default
      // to true); this covers a plain process.exit(). Exit handlers must be synchronous.
      process.once('exit', () => {
        browserPromise?.then((b) => b.process()?.kill('SIGKILL')).catch(() => undefined);
      });
    }
  }
  return browserPromise;
}
let exitHookInstalled = false;

/** Close the shared browser (used on shutdown and by tests). */
export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  try {
    const b = await p;
    await b.close();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function headerFooterTemplate(text: string | undefined, pageNumbers: boolean): string {
  const left = text ? escapeHtml(text) : '';
  const right = pageNumbers ? '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>' : '';
  if (!left && !right) return '<div></div>';
  return `<div style="font-size:9px;width:100%;padding:0 10mm;color:#666;display:flex;justify-content:space-between;align-items:center;font-family:Helvetica,Arial,sans-serif;box-sizing:border-box;"><span>${left}</span>${right}</div>`;
}

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

async function fetchHtmlSafely(input: string): Promise<{ html: string; finalUrl: string }> {
  let url = await assertSafeUrl(input);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    }).catch((err: unknown) => {
      throw new AppError('CONVERSION_FAILED', 'The URL could not be fetched.', { cause: err });
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => undefined);
      url = await assertSafeUrl(new URL(res.headers.get('location') as string, url).toString());
      continue;
    }
    if (!res.ok) throw new AppError('CONVERSION_FAILED', `The URL responded with status ${res.status}.`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > FETCH_MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new AppError('FILE_TOO_LARGE', 'The page is larger than 5 MB.');
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks);
    const ct = res.headers.get('content-type') ?? '';
    const charset = /charset=([\w-]+)/i.exec(ct)?.[1]?.toLowerCase();
    let html: string;
    try {
      html = new TextDecoder(charset && charset !== 'utf8' ? charset : 'utf-8').decode(buf);
    } catch {
      html = buf.toString('utf8');
    }
    return { html, finalUrl: url.toString() };
  }
  throw new AppError('CONVERSION_FAILED', 'Too many redirects.');
}

async function readInputHtml(input: HtmlToPdfInput): Promise<string> {
  if (input.filePath) return readFile(input.filePath, 'utf8');
  if (typeof input.html === 'string') return input.html;
  if (input.url) return (await fetchHtmlSafely(input.url)).html;
  throw new AppError('VALIDATION_ERROR', 'Provide HTML, upload an HTML file or enter a URL.');
}

// ---------------------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------------------

async function renderWithPuppeteer(input: HtmlToPdfInput, opts: HtmlToPdfOptions): Promise<Buffer> {
  const browser = await getBrowser();
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(OP_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.emulateMediaType('print');

    // Uploaded files: JS off and no network at all. Pasted HTML: JS off, public sub-resources only.
    // URLs: JS on (pages need it to render), but private sub-resources are aborted.
    const mode: 'public' | 'none' = input.url ? 'public' : input.filePath ? 'none' : 'public';
    if (!input.url) await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req: HTTPRequest) => {
      if (isRequestUrlAllowed(req.url(), mode)) req.continue().catch(() => undefined);
      else req.abort('blockedbyclient').catch(() => undefined);
    });

    if (input.url) {
      const url = await assertSafeUrl(input.url);
      const res = await page.goto(url.toString(), { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS }).catch((err: unknown) => {
        throw AppError.from(err, 'CONVERSION_FAILED', 'The page could not be loaded.');
      });
      if (res && res.status() >= 400) throw new AppError('CONVERSION_FAILED', `The URL responded with status ${res.status()}.`);
    } else {
      const html = await readInputHtml(input);
      await page.setContent(html, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
      // let blocked/aborted sub-resources settle and fonts load before printing
      await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => undefined);
    }

    const hasHeader = Boolean(opts.header?.trim());
    const hasFooter = Boolean(opts.footer?.trim()) || opts.pageNumbers;
    const display = hasHeader || hasFooter;
    const m = Math.max(0, opts.margin);
    const top = display && hasHeader ? Math.max(m, 15) : m;
    const bottom = display && hasFooter ? Math.max(m, 15) : m;
    const pdfOptions: PDFOptions = {
      format: opts.pageSize,
      landscape: opts.orientation === 'landscape',
      printBackground: opts.printBackground,
      margin: { top: `${top}mm`, right: `${m}mm`, bottom: `${bottom}mm`, left: `${m}mm` },
      scale: opts.scale,
      preferCSSPageSize: false,
      displayHeaderFooter: display,
      headerTemplate: display ? headerFooterTemplate(hasHeader ? opts.header : undefined, false) : undefined,
      footerTemplate: display ? headerFooterTemplate(opts.footer?.trim() ? opts.footer : undefined, opts.pageNumbers) : undefined,
      timeout: OP_TIMEOUT_MS,
    };
    const bytes = await page.pdf(pdfOptions);
    return Buffer.from(bytes);
  } finally {
    await page?.close().catch(() => undefined);
  }
}

/** Convert an HTML file to PDF with LibreOffice; returns the PDF bytes. */
export async function htmlFileToPdfWithLibreOffice(soffice: string, htmlPath: string, workDir: string): Promise<Buffer> {
  const outDir = path.join(workDir, 'lo-out');
  await mkdir(outDir, { recursive: true });
  const profile = pathToFileURL(path.join(workDir, 'lo-profile')).href;
  const src = path.join(workDir, 'lo-input.html');
  if (path.resolve(src) !== path.resolve(htmlPath)) await copyFile(htmlPath, src);
  await run(soffice, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nologo', '--convert-to', 'pdf:writer_web_pdf_Export', '--outdir', outDir, src], {
    cwd: workDir,
    timeoutMs: config.processTimeoutMs,
  }).catch((err: unknown) => {
    throw AppError.from(err, 'CONVERSION_FAILED');
  });
  const out = path.join(outDir, 'lo-input.pdf');
  if (!existsSync(out)) throw new AppError('CONVERSION_FAILED', 'LibreOffice did not produce a PDF.');
  return readFile(out);
}

async function renderAsText(html: string, opts: HtmlToPdfOptions): Promise<Buffer> {
  const blocks = htmlToBlocks(html);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : undefined;
  const bytes = await textToPdf(blocks, {
    pageSize: opts.pageSize as TextPageSize,
    landscape: opts.orientation === 'landscape',
    margin: Math.max(18, mmToPt(opts.margin)),
    fontSize: 11 * Math.max(0.3, Math.min(2, opts.scale || 1)),
    title,
    header: opts.header,
    footer: opts.footer,
    pageNumbers: opts.pageNumbers,
  });
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

export async function htmlToPdf(input: HtmlToPdfInput, opts: HtmlToPdfOptions, workDir: string): Promise<HtmlToPdfResult> {
  if (!input.filePath && typeof input.html !== 'string' && !input.url) throw new AppError('VALIDATION_ERROR', 'Provide HTML, upload an HTML file or enter a URL.');
  // Validate URLs up-front so bad input never reaches a browser or the network.
  if (input.url) await assertSafeUrl(input.url);
  const tools = await detectTools();
  const warnings: string[] = [];

  if (tools.puppeteer) {
    try {
      const pdf = await renderWithPuppeteer(input, opts);
      return { pdf, engine: 'puppeteer', warnings };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.from(err, 'CONVERSION_FAILED', 'The HTML could not be rendered.');
    }
  }

  const html = await readInputHtml(input);

  if (tools.soffice) {
    try {
      const htmlPath = path.join(workDir, 'lo-input.html');
      await writeFile(htmlPath, html, 'utf8');
      const pdf = await htmlFileToPdfWithLibreOffice(tools.soffice, htmlPath, workDir);
      warnings.push('Rendered with LibreOffice: page options such as headers, footers and scale are not applied.');
      return { pdf, engine: 'libreoffice', warnings };
    } catch {
      // fall through to the text renderer
    }
  }

  const pdf = await renderAsText(html, opts);
  warnings.push(TEXT_FALLBACK_WARNING);
  return { pdf, engine: 'js', warnings };
}
