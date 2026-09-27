/**
 * Office documents (Word / PowerPoint / Excel) -> PDF, entirely in the browser.
 *
 * The document content is extracted (mammoth for .docx, SheetJS for spreadsheets, the slide
 * XML for .pptx, ODF content.xml, RTF and a best-effort scan of legacy binaries) and laid
 * out with pdf-lib. The result is always a readable, text-selectable PDF; layout fidelity is
 * reduced compared to the original application.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import { normalizeImageForPdf } from '@/utils/file';
import { assertNotAborted, engineError, latin1Decode, utf8Decode } from './common';
import { textToPdf, htmlToBlocks, decodeHtmlEntities, sanitizeForFont, wrapText, type TextBlock, type BlockStyle } from './textPdf';

export type OfficeKind = 'word' | 'powerpoint' | 'excel';

export interface OfficeToPdfOptions {
  signal?: AbortSignal;
  onProgress?: (stage: string, fraction: number | null) => void;
}

export interface OfficeToPdfResult {
  pdf: Uint8Array;
  engine: 'js';
  warnings: string[];
}

const JS_WARNING = 'Converted with the built-in converter: text and images are kept, layout fidelity is reduced.';
const LEGACY_WARNING = 'Legacy binary formats (.doc/.ppt) are converted best-effort: only the readable text is kept.';

function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function titleOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return (idx > 0 ? name.slice(0, idx) : name) || 'document';
}

type Container = 'zip' | 'ole' | 'rtf' | 'text';

function sniff(buf: Uint8Array): Container {
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  if (buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 && buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1) return 'ole';
  if (latin1Decode(buf.subarray(0, 5)) === '{\\rtf') return 'rtf';
  return 'text';
}

/** Read every file entry of a ZIP container (OOXML / ODF) into memory. */
export async function readZipEntries(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const { default: JSZip } = await import('jszip');
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw engineError('UNSUPPORTED_FORMAT', 'The file is not a valid Office document (damaged ZIP container).');
  }
  const out = new Map<string, Uint8Array>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    out.set(name, await entry.async('uint8array'));
  }
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
  par: '\n', line: '\n', tab: '\t', cell: ' | ', row: '\n', page: '\n\n', sect: '\n\n', bullet: '•', endash: '–', emdash: '—',
  lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', enspace: ' ', emspace: ' ', qmspace: ' ', '~': '\xa0', '_': '-', '-': '', '{': '{', '}': '}', '\\': '\\',
  nestcell: ' | ', nestrow: '\n', chdate: '', chtime: '', chpgn: '', sectd: '', ldblquot: '“', rdblquot: '”',
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

function utf16leDecode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  return s;
}

/**
 * Best-effort text extraction from legacy OLE binaries (.doc/.ppt/.xls): scans for runs of
 * printable 8-bit and UTF-16LE characters and keeps the ones that look like prose.
 */
