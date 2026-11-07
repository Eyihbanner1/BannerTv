import { expect, type Locator, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback, readKv, seedStreamAddon } from '../../webos/e2e/play.ts';

/*
 * Browse, Continue Watching's held menu and episode marks on the phone, against the TV
 * journeys' fake addons.
 */

/** Morevna Project, whose first season has eight episodes. */
const SERIES = 'tt8000001';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * A long press, once the last sheet has gone and the page has settled: the title's buttons
 * change with the marks, and a row that moves under the finger is not held.
 */
async function hold(page: Page, target: Locator): Promise<void> {
  await expect(page.getByRole('button', { name: /^Mark / })).toHaveCount(0);
  await page.waitForTimeout(500);
  await target.click({ delay: 900 });
}

async function openApp(page: Page): Promise<void> {
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
}

test('Browse picks a type, a catalog and a genre, and keeps them for next time', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page);
  await openApp(page);
  await page.getByRole('button', { name: 'Discover' }).click();
  await expect(page.getByRole('button', { name: 'Movies' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All genres' })).toBeVisible();

  await page.getByRole('button', { name: 'Series' }).click();
  await page.getByRole('button', { name: 'Featured' }).click();
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await expect.poll(() => requests.catalogs).toContain('series/imdbRating/genre=Animation');
  // A catalog that needs a genre starts on its first.
  await page.getByRole('button', { name: 'New' }).click();
  await expect
    .poll(() => requests.catalogs.some((c) => c.startsWith('series/year/genre=')))
    .toBe(true);
  await expect(page.getByRole('button', { name: 'All genres' })).toHaveCount(0);

  await page.getByLabel('Back').first().click();
  await page.getByRole('button', { name: 'Discover' }).click();
  // Back on New, which needs a genre, so there is no All genres.
  await expect(page.getByRole('button', { name: 'Featured' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All genres' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a long press on Continue Watching takes the title off the row', async ({ page }) => {
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
  });
  await mockPlayback(page);
  await openApp(page);
  await expect(page.getByText('Continue watching')).toBeVisible();
  await page.getByRole('button', { name: 'Morevna Project, S1:E2' }).click({ delay: 900 });
  await page.getByRole('button', { name: 'Remove from Continue Watching' }).click();
  await expect(page.getByText('Continue watching')).toHaveCount(0);
  await expect
    .poll(async () => {
      const saved = (await readKv(page, 'progress')) as { continueRow?: false }[] | undefined;
      return saved?.[0]?.continueRow;
    })
    .toBe(false);
  expect(errors).toEqual([]);
});

test('a long press on an episode marks it watched, and its season', async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await openApp(page);
  await page
    .getByLabel(/^Morevna Project/)
    .first()
    .click();
  const first = page.getByRole('button', { name: /^1\. Season 1 episode 1,/ });
  await first.click({ delay: 900 });
  await page.getByRole('button', { name: 'Mark as watched' }).click();
  await expect(first).toHaveAttribute('aria-label', /, watched$/);

  await hold(page, first);
  await page.getByRole('button', { name: 'Mark season 1 as watched' }).click();
  await expect(
    page.getByRole('button', { name: /^3\. Season 1 episode 3,.*, watched$/ }),
  ).toBeVisible();

  await hold(page, first);
  await page.getByRole('button', { name: 'Mark season 1 as unwatched' }).click();
  await expect(first).not.toHaveAttribute('aria-label', /, watched$/);
  expect(errors).toEqual([]);
});

test('a genre on a title opens its catalog on it, and a name in the cast opens Search', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page);
  await openApp(page);
  await page
    .getByLabel(/^Elephants Dream/)
    .first()
    .click();
  // Animation is one of Cinemeta's film genres; Short is not.
  await expect(page.getByText('Short', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Browse Animation from Cinemeta' }).click();
  // The catalog's own title: the title's More Animation from Cinemeta row says it too.
  await expect(
    page.getByRole('heading', { name: 'Animation from Cinemeta', exact: true }),
  ).toBeVisible();
  await expect.poll(() => requests.catalogs).toContain('movie/top/genre=Animation');

  await page.locator('[aria-label="Back"]:visible').first().click();
  await page.getByRole('button', { name: 'Emo, search for more with them' }).click();
  await expect(page.getByLabel('Search', { exact: true })).toHaveValue('Emo');

  // Again from a title opened while Search is open below it: the Search on show takes the name.
  await page.getByRole('tab', { name: 'Home' }).click();
  await page
    .getByLabel(/^Elephants Dream/)
    .first()
    .click();
  await page.getByRole('button', { name: 'Proog, search for more with them' }).click();
  await expect(page.locator('input[aria-label="Search"]:visible')).toHaveValue('Proog');
  await expect(page.locator('input[aria-label="Search"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
