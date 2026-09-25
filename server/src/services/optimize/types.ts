/**
 * Contracts for the optimize services (implemented in compress.ts, repair.ts, ocr.ts).
 * All functions receive a path to the uploaded PDF and an isolated, writable `workDir`
 * that is removed after the request. Outputs must be written inside `workDir`.
 */

export type CompressionLevel = 'low' | 'medium' | 'high';

export interface CompressOptions {
  level: CompressionLevel;
}

export interface CompressResult {
  /** path to the compressed PDF (inside workDir) */
  pdfPath: string;
  engine: 'ghostscript' | 'js';
  warnings: string[];
}

export interface RepairResult {
  /** path to the repaired PDF, or null when repair was impossible */
  pdfPath: string | null;
  /** true when the file needed changes; false when it was already healthy */
  repaired: boolean;
  engine: 'qpdf' | 'ghostscript' | 'pdf-lib' | 'pdfjs-rebuild' | 'none';
  pageCount?: number;
  /** human readable notes about what was found/fixed */
  notes: string[];
  warnings: string[];
}

export interface OcrOptions {
  /** tesseract language codes, e.g. ['eng'] or ['eng','deu'] */
  languages: string[];
  dpi: number;
  /** skip pages that already have a text layer */
  skipText: boolean;
}

export interface OcrResult {
  /** searchable PDF path (inside workDir) */
  pdfPath: string;
  /** plain text path (inside workDir) */
  textPath: string;
  engine: 'ocrmypdf' | 'tesseract' | 'tesseract.js';
  pageCount: number;
  pagesProcessed: number;
  pagesSkipped: number;
  characters: number;
  textPreview: string;
  warnings: string[];
}
