import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { APP_URL, expectFocus, openSection, press, pressBack } from './tv';

const picker = (page: import('@playwright/test').Page, key: string) =>
  page.locator(`[data-focus-key="discover-${key}"]`);

test('Discover pages through a catalog and filters it by genre', async ({ page }) => {
  const requests = await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'discover');
  await expectFocus(page, 'discover-tile-0');
  await expect(picker(page, 'type')).toHaveAttribute('aria-label', 'Type: Movies');
  await expect(picker(page, 'catalog')).toHaveAttribute('aria-label', 'Catalog: Popular');
  await expect(picker(page, 'genre')).toHaveAttribute('aria-label', 'Genre: All genres');

  // Moving down the grid asks for the next page with skip.
  await press(page, 'ArrowDown', 'discover-tile-7');
  await expect.poll(() => requests.catalogs).toContain('movie/top/skip=14');
  await press(page, 'ArrowDown', 'discover-tile-14');
  await expect(page.locator('[data-focus-key="discover-tile-14"]')).toHaveAttribute(
    'aria-label',
    'movie 15, 2024',
  );
  await press(page, 'ArrowDown', 'discover-tile-21');
  await press(page, 'ArrowDown', 'discover-tile-28');
  await expect.poll(() => requests.catalogs).toContain('movie/top/skip=28');
  await press(page, 'ArrowDown', 'discover-tile-35');
  await expect.poll(() => requests.catalogs).toContain('movie/top/skip=42');
  // The catalog ran out: Down has nowhere to go.
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await expectFocus(page, 'discover-tile-35');

  for (const n of [28, 21, 14, 7, 0]) await press(page, 'ArrowUp', `discover-tile-${n}`);
  await press(page, 'ArrowUp', 'discover-type');
  await press(page, 'ArrowRight', 'discover-catalog');
  await press(page, 'ArrowRight', 'discover-genre');

  // The genre menu: Back closes it, OK picks.
  await press(page, 'Enter', 'discover-genre-menu-0');
  await expect(page.getByRole('dialog', { name: 'Genre' })).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'discover-genre');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await press(page, 'Enter', 'discover-genre-menu-0');
  await press(page, 'ArrowDown', 'discover-genre-menu-1');
  await press(page, 'Enter', 'discover-genre');
  await expect(picker(page, 'genre')).toHaveAttribute('aria-label', 'Genre: Action');
  await expect.poll(() => requests.catalogs).toContain('movie/top/genre=Action');

  // A new type starts on its first catalog.
  await press(page, 'ArrowLeft', 'discover-catalog');
  await press(page, 'ArrowLeft', 'discover-type');
  await press(page, 'Enter', 'discover-type-menu-0');
  await press(page, 'ArrowDown', 'discover-type-menu-1');
  await press(page, 'Enter', 'discover-type');
  await expect(picker(page, 'type')).toHaveAttribute('aria-label', 'Type: Series');
  await expect(picker(page, 'genre')).toHaveAttribute('aria-label', 'Genre: All genres');
  await press(page, 'ArrowDown', 'discover-tile-0');
  await expect(page.locator('[data-focus-key="discover-tile-0"]')).toHaveAttribute(
    'aria-label',
    'Morevna Project, 2016–',
  );

  // Cinemeta's New catalog needs a year, so its genre picker has no "All".
  await press(page, 'ArrowUp', 'discover-type');
  await press(page, 'ArrowRight', 'discover-catalog');
  await press(page, 'Enter', 'discover-catalog-menu-0');
  await press(page, 'ArrowDown', 'discover-catalog-menu-1');
  await press(page, 'Enter', 'discover-catalog');
  await expect(picker(page, 'catalog')).toHaveAttribute('aria-label', 'Catalog: New');
  await expect(picker(page, 'genre')).not.toHaveAttribute('aria-label', 'Genre: All genres');
});

test('See all on a Home row opens that catalog, and Back returns to the row', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  for (let n = 1; n <= 14; n++) await press(page, 'ArrowRight', `${FIRST_ROW}-tile-${n}`);
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-14"]`)).toHaveText('See all');

  await press(page, 'Enter', 'discover-tile-0');
  await expect(picker(page, 'catalog')).toHaveAttribute('aria-label', 'Catalog: Popular');
  await press(page, 'ArrowRight', 'discover-tile-1');
  await press(page, 'Enter', 'details-watch');
  await pressBack(page);
  await expectFocus(page, 'discover-tile-1');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-14`);
});
