// @ts-check
const { defineConfig } = require('@playwright/test');

const CI = Boolean(process.env.CI);

module.exports = defineConfig({
  testDir: './e2e',
  timeout: CI ? 45_000 : 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: CI ? 1 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROME_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL } : {}),
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    {
      // Fast gate: runs on every PR (and with --repeat-each=20 for stability proof).
      name: 'smoke',
      testMatch: /smoke\.spec\.js/,
      testIgnore: /visual-smoke/,
    },
    {
      // Real user flows and feature behavior against HTTP fixtures.
      name: 'functional',
      testMatch: /\.spec\.js/,
      testIgnore: [/smoke\.spec\.js/, /visual-smoke/, /tabview-stress/],
    },
    {
      // Screenshot baselines: chromium + Linux only (CI container).
      name: 'visual',
      testMatch: /visual-smoke\.spec\.js/,
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--disable-gpu',
            '--font-render-hinting=none',
            '--disable-skia-runtime-opts',
            '--disable-font-subpixel-positioning',
            '--disable-lcd-text',
            '--force-color-profile=srgb',
            '--hide-scrollbars',
          ],
        },
      },
    },
    {
      // Load/navigation abuse. Serial by design.
      name: 'stress',
      testMatch: /tabview-stress\.spec\.js/,
      workers: 1,
      retries: 0,
    },
  ],
});
