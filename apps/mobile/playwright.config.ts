import { defineConfig } from '@playwright/test';

/**
 * Touch journeys against the phone app's web build (`pnpm export:web`), with the TV journeys'
 * fake addons. They check the screens and the shared data layer; the player itself is checked
 * on a phone, since the web build plays through the browser's own video element.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 412, height: 915 },
    baseURL: 'http://localhost:8765',
    trace: 'retain-on-failure',
    // A phone app starts the video the viewer asked for; the browser would wait for a tap.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'python3 -m http.server 8765 --directory dist/web',
    url: 'http://localhost:8765',
    reuseExistingServer: true,
    stderr: 'ignore',
  },
});
