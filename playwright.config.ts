import { defineConfig, devices } from '@playwright/test';

const CLIENT_PORT = 5173;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    // Optional: point at an existing Chromium/Chrome binary when the Playwright
    // browser download is not possible (e.g. restricted networks).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /navigation|jpg-to-pdf/ },
  ],
  webServer: {
    command: 'npm run dev -w client',
    url: `http://localhost:${CLIENT_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
