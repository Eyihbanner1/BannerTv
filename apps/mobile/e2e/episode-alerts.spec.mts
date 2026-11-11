import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { KIDS_ID, main, seedProfiles } from '../../webos/e2e/profiles.ts';

/*
 * Settings, New episode alerts on the phone. The web build schedules no notifications (a
 * browser tab has none ahead), so these check the switch: for grown-ups only, off until it is
 * switched on, and each profile's own, kept on the phone. Which alerts a phone schedules is
 * unit-tested (src/data/episode-alerts-plan.test.ts).
 */

const GUEST = 'guest4';
const ON_KEY = 'bannertv.phone.episodeAlerts';

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

/** The profiles with alerts on, as the phone keeps them. */
function alertsOn(page: Page): Promise<unknown> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown, ON_KEY);
}

test('New episode alerts are off until switched on, kept, and each profile has its own', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(), { id: GUEST, name: 'Guest', colour: 2 }],
    lastId: 'main',
    askAtLaunch: false,
  });
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  const alerts = page.getByRole('switch', { name: 'New episode alerts' });
  await expect(alerts).not.toBeChecked();
  await expect(
    page.getByText(
      'A notification at 18:00 on the day a new episode comes out, for series you watch and series on My List.',
    ),
  ).toBeVisible();
  await alerts.click();
  await expect(alerts).toBeChecked();
  expect(await alertsOn(page)).toEqual(['main']);

  // Kept when the app starts again.
  await page.goto('/');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('switch', { name: 'New episode alerts' })).toBeChecked();

  // Guest's are off: alerts are the profile's that switched them on.
  await page.getByRole('button', { name: 'Switch profile' }).click();
  const switched = page.waitForEvent('load', { timeout: 20000 });
  await page.getByRole('button', { name: 'Guest', exact: true }).click();
  await switched;
  // The test server has no page at /profiles, where the web build starts again.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Switch profile' })).toHaveText('G');
  await page.getByRole('tab', { name: 'Settings' }).click();
  const guests = page.getByRole('switch', { name: 'New episode alerts' });
  await expect(guests).not.toBeChecked();
  // The whole row switches it, as the other switches in Settings.
  await page.getByText('New episode alerts', { exact: true }).click();
  await expect(guests).toBeChecked();
  expect(await alertsOn(page)).toEqual(['main', GUEST]);
  await guests.click();
  await expect(guests).not.toBeChecked();
  expect(await alertsOn(page)).toEqual(['main']);
  expect(errors).toEqual([]);
});

test("a kids profile's Settings has no New episode alerts", async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Ada', colour: 2, kids: 'U' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(
    page.getByText('Grown-ups can change the settings from their own profile.'),
  ).toBeVisible();
  await expect(page.getByText('New episode alerts', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
