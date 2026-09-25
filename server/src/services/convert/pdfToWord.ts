/**
 * PDF -> DOCX.
 *
 * - LibreOffice (when installed): `soffice --headless --infilter=writer_pdf_import --convert-to docx`.
 * - Pure JS fallback: reconstruct paragraphs / headings / lists from the pdf.js text layer and
 *   build the document with the `docx` package. In 'layout' mode every page additionally starts
 *   with the rendered page image so the result looks like the original while staying editable.
 */
import path from 'node:path';
import { readFile, readdir, rename, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AlignmentType, Document, HeadingLevel, ImageRun, LevelFormat, Packer, PageOrientation, Paragraph, TextRun } from 'docx';
import { detectTools } from '../../config/tools.js';
import { run } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import { openPdfDocument, renderPdfPages, type RenderedPage } from '../render.js';
import { extractTextBlocks, type PageTextLayout, type TextBlock } from './textLayout.js';
import type { PdfToWordResult } from './types.js';

export interface PdfToWordOptions {
  mode: 'text' | 'layout';
}

const NO_TEXT_NOTE = '(No text layer found on this page – run OCR first for editable text)';
const PT_TO_TWIP = 20;
const PT_TO_PX = 96 / 72;

export async function pdfToWord(pdfPath: string, workDir: string, opts: PdfToWordOptions): Promise<PdfToWordResult> {
  const tools = await detectTools();
  const warnings: string[] = [];
  if (tools.soffice) {
    try {
      return await convertWithLibreOffice(tools.soffice, pdfPath, workDir);
    } catch (err) {
      warnings.push('LibreOffice conversion failed; the built-in converter was used instead.');
      void err;
    }
  }
  const r = await convertWithJs(pdfPath, workDir, opts);
  r.warnings.unshift(...warnings);
  return r;
}

async function convertWithLibreOffice(soffice: string, pdfPath: string, workDir: string): Promise<PdfToWordResult> {
  const profile = path.join(workDir, 'lo-profile');
  await mkdir(profile, { recursive: true });
  const outDir = path.join(workDir, 'lo-out');
  await mkdir(outDir, { recursive: true });
  const input = path.join(workDir, 'in.pdf');
  await writeFile(input, await readFile(pdfPath));
  await run(soffice, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--norestore', '--infilter=writer_pdf_import', '--convert-to', 'docx', '--outdir', outDir, input], { cwd: workDir });
  const produced = (await readdir(outDir)).find((n) => n.toLowerCase().endsWith('.docx'));
  if (!produced) throw new Error('LibreOffice produced no DOCX');
  const docxPath = path.join(workDir, 'output.docx');
  await rename(path.join(outDir, produced), docxPath);
  const pageCount = await countPages(pdfPath);
  return { docxPath, engine: 'libreoffice', warnings: [], pageCount };
}

async function countPages(pdfPath: string): Promise<number> {
  const doc = await openPdfDocument(await readFile(pdfPath));
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

function headingLevel(level: 1 | 2 | 3 | undefined) {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

function blockToParagraph(block: TextBlock): Paragraph {
  const size = Math.max(8, Math.round(block.fontSize * 2)); // half-points
  const run = new TextRun({ text: block.text, size, bold: block.bold || block.kind === 'heading' });
  const spacing = { after: Math.round(Math.max(4, block.fontSize * 0.5) * PT_TO_TWIP) };
  if (block.kind === 'heading') {
    return new Paragraph({ children: [run], heading: headingLevel(block.headingLevel), spacing: { before: Math.round(block.fontSize * 0.6 * PT_TO_TWIP), after: spacing.after } });
  }
  if (block.kind === 'bullet') return new Paragraph({ children: [run], numbering: { reference: 'pdfly-bullets', level: 0 }, spacing });
  if (block.kind === 'numbered') return new Paragraph({ children: [run], numbering: { reference: 'pdfly-numbers', level: 0 }, spacing });
  return new Paragraph({ children: [run], spacing: { ...spacing, line: Math.round(Math.max(1, block.linePitch / Math.max(1, block.fontSize)) * 240) } });
}

function pageImageParagraph(img: RenderedPage, contentWidthPt: number): Paragraph {
  const widthPx = Math.round(contentWidthPt * PT_TO_PX);
  const heightPx = Math.max(1, Math.round((widthPx * img.height) / Math.max(1, img.width)));
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new ImageRun({ type: 'png', data: img.data, transformation: { width: widthPx, height: heightPx }, altText: { title: `Page ${img.page}`, description: `Rendered page ${img.page}`, name: `page-${img.page}` } })],
  });
}

