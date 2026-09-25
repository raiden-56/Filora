/**
 * Thin wrappers around @pdfly/core for server use (file based I/O, error mapping).
 */
import { readFile } from 'node:fs/promises';
import {
  mergePdfs,
  splitPdf,
  removePages,
  extractPages,
  organizePdf,
  rotatePdf,
  addPageNumbers,
  addWatermark,
  cropPdf,
  imagesToPdf,
  getPdfInfo,
  listFormFields,
  fillFormFields,
  addFormFields,
  type SplitMode,
  type OrganizePage,
  type RotateOptions,
  type PageNumberOptions,
  type WatermarkOptions,
  type CropOptions,
  type ImageInput,
  type ImagesToPdfOptions,
  type NewFormField,
  type FormValue,
} from '@pdfly/core';
import { AppError } from '../utils/errors.js';

async function bytes(file: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(file));
}

function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((err) => {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/out of range|Select at least|cannot remove|No pages|empty|no PDF files|would have no pages/i.test(msg)) throw new AppError('VALIDATION_ERROR', msg, { cause: err });
    throw AppError.from(err, 'CONVERSION_FAILED');
  });
}

export const pdfService = {
  info: (file: string) => wrap(bytes(file).then(getPdfInfo)),
  merge: (files: string[], title?: string) => wrap(Promise.all(files.map(bytes)).then((b) => mergePdfs(b, title))),
  split: (file: string, mode: SplitMode, baseName: string) => wrap(bytes(file).then((b) => splitPdf(b, mode, baseName))),
  removePages: (file: string, pages: number[]) => wrap(bytes(file).then((b) => removePages(b, pages))),
  extractPages: (file: string, pages: number[]) => wrap(bytes(file).then((b) => extractPages(b, pages))),
  organize: (files: string[], pages: OrganizePage[]) => wrap(Promise.all(files.map(bytes)).then((sources) => organizePdf({ sources, pages }))),
  rotate: (file: string, opts: RotateOptions) => wrap(bytes(file).then((b) => rotatePdf(b, opts))),
  pageNumbers: (file: string, opts: PageNumberOptions) => wrap(bytes(file).then((b) => addPageNumbers(b, opts))),
  watermark: (file: string, opts: WatermarkOptions) => wrap(bytes(file).then((b) => addWatermark(b, opts))),
  crop: (file: string, opts: CropOptions) => wrap(bytes(file).then((b) => cropPdf(b, opts))),
  imagesToPdf: (images: ImageInput[], opts: ImagesToPdfOptions) => wrap(imagesToPdf(images, opts)),
  listFields: (file: string) => wrap(bytes(file).then(listFormFields)),
  fillFields: (file: string, values: Record<string, FormValue>, flatten: boolean) => wrap(bytes(file).then((b) => fillFormFields(b, values, { flatten }))),
  addFields: (file: string, fields: NewFormField[]) => wrap(bytes(file).then((b) => addFormFields(b, fields))),
};
