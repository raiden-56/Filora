import { test, expect } from '@playwright/test';

test.describe('Navigation and discovery', () => {
  test('home page shows hero, upload area and categories', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('All your PDF tools in one place');
    await expect(page.getByRole('link', { name: 'Choose a PDF Tool' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Convert JPG to PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Drop your files here/ })).toBeVisible();
    for (const cat of ['Organize PDF', 'Optimize PDF', 'Convert to PDF', 'Convert from PDF', 'Edit PDF', 'Image Tools']) {
      await expect(page.getByRole('heading', { name: cat, level: 3 })).toBeVisible();
    }
    // No horizontal overflow
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });

  test('all tools page lists every tool grouped by category', async ({ page }) => {
    await page.goto('/tools');
    await expect(page.getByRole('heading', { name: 'All PDF Tools' })).toBeVisible();
    const names = ['Merge PDF', 'Split PDF', 'Remove Pages', 'Extract Pages', 'Organize PDF', 'Scan to PDF', 'Compress PDF', 'Repair PDF', 'OCR PDF', 'JPG to PDF', 'Word to PDF', 'PowerPoint to PDF', 'Excel to PDF', 'HTML to PDF', 'PDF to JPG', 'PDF to Word', 'PDF to PowerPoint', 'PDF to Excel', 'PDF to PDF/A', 'Rotate PDF', 'Page Numbers', 'Watermark', 'Crop PDF', 'Edit PDF', 'PDF Forms', 'HEIC to JPG', 'HEIF to JPG', 'JPG to PNG', 'PNG to JPG'];
    for (const n of names) await expect(page.getByRole('link', { name: new RegExp(`^${n.replace(/[/]/g, '\\/')}:`) })).toBeVisible();
    await page.getByLabel('Filter tools').fill('compress');
    await expect(page.getByRole('link', { name: /^Compress PDF:/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Merge PDF:/ })).toHaveCount(0);
  });

  test('global search with keyboard shortcut finds tools', async ({ page, isMobile }) => {
    await page.goto('/');
    if (isMobile) await page.getByRole('button', { name: 'Search tools' }).click();
    else await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'Search tools' });
    await expect(box).toBeVisible();
    await box.fill('jpg');
    await expect(page.getByRole('option', { name: /JPG to PDF/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /PDF to JPG/ })).toBeVisible();
    await box.press('Enter');
    await expect(page).toHaveURL(/\/tools\/jpg-to-pdf/);
  });

  test('dark mode toggle and settings persist', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgb(247, 248, 251)');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.reload();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(bg);
    await page.getByRole('button', { name: 'Light', exact: true }).click();
  });

  test('unknown routes show not found', async ({ page }) => {
    await page.goto('/tools/does-not-exist');
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});
