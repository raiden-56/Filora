/**
 * Office documents (Word / PowerPoint / Excel) -> PDF.
 *
 * LibreOffice is used when installed (best fidelity). Otherwise a pure-JS path extracts the
 * document content and lays it out with pdf-lib (or with headless Chromium when puppeteer's
 * browser is present). The JS path always produces a readable PDF; layout fidelity is reduced.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import sharp from 'sharp';
import { detectTools } from '../../config/tools.js';
import { config } from '../../config/index.js';
import { run } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import { readZipEntries, isZip } from '../../utils/zip.js';
import { htmlToPdf, escapeHtml } from './htmlToPdf.js';
import { textToPdf, htmlToBlocks, decodeHtmlEntities, sanitizeForFont, wrapText, type TextBlock, type BlockStyle } from './textPdf.js';
import type { HtmlToPdfOptions, OfficeKind, OfficeToPdfResult } from './types.js';

const JS_WARNING = 'Converted without LibreOffice: layout fidelity is reduced.';
const LEGACY_WARNING = 'Legacy binary formats (.doc/.ppt) are converted best-effort without LibreOffice: only the readable text is kept.';

const OFFICE_HTML_OPTS: HtmlToPdfOptions = { pageSize: 'A4', orientation: 'portrait', margin: 20, printBackground: true, pageNumbers: false, scale: 1 };

function extOf(name: string): string {
  return path.extname(name).toLowerCase().replace(/^\./, '');
}

function safeBase(name: string): string {
  const base = path.basename(name, path.extname(name)).replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'document';
  return base.slice(0, 60);
}

function outputPath(workDir: string, originalName: string): string {
  return path.join(workDir, `${safeBase(originalName)}-${randomUUID().slice(0, 8)}.pdf`);
}

type Container = 'zip' | 'ole' | 'rtf' | 'text';

function sniff(buf: Buffer): Container {
  if (isZip(buf)) return 'zip';
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1) return 'ole';
  if (buf.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  return 'text';
}

// ---------------------------------------------------------------------------------------
// LibreOffice
// ---------------------------------------------------------------------------------------

async function convertWithLibreOffice(soffice: string, inputPath: string, originalName: string, workDir: string): Promise<string> {
  const ext = extOf(originalName) || extOf(inputPath) || 'bin';
  const base = `${safeBase(originalName)}-${randomUUID().slice(0, 8)}`;
  const src = path.join(workDir, `${base}.${ext}`);
  await copyFile(inputPath, src);
  const outDir = path.join(workDir, 'lo-out');
  await mkdir(outDir, { recursive: true });
  const profile = pathToFileURL(path.join(workDir, 'lo-profile')).href;
  await run(soffice, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nologo', '--convert-to', 'pdf', '--outdir', outDir, src], {
    cwd: workDir,
    timeoutMs: config.processTimeoutMs,
  });
  const out = path.join(outDir, `${base}.pdf`);
  if (!existsSync(out)) throw new AppError('CONVERSION_FAILED', 'LibreOffice did not produce a PDF.');
  return out;
}

// ---------------------------------------------------------------------------------------
// Text extraction helpers (RTF, ODF, legacy binary)
// ---------------------------------------------------------------------------------------

let cp1252: TextDecoder | null | undefined;
function decodeCp1252Byte(b: number): string {
  if (cp1252 === undefined) {
    try {
      cp1252 = new TextDecoder('windows-1252');
    } catch {
      cp1252 = null;
    }
  }
  return cp1252 ? cp1252.decode(new Uint8Array([b])) : String.fromCharCode(b);
}

const RTF_SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf', 'footnote',
  'xe', 'tc', 'fldinst', 'pntext', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore',
  'mmathPr', 'wgrffmtfilter', 'xmlnstbl', 'userprops', 'docvar', 'ftnsep', 'ftnsepc', 'aftnsep', 'aftnsepc', 'bkmkstart', 'bkmkend', 'template', 'annotation', 'atnid', 'atnauthor',
]);

const RTF_SYMBOLS: Record<string, string> = {
  par: '\n', line: '\n', tab: '\t', cell: ' | ', row: '\n', page: '\n\n', sect: '\n\n', bullet: '\u2022', endash: '\u2013', emdash: '\u2014',
  lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201c', rdblquote: '\u201d', enspace: ' ', emspace: ' ', qmspace: ' ', '~': '\u00a0', '_': '-', '-': '', '{': '{', '}': '}', '\\': '\\',
  nestcell: ' | ', nestrow: '\n', chdate: '', chtime: '', chpgn: '', sectd: '', ldblquot: '\u201c', rdblquot: '\u201d',
};

/** Strip RTF control words/groups and return the document's plain text. */
export function rtfToText(rtf: string): string {
  let out = '';
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let skipChars = 0;
  let i = 0;
  const n = rtf.length;
  while (i < n) {
    const ch = rtf[i];
    if (ch === '{') {
      stack.push({ skip, uc });
      i++;
      // "\*" marks an unknown/ignorable destination
      if (rtf[i] === '\\' && rtf[i + 1] === '*') {
        const m = /^\\\*\\([a-zA-Z]+)/.exec(rtf.slice(i, i + 40));
        if (!m || m[1] !== 'fldrslt') skip = true;
      }
      continue;
    }
    if (ch === '}') {
      const st = stack.pop();
      skip = st ? st.skip : false;
      uc = st ? st.uc : 1;
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === undefined) break;
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        i += 4;
        if (skipChars > 0) {
          skipChars--;
          continue;
        }
        if (!skip && /^[0-9a-fA-F]{2}$/.test(hex)) out += decodeCp1252Byte(parseInt(hex, 16));
        continue;
      }
      if (!/[a-zA-Z]/.test(next)) {
        // control symbol
        i += 2;
        if (skipChars > 0) {
          skipChars--;
          continue;
        }
        if (!skip) out += RTF_SYMBOLS[next] ?? '';
        continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      const word = m[1];
      const param = m[2] !== undefined ? parseInt(m[2], 10) : undefined;
      if (word === 'uc') {
        uc = param ?? 1;
        continue;
      }
      if (word === 'u' && param !== undefined) {
        if (!skip) {
          let code = param;
          if (code < 0) code += 65536;
          out += String.fromCharCode(code);
        }
        skipChars = uc;
        continue;
      }
      if (RTF_SKIP_DESTINATIONS.has(word)) {
        skip = true;
        continue;
      }
      if (!skip && RTF_SYMBOLS[word] !== undefined) out += RTF_SYMBOLS[word];
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    i++;
    if (skipChars > 0) {
      skipChars--;
      continue;
    }
    if (!skip) out += ch;
  }
  return out;
}

