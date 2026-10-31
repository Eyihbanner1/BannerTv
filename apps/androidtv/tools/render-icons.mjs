// Draws the Android launcher icons and the Android TV banner from the brand SVGs.
// Run from anywhere: node apps/androidtv/tools/render-icons.mjs (needs Playwright and Chromium).
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const res = path.resolve(here, '../app/src/main/res');
const mark = readFileSync(path.join(repo, 'brand/logo/bannertv-mark.svg'), 'utf8');
const lockup = readFileSync(path.join(repo, 'brand/logo/bannertv-lockup-horizontal.svg'), 'utf8');

const TILE = '#1B1430';
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// The mark is drawn on a 100 by 100 grid and already sits optically centred in it, so every
// layout below centres that grid box rather than the triangle's bounding box.
function sized(svg, width) {
  return svg.replace('<svg ', `<svg width="${width}" style="display:block" `);
}

function page(width, height, background, shape, content) {
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center">
<div style="${shape};background:${background};display:flex;align-items:center;justify-content:center">
${content}</div></div></body></html>`;
}

const jobs = [];
for (const [density, scale] of Object.entries(DENSITIES)) {
  // Legacy icons (before Android 8): a 48dp square with a 2dp margin around the tile.
  const icon = 48 * scale;
  const tile = 44 * scale;
  const legacyMark = sized(mark, Math.round(tile * 0.66));
  jobs.push({
    out: `mipmap-${density}/ic_launcher.png`,
    size: [icon, icon],
    html: page(
      icon,
      icon,
      TILE,
      `width:${tile}px;height:${tile}px;border-radius:${tile * 0.16}px`,
      legacyMark,
    ),
  });
  jobs.push({
    out: `mipmap-${density}/ic_launcher_round.png`,
    size: [icon, icon],
    html: page(icon, icon, TILE, `width:${tile}px;height:${tile}px;border-radius:50%`, legacyMark),
  });
  // Adaptive icon foreground: 108dp, with the mark inside the 66dp circle no launcher mask cuts.
  // The grid box is 64dp, which keeps the triangle's corners within about 28dp of the centre.
  const foreground = 108 * scale;
  jobs.push({
    out: `mipmap-${density}/ic_launcher_foreground.png`,
    size: [foreground, foreground],
    html: page(
      foreground,
      foreground,
      'transparent',
      `width:${foreground}px;height:${foreground}px`,
      sized(mark, 64 * scale),
    ),
  });
}

// Android TV banner: 320 by 180 at xhdpi, with the name in it. The lockup's own viewBox carries
// clear space on every side; its artwork is 563 units wide, drawn here 256px wide.
const lockupBox = 633.38;
const lockupArt = 563.38;
jobs.push({
  out: 'drawable-xhdpi/banner.png',
  size: [320, 180],
  html: page(
    320,
    180,
    TILE,
    'width:320px;height:180px',
    sized(lockup, Math.round((256 * lockupBox) / lockupArt)),
  ),
});

const browser = await chromium.launch();
for (const job of jobs) {
  const [width, height] = job.size;
  const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await tab.setContent(job.html);
  const file = path.join(res, job.out);
  mkdirSync(path.dirname(file), { recursive: true });
  await tab.screenshot({ path: file, omitBackground: true });
  await tab.close();
  process.stdout.write(`${job.out}\n`);
}
await browser.close();
