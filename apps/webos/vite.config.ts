import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { vendorScripts } from './build/vendor-scripts.ts';
import { webosPackage } from './build/webos-package.ts';
import { VENDOR_SCRIPTS } from './src/player/engines/vendor.ts';

const root = import.meta.dirname;

export default defineConfig({
  // Packaged apps load from file://, so every URL in the build must be relative.
  base: './',
  plugins: [
    react(),
    vendorScripts(VENDOR_SCRIPTS),
    webosPackage({
      metaDir: resolve(root, 'webos-meta'),
      brandDir: resolve(root, '../../brand/webos'),
      extraFiles: {
        'licenses/Urbanist-OFL.txt': resolve(root, 'src/styles/fonts/Urbanist-OFL.txt'),
      },
    }),
  ],
  build: {
    // webOS 5.0 runs Chromium 68. See docs/adr/0001-react-norigin-classic-bundle.md.
    target: 'es2017',
    cssTarget: 'chrome68',
    modulePreload: false,
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        // One classic script, no chunks: dynamic imports are inlined and CSS rides in the script.
        format: 'iife',
        codeSplitting: false,
      },
    },
  },
  server: {
    port: 5173,
  },
});
