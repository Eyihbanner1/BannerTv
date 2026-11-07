import { expect, test } from '@playwright/test';
import { PAIR_SERVICE } from '../src/data/pairing';
import {
  CONFIGURED_ADDON_URL,
  EXTRA_ADDON_URL,
  FIRST_ROW,
  LONG_ADDON_URL,
  mockAddons,
  PLAIN_ADDON_URL,
} from './addons';
import { mockPlayback, readKv, seedStreamAddon } from './play';
import { fakeSync, mockSync, openAccount, openSettings, shownCode, typeInto } from './sync';
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
  await expect(dialog.getByText(/the QR code also opens the addon's settings/)).toBeVisible();

  // A link for another addon does not replace this one.
  phone.send('https://v3-cinemeta.strem.io/manifest.json');
  await expectFocus(page, 'configure-confirm');
  await settle(page);
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('That link is for a different addon.')).toBeVisible();
  await expect(cards).toHaveCount(3);

  phone.send(CONFIGURED_ADDON_URL);
  await expect(dialog.getByText('New settings for Open Shorts arrived.')).toBeVisible();
  await expectFocus(page, 'configure-confirm');
  await settle(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Updated Open Shorts with its new settings.')).toBeVisible();
  await expectFocusLabel(page, 'Settings for Open Shorts');
  await expect(cards).toHaveCount(3);
  await expect(cards.last()).toContainText('v1.3.0');

  // Settings that take the settings page away leave focus on the card.
  await settle(page);
  await press(page, 'Enter', 'configure-cancel');
  phone.send(PLAIN_ADDON_URL);
  await expectFocus(page, 'configure-confirm');
  await settle(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(cards.last()).toContainText('v1.4.0');
  await expectFocusLabel(page, 'Move Open Shorts up');
  await expect(page.getByRole('button', { name: /^Settings for/ })).toHaveCount(0);
});

test('a settings address too long for a QR code is left out of it', async ({ page }) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  await press(page, 'ArrowUp', 'addons-add');
  await press(page, 'Enter', 'install-field');
  await page.locator('input[aria-label="Addon address"]').fill(LONG_ADDON_URL);
  await pressTo(page, 'ArrowDown', 'Add');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Move Open Shorts up');
  await settle(page);
  await pressTo(page, 'ArrowRight', 'Move Open Shorts down');
  await pressTo(page, 'ArrowRight', 'Settings for Open Shorts');
  await press(page, 'Enter', 'configure-cancel');
  const dialog = page.getByRole('dialog', { name: 'Settings for Open Shorts' });
  await expect(dialog.getByText(/too long for a QR code/)).toBeVisible();
  await expect(dialog.getByText('K7P 3QZ')).toBeVisible();
});

/**
 * Presses `key` until focus reaches the button labelled `label`: cards hold
 * different buttons, so the same button sits at another place on each.
 */
async function walkTo(
  page: import('@playwright/test').Page,
  key: string,
  label: string,
): Promise<void> {
  for (let presses = 0; presses < 8; presses++) {
    const focused = await page.locator('[data-focused="true"]').getAttribute('aria-label');
    if (focused === label) return;
    await page.keyboard.press(key);
    await settle(page);
  }
  await expectFocusLabel(page, label);
}

/** From the first card's Move up, to the second card's Move up. */
async function downToSecond(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.keyboard.press('ArrowDown');
  await settle(page);
  await walkTo(page, 'ArrowLeft', `Move ${name} up`);
}

test('an addon that stops answering says since when, and Check now asks it again', async ({
  page,
}) => {
  await mockAddons(page);
  await mockPlayback(page);
  await seedStreamAddon(page);
  // Test Streams answers nothing, its manifest included, until the test brings it back.
  let down = true;
  await page.route(/^https:\/\/streams\.example\.com\/bannertv\//, (route) =>
    down ? route.abort() : route.fallback(),
  );
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  // The daily manifest refresh, a few seconds after launch, hears nothing from it.
  const line = page.getByRole('status').filter({ hasText: /^Not answering since \d\d:\d\d$/ });
  await expect(line).toHaveCount(1, { timeout: 15000 });
  const since = await line.textContent();
  // The addons that answer have no such line, nor Check now.
  await expect(page.getByRole('button', { name: /^Check .* now$/ })).toHaveCount(1);

  await downToSecond(page, 'Test Streams');
  await walkTo(page, 'ArrowRight', 'Check Test Streams now');
  await page.keyboard.press('Enter');
  await expect(page.getByText("Test Streams still isn't answering.")).toBeVisible();
  await expect(line).toHaveText(since!);
  await expectFocusLabel(page, 'Check Test Streams now');

  // Since when is kept across a restart.
  await page.reload();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'addons');
  await expect(line).toHaveText(since!);

  // It answers again: the line and Check now go, and focus stays on the card.
  await downToSecond(page, 'Test Streams');
  await walkTo(page, 'ArrowRight', 'Check Test Streams now');
  down = false;
  await page.keyboard.press('Enter');
  await expect(page.getByText('Test Streams is answering.')).toBeVisible();
  await expect(line).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Check .* now$/ })).toHaveCount(0);
  await expectFocusLabel(page, 'Remove Test Streams');
});

