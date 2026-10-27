import { expect, test } from '@playwright/test';
import { EXTRA_ADDON_URL, FIRST_ROW, mockAddons } from './addons';
import {
  APP_URL,
  expectFocus,
  expectFocusLabel,
  openSection,
  press,
  pressBack,
  pressTo,
} from './tv';

// Spatial navigation ignores a key pressed sooner than 100 ms after the last one.
const settle = (page: import('@playwright/test').Page) => page.waitForTimeout(150);

test('Addons moves and removes addons, and asks before removing', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  const cards = page.locator('main p:has(> span)');
  await expect(cards).toHaveText([/^Cinemetav[\d.]+Default$/, /^OpenSubtitles v3v[\d.]+Default$/]);

  await pressTo(page, 'ArrowRight', 'Move Cinemeta down');
  await page.keyboard.press('Enter');
  await settle(page);
  await expect(cards.first()).toContainText('OpenSubtitles v3');
  await expectFocusLabel(page, 'Move Cinemeta down');
  await pressTo(page, 'ArrowLeft', 'Move Cinemeta up');
  await page.keyboard.press('Enter');
  await settle(page);
  await expect(cards.first()).toContainText('Cinemeta');

  await pressTo(page, 'ArrowDown', 'Move OpenSubtitles v3 up');
  await pressTo(page, 'ArrowRight', 'Move OpenSubtitles v3 down');
  await pressTo(page, 'ArrowRight', 'Remove OpenSubtitles v3');
  await press(page, 'Enter', 'remove-addon-cancel');
  await expect(page.getByRole('dialog', { name: 'Remove OpenSubtitles v3?' })).toBeVisible();
  await pressBack(page);
  await expectFocusLabel(page, 'Remove OpenSubtitles v3');
  await expect(cards).toHaveCount(2);

  await press(page, 'Enter', 'remove-addon-cancel');
  await press(page, 'ArrowLeft', 'remove-addon-confirm');
  await page.keyboard.press('Enter');
  await expect(cards).toHaveCount(1);
  await expect(page.getByText('Removed OpenSubtitles v3.')).toBeVisible();
  await expectFocusLabel(page, 'Remove Cinemeta');
});

test('an addon can be added by its address', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  await press(page, 'ArrowUp', 'addons-add');
  await press(page, 'Enter', 'install-field');

  const input = page.locator('input[aria-label="Addon address"]');
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.type('not an address');
  await page.keyboard.press('Enter');
  await expect(page.getByText("That doesn't look like an addon address.")).toBeVisible();
  await expectFocus(page, 'install-field');

  await input.fill(EXTRA_ADDON_URL.replace('/manifest.json', ''));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Added Open Shorts. Its catalogs are on Home now.')).toBeVisible();
  await expectFocusLabel(page, 'Move Open Shorts up');

  // Its catalog is a row on Home, after Cinemeta's.
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('h2', { hasText: 'Trending shorts' })).toHaveCount(1);
});