function linesToBlocks(text: string, style: BlockStyle = 'p'): TextBlock[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .map((t) => ({ text: t, style }));
}

/** Convert the body of an ODF content.xml fragment into text blocks. */
export function odfXmlToBlocks(xml: string): TextBlock[] {
  const cleaned = xml.replace(/<office:(automatic-styles|font-face-decls|styles|scripts|settings)\b[\s\S]*?<\/office:\1>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const blocks: TextBlock[] = [];
  let buf = '';
  let style: BlockStyle = 'p';
  let listDepth = 0;
  const flush = () => {
    const t = buf.replace(/[ \t\r\n]+/g, ' ').trim();
    if (t) blocks.push({ text: t, style });
    buf = '';
  };
  const re = /<[!?][^>]*>|<\/?([a-zA-Z0-9:_-]+)\b([^>]*)>|[^<]+/g;
  for (const m of cleaned.matchAll(re)) {
    const tag = m[1];
    if (!tag) {
      if (!m[0].startsWith('<')) buf += decodeHtmlEntities(m[0]);
      continue;
    }
    const closing = m[0].startsWith('</');
    const attrs = m[2] ?? '';
    switch (tag) {
      case 'text:h': {
        flush();
        if (closing) style = listDepth ? 'li' : 'p';
        else {
          const lvl = Number(/text:outline-level="(\d+)"/.exec(attrs)?.[1] ?? 1);
          style = lvl <= 1 ? 'h1' : lvl === 2 ? 'h2' : 'h3';
        }
        break;
      }
      case 'text:p':
        flush();
        style = listDepth ? 'li' : 'p';
        break;
      case 'text:list':
        flush();
        listDepth = Math.max(0, listDepth + (closing ? -1 : 1));
        style = listDepth ? 'li' : 'p';
        break;
      case 'text:list-item':
        flush();
        break;
      case 'text:tab':
        buf += '\t';
        break;
      case 'text:line-break':
        buf += '\n';
        break;
      case 'text:s': {
        const c = Number(/text:c="(\d+)"/.exec(attrs)?.[1] ?? 1);
        buf += ' '.repeat(Math.max(1, c));
        break;
      }
      case 'table:table-cell':
      case 'table:covered-table-cell':
        if (!closing && buf.trim()) buf += ' | ';
        break;
      case 'table:table-row':
      case 'table:table':
      case 'draw:frame':
      case 'draw:text-box':
      case 'draw:page':
      case 'text:section':
        flush();
        break;
      default:
        break;
    }
  }
  flush();
  return blocks;
}

const NOISE_RE =
  /^(MSWordDoc|Word\.Document\.\d+|Microsoft (Office )?(Word|PowerPoint|Excel)( \d+)?.*|Normal(\.dotm?)?|Root Entry|WordDocument|SummaryInformation|DocumentSummaryInformation|CompObj|ObjectPool|Data|1Table|0Table|PowerPoint Document|Current User|Pictures|Times New Roman|Calibri( Light)?|Arial|Cambria( Math)?|Symbol|Wingdings|Courier New|Segoe UI|Verdana|Tahoma|Default Paragraph Font|Table Normal|No List|Title|Subtitle|Heading \d|Normal Table|Hyperlink|List Paragraph|Body Text|Default Design|Office Theme|On-screen Show.*|Slide Titles|Arial Narrow|Century Gothic|Georgia|Lucida Sans Unicode|Trebuchet MS|_x000d_|Times|Helvetica|Click to edit .*|\*)$/i;

function isReadable(s: string): boolean {
  const letters = (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return letters >= 3 && letters / s.length >= 0.5;
}

/**
 * Best-effort text extraction from legacy OLE binaries (.doc/.ppt/.xls): scans for runs of
 * printable 8-bit and UTF-16LE characters and keeps the ones that look like prose.
 */
export function extractBinaryText(buf: Buffer): string[] {
  const runs: { pos: number; text: string }[] = [];
  const printable8 = (b: number) => (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0b || b === 0x0d || b === 0x0a || (b >= 0xa0 && b <= 0xff);
  // 8-bit runs
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const ok = i < buf.length && printable8(buf[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= 6) runs.push({ pos: start, text: buf.subarray(start, i).toString('latin1') });
      start = -1;
    }
  }
  // UTF-16LE runs (BMP characters with a printable low byte or any letter code point)
  const printable16 = (lo: number, hi: number) => (hi === 0 && printable8(lo)) || (hi > 0 && hi < 0xd8 && hi !== 0xff);
  for (const offset of [0, 1]) {
    let s = -1;
    let count = 0;
    for (let i = offset; i + 1 <= buf.length; i += 2) {
      const ok = i + 1 < buf.length && printable16(buf[i], buf[i + 1]);
      if (ok && s < 0) {
        s = i;
        count = 0;
      }
      if (ok) count++;
      if (!ok && s >= 0) {
        if (count >= 6) runs.push({ pos: s, text: buf.subarray(s, s + count * 2).toString('utf16le') });
        s = -1;
      }
    }
  }
  runs.sort((a, b) => a.pos - b.pos);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of runs) {
    for (const piece of r.text.split(/[\r\n\x0b\x0c\x07]+/)) {
      const t = piece.replace(/[\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (t.length < 4 || !isReadable(t) || NOISE_RE.test(t) || seen.has(t)) continue;
      // drop things that look like binary garbage or file paths
      if (/^[\W_]+$/.test(t) || /[\u0080-\u00a0]{2,}/.test(t) || /^[A-Za-z]:\\/.test(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------------------

function wrapOfficeHtml(bodyHtml: string, title: string, extraCss = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font-family:Calibri,Carlito,Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.4;color:#111}
h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}
img{max-width:100%;height:auto}
table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #bbb;padding:2px 6px;vertical-align:top}
p{margin:0 0 8pt}
${extraCss}</style></head><body>${bodyHtml}</body></html>`;
}

async function htmlOrTextToPdf(html: string, title: string, workDir: string, opts: HtmlToPdfOptions, usePuppeteer: boolean): Promise<Uint8Array> {
  if (usePuppeteer) {
    try {
      const r = await htmlToPdf({ html }, opts, workDir);
      if (r.engine === 'puppeteer') return r.pdf;
    } catch {
      /* fall back to text rendering below */
    }
  }
  return textToPdf(htmlToBlocks(html), { pageSize: opts.pageSize, landscape: opts.orientation === 'landscape', title });
}

async function wordToPdfJs(inputPath: string, originalName: string, workDir: string, warnings: string[], puppeteer: boolean): Promise<Uint8Array> {
  const buf = await readFile(inputPath);
  const ext = extOf(originalName);
  const kind = sniff(buf);
  const title = path.basename(originalName, path.extname(originalName));

  if (kind === 'zip') {
    const entries = readZipEntries(buf);
    if (entries.has('word/document.xml')) {
      let html: string;
      try {
        const r = await mammoth.convertToHtml({ buffer: buf });
        html = r.value;
      } catch (err) {
        throw new AppError('CONVERSION_FAILED', 'This Word document could not be read.', { cause: err });
      }
      if (!html.trim()) html = '<p></p>';
      return htmlOrTextToPdf(wrapOfficeHtml(html, title), title, workDir, OFFICE_HTML_OPTS, puppeteer);
    }
    const content = entries.get('content.xml');
    if (content) {
      const blocks = odfXmlToBlocks(content.toString('utf8'));
      return textToPdf(blocks.length ? blocks : [{ text: '' }], { title });
    }
    throw new AppError('UNSUPPORTED_FORMAT', 'Unrecognised document container.');
  }
  if (kind === 'rtf') {
    const text = rtfToText(buf.toString('latin1'));
    return textToPdf(linesToBlocks(text), { title });
  }
  if (kind === 'ole') {
    warnings.push(LEGACY_WARNING);
    const lines = extractBinaryText(buf);
    const blocks: TextBlock[] = lines.length ? lines.map((t) => ({ text: t, style: 'p' as BlockStyle })) : [{ text: '(No readable text was found in this document.)' }];
    return textToPdf(blocks, { title });
  }
  // plain text / unknown
  if (ext === 'txt' || ext === 'md' || ext === 'text' || kind === 'text') {
    const text = buf.toString('utf8').replace(/\ufffd/g, '');
    const blocks = text.split(/\r?\n\r?\n/).map((p) => ({ text: p.trim() })).filter((b) => b.text);
    return textToPdf(blocks.length ? blocks : [{ text: '' }], { title });
  }
  throw new AppError('UNSUPPORTED_FORMAT');
}

// ---------------------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------------------

interface SlideContent {
  title?: string;
  blocks: TextBlock[];
  image?: Buffer;
}

function xmlText(fragment: string): string {
  return decodeHtmlEntities(fragment.replace(/<[^>]+>/g, ''));
}

function parsePptxSlide(xml: string): { title?: string; blocks: TextBlock[]; imageRel?: string; hidden: boolean } {
  const hidden = /<p:sld\b[^>]*\bshow="0"/.test(xml);
  let title: string | undefined;
  const blocks: TextBlock[] = [];
  const shapeRe = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  const tableRe = /<a:tbl\b[\s\S]*?<\/a:tbl>/g;
  // Collect shapes and tables in document order.
  const items: { pos: number; kind: 'sp' | 'tbl'; xml: string }[] = [];
  for (const m of xml.matchAll(shapeRe)) items.push({ pos: m.index ?? 0, kind: 'sp', xml: m[0] });
  for (const m of xml.matchAll(tableRe)) items.push({ pos: m.index ?? 0, kind: 'tbl', xml: m[0] });
  items.sort((a, b) => a.pos - b.pos);

  for (const item of items) {
    if (item.kind === 'tbl') {
      for (const row of item.xml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
        const cells = [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((c) => [...c[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => xmlText(t[1])).join('').trim());
        const line = cells.join(' | ').trim();
        if (line) blocks.push({ text: line, style: 'p' });
      }
      continue;
    }
    const ph = /<p:ph\b([^>]*)\/?>/.exec(item.xml);
    const phType = ph ? /\btype="([^"]+)"/.exec(ph[1])?.[1] ?? 'body' : null;
    if (phType === 'sldNum' || phType === 'dt' || phType === 'ftr') continue;
    const isTitle = phType === 'title' || phType === 'ctrTitle';
    const paragraphs: TextBlock[] = [];
    for (const p of item.xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
      const pxml = p[0];
      let text = '';
      for (const tok of pxml.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>|<a:tab\b[^>]*\/?>/g)) {
        if (tok[0].startsWith('<a:t>')) text += xmlText(tok[1]);
        else if (tok[0].startsWith('<a:br')) text += '\n';
        else text += '\t';
      }
      text = text.replace(/[ \t]+/g, ' ').trim();
      if (!text) continue;
      let style: BlockStyle = 'p';
      if (!isTitle) {
        const bulleted = /<a:buChar\b|<a:buAutoNum\b|<a:buBlip\b/.test(pxml);
        const noBullet = /<a:buNone\b/.test(pxml);
        if (bulleted) style = 'li';
        else if (phType && !noBullet && phType !== 'subTitle') style = 'li';
      }
      paragraphs.push({ text, style });
    }
    if (!paragraphs.length) continue;
    if (isTitle && !title) {
      title = paragraphs.map((p) => p.text).join(' ');
    } else if (!title && !ph && blocks.length === 0 && paragraphs.length === 1 && paragraphs[0].text.length <= 120) {
      // first short text box on a slide without a title placeholder acts as the heading
      title = paragraphs[0].text;
    } else blocks.push(...paragraphs);
  }
  const pic = /<p:pic\b[\s\S]*?<\/p:pic>/.exec(xml);
  const imageRel = pic ? /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(pic[0])?.[1] : undefined;
  return { title, blocks, imageRel, hidden };
}

function resolveRel(relsXml: string | undefined, id: string | undefined, baseDir: string): string | undefined {
  if (!relsXml || !id) return undefined;
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    if (/\bId="([^"]+)"/.exec(attrs)?.[1] !== id) continue;
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (!target || /^https?:/i.test(target)) return undefined;
    const joined = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(baseDir, target));
    return joined;
  }
  return undefined;
}

async function toPdfImage(doc: PDFDocument, data: Buffer): Promise<PDFImage | null> {
  try {
    if (data[0] === 0x89 && data[1] === 0x50) return await doc.embedPng(data);
    if (data[0] === 0xff && data[1] === 0xd8) return await doc.embedJpg(data);
    const png = await sharp(data, { limitInputPixels: 50_000_000 }).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return await doc.embedPng(png);
  } catch {
    return null;
  }
}

/** Render slides to a 16:9 landscape PDF (960x540 pt per slide). */
export async function slidesToPdf(slides: SlideContent[], docTitle?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer('PDFly');
  doc.setCreator('PDFly');
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());
  if (docTitle) doc.setTitle(docTitle);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 960;
  const H = 540;
  const M = 48;
  const dark = rgb(0.12, 0.12, 0.12);
  const grey = rgb(0.5, 0.5, 0.5);
  const accent = rgb(0.2, 0.45, 0.8);
  const list = slides.length ? slides : [{ blocks: [{ text: '(empty presentation)' }] }];

  for (let s = 0; s < list.length; s++) {
    const slide = list[s];
    const page = doc.addPage([W, H]);
    let y = H - M;
    const image = slide.image ? await toPdfImage(doc, slide.image) : null;
    const textWidth = image ? (W - M * 2) * 0.55 : W - M * 2;

    if (slide.title) {
      const titleSize = 28;
      const lines = wrapText(sanitizeForFont(slide.title, bold), bold, titleSize, W - M * 2).slice(0, 2);
      for (const line of lines) {
        page.drawText(line, { x: M, y: y - titleSize, size: titleSize, font: bold, color: dark });
        y -= titleSize * 1.25;
      }
      y -= 6;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: accent });
      y -= 18;
    }

    const bodyTop = y;
    const available = bodyTop - M - 10;
    // choose the largest body size that fits
    let chosen: { size: number; lines: { text: string; style: BlockStyle; first: boolean }[] } | null = null;
    for (const size of [18, 16, 14, 12, 11, 10]) {
      const lineH = size * 1.35;
      const lines: { text: string; style: BlockStyle; first: boolean }[] = [];
      let height = 0;
      for (const b of slide.blocks) {
        const font = b.style === 'h1' || b.style === 'h2' || b.style === 'h3' ? bold : regular;
        const indent = b.style === 'li' ? 16 : 0;
        const wrapped = sanitizeForFont(b.text, font)
          .split('\n')
          .flatMap((l) => wrapText(l, font, size, textWidth - indent));
        wrapped.forEach((t, i) => lines.push({ text: t, style: b.style ?? 'p', first: i === 0 }));
        height += wrapped.length * lineH + 4;
      }
      chosen = { size, lines };
      if (height <= available) break;
    }
    if (chosen) {
      const { size, lines } = chosen;
      const lineH = size * 1.35;
      let yy = bodyTop;
      let prevStyle: BlockStyle | null = null;
      let truncated = false;
      for (const line of lines) {
        if (line.first && prevStyle !== null) yy -= 4;
        if (yy - lineH < M) {
          truncated = true;
          break;
        }
        const font = line.style === 'h1' || line.style === 'h2' || line.style === 'h3' ? bold : regular;
        const indent = line.style === 'li' ? 16 : 0;
        if (line.style === 'li' && line.first) page.drawText('\u2022', { x: M + 2, y: yy - size, size, font: regular, color: dark });
        if (line.text) page.drawText(line.text, { x: M + indent, y: yy - size, size, font, color: dark });
        yy -= lineH;
        prevStyle = line.style;
      }
      if (truncated) page.drawText('\u2026', { x: M, y: M - 4, size: 12, font: regular, color: grey });
    }

    if (image) {
      const areaX = M + textWidth + 20;
      const areaW = W - M - areaX;
      const areaH = bodyTop - M;
      if (areaW > 40 && areaH > 40) {
        const scale = Math.min(areaW / image.width, areaH / image.height, 1);
        const w = image.width * scale;
        const h = image.height * scale;
        page.drawImage(image, { x: areaX + (areaW - w) / 2, y: M + (areaH - h) / 2, width: w, height: h });
      }
    }

    const num = `${s + 1} / ${list.length}`;
    page.drawText(num, { x: W - M - regular.widthOfTextAtSize(num, 10), y: M / 2, size: 10, font: regular, color: grey });
  }
  return doc.save({ useObjectStreams: false });
}

async function pptxToSlides(entries: Map<string, Buffer>): Promise<SlideContent[]> {
  const slideNames = [...entries.keys()]
    .map((k) => ({ k, m: /^ppt\/slides\/slide(\d+)\.xml$/.exec(k) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m![1]) - Number(b.m![1]));
  const slides: SlideContent[] = [];
  for (const { k, m } of slideNames) {
    const xml = entries.get(k)!.toString('utf8');
    const parsed = parsePptxSlide(xml);
    if (parsed.hidden) continue;
    let image: Buffer | undefined;
    if (parsed.imageRel) {
      const rels = entries.get(`ppt/slides/_rels/slide${m![1]}.xml.rels`)?.toString('utf8');
      const target = resolveRel(rels, parsed.imageRel, 'ppt/slides');
      if (target && entries.has(target)) image = entries.get(target);
    }
    slides.push({ title: parsed.title, blocks: parsed.blocks, image });
  }
  return slides;
}

function odpToSlides(contentXml: string): SlideContent[] {
  const parts = contentXml.split(/(?=<draw:page\b)/).filter((p) => p.startsWith('<draw:page'));
  return parts.map((p) => {
    const end = p.indexOf('</draw:page>');
    const blocks = odfXmlToBlocks(end >= 0 ? p.slice(0, end) : p);
    const title = blocks.length && blocks[0].text.length <= 120 ? blocks[0].text : undefined;
    return { title, blocks: title ? blocks.slice(1) : blocks };
  });
}

async function powerpointToPdfJs(inputPath: string, originalName: string, warnings: string[]): Promise<Uint8Array> {
  const buf = await readFile(inputPath);
  const kind = sniff(buf);
  const title = path.basename(originalName, path.extname(originalName));
  if (kind === 'zip') {
    const entries = readZipEntries(buf);
    if (entries.has('ppt/presentation.xml') || [...entries.keys()].some((k) => k.startsWith('ppt/slides/'))) {
      return slidesToPdf(await pptxToSlides(entries), title);
    }
    const content = entries.get('content.xml');
    if (content) return slidesToPdf(odpToSlides(content.toString('utf8')), title);
    throw new AppError('UNSUPPORTED_FORMAT', 'Unrecognised presentation container.');
  }
  if (kind === 'ole') {
    warnings.push(LEGACY_WARNING);
    const lines = extractBinaryText(buf);
    // group into slides of ~8 lines so the result stays readable
    const slides: SlideContent[] = [];
    for (let i = 0; i < lines.length; i += 8) slides.push({ title: i === 0 ? title : undefined, blocks: lines.slice(i, i + 8).map((t) => ({ text: t, style: 'p' as BlockStyle })) });
    if (!slides.length) slides.push({ title, blocks: [{ text: '(No readable text was found in this presentation.)' }] });
    return slidesToPdf(slides, title);
  }
  throw new AppError('UNSUPPORTED_FORMAT');
}

// ---------------------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------------------

interface SheetData {
  name: string;
  rows: string[][];
}

function readWorkbook(inputPath: string, originalName: string): SheetData[] {
  let wb: XLSX.WorkBook;
  try {
    // XLSX.read on a buffer: the ESM build of SheetJS has no fs binding unless set_fs() is called.
    wb = XLSX.read(readFileSync(inputPath), { type: 'buffer', cellDates: true, cellNF: false, cellText: true, raw: false, dense: false });
  } catch (err) {
    throw new AppError('CONVERSION_FAILED', 'This spreadsheet could not be read.', { cause: err });
  }
  const ext = extOf(originalName);
  const sheets: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false }).map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
    let maxCols = 0;
    for (const r of rows) {
      let last = r.length;
      while (last > 0 && !r[last - 1].trim()) last--;
      maxCols = Math.max(maxCols, last);
    }
    const trimmed = rows.map((r) => r.slice(0, maxCols).concat(Array(Math.max(0, maxCols - r.length)).fill('')));
    sheets.push({ name: ext === 'csv' || ext === 'txt' ? path.basename(originalName, path.extname(originalName)) : name, rows: trimmed });
  }
  if (!sheets.length) throw new AppError('CONVERSION_FAILED', 'The workbook has no sheets.');
  return sheets;
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ell = '\u2026';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid) + ell, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ell : '';
}

/** Draw spreadsheet data as bordered tables with pdf-lib. */
export async function sheetsToPdf(sheets: SheetData[], docTitle?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer('PDFly');
  doc.setCreator('PDFly');
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());
  if (docTitle) doc.setTitle(docTitle);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 9;
  const rowH = 14;
  const pad = 4;
  const M = 36;
  const dark = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.55, 0.55, 0.55);
  const border = rgb(0.7, 0.7, 0.7);
  const headerFill = rgb(0.93, 0.93, 0.93);
  const MAX_COLS = 12;

  for (const sheet of sheets) {
    const cols = Math.max(...sheet.rows.map((r) => r.length), 0);
    const landscape = cols > 6;
    const [W, H] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    const rows = sheet.rows.map((r) => r.map((c) => sanitizeForFont(c.replace(/\s+/g, ' ').trim(), regular)));
    const drawTitle = (page: ReturnType<typeof doc.addPage>, suffix: string) => {
      const t = sanitizeForFont(`${sheet.name}${suffix}`, bold);
      page.drawText(truncateToWidth(t, bold, 14, W - M * 2), { x: M, y: H - M, size: 14, font: bold, color: dark });
    };
    if (!cols || !rows.length) {
      const page = doc.addPage([W, H]);
      drawTitle(page, '');
      page.drawText('(empty sheet)', { x: M, y: H - M - 24, size, font: regular, color: grey });
      continue;
    }
    // column chunks of at most MAX_COLS columns
    const chunks: number[][] = [];
    for (let c = 0; c < cols; c += MAX_COLS) chunks.push(Array.from({ length: Math.min(MAX_COLS, cols - c) }, (_, i) => c + i));
    const availW = W - M * 2;
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      // column widths from content (sampled), clamped, then scaled to fit
      let widths = chunk.map((c) => {
        let max = 30;
        const sample = rows.length > 400 ? rows.slice(0, 400) : rows;
        for (let ri = 0; ri < sample.length; ri++) {
          const cell = (sample[ri][c] ?? '').slice(0, 60);
          if (cell) max = Math.max(max, (ri === 0 ? bold : regular).widthOfTextAtSize(cell, size) + pad * 2);
        }
        return Math.min(max, 180);
      });
      const total = widths.reduce((a, b) => a + b, 0);
      if (total > availW) widths = widths.map((w) => (w / total) * availW);
      const suffix = chunks.length > 1 ? ` (columns ${chunk[0] + 1}-${chunk[chunk.length - 1] + 1})` : '';
      const header = rows[0];
      const body = rows.slice(1);
      let page = doc.addPage([W, H]);
      drawTitle(page, suffix);
      let y = H - M - 26;
      const drawRow = (cells: string[], isHeader: boolean) => {
        let x = M;
        const font = isHeader ? bold : regular;
        if (isHeader) page.drawRectangle({ x, y: y - rowH, width: widths.reduce((a, b) => a + b, 0), height: rowH, color: headerFill });
        for (let i = 0; i < chunk.length; i++) {
          const w = widths[i];
          page.drawRectangle({ x, y: y - rowH, width: w, height: rowH, borderColor: border, borderWidth: 0.5 });
          const raw = cells[chunk[i]] ?? '';
          if (raw) {
            const text = truncateToWidth(raw, font, size, w - pad * 2);
            const numeric = !isHeader && /^[-+]?[\d,.]+%?$/.test(raw.trim());
            const tw = numeric ? font.widthOfTextAtSize(text, size) : 0;
            page.drawText(text, { x: numeric ? x + w - pad - tw : x + pad, y: y - rowH + (rowH - size) / 2 + 1, size, font, color: dark });
          }
          x += w;
        }
        y -= rowH;
      };
      drawRow(header, true);
      for (const r of body) {
        if (y - rowH < M) {
          const n = `Page ${doc.getPageCount()}`;
          page.drawText(n, { x: W - M - regular.widthOfTextAtSize(n, 8), y: M / 2, size: 8, font: regular, color: grey });
          page = doc.addPage([W, H]);
          drawTitle(page, `${suffix} (continued)`);
          y = H - M - 26;
          drawRow(header, true);
        }
        drawRow(r, false);
      }
      const n = `Page ${doc.getPageCount()}`;
      page.drawText(n, { x: W - M - regular.widthOfTextAtSize(n, 8), y: M / 2, size: 8, font: regular, color: grey });
    }
  }
  if (doc.getPageCount() === 0) doc.addPage();
  return doc.save({ useObjectStreams: false });
}

async function excelToPdfJs(inputPath: string, originalName: string, workDir: string, puppeteer: boolean): Promise<Uint8Array> {
  const sheets = readWorkbook(inputPath, originalName);
  const title = path.basename(originalName, path.extname(originalName));
  if (puppeteer) {
    const wide = sheets.some((s) => Math.max(...s.rows.map((r) => r.length), 0) > 6);
    const body = sheets
      .map((s, i) => {
        const rows = s.rows
          .map((r, ri) => `<tr>${r.map((c) => (ri === 0 ? `<th>${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join('')}</tr>`)
          .join('');
        return `<section${i > 0 ? ' style="page-break-before:always"' : ''}><h2>${escapeHtml(s.name)}</h2>${rows ? `<table>${rows}</table>` : '<p><em>(empty sheet)</em></p>'}</section>`;
      })
      .join('');
    const css = 'table{font-size:9pt;width:100%}th{background:#eee;text-align:left}td,th{border:1px solid #bbb;padding:2px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}h2{font-size:14pt;margin:0 0 8pt}';
    try {
      const r = await htmlToPdf({ html: wrapOfficeHtml(body, title, css) }, { ...OFFICE_HTML_OPTS, orientation: wide ? 'landscape' : 'portrait', margin: 12 }, workDir);
      if (r.engine === 'puppeteer') return r.pdf;
    } catch {
      /* fall back to pdf-lib tables */
    }
  }
  return sheetsToPdf(sheets, title);
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

export async function officeToPdf(inputPath: string, originalName: string, kind: OfficeKind, workDir: string): Promise<OfficeToPdfResult> {
  if (!existsSync(inputPath)) throw new AppError('NO_FILE');
  const tools = await detectTools();
  const warnings: string[] = [];

  if (tools.soffice) {
    try {
      const pdfPath = await convertWithLibreOffice(tools.soffice, inputPath, originalName, workDir);
      return { pdfPath, engine: 'libreoffice', warnings };
    } catch (err) {
      if (err instanceof AppError && err.code === 'TIMEOUT') throw err;
      warnings.push('LibreOffice failed to convert this file; the built-in converter was used instead.');
    }
  }

  let pdf: Uint8Array;
  try {
    if (kind === 'word') pdf = await wordToPdfJs(inputPath, originalName, workDir, warnings, tools.puppeteer);
    else if (kind === 'powerpoint') pdf = await powerpointToPdfJs(inputPath, originalName, warnings);
    else pdf = await excelToPdfJs(inputPath, originalName, workDir, tools.puppeteer);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.from(err, 'CONVERSION_FAILED');
  }
  const pdfPath = outputPath(workDir, originalName);
  await writeFile(pdfPath, pdf);
  warnings.unshift(JS_WARNING);
  return { pdfPath, engine: 'js', warnings: [...new Set(warnings)] };
}