export function extractBinaryText(buf: Uint8Array): string[] {
  const runs: { pos: number; text: string }[] = [];
  const printable8 = (b: number) => (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0b || b === 0x0d || b === 0x0a || (b >= 0xa0 && b <= 0xff);
  // 8-bit runs
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const ok = i < buf.length && printable8(buf[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= 6) runs.push({ pos: start, text: latin1Decode(buf.subarray(start, i)) });
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
        if (count >= 6) runs.push({ pos: s, text: utf16leDecode(buf.subarray(s, s + count * 2)) });
        s = -1;
      }
    }
  }
  runs.sort((a, b) => a.pos - b.pos);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of runs) {
    // eslint-disable-next-line no-control-regex -- legacy binaries separate text runs with control characters
    for (const piece of r.text.split(/[\r\n\x0b\x0c\x07]+/)) {
      // eslint-disable-next-line no-control-regex
      const t = piece.replace(/[\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (t.length < 4 || !isReadable(t) || NOISE_RE.test(t) || seen.has(t)) continue;
      // drop things that look like binary garbage or file paths
      if (/^[\W_]+$/.test(t) || /[\x80-\xa0]{2,}/.test(t) || /^[A-Za-z]:\\/.test(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------

/** Turn any browser-decodable image into PNG/JPEG bytes pdf-lib can embed (null when it cannot be decoded). */
async function toEmbeddable(data: Uint8Array, mimeType?: string): Promise<{ data: Uint8Array; mimeType: 'image/png' | 'image/jpeg' } | null> {
  if (data[0] === 0x89 && data[1] === 0x50) return { data, mimeType: 'image/png' };
  if (data[0] === 0xff && data[1] === 0xd8) return { data, mimeType: 'image/jpeg' };
  try {
    return await normalizeImageForPdf(new Blob([data as BlobPart], { type: mimeType ?? 'application/octet-stream' }), { maxDimension: 1600, preferPng: true });
  } catch {
    return null;
  }
}

/** Resolve the images mammoth left as base64 data URIs (htmlToBlocks keeps PNG/JPEG; convert the rest). */
async function embedHtmlImages(html: string): Promise<string> {
  const re = /<img\b[^>]*\bsrc\s*=\s*"data:(image\/[a-z0-9.+-]+);base64,([^"]+)"[^>]*>/gi;
  const matches = [...html.matchAll(re)];
  let out = html;
  for (const m of matches) {
    const type = m[1].toLowerCase();
    if (type === 'image/png' || type === 'image/jpeg') continue;
    let replacement = '';
    try {
      const bytes = Uint8Array.from(atob(m[2].replace(/\s+/g, '')), (c) => c.charCodeAt(0));
      const img = await toEmbeddable(bytes, type);
      if (img) {
        let b64 = '';
        for (let i = 0; i < img.data.length; i += 0x8000) b64 += String.fromCharCode.apply(null, img.data.subarray(i, i + 0x8000) as unknown as number[]);
        replacement = `<img src="data:${img.mimeType};base64,${btoa(b64)}">`;
      }
    } catch {
      replacement = '';
    }
    out = out.replace(m[0], replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------------------

async function wordToPdf(buf: Uint8Array, originalName: string, warnings: string[]): Promise<Uint8Array> {
  const ext = extOf(originalName);
  const kind = sniff(buf);
  const title = titleOf(originalName);

  if (kind === 'zip') {
    const entries = await readZipEntries(buf);
    if (entries.has('word/document.xml')) {
      const mammoth = await import('mammoth');
      let html: string;
      try {
        const r = await mammoth.convertToHtml({ arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer });
        html = r.value;
      } catch {
        throw engineError('CONVERSION_FAILED', 'This Word document could not be read.');
      }
      if (!html.trim()) html = '<p></p>';
      const blocks = htmlToBlocks(await embedHtmlImages(html));
      return textToPdf(blocks.length ? blocks : [{ text: '' }], { title });
    }
    const content = entries.get('content.xml');
    if (content) {
      const blocks = odfXmlToBlocks(utf8Decode(content));
      return textToPdf(blocks.length ? blocks : [{ text: '' }], { title });
    }
    throw engineError('UNSUPPORTED_FORMAT', 'Unrecognised document container.');
  }
  if (kind === 'rtf') {
    const text = rtfToText(latin1Decode(buf));
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
    const text = utf8Decode(buf).replace(/�/g, '');
    const blocks = text.split(/\r?\n\r?\n/).map((p) => ({ text: p.trim() })).filter((b) => b.text);
    return textToPdf(blocks.length ? blocks : [{ text: '' }], { title });
  }
  throw engineError('UNSUPPORTED_FORMAT', 'Unsupported file format.');
}

// ---------------------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------------------

interface SlideContent {
  title?: string;
  blocks: TextBlock[];
  image?: Uint8Array;
}

function xmlText(fragment: string): string {
  return decodeHtmlEntities(fragment.replace(/<[^>]+>/g, ''));
}

export function parsePptxSlide(xml: string): { title?: string; blocks: TextBlock[]; imageRel?: string; hidden: boolean } {
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

/** Normalise a relationship target ("../media/x.png" relative to `baseDir`) to a zip entry name. */
function resolveRel(relsXml: string | undefined, id: string | undefined, baseDir: string): string | undefined {
  if (!relsXml || !id) return undefined;
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    if (/\bId="([^"]+)"/.exec(attrs)?.[1] !== id) continue;
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (!target || /^https?:/i.test(target)) return undefined;
    if (target.startsWith('/')) return target.slice(1);
    const parts = [...baseDir.split('/'), ...target.split('/')];
    const out: string[] = [];
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') out.pop();
      else out.push(p);
    }
    return out.join('/');
  }
  return undefined;
}

async function toPdfImage(doc: PDFDocument, data: Uint8Array): Promise<PDFImage | null> {
  try {
    const img = await toEmbeddable(data);
    if (!img) return null;
    return img.mimeType === 'image/png' ? await doc.embedPng(img.data) : await doc.embedJpg(img.data);
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
        if (line.style === 'li' && line.first) page.drawText('•', { x: M + 2, y: yy - size, size, font: regular, color: dark });
        if (line.text) page.drawText(line.text, { x: M + indent, y: yy - size, size, font, color: dark });
        yy -= lineH;
        prevStyle = line.style;
      }
      if (truncated) page.drawText('…', { x: M, y: M - 4, size: 12, font: regular, color: grey });
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

function pptxToSlides(entries: Map<string, Uint8Array>): SlideContent[] {
  const slideNames = [...entries.keys()]
    .map((k) => ({ k, m: /^ppt\/slides\/slide(\d+)\.xml$/.exec(k) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m![1]) - Number(b.m![1]));
  const slides: SlideContent[] = [];
  for (const { k, m } of slideNames) {
    const xml = utf8Decode(entries.get(k)!);
    const parsed = parsePptxSlide(xml);
    if (parsed.hidden) continue;
    let image: Uint8Array | undefined;
    if (parsed.imageRel) {
      const relsBytes = entries.get(`ppt/slides/_rels/slide${m![1]}.xml.rels`);
      const target = resolveRel(relsBytes ? utf8Decode(relsBytes) : undefined, parsed.imageRel, 'ppt/slides');
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

async function powerpointToPdf(buf: Uint8Array, originalName: string, warnings: string[]): Promise<Uint8Array> {
  const kind = sniff(buf);
  const title = titleOf(originalName);
  if (kind === 'zip') {
    const entries = await readZipEntries(buf);
    if (entries.has('ppt/presentation.xml') || [...entries.keys()].some((k) => k.startsWith('ppt/slides/'))) {
      return slidesToPdf(pptxToSlides(entries), title);
    }
    const content = entries.get('content.xml');
    if (content) return slidesToPdf(odpToSlides(utf8Decode(content)), title);
    throw engineError('UNSUPPORTED_FORMAT', 'Unrecognised presentation container.');
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
  throw engineError('UNSUPPORTED_FORMAT', 'Unsupported file format.');
}

// ---------------------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------------------

export interface SheetData {
  name: string;
  rows: string[][];
}

async function readWorkbook(buf: Uint8Array, originalName: string): Promise<SheetData[]> {
  const XLSX = await import('xlsx');
  let wb: import('xlsx').WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellDates: true, cellNF: false, cellText: true, raw: false, dense: false });
  } catch {
    throw engineError('CONVERSION_FAILED', 'This spreadsheet could not be read.');
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
    sheets.push({ name: ext === 'csv' || ext === 'txt' ? titleOf(originalName) : name, rows: trimmed });
  }
  if (!sheets.length) throw engineError('CONVERSION_FAILED', 'The workbook has no sheets.');
  return sheets;
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ell = '…';
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

async function excelToPdf(buf: Uint8Array, originalName: string): Promise<Uint8Array> {
  const sheets = await readWorkbook(buf, originalName);
  return sheetsToPdf(sheets, titleOf(originalName));
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

export async function officeToPdf(buf: Uint8Array, originalName: string, kind: OfficeKind, opts: OfficeToPdfOptions = {}): Promise<OfficeToPdfResult> {
  if (!buf.length) throw engineError('EMPTY_FILE', 'The file is empty.');
  const warnings: string[] = [JS_WARNING];
  assertNotAborted(opts.signal);
  opts.onProgress?.('Converting...', null);
  let pdf: Uint8Array;
  try {
    if (kind === 'word') pdf = await wordToPdf(buf, originalName, warnings);
    else if (kind === 'powerpoint') pdf = await powerpointToPdf(buf, originalName, warnings);
    else pdf = await excelToPdf(buf, originalName);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    throw engineError('CONVERSION_FAILED', 'The conversion failed. Please try another file.');
  }
  assertNotAborted(opts.signal);
  return { pdf, engine: 'js', warnings: [...new Set(warnings)] };
}
