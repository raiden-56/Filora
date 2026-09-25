/**
 * Plain-text PDF renderer (pdf-lib, standard fonts) used by the pure-JS fallbacks when no
 * browser engine or LibreOffice is available. Supports headings, paragraphs, bullet items
 * and monospace blocks with proper word wrapping and pagination.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type BlockStyle = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'mono';

export interface TextBlock {
  text: string;
  style?: BlockStyle;
}

export type TextPageSize = 'A4' | 'A3' | 'Letter' | 'Legal';

export interface TextPdfOptions {
  pageSize?: TextPageSize | [number, number];
  landscape?: boolean;
  /** page margin in points (default 56 = ~20mm) */
  margin?: number;
  /** body font size in points (default 11) */
  fontSize?: number;
  title?: string;
  /** draw "Page n" at the bottom of every page */
  pageNumbers?: boolean;
  /** small text drawn at the top / bottom of every page */
  header?: string;
  footer?: string;
}

export const TEXT_PAGE_SIZES: Record<TextPageSize, [number, number]> = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  Letter: [612, 792],
  Legal: [612, 1008],
};

export function resolveTextPageSize(size: TextPageSize | [number, number] | undefined, landscape?: boolean): [number, number] {
  const base: [number, number] = Array.isArray(size) ? size : TEXT_PAGE_SIZES[size ?? 'A4'];
  const [w, h] = base;
  return landscape ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
}

const charsetCache = new WeakMap<PDFFont, Set<number>>();

/** Replace characters that a WinAnsi standard font cannot encode. */
export function sanitizeForFont(text: string, font: PDFFont): string {
  let set = charsetCache.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsetCache.set(font, set);
  }
  let out = '';
  const cleaned = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\u200b-\u200f\u2028\u2029\ufeff\u00ad]/g, '');
  for (const ch of cleaned) {
    const cp = ch.codePointAt(0)!;
    if (cp === 10 || set.has(cp)) {
      out += ch;
      continue;
    }
    if (cp < 32) continue;
    // try to strip diacritics (e.g. "\u0219" -> "s")
    const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    let replaced = '';
    for (const b of base) {
      const bcp = b.codePointAt(0)!;
      replaced += set.has(bcp) ? b : '';
    }
    out += replaced || '?';
  }
  return out;
}

function widthOf(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

/** Break a single line of text into lines that fit `maxWidth`. Long words are split. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const words = text.split(' ');
  let line = '';
  const pushWord = (word: string) => {
    if (widthOf(font, word, size) <= maxWidth) {
      line = word;
      return;
    }
    // split an over-long word character by character
    let part = '';
    for (const ch of word) {
      if (widthOf(font, part + ch, size) > maxWidth && part) {
        lines.push(part);
        part = '';
      }
      part += ch;
    }
    line = part;
  };
  for (const word of words) {
    if (!word) {
      if (line) line += ' ';
      continue;
    }
    if (!line) {
      pushWord(word);
      continue;
    }
    const candidate = line.endsWith(' ') ? line + word : `${line} ${word}`;
    if (widthOf(font, candidate, size) <= maxWidth) line = candidate;
    else {
      lines.push(line.trimEnd());
      pushWord(word);
    }
  }
  lines.push(line.trimEnd());
  return lines.length ? lines : [''];
}

interface StyleSpec {
  scale: number;
  bold: boolean;
  mono: boolean;
  before: number;
  after: number;
  indent: number;
}

const STYLES: Record<BlockStyle, StyleSpec> = {
  h1: { scale: 1.8, bold: true, mono: false, before: 14, after: 8, indent: 0 },
  h2: { scale: 1.45, bold: true, mono: false, before: 12, after: 6, indent: 0 },
  h3: { scale: 1.2, bold: true, mono: false, before: 10, after: 4, indent: 0 },
  p: { scale: 1, bold: false, mono: false, before: 0, after: 7, indent: 0 },
  li: { scale: 1, bold: false, mono: false, before: 0, after: 3, indent: 14 },
  mono: { scale: 0.9, bold: false, mono: true, before: 4, after: 8, indent: 0 },
};

/** Render text blocks to a PDF. Always yields at least one page. */
export async function textToPdf(blocks: TextBlock[], opts: TextPdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer('PDFly');
  doc.setCreator('PDFly');
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());
  if (opts.title) doc.setTitle(opts.title);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const [pw, ph] = resolveTextPageSize(opts.pageSize, opts.landscape);
  const margin = Math.max(18, Math.min(opts.margin ?? 56, Math.min(pw, ph) / 3));
  const base = opts.fontSize ?? 11;
  const width = pw - margin * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.45, 0.45, 0.45);
  const pages: PDFPage[] = [];
  let page = null as unknown as PDFPage;
  let y = 0;

  const decoratePage = (p: PDFPage, index: number) => {
    const small = 8;
    if (opts.header) {
      const t = sanitizeForFont(opts.header, regular);
      p.drawText(t, { x: margin, y: ph - margin / 2, size: small, font: regular, color: grey });
    }
    const footerParts: string[] = [];
    if (opts.footer) footerParts.push(sanitizeForFont(opts.footer, regular));
    if (opts.footer) p.drawText(footerParts[0], { x: margin, y: margin / 2 - small / 2, size: small, font: regular, color: grey });
    if (opts.pageNumbers) {
      const t = `Page ${index + 1}`;
      p.drawText(t, { x: pw - margin - widthOf(regular, t, small), y: margin / 2 - small / 2, size: small, font: regular, color: grey });
    }
  };
  const newPage = () => {
    page = doc.addPage([pw, ph]);
    pages.push(page);
    decoratePage(page, pages.length - 1);
    y = ph - margin;
    return page;
  };
  newPage();

  for (const block of blocks) {
    const style = STYLES[block.style ?? 'p'];
    const font = style.mono ? mono : style.bold ? bold : regular;
    const size = base * style.scale;
    const lineHeight = size * 1.35;
    if (y < ph - margin - 0.5) y -= style.before;
    const text = sanitizeForFont(block.text ?? '', font);
    const rawLines = text.split('\n');
    const lines: string[] = [];
    for (const raw of rawLines) lines.push(...wrapText(raw, font, size, width - style.indent));
    for (let i = 0; i < lines.length; i++) {
      if (y - lineHeight < margin) newPage();
      const p = page;
      const baseline = y - size;
      if (block.style === 'li' && i === 0) p.drawText('\u2022', { x: margin + 2, y: baseline, size, font: regular, color: black });
      if (lines[i]) p.drawText(lines[i], { x: margin + style.indent, y: baseline, size, font, color: black });
      y -= lineHeight;
    }
    y -= style.after;
  }
  return doc.save({ useObjectStreams: false });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  bull: '\u2022',
  middot: '\u00b7',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  sect: '\u00a7',
  deg: '\u00b0',
  times: '\u00d7',
  divide: '\u00f7',
  plusmn: '\u00b1',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  para: '\u00b6',
  larr: '\u2190',
  rarr: '\u2192',
  uarr: '\u2191',
  darr: '\u2193',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '',
  zwj: '',
  shy: '',
};

