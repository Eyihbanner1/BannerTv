import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback } from '../../webos/e2e/play.ts';
import { mockSports, seedSports, SPORTS_NOW } from '../../webos/e2e/sports.ts';

/*
 * Sport on the phone, against the TV journeys' made-up sports addon (never a real one). The
 * clock is fixed to SPORTS_NOW, 19:30 in London, where Arsenal v Brighton is live.
 */
test.use({ timezoneId: 'Europe/London' });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('Sports: the Live sport row, the Sports tab, a match page and the match playing', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.clock.install({ time: SPORTS_NOW });
  await mockAddons(page);
  await seedSports(page);
  const requests = await mockSports(page);
  const playback = await mockPlayback(page);
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');

  // Home: the Live sport row stands in for the sports addon's catalogs.
  await expect(page.getByText('Live sport', { exact: true })).toBeVisible();
  await expect(page.getByText('Test Sports', { exact: false })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Sports' }).click();
  // Today's rows: the live match, one starting soon and one that has ended.
  await expect(page.getByText('Starting 19:40')).toBeVisible();
  await expect(page.getByText('Ended', { exact: true })).toBeVisible();
  await page
    .getByLabel(/^Arsenal v Brighton/)
    // Home's Live sport row has it too, under the Sports tab.
    .last()
    .click();

  // The match page, from the addon that listed it.
  await expect(page.getByText('Listed by Test Sports')).toBeVisible();
  await page.getByRole('button', { name: /^Watch/ }).click();
  const pause = page.getByLabel('Pause', { exact: true }).first();
  await expect(pause).toBeVisible();
  // The browser waits for a tap before it plays; the phone does not.
  await pause.click();
  await page.getByLabel('Play', { exact: true }).first().click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0))
    .toBeGreaterThan(0);
  expect(playback.media).toContain('/match-1080p.webm');
  expect(requests.streams).toContain('sports sport/tsport:arsenal-brighton');

  await page.getByLabel('Leave the player').first().click();
  await expect(page.getByText('Listed by Test Sports')).toBeVisible();
  expect(errors).toEqual([]);
});
