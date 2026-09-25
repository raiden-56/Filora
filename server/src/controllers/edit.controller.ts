import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import type { z } from 'zod';
import { pdfService } from '../services/pdfService.js';
import { respondWithBuffers, withExt, firstUpload } from './helpers.js';
import { AppError } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import { cleanupRequestFiles } from '../middleware/upload.js';
import { applyAnnotations } from '../services/edit/annotate.js';
import type { rotateSchema, pageNumbersSchema, watermarkSchema, cropSchema, editSchema, formsSchema } from '../validators/edit.validators.js';
import type { NewFormField } from '@pdfly/core';

export async function rotate(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof rotateSchema>;
  const f = firstUpload(req);
  const data = await pdfService.rotate(f.path, { angle: opts.angle, pages: opts.pages });
  await respondWithBuffers(req, res, [{ data, name: withExt(f.originalname, '-rotated', 'pdf'), mimeType: 'application/pdf' }], 'PDF rotated successfully');
}

export async function pageNumbers(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof pageNumbersSchema>;
  const f = firstUpload(req);
  const data = await pdfService.pageNumbers(f.path, opts);
  await respondWithBuffers(req, res, [{ data, name: withExt(f.originalname, '-numbered', 'pdf'), mimeType: 'application/pdf' }], 'Page numbers added');
}

export async function watermark(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof watermarkSchema>;
  const f = firstUpload(req);
  let data: Uint8Array;
  if (opts.type === 'image') {
    const img = req.extraUploads?.image;
    if (!img) throw new AppError('NO_FILE', 'Upload a watermark image.');
    const bytes = new Uint8Array(await readFile(img.path));
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    data = await pdfService.watermark(f.path, { type: 'image', image: bytes, imageType: isPng ? 'image/png' : 'image/jpeg', opacity: opts.opacity, scale: opts.scale, rotation: opts.rotation, position: opts.position, pages: opts.pages });
  } else {
    if (!opts.text?.trim()) throw new AppError('VALIDATION_ERROR', 'Enter the watermark text.');
    data = await pdfService.watermark(f.path, { type: 'text', text: opts.text, fontSize: opts.fontSize, opacity: opts.opacity, rotation: opts.rotation, position: opts.position, color: opts.color, pages: opts.pages, font: opts.font });
  }
  await respondWithBuffers(req, res, [{ data, name: withExt(f.originalname, '-watermarked', 'pdf'), mimeType: 'application/pdf' }], 'Watermark added');
}

export async function crop(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof cropSchema>;
  const f = firstUpload(req);
  const data = await pdfService.crop(f.path, { box: opts.box, pages: opts.pages });
  await respondWithBuffers(req, res, [{ data, name: withExt(f.originalname, '-cropped', 'pdf'), mimeType: 'application/pdf' }], 'PDF cropped');
}

export async function edit(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof editSchema>;
  const f = firstUpload(req);
  const input = new Uint8Array(await readFile(f.path));
  const data = await applyAnnotations(input, opts.annotations, opts.images ?? {});
  await respondWithBuffers(req, res, [{ data, name: withExt(f.originalname, '-edited', 'pdf'), mimeType: 'application/pdf' }], 'PDF saved', { meta: { annotations: opts.annotations.length } });
}

function dataUrlToBytes(s: string | undefined): Uint8Array | undefined {
  if (!s) return undefined;
  const m = /^data:[^;]+;base64,(.+)$/.exec(s);
  return m ? new Uint8Array(Buffer.from(m[1], 'base64')) : undefined;
}

export async function forms(req: Request, res: Response) {
  const opts = req.options as z.infer<typeof formsSchema>;
  const f = firstUpload(req);
  if (opts.action === 'list') {
    const fields = await pdfService.listFields(f.path);
    await cleanupRequestFiles(req);
    return ok(res, { fields });
  }
  let data: Uint8Array;
  if (opts.action === 'add') {
    const fields: NewFormField[] = (opts.fields ?? []).map((fl) => ({ ...fl, image: dataUrlToBytes(fl.image) }));
    if (!fields.length) throw new AppError('VALIDATION_ERROR', 'Add at least one form field.');
    data = await pdfService.addFields(f.path, fields);
    if (opts.values && Object.keys(opts.values).length) data = await pdfService.fillFields(await writeTmp(data, f.path), opts.values, opts.flatten);
  } else {
    data = await pdfService.fillFields(f.path, opts.values ?? {}, opts.flatten);
  }
  await respondWithBuffers(req, res, [{ data, name: withExt(f.originalname, opts.action === 'add' ? '-form' : '-filled', 'pdf'), mimeType: 'application/pdf' }], 'Form saved');
}

import { writeFile } from 'node:fs/promises';
async function writeTmp(data: Uint8Array, original: string): Promise<string> {
  const p = `${original}.stage.pdf`;
  await writeFile(p, data);
  return p;
}
