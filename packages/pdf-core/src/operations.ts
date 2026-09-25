import { PDFDocument, StandardFonts, degrees, PDFImage, PDFPage, PDFFont } from 'pdf-lib';
import type {
  CropOptions,
  ImageInput,
  ImagesToPdfOptions,
  OrganizeOptions,
  OutputFile,
  PageNumberOptions,
  PdfInfo,
  RotateOptions,
  SplitMode,
  WatermarkOptions,
} from './types';
import {
  assertPages,
  hexToRgb,
  normalizeAngle,
  parsePageRangeGroups,
  resolvePageSize,
  withSuffix,
} from './utils';

const LOAD_OPTS = { ignoreEncryption: true, updateMetadata: false } as const;

async function load(data: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(data, LOAD_OPTS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to read PDF: ${msg}`);
  }
}

function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

function allPages(total: number): number[] {
  return Array.from({ length: total }, (_, i) => i + 1);
}

function stdFont(name: 'Helvetica' | 'TimesRoman' | 'Courier' | undefined) {
  switch (name) {
    case 'TimesRoman':
      return StandardFonts.TimesRoman;
    case 'Courier':
      return StandardFonts.Courier;
    default:
      return StandardFonts.Helvetica;
  }
}

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------

export async function getPdfInfo(data: Uint8Array): Promise<PdfInfo> {
  const doc = await load(data);
  const pages = doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width, height, rotation: p.getRotation().angle };
  });
  return {
    pageCount: doc.getPageCount(),
    pages,
    title: safeMeta(() => doc.getTitle()),
    author: safeMeta(() => doc.getAuthor()),
  };
}

function safeMeta(fn: () => string | undefined) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export async function mergePdfs(inputs: Uint8Array[], title = 'Merged document'): Promise<Uint8Array> {
  if (!inputs.length) throw new Error('No PDF files to merge');
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setProducer('PDFly');
  out.setCreator('PDFly');
  for (const input of inputs) {
    const src = await load(input);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return save(out);
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

async function copySubset(src: PDFDocument, pages: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setProducer('PDFly');
  const copied = await out.copyPages(
    src,
    pages.map((p) => p - 1),
  );
  copied.forEach((p) => out.addPage(p));
  return save(out);
}

export async function splitPdf(
  data: Uint8Array,
  mode: SplitMode,
  baseName = 'document.pdf',
): Promise<OutputFile[]> {
  const src = await load(data);
  const total = src.getPageCount();
  let groups: number[][] = [];

  switch (mode.type) {
    case 'every':
      groups = allPages(total).map((p) => [p]);
      break;
    case 'pages':
      assertPages(mode.pages, total);
      groups = [...new Set(mode.pages)].sort((a, b) => a - b).map((p) => [p]);
      break;
    case 'ranges':
      groups = parsePageRangeGroups(mode.ranges, total);
      break;
    case 'chunk': {
      const size = Math.max(1, Math.floor(mode.size));
      for (let i = 1; i <= total; i += size) {
        groups.push(allPages(total).slice(i - 1, i - 1 + size));
      }
      break;
    }
  }

  if (!groups.length) throw new Error('No pages selected to split');

  const outputs: OutputFile[] = [];
  for (let i = 0; i < groups.length; i++) {
    const pages = groups[i];
    const label =
      pages.length === 1 ? `page-${pages[0]}` : `pages-${pages[0]}-${pages[pages.length - 1]}`;
    outputs.push({
      name: withSuffix(baseName, `-${label}`),
      data: await copySubset(src, pages),
      mimeType: 'application/pdf',
    });
  }
  return outputs;
}

// ---------------------------------------------------------------------------
// Remove / Extract
// ---------------------------------------------------------------------------

export async function removePages(data: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await load(data);
  const total = src.getPageCount();
  assertPages(pages, total);
  const remove = new Set(pages);
  const keep = allPages(total).filter((p) => !remove.has(p));
  if (!keep.length) throw new Error('You cannot remove every page of the document');
  return copySubset(src, keep);
}

export async function extractPages(data: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await load(data);
  const total = src.getPageCount();
  const unique = [...new Set(pages)].sort((a, b) => a - b);
  assertPages(unique, total);
  if (!unique.length) throw new Error('Select at least one page to extract');
  return copySubset(src, unique);
}

// ---------------------------------------------------------------------------
// Organize (reorder, duplicate, rotate, insert from other documents)
// ---------------------------------------------------------------------------

export async function organizePdf(options: OrganizeOptions): Promise<Uint8Array> {
  const { sources, pages } = options;
  if (!sources.length) throw new Error('No source document');
  if (!pages.length) throw new Error('The document would have no pages');
  const docs = await Promise.all(sources.map((s) => load(s)));
  const out = await PDFDocument.create();
  out.setProducer('PDFly');

  // Group copy operations by source to allow pdf-lib to reuse objects.
  for (const op of pages) {
    const src = docs[op.source];
    if (!src) throw new Error(`Unknown source document ${op.source}`);
    assertPages([op.page], src.getPageCount());
    const [copied] = await out.copyPages(src, [op.page - 1]);
    if (op.rotate) {
      const current = copied.getRotation().angle;
      copied.setRotation(degrees(normalizeAngle(current + op.rotate)));
    }
    out.addPage(copied);
  }
  return save(out);
}

// ---------------------------------------------------------------------------
// Rotate
// ---------------------------------------------------------------------------

export async function rotatePdf(data: Uint8Array, options: RotateOptions): Promise<Uint8Array> {
  const doc = await load(data);
  const total = doc.getPageCount();
  const pages = options.pages ?? allPages(total);
  assertPages(pages, total);
  const delta = normalizeAngle(options.angle);
  for (const p of pages) {
    const page = doc.getPage(p - 1);
    page.setRotation(degrees(normalizeAngle(page.getRotation().angle + delta)));
  }
  return save(doc);
}

// ---------------------------------------------------------------------------
// Page numbers
// ---------------------------------------------------------------------------

export function formatPageNumber(format: string, n: number, total: number): string {
  return format.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total));
}

/** Visible (rotated) width/height and a function mapping visual coords to page coords. */
function visualBox(page: PDFPage) {
  const rot = normalizeAngle(page.getRotation().angle);
  const { width, height } = page.getSize();
  const swapped = rot === 90 || rot === 270;
  return { rot, width: swapped ? height : width, height: swapped ? width : height };
}

export async function addPageNumbers(
  data: Uint8Array,
  options: PageNumberOptions,
): Promise<Uint8Array> {
  const doc = await load(data);
  const total = doc.getPageCount();
  const pages = options.pages ?? allPages(total);
  assertPages(pages, total);
  const font = await doc.embedFont(stdFont(options.font));
  const fontSize = options.fontSize ?? 12;
  const margin = options.margin ?? 28;
  const format = options.format || '{n}';
  const start = options.startNumber ?? 1;
  const color = hexToRgb(options.color ?? '#333333');

  for (const p of pages) {
    const page = doc.getPage(p - 1);
    const text = formatPageNumber(format, start + (p - 1), total + start - 1);
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const { width, height, rot } = visualBox(page);

    let vx: number;
    let vy: number;
    if (options.position.endsWith('left')) vx = margin;
    else if (options.position.endsWith('right')) vx = width - margin - textWidth;
    else vx = (width - textWidth) / 2;
    if (options.position.startsWith('top')) vy = height - margin - fontSize;
    else vy = margin;

    drawTextRotated(page, text, vx, vy, rot, { font, size: fontSize, color, textWidth });
  }
  return save(doc);
}

/**
 * Draw text at a visual position, compensating for the page's /Rotate attribute
 * so it always appears upright to the viewer.
 */
function drawTextRotated(
  page: PDFPage,
  text: string,
  vx: number,
  vy: number,
  rot: number,
  o: { font: PDFFont; size: number; color: ReturnType<typeof hexToRgb>; textWidth: number; opacity?: number; extraRotate?: number },
) {
  const { width: pw, height: ph } = page.getSize();
  let x = vx;
  let y = vy;
  // Map visual coordinates (in the rotated frame) back to unrotated page coordinates.
  switch (rot) {
    case 90:
      x = pw - vy;
      y = vx;
      break;
    case 180:
      x = pw - vx;
      y = ph - vy;
      break;
    case 270:
      x = vy;
      y = ph - vx;
      break;
  }
  page.drawText(text, {
    x,
    y,
    size: o.size,
    font: o.font,
    color: o.color,
    opacity: o.opacity,
    rotate: degrees(rot + (o.extraRotate ?? 0)),
  });
}

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

function positionFor(
  position: string,
  boxW: number,
  boxH: number,
  itemW: number,
  itemH: number,
  margin = 36,
): { x: number; y: number } {
  let x = (boxW - itemW) / 2;
  let y = (boxH - itemH) / 2;
  if (position.startsWith('top')) y = boxH - itemH - margin;
  if (position.startsWith('bottom')) y = margin;
  if (position.endsWith('left')) x = margin;
  if (position.endsWith('right')) x = boxW - itemW - margin;
  return { x, y };
}

export async function addWatermark(data: Uint8Array, options: WatermarkOptions): Promise<Uint8Array> {
  const doc = await load(data);
  const total = doc.getPageCount();
  const pages = options.pages ?? allPages(total);
  assertPages(pages, total);
  const opacity = Math.min(1, Math.max(0, options.opacity ?? 0.3));
  const rotation = options.rotation ?? 0;
  const position = options.position ?? 'center';

  if (options.type === 'text') {
    if (!options.text?.trim()) throw new Error('Watermark text is empty');
    const font = await doc.embedFont(stdFont(options.font));
    const size = options.fontSize ?? 48;
    const color = hexToRgb(options.color ?? '#ff0000');
    const textWidth = font.widthOfTextAtSize(options.text, size);
    for (const p of pages) {
      const page = doc.getPage(p - 1);
      const { width, height, rot } = visualBox(page);
      if (position === 'tile') {
        const stepX = textWidth + 80;
        const stepY = size + 100;
        for (let yy = -stepY; yy < height + stepY; yy += stepY) {
          for (let xx = -stepX; xx < width + stepX; xx += stepX) {
            drawTextRotated(page, options.text, xx, yy, rot, {
              font,
              size,
              color,
              textWidth,
              opacity,
              extraRotate: rotation,
            });
          }
        }
      } else {
        // Center of the rotated text box should sit at the target position.
        const { x, y } = positionFor(position, width, height, textWidth, size);
        const rad = (rotation * Math.PI) / 180;
        const cx = x + textWidth / 2;
        const cy = y + size / 2;
        const ox = cx - (Math.cos(rad) * textWidth) / 2 + (Math.sin(rad) * size) / 2;
        const oy = cy - (Math.sin(rad) * textWidth) / 2 - (Math.cos(rad) * size) / 2;
        drawTextRotated(page, options.text, ox, oy, rot, {
          font,
          size,
          color,
          textWidth,
          opacity,
          extraRotate: rotation,
        });
      }
    }
  } else {
    const image =
      options.imageType === 'image/png'
        ? await doc.embedPng(options.image)
        : await doc.embedJpg(options.image);
    const scale = Math.min(1, Math.max(0.02, options.scale ?? 0.4));
    for (const p of pages) {
      const page = doc.getPage(p - 1);
      const { width, height, rot } = visualBox(page);
      const w = width * scale;
      const h = (image.height / image.width) * w;
      if (position === 'tile') {
        for (let yy = 0; yy < height; yy += h + 60) {
          for (let xx = 0; xx < width; xx += w + 60) {
            drawImageRotated(page, image, xx, yy, w, h, rot, rotation, opacity);
          }
        }
      } else {
        const { x, y } = positionFor(position, width, height, w, h);
        const rad = (rotation * Math.PI) / 180;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const ox = cx - (Math.cos(rad) * w) / 2 + (Math.sin(rad) * h) / 2;
        const oy = cy - (Math.sin(rad) * w) / 2 - (Math.cos(rad) * h) / 2;
        drawImageRotated(page, image, ox, oy, w, h, rot, rotation, opacity);
      }
    }
  }
  return save(doc);
}

function drawImageRotated(
  page: PDFPage,
  image: PDFImage,
  vx: number,
  vy: number,
  w: number,
  h: number,
  rot: number,
  extraRotate: number,
  opacity: number,
) {
  const { width: pw, height: ph } = page.getSize();
  let x = vx;
  let y = vy;
  switch (rot) {
    case 90:
      x = pw - vy;
      y = vx;
      break;
    case 180:
      x = pw - vx;
      y = ph - vy;
      break;
    case 270:
      x = vy;
      y = ph - vx;
      break;
  }
  page.drawImage(image, { x, y, width: w, height: h, opacity, rotate: degrees(rot + extraRotate) });
}

// ---------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------

export async function cropPdf(data: Uint8Array, options: CropOptions): Promise<Uint8Array> {
  const doc = await load(data);
  const total = doc.getPageCount();
  const pages = options.pages ?? allPages(total);
  assertPages(pages, total);
  const { box } = options;
  if (box.width <= 0 || box.height <= 0) throw new Error('Crop area is empty');

  for (const p of pages) {
    const page = doc.getPage(p - 1);
    const { width, height, rot } = visualBox(page);
    // Visual crop rectangle (origin top-left) in the rotated frame.
    const vx = Math.max(0, Math.min(1, box.x)) * width;
    const vyTop = Math.max(0, Math.min(1, box.y)) * height;
    const vw = Math.min(1 - box.x, box.width) * width;
    const vh = Math.min(1 - box.y, box.height) * height;
    const vyBottom = height - vyTop - vh;

    // Map to page coordinates (unrotated frame, origin bottom-left).
    // Visual frame: width x height, origin top-left. For /Rotate 90 the page is shown
    // rotated clockwise, so page x runs visually downwards and page y runs visually rightwards.
    const mb = page.getMediaBox();
    let x = vx;
    let y = vyBottom;
    let w = vw;
    let h = vh;
    switch (rot) {
      case 90:
        x = vyTop;
        y = vx;
        w = vh;
        h = vw;
        break;
      case 180:
        x = width - vx - vw;
        y = vyTop;
        break;
      case 270:
        x = height - vyTop - vh;
        y = width - vx - vw;
        w = vh;
        h = vw;
        break;
    }
    const nx = mb.x + x;
    const ny = mb.y + y;
    page.setCropBox(nx, ny, w, h);
    page.setMediaBox(nx, ny, w, h);
  }
  return save(doc);
}

// ---------------------------------------------------------------------------
// Images -> PDF
// ---------------------------------------------------------------------------

export async function imagesToPdf(
  images: ImageInput[],
  options: ImagesToPdfOptions = {},
): Promise<Uint8Array> {
  if (!images.length) throw new Error('Add at least one image');
  const doc = await PDFDocument.create();
  doc.setTitle(options.title ?? 'Images');
  doc.setProducer('PDFly');
  doc.setCreator('PDFly');
  const margin = Math.max(0, options.margin ?? 0);
  const fit = options.fit ?? 'fit';
  const pageSizeName = options.pageSize ?? 'A4';

  for (const img of images) {
    let embedded: PDFImage;
    try {
      embedded =
        img.mimeType === 'image/png' ? await doc.embedPng(img.data) : await doc.embedJpg(img.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not read image ${img.name ?? ''}: ${msg}`);
    }
    // `img.rotation` is clockwise (like the PDF /Rotate attribute); pdf-lib's drawImage
    // rotates counter-clockwise, so convert.
    const rotation = normalizeAngle(-(img.rotation ?? 0));
    const swapped = rotation === 90 || rotation === 270;
    // Visual size of the (rotated) image at 72dpi.
    const imgW = swapped ? embedded.height : embedded.width;
    const imgH = swapped ? embedded.width : embedded.height;

    let pageW: number;
    let pageH: number;
    if (pageSizeName === 'Fit') {
      pageW = imgW + margin * 2;
      pageH = imgH + margin * 2;
    } else {
      const orientation =
        options.orientation === 'auto' || !options.orientation
          ? imgW > imgH
            ? 'landscape'
            : 'portrait'
          : options.orientation;
      [pageW, pageH] = resolvePageSize(pageSizeName, orientation, options.customSize);
    }

    const page = doc.addPage([pageW, pageH]);
    const availW = Math.max(1, pageW - margin * 2);
    const availH = Math.max(1, pageH - margin * 2);

    let drawW: number;
    let drawH: number;
    if (fit === 'original') {
      drawW = imgW;
      drawH = imgH;
      // still cap to page so nothing is lost
      const s = Math.min(1, availW / drawW, availH / drawH);
      drawW *= s;
      drawH *= s;
    } else if (fit === 'fill') {
      const s = Math.max(availW / imgW, availH / imgH);
      drawW = imgW * s;
      drawH = imgH * s;
    } else {
      const s = Math.min(availW / imgW, availH / imgH);
      drawW = imgW * s;
      drawH = imgH * s;
    }

    const cx = pageW / 2;
    const cy = pageH / 2;

    if (fit === 'fill') {
      // Clip to the content area so overflow does not paint outside the margin.
      page.pushOperators(
        ...clipRect(margin, margin, availW, availH),
      );
    }

    // pdf-lib rotates around the bottom-left corner of the image; compute the
    // placement so that the rotated image is centered.
    const w = swapped ? drawH : drawW; // unrotated draw width
    const h = swapped ? drawW : drawH;
    let x = cx - w / 2;
    let y = cy - h / 2;
    switch (rotation) {
      case 90:
        x = cx + h / 2;
        y = cy - w / 2;
        break;
      case 180:
        x = cx + w / 2;
        y = cy + h / 2;
        break;
      case 270:
        x = cx - h / 2;
        y = cy + w / 2;
        break;
    }
    page.drawImage(embedded, { x, y, width: w, height: h, rotate: degrees(rotation) });
  }
  return save(doc);
}

