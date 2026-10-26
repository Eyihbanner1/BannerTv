import { expect, test } from '@playwright/test';
import { APP_URL, expectFocus, press, pressBack, watchErrors } from './tv';

test('the packaged build loads from file:// as a classic script', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await expectFocus(page, 'home-row-0-tile-0');
  await expect(page.locator('script[type="module"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.fonts.check('600 24px Urbanist'))).toBe(true);
  expect(errors).toEqual([]);
});

test('arrows move through rows, remember the tile per row, and reach the hero and rail', async ({
  page,
}) => {
  await page.goto(APP_URL);
  await expectFocus(page, 'home-row-0-tile-0');

  await press(page, 'ArrowRight', 'home-row-0-tile-1');
  await press(page, 'ArrowRight', 'home-row-0-tile-2');
  await press(page, 'ArrowRight', 'home-row-0-tile-3');
  await expect(page.locator('#root h1')).toHaveText('Tears of Steel');

  await press(page, 'ArrowDown', 'home-row-1-tile-0');
  await press(page, 'ArrowRight', 'home-row-1-tile-1');
  // Back up to the tile this row was left on, not column 0.
  await press(page, 'ArrowUp', 'home-row-0-tile-3');
  await press(page, 'ArrowDown', 'home-row-1-tile-1');
  await press(page, 'ArrowUp', 'home-row-0-tile-3');

  await press(page, 'ArrowUp', 'home-hero-details');
  await press(page, 'ArrowDown', 'home-row-0-tile-3');

  await press(page, 'ArrowLeft', 'home-row-0-tile-2');
  await press(page, 'ArrowLeft', 'home-row-0-tile-1');
  await press(page, 'ArrowLeft', 'home-row-0-tile-0');
  await press(page, 'ArrowLeft', 'rail-home');
  // The rail opens and shows its labels while it has focus.
  const label = page.locator('[data-focus-key="rail-home"] span');
  await expect(label).toHaveCSS('opacity', '1');

  await press(page, 'ArrowRight', 'home-row-0-tile-0');
  await expect(label).toHaveCSS('opacity', '0');
});

test('OK opens details and Back returns to the same tile', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, 'home-row-0-tile-0');
  await press(page, 'ArrowRight', 'home-row-0-tile-1');
  await press(page, 'ArrowRight', 'home-row-0-tile-2');
  await press(page, 'Enter', 'details-back');
  await expect(page.locator('#root h1')).toHaveText('Sintel');

  await pressBack(page);
  await expectFocus(page, 'home-row-0-tile-2');
});

test('Back closes screens, goes Home, returns to the first row, then exits', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, 'home-row-0-tile-0');
  await page.evaluate(() => {
    const w = window as Window & { exitRequested?: boolean };
    window.addEventListener('bannertv:exit', () => (w.exitRequested = true));
  });

  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'addons', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-diagnostics');
  await press(page, 'Enter', 'diagnostics-refresh');
  await expect(page.getByText('classic script')).toBeVisible();

  await pressBack(page);
  await expectFocus(page, 'settings-diagnostics');
  await pressBack(page);
  await expectFocus(page, 'home-row-0-tile-0');

  await press(page, 'ArrowDown', 'home-row-1-tile-0');
  await pressBack(page);
  await expectFocus(page, 'home-row-0-tile-0');

  await pressBack(page);
  await expect
    .poll(() => page.evaluate(() => (window as Window & { exitRequested?: boolean }).exitRequested))
    .toBe(true);
});

test('on a TV, Back on the root screen calls platformBack', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { platformBackCalls?: number };
    w.platformBackCalls = 0;
    w.PalmSystem = {
      deviceInfo: JSON.stringify({ modelName: 'TEST', platformVersion: '7.6.0' }),
      platformBack: () => (w.platformBackCalls = (w.platformBackCalls ?? 0) + 1),
    };
  });
  await page.goto(APP_URL);
  await expectFocus(page, 'home-row-0-tile-0');
  await pressBack(page);
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { platformBackCalls?: number }).platformBackCalls),
    )
    .toBe(1);
});

test('the Magic Remote pointer moves focus by hovering', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, 'home-row-0-tile-0');
  const tile = page.locator('[data-focus-key="home-row-0-tile-4"]');
  const box = await tile.boundingBox();
  if (!box) throw new Error('tile 4 is not on screen');
  await page.mouse.move(10, 10);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await expectFocus(page, 'home-row-0-tile-4');
  await expect(page.locator('html')).toHaveClass(/pointer-mode/);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).not.toHaveClass(/pointer-mode/);
});
