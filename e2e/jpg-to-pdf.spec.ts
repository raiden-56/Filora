import { test, expect } from '@playwright/test';
import { makePng, makeJpg, uploadFiles } from './helpers';

test.describe('JPG to PDF (core flow)', () => {
  test('upload -> configure -> convert -> preview -> download', async ({ page }) => {
    await page.goto('/tools/jpg-to-pdf');
    await expect(page.getByRole('heading', { name: 'JPG to PDF', level: 1 })).toBeVisible();
    await expect(page.getByTestId('step-upload')).toBeVisible();

    await uploadFiles(page, [
      { name: 'photo-1.png', mimeType: 'image/png', buffer: await makePng() },
      { name: 'photo-2.jpg', mimeType: 'image/jpeg', buffer: await makeJpg() },
    ]);

    // Configure step with both images listed
    await expect(page.getByTestId('step-configure')).toBeVisible();
    await expect(page.getByTestId('file-card')).toHaveCount(2);

    // Change a couple of options (page size + orientation) if the controls exist
    const pageSize = page.getByLabel(/page size/i).first();
    if (await pageSize.count()) {
      await pageSize.click();
      await page.getByRole('option', { name: 'Letter' }).click();
    }

    // Convert
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('download-card')).toHaveCount(1);
    await expect(page.getByTestId('download-card')).toContainText('.pdf');
    await expect(page.getByTestId('download-card')).toContainText('2 pages');

    // Preview opens the viewer
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByLabel('PDF viewer')).toBeVisible();
    await expect(page.getByLabel('Current page')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    // Download produces a PDF
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-primary').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs');
    const head = fs.readFileSync(path!).subarray(0, 5).toString('latin1');
    expect(head).toBe('%PDF-');

    // Appears in My Files
    await page.goto('/my-files');
    await expect(page.getByText(/\.pdf/).first()).toBeVisible();

    // Start again resets
    await page.goto('/tools/jpg-to-pdf');
    await expect(page.getByTestId('step-upload')).toBeVisible();
  });

  test('rejects unsupported and empty files with a friendly message', async ({ page }) => {
    await page.goto('/tools/jpg-to-pdf');
    await uploadFiles(page, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
    await expect(page.getByRole('alert')).toContainText(/not a supported format/i);
    await uploadFiles(page, [{ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }]);
    await expect(page.getByRole('alert').last()).toContainText(/empty/i);
    await expect(page.getByTestId('step-upload')).toBeVisible();
  });
});
