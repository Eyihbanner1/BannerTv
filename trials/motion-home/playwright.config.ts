import { defineConfig } from '@playwright/test';

// The built trial, opened from file:// as the TV opens it, with made-up art so no network is needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  reporter: [['list']],
  use: {
    viewport: { width: 1920, height: 1080 },
    launchOptions: {
      // A CI runner has no GPU: SwiftShader draws WebGL in software.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    },
  },
});
