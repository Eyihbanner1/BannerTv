import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { webosPackage } from './build/webos-package.ts';

const root = import.meta.dirname;

// Built like the app (apps/webos/vite.config.ts): one classic ES2017 script that
// runs from file:// on webOS 5.0's Chromium 68, with relative URLs.
export default defineConfig({
  base: './',
  plugins: [
    webosPackage({
      metaDir: resolve(root, 'webos-meta'),
      brandDir: resolve(root, '../../brand/webos'),
      extraFiles: {
        'licenses/Urbanist-OFL.txt': resolve(
          root,
          '../../apps/webos/src/styles/fonts/Urbanist-OFL.txt',
        ),
      },
    }),
  ],
  build: {
    target: 'es2017',
    cssTarget: 'chrome68',
    modulePreload: false,
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        format: 'iife',
        codeSplitting: false,
      },
    },
  },
  server: { port: 5180 },
});