test('an answer to Check now leaves focus where the person moved it while waiting', async ({
  page,
}) => {
  await mockAddons(page);
  await mockPlayback(page);
  await seedStreamAddon(page);
  // Test Streams answers nothing at first; once back, its answer waits until the test lets it go.
  let down = true;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  await page.route(/^https:\/\/streams\.example\.com\/bannertv\//, async (route) => {
    if (down) return route.abort();
    await held;
    return route.fallback();
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  const line = page.getByRole('status').filter({ hasText: /^Not answering since / });
  await expect(line).toHaveCount(1, { timeout: 15000 });

  await downToSecond(page, 'Test Streams');
  await walkTo(page, 'ArrowRight', 'Check Test Streams now');
  down = false;
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Checking…' })).toHaveCount(1);
  await settle(page);
  await page.keyboard.press('ArrowLeft');
  await settle(page);
  const moved = await page.locator('[data-focused="true"]').getAttribute('aria-label');
  expect(moved).not.toBe('Check Test Streams now');

  release();
  await expect(page.getByText('Test Streams is answering.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Check .* now$/ })).toHaveCount(0);
  await settle(page);
  await expectFocusLabel(page, moved!);
});

test('the player names the addon that did not answer', async ({ page }) => {
  await mockAddons(page);
  await mockPlayback(page);
  await seedStreamAddon(page);
  await page.route(/^https:\/\/streams\.example\.com\/bannertv\/stream\//, (route) =>
    route.abort(),
  );
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await settle(page);
  await press(page, 'Enter', 'details-watch');
  await page.keyboard.press('Enter');
  await expect(page.getByText('No stream could play')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Test Streams didn't answer.")).toBeVisible();
  await expectFocus(page, 'player-problem-streams');
});

test('an addon switched off leaves Home but keeps its settings, until it is switched on', async ({
  page,
}) => {
  await mockAddons(page);
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

  // The switch is the card's first button, so the others keep their places.
  await pressTo(page, 'ArrowLeft', 'Open Shorts is on. Switch it off');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Open Shorts is off. Switch it on');
  await expect(page.getByText(/^Open Shorts is off: it gives no rows/)).toBeVisible();
  await expect(page.getByText('Off: its settings are kept')).toHaveCount(1);
  const cards = page.locator('main p:has(> span)');
  await expect(cards).toHaveCount(3);
  // Kept by the install's name, never by its address.
  await expect.poll(() => readKv(page, 'addons.off')).toHaveLength(1);
  expect(JSON.stringify(await readKv(page, 'addons.off'))).not.toContain('addon.example.com');

  // Home leaves its row out, and still does after a restart.
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('h2', { hasText: 'Trending shorts' })).toHaveCount(0);
  await page.reload();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('h2', { hasText: 'Trending shorts' })).toHaveCount(0);

  // Switched on again, its row is back.
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  await expect(cards).toHaveCount(3);
  await page.keyboard.press('ArrowDown');
  await settle(page);
  await page.keyboard.press('ArrowDown');
  await settle(page);
  await walkTo(page, 'ArrowLeft', 'Open Shorts is off. Switch it on');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Open Shorts is on again.')).toBeVisible();
  await expect(page.getByText('Off: its settings are kept')).toHaveCount(0);
  await expect.poll(() => readKv(page, 'addons.off')).toEqual([]);
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('h2', { hasText: 'Trending shorts' })).toHaveCount(1);

  // Removing an addon switched off takes its switch with it.
  await openSection(page, 'addons');
  await page.keyboard.press('ArrowDown');
  await settle(page);
  await page.keyboard.press('ArrowDown');
  await settle(page);
  await walkTo(page, 'ArrowLeft', 'Open Shorts is on. Switch it off');
  await page.keyboard.press('Enter');
  await expect.poll(() => readKv(page, 'addons.off')).toHaveLength(1);
  await walkTo(page, 'ArrowRight', 'Remove Open Shorts');
  await press(page, 'Enter', 'remove-addon-cancel');
  await press(page, 'ArrowLeft', 'remove-addon-confirm');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Removed Open Shorts.')).toBeVisible();
  await expect(cards).toHaveCount(2);
  await expect.poll(() => readKv(page, 'addons.off')).toEqual([]);
});

test('in a BannerTV account, switching an addon off and removing one say they reach every screen', async ({
  page,
}) => {
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  await press(page, 'Enter', 'account-code-saved');
  const code = await shownCode(page);
  await press(page, 'Enter', 'account-check-field');
  await typeInto(page, 'Last four characters of the code', code.slice(-4));
  await page.keyboard.press('Enter');
  await expect(page.getByText('This screen is in your account.')).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'settings-account');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  await pressTo(page, 'ArrowDown', 'Move OpenSubtitles v3 up');
  await pressTo(page, 'ArrowLeft', 'OpenSubtitles v3 is on. Switch it off');
  const pushes = () => sync.requests.filter((request) => request === 'POST /v1/push').length;
  const before = pushes();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText(/^OpenSubtitles v3 is off on every screen in your BannerTV account: /),
  ).toBeVisible();
  // The switch goes to the account like any other change.
  await expect.poll(pushes, { timeout: 15000 }).toBeGreaterThan(before);

  await walkTo(page, 'ArrowRight', 'Remove OpenSubtitles v3');
  await press(page, 'Enter', 'remove-addon-cancel');
  await expect(
    page.getByText(
      'Its rows leave Home on every screen in your BannerTV account, and it stops answering for titles. You can add it again later from its address.',
    ),
  ).toBeVisible();
  await pressBack(page);
  await expectFocusLabel(page, 'Remove OpenSubtitles v3');
});
