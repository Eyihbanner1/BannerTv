/**
 * Draws the artwork that needs no film frames, into static/art/, which is
 * committed: each film's title logo, the shade laid over posters, and the
 * addon's icon. prepare-media.mjs then builds posters and backdrops from film
 * frames on the machine that has the films.
 *
 * Blender's own title logos are not covered by the films' Creative Commons
 * licences, so the titles are set here in Urbanist, BannerTV's own typeface
 * (SIL Open Font License), from the font files the TV app ships.
 *
 * Needs Playwright's Chromium: `pnpm --filter @bannertv/webos exec playwright install chromium`.
 * Run with `pnpm --filter @bannertv/demo art`.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { loadFilms } from './lib/films.mjs';

/* global document -- the page.evaluate callbacks run in Chromium */

const here = dirname(fileURLToPath(import.meta.url));
const service = join(here, '..');
const repo = join(service, '..', '..');
const fonts = join(repo, 'apps', 'webos', 'src', 'styles', 'fonts');
const out = join(service, 'static', 'art');

/** Logos are drawn into this box at most, and trimmed to the text. */
const LOGO_BOX = { width: 1280, height: 340 };
const POSTER = { width: 500, height: 750 };
const TEXT = '#F1EDFF';

// Inlined as data: URLs, since a page set with setContent() can't load file:// fonts.
const fontFaces = ['urbanist-latin.woff2', 'urbanist-latin-ext.woff2']
  .map((file) => {
    const data = readFileSync(join(fonts, file)).toString('base64');
    return `@font-face { font-family: Urbanist; font-weight: 400 800; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
  })
  .join('\n');

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Waits for Urbanist, and refuses to draw in a fallback font. */
async function fontsReady(page) {
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('800 100px Urbanist');
  });
  if (!loaded) throw new Error('Urbanist did not load');
}

async function renderLogo(page, lines, file) {
  const html = `<!doctype html><html><head><style>
${fontFaces}
html, body { margin: 0; background: transparent; }
#logo { display: inline-block; padding: 6px 16px 14px; font: 800 200px/1.18 Urbanist, sans-serif;
  color: ${TEXT}; letter-spacing: -0.01em; white-space: nowrap; text-align: left;
  text-shadow: 0 4px 18px rgba(11, 8, 21, 0.55), 0 1px 3px rgba(11, 8, 21, 0.6); }
#logo .small { display: block; font-size: 0.5em; font-weight: 700; letter-spacing: 0; }
</style></head><body><div id="logo">${lines
    .map((line, index) => `<span class="${index === 0 ? '' : 'small'}">${escapeHtml(line)}</span>`)
    .join('<br>')}</div></body></html>`;
  await page.setViewportSize({ width: 4000, height: 1200 });
  await page.setContent(html);
  await fontsReady(page);
  // Shrink the type until the block fits the logo box.
  const box = await page.evaluate(({ width, height }) => {
    const logo = document.getElementById('logo');
    let size = 200;
    for (;;) {
      const rect = logo.getBoundingClientRect();
      if ((rect.width <= width && rect.height <= height) || size <= 40) return rect.toJSON();
      size -= 4;
      logo.style.fontSize = `${size}px`;
    }
  }, LOGO_BOX);
  await page.locator('#logo').screenshot({ path: file, omitBackground: true });
  return box;
}

async function renderShade(page, file) {
  const html = `<!doctype html><html><head><style>
html, body { margin: 0; background: transparent; }
#shade { width: ${POSTER.width}px; height: ${POSTER.height}px;
  background: linear-gradient(to bottom, rgba(11, 8, 21, 0) 40%, rgba(11, 8, 21, 0.55) 68%, rgba(11, 8, 21, 0.92) 100%); }
</style></head><body><div id="shade"></div></body></html>`;
  await page.setViewportSize(POSTER);
  await page.setContent(html);
  await page.locator('#shade').screenshot({ path: file, omitBackground: true });
}

async function renderIcon(page, file) {
  const mark = readFileSync(join(repo, 'brand', 'logo', 'bannertv-mark.svg'), 'utf8');
  const html = `<!doctype html><html><head><style>
${fontFaces}
html, body { margin: 0; background: transparent; }
#icon { width: 256px; height: 256px; border-radius: 40px; background: #1B1430; position: relative; overflow: hidden; }
#icon svg { position: absolute; left: 34px; top: 18px; width: 188px; height: 188px; }
#icon span { position: absolute; left: 0; right: 0; bottom: 22px; text-align: center;
  font: 800 40px/1 Urbanist, sans-serif; letter-spacing: 0.18em; color: ${TEXT}; }
</style></head><body><div id="icon">${mark}<span>DEMO</span></div></body></html>`;
  await page.setViewportSize({ width: 256, height: 256 });
  await page.setContent(html);
  await fontsReady(page);
  await page.locator('#icon').screenshot({ path: file, omitBackground: true });
}

async function main() {
  const films = loadFilms();
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const film of films) {
      mkdirSync(join(out, film.slug), { recursive: true });
      const file = join(out, film.slug, 'logo.png');
      const box = await renderLogo(page, film.logoLines, file);
      console.log(`${film.slug}/logo.png  ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    await renderShade(page, join(out, 'poster-shade.png'));
    console.log('poster-shade.png');
    await renderIcon(page, join(out, 'addon.png'));
    console.log('addon.png');
  } finally {
    await browser.close();
  }
}

await main();
