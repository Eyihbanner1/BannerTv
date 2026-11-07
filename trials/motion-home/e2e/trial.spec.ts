import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const INDEX = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** The trial's phase, or 'navigating' while the suite moves on to the next mode. */
const phase = (page: Page) =>
  page.evaluate(() => window.__motionTrial?.phase).catch(() => 'navigating');

test('the menu opens and the remote moves through it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${INDEX}?fixture=1`);
  await expect(page.locator('.mt-button.mt-selected')).toContainText('Run all three tests');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.mt-button.mt-selected')).toContainText('Lightning, sharp');
  expect(errors).toEqual([]);
});

for (const mode of ['lightning', 'lightning-1080', 'html']) {
  test(`${mode}: Home draws and follows the arrows`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`${INDEX}?fixture=1&mode=${mode}`);
    await expect.poll(() => phase(page), { timeout: 20_000 }).toBe('ready');
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await page.keyboard.press(key);
    }
    expect(await phase(page)).toBe('ready');
    if (mode === 'html') await expect(page.locator('.mt-tile.mt-focused')).toHaveCount(1);
    else await expect(page.locator('canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('the full suite runs every mode and shows the results', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${INDEX}?fixture=1`);
  await page.evaluate(() => localStorage.removeItem('bannertv.motionTrial.results'));
  await page.keyboard.press('Enter');
  await expect.poll(() => phase(page), { timeout: 220_000, intervals: [2000] }).toBe('results');
  await expect(page.locator('.mt-table tr')).toHaveCount(4);
  const results = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('bannertv.motionTrial.results') ?? '[]'),
  );
  expect(results.map((r: { mode: string }) => r.mode)).toEqual([
    'lightning',
    'lightning-1080',
    'html',
  ]);
  for (const result of results) expect(result.browse.frames).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});
