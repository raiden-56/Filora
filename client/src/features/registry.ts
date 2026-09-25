import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Maps tool ids to their lazily loaded page components. Each feature is a separate
 * chunk so heavy tools (editor, OCR, etc.) are only downloaded when opened.
 */
export const TOOL_COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = {
  // Organize
  merge: lazy(() => import('./organize/MergePdfTool')),
  split: lazy(() => import('./organize/SplitPdfTool')),
  'remove-pages': lazy(() => import('./organize/RemovePagesTool')),
  'extract-pages': lazy(() => import('./organize/ExtractPagesTool')),
  organize: lazy(() => import('./organize/OrganizePdfTool')),
  'scan-to-pdf': lazy(() => import('./organize/ScanToPdfTool')),
  // Optimize
  compress: lazy(() => import('./optimize/CompressPdfTool')),
  repair: lazy(() => import('./optimize/RepairPdfTool')),
  ocr: lazy(() => import('./optimize/OcrPdfTool')),
  // Convert to PDF
  'jpg-to-pdf': lazy(() => import('./convert-to/JpgToPdfTool')),
  'word-to-pdf': lazy(() => import('./convert-to/WordToPdfTool')),
  'ppt-to-pdf': lazy(() => import('./convert-to/PptToPdfTool')),
  'excel-to-pdf': lazy(() => import('./convert-to/ExcelToPdfTool')),
  'html-to-pdf': lazy(() => import('./convert-to/HtmlToPdfTool')),
  // Convert from PDF
  'pdf-to-jpg': lazy(() => import('./convert-from/PdfToJpgTool')),
  'pdf-to-word': lazy(() => import('./convert-from/PdfToWordTool')),
  'pdf-to-ppt': lazy(() => import('./convert-from/PdfToPptTool')),
  'pdf-to-excel': lazy(() => import('./convert-from/PdfToExcelTool')),
  'pdf-to-pdfa': lazy(() => import('./convert-from/PdfToPdfaTool')),
  // Edit
  rotate: lazy(() => import('./edit/RotatePdfTool')),
  'page-numbers': lazy(() => import('./edit/PageNumbersTool')),
  watermark: lazy(() => import('./edit/WatermarkTool')),
  crop: lazy(() => import('./edit/CropPdfTool')),
  edit: lazy(() => import('./edit/EditPdfTool')),
  forms: lazy(() => import('./edit/PdfFormsTool')),
};
