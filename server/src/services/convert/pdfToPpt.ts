/**
 * PDF -> PPTX with pptxgenjs. One slide per page; the slide size follows the first page's
 * aspect ratio (capped at 13.333in wide).
 *
 * - 'image': each page as a full-slide picture (faithful, not editable)
 * - 'text':  text blocks placed as editable text boxes at their original positions
 * - 'both':  page picture as the slide background + editable text boxes on top
 */
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import PptxGenJS from 'pptxgenjs';
import { AppError } from '../../utils/errors.js';
import { openPdfDocument, renderPdfPages, type RenderedPage } from '../render.js';
import { extractTextBlocks, type PageTextLayout } from './textLayout.js';
import type { PdfToPptResult } from './types.js';

export interface PdfToPptOptions {
  mode: 'image' | 'text' | 'both';
  dpi: number;
}

const MAX_WIDTH_IN = 13.333;
const MAX_HEIGHT_IN = 13.333;
const MAX_IMAGE_DPI = 150;

export async function pdfToPptx(pdfPath: string, workDir: string, opts: PdfToPptOptions): Promise<PdfToPptResult> {
  const bytes = await readFile(pdfPath);
  const doc = await openPdfDocument(bytes);
  const warnings = new Set<string>();
  try {
    const pageCount = doc.numPages;
    if (!pageCount) throw new AppError('CONVERSION_FAILED', 'The PDF has no pages.');
    const layouts: PageTextLayout[] = [];
    for (let p = 1; p <= pageCount; p++) {
      try {
        layouts.push(await extractTextBlocks(doc, p));
      } catch (err) {
        throw AppError.from(err, 'CONVERSION_FAILED');
      }
    }

    // Slide size from the first page (points -> inches), capped for PowerPoint.
    const first = layouts[0];
    let slideW = first.width / 72;
    let slideH = first.height / 72;
    const cap = Math.min(1, MAX_WIDTH_IN / slideW, MAX_HEIGHT_IN / slideH);
    slideW = round3(slideW * cap);
    slideH = round3(slideH * cap);

    const needImages = opts.mode !== 'text';
    const images = new Map<number, RenderedPage>();
    if (needImages) {
      const dpi = Math.min(MAX_IMAGE_DPI, Math.max(36, opts.dpi || 150));
      try {
        const rendered = await renderPdfPages(bytes, { dpi, format: 'png', maxDimension: 3000 }, workDir);
        for (const r of rendered) images.set(r.page, r);
      } catch (err) {
        throw AppError.from(err, 'CONVERSION_FAILED');
      }
    }

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'PDF', width: slideW, height: slideH });
    pptx.layout = 'PDF';
    pptx.title = path.basename(pdfPath, path.extname(pdfPath));
    pptx.author = 'PDFly';

    const textPages = layouts.filter((l) => l.hasText).length;
    if (opts.mode !== 'image' && textPages === 0) warnings.add('No text layer found – the slides contain page images only. Run OCR first for editable text.');
    if (opts.mode !== 'image' && textPages > 0) warnings.add('Text boxes were positioned from the PDF text layer; fonts and exact spacing may differ from the original.');

    for (let idx = 0; idx < layouts.length; idx++) {
      const layout = layouts[idx];
      const pageNo = idx + 1;
      const slide = pptx.addSlide();
      // Fit this page into the slide, keeping its aspect ratio (pages may differ in size).
      const pageWIn = layout.width / 72;
      const pageHIn = layout.height / 72;
      const s = Math.min(slideW / pageWIn, slideH / pageHIn);
      const drawW = pageWIn * s;
      const drawH = pageHIn * s;
      const offX = (slideW - drawW) / 2;
      const offY = (slideH - drawH) / 2;
      const fullSlide = Math.abs(drawW - slideW) < 0.02 && Math.abs(drawH - slideH) < 0.02;
      if (!fullSlide) warnings.add(`Page ${pageNo} has a different size than the first page; it was fitted onto the slide.`);

      const img = images.get(pageNo);
      const wantImage = opts.mode === 'image' || opts.mode === 'both' || (opts.mode === 'text' && !layout.hasText);
      if (wantImage && img) {
        const data = `image/png;base64,${img.data.toString('base64')}`;
        if (opts.mode === 'both' && fullSlide) slide.background = { data };
        else slide.addImage({ data, x: round3(offX), y: round3(offY), w: round3(drawW), h: round3(drawH) });
      } else if (wantImage && !img) {
        warnings.add(`Page ${pageNo} could not be rendered.`);
      }
      if (opts.mode === 'text' && !layout.hasText && !img) {
        // In text mode we do not render pages, so leave a visible hint on scanned pages.
        slide.addText('(No text layer found on this page – run OCR first for editable text)', { x: 0.5, y: 0.5, w: slideW - 1, h: 0.6, fontSize: 14, fontFace: 'Arial', color: '888888', italic: true });
      }

      if (opts.mode === 'image' || !layout.hasText) continue;
      for (const block of layout.blocks) {
        const fontSize = Math.max(4, Math.min(200, block.fontSize * s));
        const lines = block.lines.map((l) => l.text);
        const pitch = block.lines.length > 1 ? block.linePitch * s : block.fontSize * 1.2 * s;
        const x = offX + (block.x / 72) * s;
        const y = offY + (block.y / 72) * s - (fontSize * 0.15) / 72;
        const w = (block.w / 72) * s + (fontSize * 0.6) / 72; // a little slack so lines do not wrap
        const h = Math.max((pitch * block.lines.length) / 72, (fontSize * 1.25) / 72);
        const text = lines.map((t, i) => ({ text: t, options: { breakLine: i < lines.length - 1 } }));
        const prefix = block.kind === 'bullet' ? '• ' : '';
        if (prefix) text[0] = { text: prefix + text[0].text, options: text[0].options };
        slide.addText(text, {
          x: round3(Math.max(0, x)),
          y: round3(Math.max(0, y)),
          w: round3(Math.min(slideW, w)),
          h: round3(h),
          fontSize: round1(fontSize),
          fontFace: 'Arial',
          bold: block.bold || block.kind === 'heading',
          color: '000000',
          align: 'left',
          valign: 'top',
          margin: 0,
          fit: 'none',
          wrap: true,
          lineSpacing: block.lines.length > 1 ? round1(pitch) : undefined,
          paraSpaceBefore: 0,
          paraSpaceAfter: 0,
        });
      }
    }

    const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const pptxPath = path.join(workDir, 'output.pptx');
    await writeFile(pptxPath, out);
    return { pptxPath, warnings: [...warnings], slides: pageCount };
  } finally {
    await doc.destroy();
  }
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}
