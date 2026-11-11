import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { shell } from './build/shell.ts';
import { sportsData } from './build/sports-data.ts';
import { vendorScripts } from './build/vendor-scripts.ts';
import { webosPackage } from './build/webos-package.ts';
import { LG_UPDATES_IN_BUILD, SPORTS_IN_BUILD } from './src/app/features.ts';
import { SPORTS_DATA_SCRIPT } from './src/data/sports-data-script.ts';
import { VENDOR_SCRIPTS } from './src/player/engines/vendor.ts';

const root = import.meta.dirname;

export default defineConfig({
  // Packaged apps load from file://, so every URL in the build must be relative.
  base: './',
  plugins: [
    react(),
    vendorScripts(VENDOR_SCRIPTS),
    // A build without Sports carries no team and league data.
    SPORTS_IN_BUILD &&
      sportsData({
        ...SPORTS_DATA_SCRIPT,
        from: resolve(root, '../../packages/core/src/sports/data/sports-data.json'),
      }),
    // index.html starts the app through the loader, which can start a signed update instead.
    shell({
      entry: resolve(root, 'src/shell/main.ts'),
      appinfoPath: resolve(root, 'webos-meta/appinfo.json'),
      keyPath: resolve(root, 'certs/lg-updates.pem'),
      updatesInBuild: LG_UPDATES_IN_BUILD,
    }),
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
    // Every asset inside the app's script, as a data: URL: the fonts and logos. An update then
    // carries them with the script, and nothing locates a file from the script's own address,
    // which an update started from storage does not have (src/shell). check-bundle.mjs checks
    // that assets/ holds the script alone.
    assetsInlineLimit: () => true,
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
