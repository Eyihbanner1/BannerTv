import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { APP_URL, expectFocus, press, pressBack, watchErrors } from './tv';

test.beforeEach(async ({ page }) => {
  await mockAddons(page);
});

test('the packaged build loads from file:// as a classic script', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('script[type="module"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.fonts.check('600 24px Urbanist'))).toBe(true);
  // Posters from the addon are on screen.
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-0"] img`)).toHaveJSProperty(
    'complete',
    true,
  );
  expect(errors).toEqual([]);
});

test('arrows move through rows, remember the tile per row, and reach the hero and rail', async ({
  page,
}) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-2`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-3`);
  // The hero follows focus once it rests.
  await expect(page.locator('section[aria-label="Tears of Steel"]:visible')).toBeVisible();

  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowRight', `${SERIES_ROW}-tile-1`);
  // Back up to the tile this row was left on, not column 0.
  await press(page, 'ArrowUp', `${FIRST_ROW}-tile-3`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-1`);
  await press(page, 'ArrowUp', `${FIRST_ROW}-tile-3`);

  await press(page, 'ArrowUp', 'home-hero-details');
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-3`);

  await press(page, 'ArrowLeft', `${FIRST_ROW}-tile-2`);
  await press(page, 'ArrowLeft', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowLeft', `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowLeft', 'rail-home');
  // The rail opens and shows its labels while it has focus.
  const label = page.locator('[data-focus-key="rail-home"] span');
  await expect(label).toHaveCSS('opacity', '1');

  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-0`);
  await expect(label).toHaveCSS('opacity', '0');
});

test('OK opens details and Back returns to the same tile', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-2`);
  // Home stays mounted under Details, so Back shows the same elements, not new ones.
  const markRow = (key: string) => {
    const row = document.querySelector<HTMLElement>(`[data-row-key="${key}"]`);
    if (row) row.dataset.kept = 'yes';
  };
  await page.evaluate(markRow, FIRST_ROW);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('section[aria-label="Sintel"]:visible')).toBeVisible();
  // Hidden Home is out of reach: the remote cannot move into it from Details.
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toBeHidden();
  await expect(page.getByText('Starring Proog, Emo')).toBeVisible();
  await expect(page.getByText('Directed by Bassam Kurdali')).toBeVisible();

  // No stream addon is installed, so the player says so.
  await press(page, 'Enter', 'player-problem-streams');
  await expect(page.getByText('No stream could play')).toBeVisible();

  await pressBack(page);
  await expectFocus(page, 'details-watch');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-2`);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toHaveAttribute('data-kept', 'yes');
  // Home comes back with the row already at that tile, not sliding there.
  const slides = await page.evaluate(
    (key) =>
      document.querySelector(`[data-focus-key="${key}"]`)?.parentElement?.getAnimations().length,
    `${FIRST_ROW}-tile-2`,
  );
  expect(slides).toBe(0);
});

test('Back closes screens, goes Home, returns to the first row, then exits', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.evaluate(() => {
    const w = window as Window & { exitRequested?: boolean };
    window.addEventListener('bannertv:exit', () => (w.exitRequested = true));
  });

  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'addons', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-stream-choice');
  await press(page, 'ArrowDown', 'settings-probing');
  await press(page, 'ArrowDown', 'settings-subtitle-style');
  await press(page, 'ArrowDown', 'settings-diagnostics');
  await press(page, 'Enter', 'diagnostics-refresh');
  await expect(page.getByText('classic script')).toBeVisible();

  await pressBack(page);
  await expectFocus(page, 'settings-diagnostics');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

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
      deviceInfo: JSON.stringify({ modelName: 'TEST', platformVersion: '04.60.91' }),
      platformBack: () => (w.platformBackCalls = (w.platformBackCalls ?? 0) + 1),
    };
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await pressBack(page);
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { platformBackCalls?: number }).platformBackCalls),
    )
    .toBe(1);
});

test('the Magic Remote pointer moves focus by hovering', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const tile = page.locator(`[data-focus-key="${FIRST_ROW}-tile-4"]`);
  const box = await tile.boundingBox();
  if (!box) throw new Error('tile 4 is not on screen');
  await page.mouse.move(10, 10);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await expectFocus(page, `${FIRST_ROW}-tile-4`);
  await expect(page.locator('html')).toHaveClass(/pointer-mode/);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).not.toHaveClass(/pointer-mode/);
});

test('one pointer move straight from 5-way mode focuses the tile under it', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.mouse.move(10, 10);
  // The arrow hides the pointer, as on the TV.
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await expect(page.locator('html')).not.toHaveClass(/pointer-mode/);
  await page.waitForTimeout(300); // the row finishes sliding

  const box = await page.locator(`[data-focus-key="${FIRST_ROW}-tile-3"]`).boundingBox();
  if (!box) throw new Error('tile 3 is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expectFocus(page, `${FIRST_ROW}-tile-3`);
});

test('a pointer click opens details, and Back returns to the clicked tile', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  // A click with no hover before it, which the Magic Remote can send.
  await page.locator(`[data-focus-key="${SERIES_ROW}-tile-2"]`).dispatchEvent('click');
  await expectFocus(page, 'details-episodes-0');

  await pressBack(page);
  await expectFocus(page, `${SERIES_ROW}-tile-2`);
});

test('pointer arrows page through a row', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const row = page.locator(`[data-row-key="${FIRST_ROW}"]`);
  const next = row.getByRole('button', { name: 'More titles' });
  // Hidden in 5-way mode.
  await expect(next).toBeHidden();

  const box = await page.locator(`[data-focus-key="${FIRST_ROW}-tile-2"]`).boundingBox();
  if (!box) throw new Error('tile 2 is not on screen');
  await page.mouse.move(10, 10);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await expectFocus(page, `${FIRST_ROW}-tile-2`);
  await next.click();
  // One page is the six tiles that were in full view.
  await expectFocus(page, `${FIRST_ROW}-tile-6`);
  await expect(row.getByRole('button', { name: 'Previous titles' })).toBeVisible();
});