function pageMargins(layout: PageTextLayout) {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const defaults = { top: 56, right: 56, bottom: 56, left: 56 }; // ~0.78in
  if (!layout.blocks.length) return defaults;
  const minX = Math.min(...layout.blocks.map((b) => b.x));
  const maxRight = Math.max(...layout.blocks.map((b) => b.x + b.w));
  const minY = Math.min(...layout.blocks.map((b) => b.y));
  return {
    top: clamp(minY, 24, 72),
    right: clamp(layout.width - maxRight, 24, 72),
    bottom: 48,
    left: clamp(minX, 24, 72),
  };
}

async function convertWithJs(pdfPath: string, workDir: string, opts: PdfToWordOptions): Promise<PdfToWordResult> {
  const bytes = await readFile(pdfPath);
  const doc = await openPdfDocument(bytes);
  const warnings = new Set<string>();
  let pageCount = 0;
  try {
    pageCount = doc.numPages;
    const layouts: PageTextLayout[] = [];
    for (let p = 1; p <= pageCount; p++) {
      try {
        layouts.push(await extractTextBlocks(doc, p));
      } catch (err) {
        throw AppError.from(err, 'CONVERSION_FAILED');
      }
    }
    const pagesWithoutText = layouts.map((l, i) => (l.hasText ? 0 : i + 1)).filter(Boolean);
    const needImages = opts.mode === 'layout' ? layouts.map((_, i) => i + 1) : pagesWithoutText;
    const images = new Map<number, RenderedPage>();
    if (needImages.length) {
      try {
        const rendered = await renderPdfPages(bytes, { dpi: 110, pages: needImages, format: 'png', maxDimension: 2400 }, workDir);
        for (const r of rendered) images.set(r.page, r);
      } catch {
        warnings.add('Page images could not be rendered; only the text was exported.');
      }
    }

    if (pagesWithoutText.length) warnings.add(NO_TEXT_NOTE);
    if (layouts.some((l) => l.hasText)) {
      warnings.add(
        opts.mode === 'layout'
          ? 'Layout mode: each page starts with an image of the original followed by the editable text; complex layouts (columns, tables) are simplified.'
          : 'Text mode keeps the editable text only; images, graphics and complex layouts (columns, tables) are simplified.',
      );
    }

    const sections = layouts.map((layout, idx) => {
      const pageNo = idx + 1;
      const landscape = layout.width > layout.height;
      const margin = pageMargins(layout);
      const contentWidth = layout.width - margin.left - margin.right;
      const children: Paragraph[] = [];
      const img = images.get(pageNo);
      if (img && (opts.mode === 'layout' || !layout.hasText)) children.push(pageImageParagraph(img, contentWidth));
      if (!layout.hasText) {
        children.push(new Paragraph({ children: [new TextRun({ text: NO_TEXT_NOTE, italics: true, color: '888888', size: 18 })] }));
      } else {
        for (const block of layout.blocks) children.push(blockToParagraph(block));
      }
      if (!children.length) children.push(new Paragraph({ children: [] }));
      return {
        properties: {
          page: {
            size: {
              width: Math.round(layout.width * PT_TO_TWIP),
              height: Math.round(layout.height * PT_TO_TWIP),
              orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: Math.round(margin.top * PT_TO_TWIP),
              right: Math.round(margin.right * PT_TO_TWIP),
              bottom: Math.round(margin.bottom * PT_TO_TWIP),
              left: Math.round(margin.left * PT_TO_TWIP),
            },
          },
        },
        children,
      };
    });

    const document = new Document({
      creator: 'PDFly',
      title: path.basename(pdfPath, path.extname(pdfPath)),
      styles: {
        default: { document: { run: { font: 'Calibri', size: 22 } } },
        paragraphStyles: [
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { bold: true, size: 32 }, paragraph: { spacing: { before: 240, after: 120 } } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { bold: true, size: 28 }, paragraph: { spacing: { before: 200, after: 100 } } },
          { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { bold: true, size: 24 }, paragraph: { spacing: { before: 160, after: 80 } } },
        ],
      },
      numbering: {
        config: [
          { reference: 'pdfly-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
          { reference: 'pdfly-numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        ],
      },
      sections,
    });
    const buffer = await Packer.toBuffer(document);
    const docxPath = path.join(workDir, 'output.docx');
    await writeFile(docxPath, buffer);
    return { docxPath, engine: 'js', warnings: [...warnings], pageCount };
  } finally {
    await doc.destroy();
  }
}
