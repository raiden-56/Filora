import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { makePdf, uploadFiles } from './helpers';

async function expectPdfDownload(page: import('@playwright/test').Page, minPages?: number) {
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 90_000 });
  if (minPages) await expect(page.getByTestId('download-card').first()).toContainText(new RegExp(`${minPages} page`));
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-primary').click();
  const download = await dl;
  const path = await download.path();
  expect(path).toBeTruthy();
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(path!) };
}

test.describe('PDF tools end-to-end', () => {
  test('merge two PDFs', async ({ page }) => {
    await page.goto('/tools/merge-pdf');
    await uploadFiles(page, [
      { name: 'a.pdf', mimeType: 'application/pdf', buffer: await makePdf(2, 'A') },
      { name: 'b.pdf', mimeType: 'application/pdf', buffer: await makePdf(3, 'B') },
    ]);
    await expect(page.getByTestId('file-card')).toHaveCount(2);
    await expect(page.getByText(/5 pages/)).toBeVisible();
    await page.getByTestId('primary-action').click();
    const { name, bytes } = await expectPdfDownload(page, 5);
    expect(name).toBe('a-merged.pdf');
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  });

  test('split by ranges produces a ZIP', async ({ page }) => {
    await page.goto('/tools/split-pdf');
    await uploadFiles(page, [{ name: 'doc.pdf', mimeType: 'application/pdf', buffer: await makePdf(6) }]);
    await expect(page.getByTestId('step-configure')).toBeVisible();
    await page.getByRole('button', { name: /page ranges/i }).click();
    const ranges = page.getByLabel(/ranges/i).first();
    await ranges.fill('1-2\n3-4\n5-6');
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('download-card')).toHaveCount(3);
    const dl = page.waitForEvent('download');
    await page.getByTestId('download-primary').click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
  });

  test('rotate all pages', async ({ page }) => {
    await page.goto('/tools/rotate-pdf');
    await uploadFiles(page, [{ name: 'doc.pdf', mimeType: 'application/pdf', buffer: await makePdf(2) }]);
    await expect(page.getByTestId('step-configure')).toBeVisible();
    await page.getByRole('button', { name: 'Rotate 90 degrees clockwise' }).click();
    await page.getByTestId('primary-action').click();
    const { bytes } = await expectPdfDownload(page);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  test('compress via the server shows size comparison', async ({ page }) => {
    await page.goto('/tools/compress-pdf');
    await uploadFiles(page, [{ name: 'doc.pdf', mimeType: 'application/pdf', buffer: await makePdf(3) }]);
    await expect(page.getByTestId('step-configure')).toBeVisible();
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Reduced by/i)).toBeVisible();
  });

  test('PDF to JPG via the server produces images', async ({ page }) => {
    await page.goto('/tools/pdf-to-jpg');
    await uploadFiles(page, [{ name: 'doc.pdf', mimeType: 'application/pdf', buffer: await makePdf(2) }]);
    await expect(page.getByTestId('step-configure')).toBeVisible();
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('download-card')).toHaveCount(2);
  });

  test('page numbers and watermark tools complete', async ({ page }) => {
    await page.goto('/tools/add-page-numbers');
    await uploadFiles(page, [{ name: 'doc.pdf', mimeType: 'application/pdf', buffer: await makePdf(2) }]);
    await expect(page.getByTestId('step-configure')).toBeVisible();
    await page.getByTestId('primary-action').click();
    await expectPdfDownload(page, 2);

    await page.goto('/tools/add-watermark');
    await uploadFiles(page, [{ name: 'doc.pdf', mimeType: 'application/pdf', buffer: await makePdf(1) }]);
    await expect(page.getByTestId('step-configure')).toBeVisible();
    await page.getByTestId('primary-action').click();
    await expectPdfDownload(page, 1);
  });

  test('server rejects a fake PDF with a friendly error', async ({ request }) => {
    const res = await request.post('/api/pdf/compress', {
      multipart: { files: { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf') } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_FILE');
  });
});
