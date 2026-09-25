/**
 * Shared types for PDF operations. All page numbers in public APIs are 1-based
 * unless the name explicitly says "index".
 */

export type PageSizeName = 'A4' | 'A3' | 'Letter' | 'Legal' | 'Fit' | 'Custom';
export type Orientation = 'portrait' | 'landscape';
export type ImageFit = 'fit' | 'fill' | 'original';
export type ImageMime = 'image/jpeg' | 'image/png';

export interface PdfInfo {
  pageCount: number;
  pages: { width: number; height: number; rotation: number }[];
  title?: string;
  author?: string;
}

export interface SplitRangeMode {
  type: 'ranges';
  /** e.g. "1-3\n5-7\n10" or "1-3,5-7,10" -> one output per group */
  ranges: string;
}
export interface SplitEveryMode {
  type: 'every';
}
export interface SplitPagesMode {
  type: 'pages';
  /** 1-based page numbers; each becomes its own PDF */
  pages: number[];
}
export interface SplitChunkMode {
  type: 'chunk';
  /** number of pages per output document */
  size: number;
}
export type SplitMode = SplitRangeMode | SplitEveryMode | SplitPagesMode | SplitChunkMode;

export interface OutputFile {
  name: string;
  data: Uint8Array;
  mimeType: string;
}

export interface OrganizePage {
  /** index into the `sources` array (0 = primary document) */
  source: number;
  /** 1-based page number in the source document */
  page: number;
  /** additional rotation in degrees (0, 90, 180, 270) */
  rotate?: number;
}

export interface OrganizeOptions {
  sources: Uint8Array[];
  pages: OrganizePage[];
}

export interface RotateOptions {
  /** 1-based pages; omit for all pages */
  pages?: number[];
  /** 90 | 180 | 270 (or any multiple of 90) */
  angle: number;
}

export type NumberPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface PageNumberOptions {
  position: NumberPosition;
  startNumber?: number;
  fontSize?: number;
  /** Format string. Placeholders: {n} current page, {total} page count. Example "Page {n} of {total}" */
  format?: string;
  /** hex color e.g. "#333333" */
  color?: string;
  /** margin from the edge in points */
  margin?: number;
  /** 1-based pages; omit for all pages */
  pages?: number[];
  font?: 'Helvetica' | 'TimesRoman' | 'Courier';
}

export type WatermarkPosition =
  | 'center'
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'tile';

export interface TextWatermarkOptions {
  type: 'text';
  text: string;
  fontSize?: number;
  /** 0-1 */
  opacity?: number;
  /** degrees */
  rotation?: number;
  position?: WatermarkPosition;
  color?: string;
  pages?: number[];
  font?: 'Helvetica' | 'TimesRoman' | 'Courier';
}

export interface ImageWatermarkOptions {
  type: 'image';
  image: Uint8Array;
  imageType: ImageMime;
  opacity?: number;
  /** 0-1 fraction of page width */
  scale?: number;
  rotation?: number;
  position?: WatermarkPosition;
  pages?: number[];
}

export type WatermarkOptions = TextWatermarkOptions | ImageWatermarkOptions;

export interface CropBox {
  /** all values are fractions (0-1) of the page width/height, origin top-left */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropOptions {
  box: CropBox;
  /** 1-based pages; omit for all pages */
  pages?: number[];
}

export interface ImageInput {
  data: Uint8Array;
  mimeType: ImageMime;
  /** rotation to apply, degrees */
  rotation?: number;
  name?: string;
}

export interface ImagesToPdfOptions {
  pageSize?: PageSizeName;
  /** used when pageSize === 'Custom', in points */
  customSize?: { width: number; height: number };
  orientation?: Orientation | 'auto';
  /** margin in points */
  margin?: number;
  fit?: ImageFit;
  title?: string;
}