/** Decode HTML character references (named, decimal and hexadecimal). */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const v = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return v !== undefined ? v : m;
  });
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'dl', 'dt', 'dd',
  'figure', 'figcaption', 'form', 'fieldset', 'address', 'hr', 'details', 'summary', 'body', 'html', 'center', 'caption', 'legend', 'option', 'label', 'button',
]);

/**
 * Convert simple HTML into text blocks: h1-h3 (h4-h6 map to h3), paragraphs and other
 * block elements, list items, <br>, <pre> and table cells (joined with " | ").
 */
export function htmlToBlocks(html: string): TextBlock[] {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|title|head|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const blocks: TextBlock[] = [];
  let buf = '';
  let style: BlockStyle = 'p';
  let pre = false;
  let listDepth = 0;
  const flush = () => {
    // outside <pre>, the only newlines left in `buf` come from <br>
    const t = pre ? buf.replace(/^\n+|\n+$/g, '') : buf.replace(/[ \t\r\xa0]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
    if (t) blocks.push({ text: t, style });
    buf = '';
  };
  const defaultStyle = (): BlockStyle => (listDepth > 0 ? 'li' : 'p');
  const re = /<[!?][^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>|[^<]+/g;
  for (const m of cleaned.matchAll(re)) {
    const token = m[0];
    const tag = m[1]?.toLowerCase();
    if (!tag) {
      if (token.startsWith('<')) continue; // doctype / processing instruction
      let text = decodeHtmlEntities(token);
      if (!pre) text = text.replace(/[ \t\r\n]+/g, ' ');
      buf += text;
      continue;
    }
    const closing = token.startsWith('</');
    if (/^h[1-6]$/.test(tag)) {
      flush();
      if (closing) style = defaultStyle();
      else style = tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : 'h3';
      continue;
    }
    if (tag === 'pre') {
      flush();
      pre = !closing;
      style = closing ? defaultStyle() : 'mono';
      continue;
    }
    if (tag === 'br') {
      buf += '\n';
      continue;
    }
    if (tag === 'li') {
      flush();
      style = closing ? defaultStyle() : 'li';
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      flush();
      listDepth = Math.max(0, listDepth + (closing ? -1 : 1));
      style = defaultStyle();
      continue;
    }
    if (tag === 'td' || tag === 'th') {
      if (!closing && buf.trim()) buf += ' | ';
      continue;
    }
    if (tag === 'img') {
      const alt = /\balt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token);
      const text = alt?.[2] ?? alt?.[3] ?? alt?.[4];
      if (text) buf += ` [${decodeHtmlEntities(text)}] `;
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      flush();
      if (!pre && tag !== 'html' && tag !== 'body') style = defaultStyle();
      continue;
    }
    // inline elements are ignored
  }
  flush();
  return blocks;
}

/** Turn plain text into paragraphs (blank-line separated). */
export function plainTextToBlocks(text: string): TextBlock[] {
  const norm = text.replace(/\r\n?/g, '\n');
  return norm
    .split(/\n{2,}/)
    .map((s) => s.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean)
    .map((t) => ({ text: t, style: 'p' as BlockStyle }));
}
