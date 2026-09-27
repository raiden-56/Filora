/**
 * PDF -> DOCX in the browser: paragraphs / headings / lists are reconstructed from the
 * pdf.js text layer and the document is built with the `docx` package. In 'layout' mode every
 * page additionally starts with the rendered page image so the result looks like the original
 * while staying editable.
 */
import { assertNotAborted, engineError } from './common';
import { openPdfDocument, renderPdfPages, renderedBytes, type RenderedPage } from './render';
import { extractTextBlocks, type PageTextLayout, type TextBlock } from './textLayout';

export interface PdfToWordOptions {
  mode: 'text' | 'layout';
  signal?: AbortSignal;
  onProgress?: (stage: string, fraction: number | null) => void;
}

export interface PdfToWordResult {
  blob: Blob;
  engine: 'js';
  warnings: string[];
  pageCount: number;
}

const NO_TEXT_NOTE = '(No text layer found on this page – run OCR first for editable text)';
const PT_TO_TWIP = 20;
const PT_TO_PX = 96 / 72;

type Docx = typeof import('docx');

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

export async function pdfToWord(bytes: Uint8Array, title: string, opts: PdfToWordOptions): Promise<PdfToWordResult> {
  const docx: Docx = await import('docx');
  const { AlignmentType, Document, HeadingLevel, ImageRun, LevelFormat, Packer, PageOrientation, Paragraph, TextRun } = docx;

  const headingLevel = (level: 1 | 2 | 3 | undefined) => (level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3);

  const blockToParagraph = (block: TextBlock) => {
    const size = Math.max(8, Math.round(block.fontSize * 2)); // half-points
    const run = new TextRun({ text: block.text, size, bold: block.bold || block.kind === 'heading' });
    const spacing = { after: Math.round(Math.max(4, block.fontSize * 0.5) * PT_TO_TWIP) };
    if (block.kind === 'heading') {
      return new Paragraph({ children: [run], heading: headingLevel(block.headingLevel), spacing: { before: Math.round(block.fontSize * 0.6 * PT_TO_TWIP), after: spacing.after } });
    }
    if (block.kind === 'bullet') return new Paragraph({ children: [run], numbering: { reference: 'pdfly-bullets', level: 0 }, spacing });
    if (block.kind === 'numbered') return new Paragraph({ children: [run], numbering: { reference: 'pdfly-numbers', level: 0 }, spacing });
    return new Paragraph({ children: [run], spacing: { ...spacing, line: Math.round(Math.max(1, block.linePitch / Math.max(1, block.fontSize)) * 240) } });
  };

  const pageImageParagraph = (img: RenderedPage, data: Uint8Array, contentWidthPt: number) => {
    const widthPx = Math.round(contentWidthPt * PT_TO_PX);
    const heightPx = Math.max(1, Math.round((widthPx * img.height) / Math.max(1, img.width)));
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new ImageRun({ type: 'png', data, transformation: { width: widthPx, height: heightPx }, altText: { title: `Page ${img.page}`, description: `Rendered page ${img.page}`, name: `page-${img.page}` } })],
    });
  };

  const doc = await openPdfDocument(bytes);
  const warnings = new Set<string>();
  try {
    const pageCount = doc.numPages;
    if (!pageCount) throw engineError('CONVERSION_FAILED', 'The PDF has no pages.');
    opts.onProgress?.('Reading text...', 0);
    const layouts: PageTextLayout[] = [];
    for (let p = 1; p <= pageCount; p++) {
      assertNotAborted(opts.signal);
      try {
        layouts.push(await extractTextBlocks(doc, p));
      } catch {
        throw engineError('CONVERSION_FAILED', `The text of page ${p} could not be read.`);
      }
      opts.onProgress?.('Reading text...', p / pageCount);
    }
    const pagesWithoutText = layouts.map((l, i) => (l.hasText ? 0 : i + 1)).filter(Boolean);
    const needImages = opts.mode === 'layout' ? layouts.map((_, i) => i + 1) : pagesWithoutText;
    const images = new Map<number, { page: RenderedPage; data: Uint8Array }>();
    if (needImages.length) {
      try {
        const rendered = await renderPdfPages(bytes, {
          dpi: 110,
          pages: needImages,
          format: 'png',
          maxDimension: 2400,
          signal: opts.signal,
          onProgress: (done, total) => opts.onProgress?.('Rendering pages...', done / total),
        });
        for (const r of rendered) images.set(r.page, { page: r, data: await renderedBytes(r) });
      } catch (err) {
        assertNotAborted(opts.signal);
        void err;
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

    opts.onProgress?.('Building document...', null);
    const sections = layouts.map((layout, idx) => {
      const pageNo = idx + 1;
      const landscape = layout.width > layout.height;
      const margin = pageMargins(layout);
      const contentWidth = layout.width - margin.left - margin.right;
      const children: InstanceType<typeof Paragraph>[] = [];
      const img = images.get(pageNo);
      if (img && (opts.mode === 'layout' || !layout.hasText)) children.push(pageImageParagraph(img.page, img.data, contentWidth));
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
      title,
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
    assertNotAborted(opts.signal);
    const blob = await Packer.toBlob(document);
    return { blob, engine: 'js', warnings: [...warnings], pageCount };
  } finally {
    await doc.destroy();
  }
}
