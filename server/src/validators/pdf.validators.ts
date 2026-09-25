import { z } from 'zod';

export const pageList = z.array(z.number().int().min(1)).min(1);

export const mergeSchema = z.object({
  title: z.string().max(200).optional(),
  /** optional explicit order of uploaded files by index */
  order: z.array(z.number().int().min(0)).optional(),
});

export const splitSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('every') }),
  z.object({ mode: z.literal('ranges'), ranges: z.string().min(1).max(5000) }),
  z.object({ mode: z.literal('pages'), pages: pageList }),
  z.object({ mode: z.literal('chunk'), size: z.number().int().min(1).max(10000) }),
]);

export const pagesSchema = z.object({ pages: pageList });

export const organizeSchema = z.object({
  pages: z
    .array(
      z.object({
        source: z.number().int().min(0),
        page: z.number().int().min(1),
        rotate: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(5000),
});

export const compressSchema = z.object({
  level: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const repairSchema = z.object({});

export const ocrSchema = z.object({
  languages: z.union([z.string(), z.array(z.string())]).default('eng').transform((v) => (Array.isArray(v) ? v : String(v).split(/[+,]/).map((s) => s.trim()).filter(Boolean))),
  dpi: z.number().int().min(72).max(400).default(200),
  /** also return extracted text as a .txt output */
  includeText: z.boolean().default(true),
  /** skip pages that already contain text */
  skipText: z.boolean().default(true),
});
