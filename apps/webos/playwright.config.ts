import { defineConfig } from '@playwright/test';

/**
 * Keyboard-only journeys against the production build, opened from file://
 * the way the TV opens a packaged app. Run `pnpm build` first.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
  },
});
