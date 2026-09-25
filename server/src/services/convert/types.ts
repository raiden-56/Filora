/**
 * Contracts for the conversion services. Each function receives an isolated writable
 * `workDir` (removed after the request); all outputs must be written inside it.
 */

export type OfficeKind = 'word' | 'powerpoint' | 'excel';

export interface OfficeToPdfResult {
  pdfPath: string;
  engine: 'libreoffice' | 'js';
  warnings: string[];
}

export interface HtmlToPdfInput {
  html?: string;
  url?: string;
  /** path of an uploaded .html file */
  filePath?: string;
}

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
  pdf: Buffer;
  engine: 'puppeteer' | 'libreoffice' | 'js';
  warnings: string[];
}

export interface PdfToImagesOptions {
  format: 'jpg' | 'png';
  quality: number;
  dpi: number;
  pages?: number[];
}

export interface PdfToImagesResult {
  files: { path: string; name: string; page: number; width: number; height: number }[];
  engine: 'pdftoppm' | 'pdfjs';
}

export interface PdfToWordResult {
  docxPath: string;
  engine: 'libreoffice' | 'js';
  warnings: string[];
  pageCount: number;
}

export interface PdfToPptResult {
  pptxPath: string;
  warnings: string[];
  slides: number;
}

export interface PdfToExcelResult {
  xlsxPath: string;
  warnings: string[];
  sheets: number;
  tablesFound: number;
}

export interface PdfaCheck {
  name: string;
  passed: boolean;
  message?: string;
}

export interface PdfToPdfaResult {
  pdfPath: string;
  engine: 'ghostscript' | 'libreoffice' | 'js';
  level: '1b' | '2b' | '3b';
  validation: {
    /** overall result of our built-in checks (not a full veraPDF validation) */
    valid: boolean;
    validator: 'built-in' | 'verapdf';
    checks: PdfaCheck[];
  };
  warnings: string[];
}
