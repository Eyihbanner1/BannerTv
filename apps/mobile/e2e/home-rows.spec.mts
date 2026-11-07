import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback, readKv, seedStreamAddon } from '../../webos/e2e/play.ts';

/* Home rows on the phone: My List on Home, and Settings > Home rows hiding and moving lines. */

const SERIES = 'tt8000001';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('My List shows on Home, and Home rows hides Continue Watching and moves My List', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [
      { metaId: SERIES, type: 'series', videoId: `${SERIES}:1:2`, position: 600, duration: 1500 },
    ],
    played: [
      {
        videoId: `${SERIES}:1:2`,
        metaId: SERIES,
        type: 'series',
        name: 'Morevna Project',
        season: 1,
        episode: 2,
      },
    ],
    kv: {
      library: {
        items: [{ id: 'tt1727587', type: 'movie', name: 'Sintel', addedAt: 1000 }],
        outbox: [],
        synced: [],
      },
    },
  });
  await mockPlayback(page);
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
  await expect(page.getByText('Continue watching')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sintel', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByText('Home rows', { exact: true }).click();
  await page.getByRole('switch', { name: 'Hide Continue watching from Home' }).click();
  await page.getByRole('button', { name: 'Move My List down' }).click();
  await expect
    .poll(async () => {
      const saved = (await readKv(page, 'homeLayout')) as
        { order: string[]; hidden: string[] } | undefined;
      return saved && { second: saved.order[1], hidden: saved.hidden };
    })
    .toEqual({ second: 'bannertv:my-list', hidden: ['bannertv:continue'] });

  await page.getByLabel('Back').first().click();
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect(page.getByText('Continue watching')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sintel', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
