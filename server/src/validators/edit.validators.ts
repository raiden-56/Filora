import { z } from 'zod';
import { pageList } from './pdf.validators.js';

const hexColor = z.string().regex(/^#?[0-9a-fA-F]{3,8}$/, 'Expected a hex color like #333333');

export const rotateSchema = z.object({
  angle: z.number().int().refine((a) => a % 90 === 0, 'Angle must be a multiple of 90'),
  pages: pageList.optional(),
});

export const pageNumbersSchema = z.object({
  position: z.enum(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']).default('bottom-center'),
  startNumber: z.number().int().min(0).max(100000).default(1),
  fontSize: z.number().min(4).max(96).default(12),
  format: z.string().max(100).default('{n}'),
  color: hexColor.default('#333333'),
  margin: z.number().min(0).max(300).default(28),
  pages: pageList.optional(),
  font: z.enum(['Helvetica', 'TimesRoman', 'Courier']).default('Helvetica'),
});

const watermarkPosition = z.enum(['center', 'top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right', 'tile']);

export const watermarkSchema = z.object({
  type: z.enum(['text', 'image']).default('text'),
  text: z.string().max(500).optional(),
  fontSize: z.number().min(4).max(400).default(48),
  opacity: z.number().min(0).max(1).default(0.3),
  rotation: z.number().min(-360).max(360).default(0),
  position: watermarkPosition.default('center'),
  color: hexColor.default('#ff0000'),
  scale: z.number().min(0.02).max(1).default(0.4),
  pages: pageList.optional(),
  font: z.enum(['Helvetica', 'TimesRoman', 'Courier']).default('Helvetica'),
});

export const cropSchema = z.object({
  box: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  }),
  pages: pageList.optional(),
});

/** Annotation payload for POST /api/edit (mirrors the client editorSlice Annotation type). */
export const annotationSchema = z.object({
  id: z.string().max(64).optional(),
  type: z.enum(['text', 'image', 'draw', 'highlight', 'underline', 'strikeout', 'rect', 'ellipse', 'line', 'arrow', 'signature', 'checkbox']),
  page: z.number().int().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: hexColor.default('#000000'),
  opacity: z.number().min(0).max(1).default(1),
  strokeWidth: z.number().min(0).max(100).default(2),
  text: z.string().max(5000).optional(),
  fontSize: z.number().min(2).max(200).optional(),
  fontFamily: z.enum(['Helvetica', 'TimesRoman', 'Courier']).optional(),
  /** key of an uploaded image field (images[]) or data URL */
  imageId: z.string().max(200).optional(),
  points: z.array(z.object({ x: z.number(), y: z.number() })).max(20000).optional(),
  x1: z.number().optional(),
  y1: z.number().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
  fill: hexColor.nullable().optional(),
  checked: z.boolean().optional(),
});

export const editSchema = z.object({
  annotations: z.array(annotationSchema).max(5000).default([]),
  /** data URLs for images keyed by imageId (small images only) */
  images: z.record(z.string(), z.string().max(6_000_000)).optional(),
});

export const formsSchema = z.object({
  action: z.enum(['list', 'fill', 'add']).default('fill'),
  values: z.record(z.string(), z.union([z.string(), z.boolean(), z.array(z.string())])).optional(),
  flatten: z.boolean().default(false),
  fields: z
    .array(
      z.object({
        kind: z.enum(['text', 'checkbox', 'radio', 'dropdown', 'date', 'signature']),
        name: z.string().min(1).max(100),
        page: z.number().int().min(1),
        rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
        options: z.array(z.string().max(200)).max(200).optional(),
        radioRects: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })).optional(),
        defaultValue: z.union([z.string(), z.boolean(), z.array(z.string())]).optional(),
        /** PNG data URL for signatures */
        image: z.string().max(4_000_000).optional(),
        fontSize: z.number().min(4).max(72).optional(),
        multiline: z.boolean().optional(),
      }),
    )
    .max(500)
    .optional(),
});
