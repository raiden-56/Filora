/**
 * Burns editor annotations into a PDF. Thin wrapper around `@pdfly/core`'s
 * `applyAnnotations` that maps the validated request payload (zod) onto the core
 * model and decodes data-URL images.
 */
import type { z } from 'zod';
import { applyAnnotations as coreApply, type Annotation } from '@pdfly/core';
import { AppError } from '../../utils/errors.js';
import type { annotationSchema } from '../../validators/edit.validators.js';

export type ServerAnnotation = z.infer<typeof annotationSchema>;

export const MAX_ANNOTATIONS = 5000;

function dataUrlToBytes(value: string): Uint8Array {
  const m = /^data:([^;,]+)?;base64,(.*)$/s.exec(value.trim());
  if (!m) throw new AppError('VALIDATION_ERROR', 'Images must be base64 data URLs (data:image/png;base64,...).');
  return new Uint8Array(Buffer.from(m[2], 'base64'));
}

export async function applyAnnotations(pdf: Uint8Array, annotations: ServerAnnotation[], images: Record<string, string> = {}): Promise<Uint8Array> {
  if (!Array.isArray(annotations)) throw new AppError('VALIDATION_ERROR', 'Annotations must be an array.');
  if (annotations.length > MAX_ANNOTATIONS) {
    throw new AppError('VALIDATION_ERROR', `Too many annotations (max ${MAX_ANNOTATIONS}).`);
  }
  const decoded: Record<string, Uint8Array> = {};
  for (const [id, value] of Object.entries(images)) {
    if (typeof value !== 'string' || !value) continue;
    decoded[id] = dataUrlToBytes(value);
  }
  const mapped: Annotation[] = annotations.map((a, i) => ({
    id: a.id ?? `a${i}`,
    type: a.type,
    page: a.page,
    x: a.x,
    y: a.y,
    width: a.width,
    height: a.height,
    color: a.color.startsWith('#') ? a.color : `#${a.color}`,
    opacity: a.opacity,
    strokeWidth: a.strokeWidth,
    text: a.text,
    fontSize: a.fontSize,
    fontFamily: a.fontFamily,
    imageId: a.imageId,
    points: a.points,
    x1: a.x1,
    y1: a.y1,
    x2: a.x2,
    y2: a.y2,
    fill: a.fill == null ? a.fill : a.fill.startsWith('#') ? a.fill : `#${a.fill}`,
    checked: a.checked,
  }));
  try {
    return await coreApply(pdf, mapped, decoded);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/PNG or JPEG|base64/i.test(msg)) throw new AppError('VALIDATION_ERROR', msg, { cause: err });
    throw AppError.from(err, 'CONVERSION_FAILED', 'Could not apply the annotations to this PDF.');
  }
}
