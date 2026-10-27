import { expect, test } from '@playwright/test';
import { PAIR_SERVICE } from '../src/data/pairing';
import { CONFIGURED_ADDON_URL, EXTRA_ADDON_URL, FIRST_ROW, mockAddons } from './addons';
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

test('an addon can be sent from a phone', async ({ page }) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  const { phone } = await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  await press(page, 'ArrowUp', 'addons-add');
  await press(page, 'Enter', 'install-field');

  const dialog = page.getByRole('dialog', { name: 'Add an addon' });
  await expect(dialog.getByText('Or send it from your phone')).toBeVisible();
  await expect(dialog.locator('svg path')).toHaveCount(1);
  await expect(dialog.getByText('K7P 2QZ')).toBeVisible();
  await expect(dialog.getByText(new URL(PAIR_SERVICE).host)).toBeVisible();

  // The code runs out: a new one is a button press away.
  phone.expire();
  await expect(dialog.getByText('This code has run out.')).toBeVisible();
  await press(page, 'ArrowRight', 'install-phone-retry');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'install-field');
  await expect(dialog.getByText('K7P 3QZ')).toBeVisible();

  // The phone sends the address: it fills the box, and Add is one press away.
  phone.send(EXTRA_ADDON_URL);
  await expectFocus(page, 'install-confirm');
  await expect(page.locator('input[aria-label="Addon address"]')).toHaveValue(EXTRA_ADDON_URL);
  await expect(dialog.getByText('Received from your phone. Press Add to add it.')).toBeVisible();
  await expect(dialog.getByText('K7P 4QZ')).toBeVisible();
  await settle(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Added Open Shorts. Its catalogs are on Home now.')).toBeVisible();
  expect(phone.codes).toEqual(['K7P2QZ', 'K7P3QZ', 'K7P4QZ']);
});

test("an addon's settings can be changed on a phone", async ({ page }) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  const { phone } = await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  await press(page, 'ArrowUp', 'addons-add');
  await press(page, 'Enter', 'install-field');
  await page.locator('input[aria-label="Addon address"]').fill(EXTRA_ADDON_URL);
  await pressTo(page, 'ArrowDown', 'Add');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Move Open Shorts up');
  await settle(page);

  // Only addons with a settings page get the button.
  const cards = page.locator('main p:has(> span)');
  await expect(page.getByRole('button', { name: 'Settings for Open Shorts' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Settings for/ })).toHaveCount(1);
  await pressTo(page, 'ArrowRight', 'Move Open Shorts down');
  await pressTo(page, 'ArrowRight', 'Settings for Open Shorts');
  await press(page, 'Enter', 'configure-cancel');
  const dialog = page.getByRole('dialog', { name: 'Settings for Open Shorts' });
  // A new code: the one from Add an addon went with that dialog.
  await expect(dialog.getByText('K7P 3QZ')).toBeVisible();

  phone.send(CONFIGURED_ADDON_URL);
  await expectFocus(page, 'configure-confirm');
  await expect(dialog.getByText('New settings for Open Shorts arrived.')).toBeVisible();
  await settle(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Updated Open Shorts with its new settings.')).toBeVisible();
  await expectFocusLabel(page, 'Settings for Open Shorts');
  await expect(cards).toHaveCount(3);
  await expect(cards.last()).toContainText('v1.3.0');
});