// Minimal clipping path operators (q is pushed by drawImage itself; we wrap with our own state).
import { pushGraphicsState, moveTo, lineTo, closePath, clip, endPath } from 'pdf-lib';
function clipRect(x: number, y: number, w: number, h: number) {
  return [
    pushGraphicsState(),
    moveTo(x, y),
    lineTo(x + w, y),
    lineTo(x + w, y + h),
    lineTo(x, y + h),
    closePath(),
    clip(),
    endPath(),
  ];
}

// ---------------------------------------------------------------------------
// Insert blank page / duplicate helpers used by editor & organizer
// ---------------------------------------------------------------------------

export async function insertBlankPage(
  data: Uint8Array,
  index: number,
  size?: [number, number],
): Promise<Uint8Array> {
  const doc = await load(data);
  const ref = doc.getPageCount() ? doc.getPage(Math.min(index, doc.getPageCount() - 1)) : undefined;
  const dims = size ?? (ref ? [ref.getWidth(), ref.getHeight()] : [595.28, 841.89]);
  doc.insertPage(Math.max(0, Math.min(index, doc.getPageCount())), dims as [number, number]);
  return save(doc);
}

/** Re-save through pdf-lib. Useful to normalize/repair mildly broken files. */
export async function resavePdf(data: Uint8Array): Promise<Uint8Array> {
  const doc = await load(data);
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}
