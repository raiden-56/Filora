import { z } from 'zod';
import { pageList } from './pdf.validators.js';

export const imagesToPdfSchema = z.object({
  pageSize: z.enum(['A4', 'A3', 'Letter', 'Legal', 'Fit', 'Custom']).default('A4'),
  orientation: z.enum(['portrait', 'landscape', 'auto']).default('auto'),
  margin: z.number().min(0).max(200).default(0),
  fit: z.enum(['fit', 'fill', 'original']).default('fit'),
  /** JPEG re-encode quality 10-100; 100 keeps originals */
  quality: z.number().int().min(10).max(100).default(100),
  customWidth: z.number().min(36).max(14400).optional(),
  customHeight: z.number().min(36).max(14400).optional(),
  /** clockwise rotation per image, same order as uploads */
  rotations: z.array(z.number().int()).optional(),
  /** explicit order of uploaded files by index */
  order: z.array(z.number().int().min(0)).optional(),
  title: z.string().max(200).optional(),
});

export const officeSchema = z.object({});

export const htmlToPdfSchema = z
  .object({
    html: z.string().max(5_000_000).optional(),
    url: z.string().url().max(2048).optional(),
    pageSize: z.enum(['A4', 'A3', 'Letter', 'Legal']).default('A4'),
    orientation: z.enum(['portrait', 'landscape']).default('portrait'),
    /** margins in millimetres */
    margin: z.number().min(0).max(100).default(15),
    header: z.string().max(500).optional(),
    footer: z.string().max(500).optional(),
    printBackground: z.boolean().default(true),
    /** page numbers in the footer */
    pageNumbers: z.boolean().default(false),
    scale: z.number().min(0.3).max(2).default(1),
  })
  .strict();

export const pdfToImagesSchema = z.object({
  format: z.enum(['jpg', 'png']).default('jpg'),
  quality: z.number().int().min(10).max(100).default(85),
  dpi: z.number().int().min(36).max(400).default(150),
  pages: pageList.optional(),
});

export const pdfToWordSchema = z.object({
  /** 'text' keeps flow text (editable), 'layout' embeds page images with text boxes */
  mode: z.enum(['text', 'layout']).default('text'),
});

export const pdfToPptSchema = z.object({
  /** 'image' = each page as a full-slide image (faithful), 'text' = extract text into editable boxes */
  mode: z.enum(['image', 'text', 'both']).default('both'),
  dpi: z.number().int().min(72).max(300).default(150),
});

export const pdfToExcelSchema = z.object({
  /** one sheet per page (default) or all rows in one sheet */
  sheetPerPage: z.boolean().default(true),
});

export const pdfToPdfaSchema = z.object({
  level: z.enum(['1b', '2b', '3b']).default('2b'),
});
