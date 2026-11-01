import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback, STREAM_ADDON_URL } from '../../webos/e2e/play.ts';

/*
 * The phone app's web build, held like a phone, against the TV journeys' fake addons. On the
 * phone itself the player is Media3 through expo-video; here it is the browser's <video>, so
 * these journeys check the screens, the shared data layer and the player's controls, not
 * which streams a phone can decode.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Opens the app. The fake addons refuse every other address, so the app's own is let through. */
async function openApp(page: Page): Promise<void> {
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
}

async function addStreamAddon(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByText('Addons', { exact: true }).click();
  await page.getByRole('button', { name: 'Add an addon' }).last().click();
  await page.getByLabel('Addon address').fill(STREAM_ADDON_URL);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Added Test Streams.', { exact: false })).toBeVisible();
  await page.getByLabel('Back').first().click();
  await page.getByRole('tab', { name: 'Home' }).click();
}

test('first run: welcome, Home, an addon, a title, All streams and the player', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page, { firstRun: true });
  const playback = await mockPlayback(page);
  await openApp(page);

  await expect(page.getByText('Welcome to BannerTV')).toBeVisible();
  await page.getByText('Start browsing').click();
  await expect(page.getByText('Blender open movies')).toBeVisible();

  await addStreamAddon(page);

  // Cinemeta's copy of the film, which the test stream addon answers for.
  await page
    .getByLabel(/Tears of Steel/)
    .last()
    .click();
  await expect(page.getByRole('button', { name: /^Watch/ })).toBeVisible();
  await page.getByRole('button', { name: /All streams/ }).click();
  await page
    .getByText(/Open Movie 1080p/)
    .first()
    .click();

  const pause = page.getByLabel('Pause', { exact: true }).first();
  await expect(pause).toBeVisible();
  // The browser waits for a tap before it plays; the phone does not.
  await pause.click();
  await page.getByLabel('Play', { exact: true }).first().click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0))
    .toBeGreaterThan(1);

  // Quality, under More options, switches to the 720p stream. The controls hide while the film
  // plays: a tap brings them.
  const more = page.getByRole('button', { name: 'More options' });
  if (!(await more.isVisible())) await page.mouse.click(206, 160);
  await more.click();
  await page.getByRole('button', { name: /^Quality, 1080p/ }).click();
  await page.getByText('720p', { exact: true }).click();
  await expect.poll(() => playback.media).toContain('/movie-720p.webm');

  const leave = page.getByLabel('Leave the player').first();
  if (!(await leave.isVisible())) await page.mouse.click(206, 160);
  await leave.click();
  await expect(page.getByRole('button', { name: /All streams/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a later launch opens on Home, and Settings shows playback and the build', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('Auto-play picks')).toBeVisible();
  await expect(page.getByText(/BannerTV for phones/)).toBeVisible();
  expect(errors).toEqual([]);
});
