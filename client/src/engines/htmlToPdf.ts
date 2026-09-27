/**
 * HTML -> PDF in the browser.
 *
 * Two paths:
 *  - `htmlToPdf`: the built-in text renderer (headings, paragraphs, lists, tables as rows,
 *    embedded images). Fully automatic and honours the page options; CSS layout is lost.
 *  - `printHtml`: renders the HTML in a hidden, script-free iframe and opens the browser's
 *    print dialog, where "Save as PDF" gives a pixel-perfect result. The user has to confirm
 *    the dialog, so this is offered as an extra action rather than the main flow.
 */
import { engineError } from './common';
import { htmlToBlocks, textToPdf, type TextPageSize } from './textPdf';

export interface HtmlToPdfOptions {
  pageSize: 'A4' | 'A3' | 'Letter' | 'Legal';
  orientation: 'portrait' | 'landscape';
  /** millimetres */
  margin: number;
  header?: string;
  footer?: string;
  printBackground: boolean;
  pageNumbers: boolean;
  scale: number;
}

export interface HtmlToPdfResult {
  pdf: Uint8Array;
  engine: 'js';
  warnings: string[];
}

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Title from <title>, used as the PDF title. */
export function htmlTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, ' ').trim() || undefined : undefined;
}

export async function htmlToPdf(html: string, opts: HtmlToPdfOptions): Promise<HtmlToPdfResult> {
  const blocks = htmlToBlocks(html);
  const pdf = await textToPdf(blocks, {
    pageSize: opts.pageSize as TextPageSize,
    landscape: opts.orientation === 'landscape',
    margin: Math.max(18, mmToPt(opts.margin)),
    fontSize: 11 * Math.max(0.3, Math.min(2, opts.scale || 1)),
    title: htmlTitle(html),
    header: opts.header,
    footer: opts.footer,
    pageNumbers: opts.pageNumbers,
  });
  return { pdf, engine: 'js', warnings: ['Rendered with the built-in text engine: CSS layout, colours and web fonts are simplified. Use "Print with browser" for an exact copy.'] };
}

/**
 * Fetch a page's HTML from the browser. Only works for sites that allow cross-origin
 * requests (CORS); everything else is rejected by the browser before we see it.
 */
export async function fetchHtml(input: string, signal?: AbortSignal): Promise<string> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw engineError('VALIDATION_ERROR', 'Please enter a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw engineError('VALIDATION_ERROR', 'Only http and https URLs are supported.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: controller.signal, headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } });
  } catch {
    if (signal?.aborted) throw engineError('CANCELLED', 'The operation was cancelled.');
    throw engineError(
      'CONVERSION_FAILED',
      'This page could not be fetched from the browser (the site does not allow cross-origin access, or is offline). Save the page as an HTML file and upload it instead.',
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw engineError('CONVERSION_FAILED', `The URL responded with status ${res.status}.`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > FETCH_MAX_BYTES) throw engineError('FILE_TOO_LARGE', 'The page is larger than 5 MB.');
  const text = await res.text();
  if (text.length > FETCH_MAX_BYTES) throw engineError('FILE_TOO_LARGE', 'The page is larger than 5 MB.');
  return text;
}

/** Inject @page rules so the print dialog defaults to the chosen size, orientation and margins. */
function withPageStyle(html: string, opts: HtmlToPdfOptions): string {
  const style = `<style data-pdfly-print>@page{size:${opts.pageSize} ${opts.orientation};margin:${Math.max(0, opts.margin)}mm}${
    opts.printBackground ? 'html{-webkit-print-color-adjust:exact;print-color-adjust:exact}' : ''
  }${opts.scale && opts.scale !== 1 ? `body{zoom:${opts.scale}}` : ''}</style>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${style}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${style}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${html}</body></html>`;
}

/**
 * Open the browser's print dialog for the given HTML. Resolves when the dialog closes
 * (or after a timeout when the browser does not report it).
 */
export function printHtml(html: string, opts: HtmlToPdfOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('title', 'Print preview');
    // Scripts never run (no allow-scripts); same-origin is needed so we can call print().
    iframe.setAttribute('sandbox', 'allow-same-origin allow-modals');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    let finished = false;
    const done = (err?: Error) => {
      if (finished) return;
      finished = true;
      setTimeout(() => iframe.remove(), 500);
      if (err) reject(err);
      else resolve();
    };
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        done(new Error('The print preview could not be created.'));
        return;
      }
      win.addEventListener('afterprint', () => done(), { once: true });
      // Give fonts and images a moment to load before printing.
      setTimeout(() => {
        try {
          win.focus();
          win.print();
          // Browsers that never fire afterprint (or block the dialog) must not hang forever.
          setTimeout(() => done(), 60_000);
        } catch (err) {
          done(err instanceof Error ? err : new Error('The print dialog could not be opened.'));
        }
      }, 300);
    };
    iframe.srcdoc = withPageStyle(html, opts);
    document.body.appendChild(iframe);
  });
}
