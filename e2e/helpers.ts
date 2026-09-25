import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Page } from '@playwright/test';

/** Build a small PDF in memory (no binary fixtures committed). */
export async function makePdf(pages = 3, label = 'Test'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`${label} page ${i}`, { x: 60, y: 760, size: 28, font, color: rgb(0.1, 0.1, 0.4) });
    page.drawRectangle({ x: 60, y: 100, width: 475, height: 600, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
  }
  return Buffer.from(await doc.save());
}

/** A valid 320x200 PNG with a gradient (generated with sharp; nothing binary is committed). */
export async function makePng(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 320, height: 200, channels: 3, background: { r: 220, g: 60, b: 60 } } })
    .composite([{ input: Buffer.from('<svg width="320" height="200"><circle cx="160" cy="100" r="70" fill="#1d4ed8"/></svg>'), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/** A valid 240x320 JPEG. */
export async function makeJpg(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 240, height: 320, channels: 3, background: { r: 30, g: 150, b: 90 } } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function uploadFiles(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const input = page.getByTestId('file-input').first();
  await input.setInputFiles(files);
}
