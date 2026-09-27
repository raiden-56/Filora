import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { makeJpg, makePng, uploadFiles } from './helpers';

async function downloadPrimary(page: import('@playwright/test').Page) {
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-primary').click();
  const download = await dl;
  return { name: download.suggestedFilename(), bytes: fs.readFileSync((await download.path())!) };
}

test.describe('Image tools', () => {
  test('PNG to JPG converts in the browser', async ({ page }) => {
    await page.goto('/tools/png-to-jpg');
    await uploadFiles(page, [{ name: 'graphic.png', mimeType: 'image/png', buffer: await makePng() }]);
    await expect(page.getByTestId('step-configure')).toBeVisible();
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('image-results')).toBeVisible();
    const { name, bytes } = await downloadPrimary(page);
    expect(name).toBe('graphic.jpg');
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
  });

  test('JPG to PNG converts several files and offers a ZIP', async ({ page }) => {
    await page.goto('/tools/jpg-to-png');
    await uploadFiles(page, [
      { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makeJpg() },
      { name: 'b.jpg', mimeType: 'image/jpeg', buffer: await makeJpg() },
    ]);
    await expect(page.getByTestId('file-card')).toHaveCount(2);
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('download-card')).toHaveCount(2);
    const { name } = await downloadPrimary(page);
    expect(name).toMatch(/\.zip$/);
  });

  test('a PNG renamed to .jpg is rejected with a helpful message', async ({ page }) => {
    await page.goto('/tools/jpg-to-png');
    await uploadFiles(page, [{ name: 'renamed.jpg', mimeType: 'image/jpeg', buffer: await makePng() }]);
    await expect(page.getByRole('alert')).toContainText(/actually a PNG/i);
  });
});
