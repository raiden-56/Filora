import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyAnnotations, MAX_ANNOTATIONS, type ServerAnnotation } from './annotate.js';
import { annotationSchema } from '../../validators/edit.validators.js';
import { AppError } from '../../utils/errors.js';

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

function parse(input: unknown): ServerAnnotation {
  return annotationSchema.parse(input);
}

describe('applyAnnotations (server)', () => {
  it('applies text, rect and image annotations from a validated payload', async () => {
    const input = await fixture();
    const annotations = [
      parse({ type: 'text', page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.1, text: 'Server side text', fontSize: 14, color: '333333' }),
      parse({ type: 'rect', page: 1, x: 0.2, y: 0.3, width: 0.3, height: 0.2, color: '#DC2626', fill: '#FDE68A', strokeWidth: 3 }),
      parse({ type: 'image', page: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.2, imageId: 'logo' }),
    ];
    const out = await applyAnnotations(input, annotations, { logo: PNG_1x1 });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(out.length).toBeGreaterThan(input.length);
    const objects = doc.context.enumerateIndirectObjects().map(([, o]) => o.toString()).join('\n');
    expect(objects).toContain('/Image');
    expect(objects).toContain('Helvetica');
  });

  it('rejects more than the maximum number of annotations', async () => {
    const input = await fixture();
    const many = Array.from({ length: MAX_ANNOTATIONS + 1 }, () => parse({ type: 'rect', page: 1, x: 0, y: 0, width: 0.1, height: 0.1 }));
    await expect(applyAnnotations(input, many, {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects images that are not data URLs', async () => {
    const input = await fixture();
    const err = await applyAnnotations(input, [parse({ type: 'image', page: 1, x: 0, y: 0, width: 0.1, height: 0.1, imageId: 'x' })], { x: 'not-a-data-url' }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('VALIDATION_ERROR');
  });
});
