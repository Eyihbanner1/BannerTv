import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { mockPlayback, seedStreamAddon, type TestStream } from './play';
import { APP_URL, expectFocus, press, pressBack } from './tv';

/** Elephants Dream, the first title on Home. */
const MOVIE = 'tt0807840';

/** Five streams: three picture sizes, four cached, one in Spanish only. */
const STREAMS: readonly TestStream[] = [
  {
    name: 'Test Streams\n2160p',
    description: 'Open Movie 2160p WEB-DL\n💾 4.1 GB ⚡ Cached',
    path: '/movie-2160p.webm',
  },
  {
    name: 'Test Streams\n1080p',
    description: 'Open Movie 1080p WEB-DL x264\n💾 1.4 GB ⚡ Cached',
    path: '/movie-1080p.webm',
  },
  {
    name: 'Test Streams\n1080p',
    description: 'Open Movie 1080p BluRay 🇪🇸\n💾 1.6 GB ⚡ Cached',
    path: '/movie-1080p-es.webm',
  },
  {
    name: 'Test Streams\n1080p',
    description: 'Open Movie 1080p WEBRip\n💾 1.2 GB',
    path: '/movie-1080p-rip.webm',
  },
  {
    name: 'Test Streams\n720p',
    description: 'Open Movie 720p WEBRip\n💾 700 MB ⚡ Cached',
    path: '/movie-720p.webm',
  },
];

const storedFilter = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('bannertv.preferences') ?? '{}').streamFilter as unknown,
  );

/** From Home, the film's All streams. */
async function openAllStreams(page: Page) {
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('section[aria-label="Elephants Dream"]:visible')).toBeVisible();
  await press(page, 'ArrowRight', 'details-streams');
  await press(page, 'Enter', 'streams-item-0');
}

test('All streams filters to 1080p cached, keeps the filter for the profile, and clears it', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, { streams: { [MOVIE]: STREAMS } });
  await page.goto(APP_URL);
  await openAllStreams(page);

  const status = page.locator('section[aria-label="All streams"] [role="status"]');
  const rows = page.locator('[data-focus-key^="streams-item-"]');
  const filterButton = page.locator('[data-focus-key="streams-filter"]');
  await expect(status).toHaveText('5 streams');
  await expect(rows).toHaveCount(5);
  await expect(filterButton).toHaveText('Filter: none');

  // Filter sits left of Sort: Up from the list still lands on Sort, and the arrows go between them.
  await press(page, 'ArrowUp', 'streams-sort');
  await press(page, 'ArrowLeft', 'streams-filter');
  await press(page, 'ArrowRight', 'streams-sort');
  await press(page, 'ArrowLeft', 'streams-filter');
  await press(page, 'ArrowDown', 'streams-item-0');
  await press(page, 'ArrowUp', 'streams-sort');
  await press(page, 'ArrowLeft', 'streams-filter');

  // A menu of the four parts, each saying what it is on; Quality offers only the sizes found.
  await press(page, 'Enter', 'streams-filter-menu-0');
  const menu = page.getByRole('dialog', { name: 'Filter streams' });
  await expect(menu).toContainText('Quality');
  await expect(page.locator('[data-focus-key="streams-filter-menu-0"]')).toHaveAttribute(
    'aria-label',
    'Quality, Any',
  );
  await press(page, 'Enter', 'streams-filter-menu-resolution-0');
  const sizes = page.getByRole('dialog', { name: 'Quality' });
  await expect(sizes.locator('[data-focus-key]')).toHaveText([
    'Any',
    '4K1 stream',
    '1080p3 streams',
    '720p1 stream',
  ]);
  await press(page, 'ArrowDown', 'streams-filter-menu-resolution-1');
  await press(page, 'ArrowDown', 'streams-filter-menu-resolution-2');
  // Picked, it goes back up to the parts, on the one just set.
  await press(page, 'Enter', 'streams-filter-menu-0');
  await expect(page.locator('[data-focus-key="streams-filter-menu-0"]')).toHaveAttribute(
    'aria-label',
    'Quality, 1080p',
  );
  // Cached only switches where it is.
  await press(page, 'ArrowDown', 'streams-filter-menu-1');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focus-key="streams-filter-menu-1"]')).toHaveAttribute(
    'aria-label',
    'Cached only, On',
  );
  await expectFocus(page, 'streams-filter-menu-1');
  // Back goes up one level at a time: from Addon's menu to the parts, then to the button.
  await press(page, 'ArrowDown', 'streams-filter-menu-2');
  await press(page, 'Enter', 'streams-filter-menu-addon-0');
  await pressBack(page);
  await expectFocus(page, 'streams-filter-menu-2');
  await pressBack(page);
  await expectFocus(page, 'streams-filter');
  await expect(menu).toHaveCount(0);

  await expect(filterButton).toHaveText('Filter: 1080p, cached');
  await expect(status).toHaveText('2 of 5 streams');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-focus-key="streams-item-0"]')).toBeVisible();
  await expect(page.locator('[data-focus-key="streams-item-1"]')).toBeVisible();
  const list = page.locator('[data-focus-key="streams-item-0"]').locator('..');
  await expect(list).toContainText('Open Movie 1080p WEB-DL x264');
  await expect(list).toContainText('Open Movie 1080p BluRay 🇪🇸');
  await expect(list).not.toContainText('WEBRip');
  await expect(list).not.toContainText('2160p');
  await press(page, 'ArrowDown', 'streams-item-0');
  await press(page, 'ArrowDown', 'streams-item-1');
  expect(await storedFilter(page)).toEqual({ resolution: '1080p', cached: true });

  // The next launch keeps it. As in search.spec.ts, the browser is given a
  // moment to keep the page's write before the reload: a busy test machine
  // has dropped it otherwise.
  await page.waitForTimeout(500);
  await page.reload();
  await openAllStreams(page);
  await expect(filterButton).toHaveText('Filter: 1080p, cached');
  await expect(status).toHaveText('2 of 5 streams');
  await expect(rows).toHaveCount(2);

  // Clear filter, last in the menu, shows every stream again.
  await press(page, 'ArrowUp', 'streams-sort');
  await press(page, 'ArrowLeft', 'streams-filter');
  await press(page, 'Enter', 'streams-filter-menu-0');
  for (const index of [1, 2, 3, 4]) await press(page, 'ArrowDown', `streams-filter-menu-${index}`);
  await expect(page.locator('[data-focus-key="streams-filter-menu-4"]')).toHaveText('Clear filter');
  await press(page, 'Enter', 'streams-filter');
  await expect(filterButton).toHaveText('Filter: none');
  await expect(status).toHaveText('5 streams');
  await expect(rows).toHaveCount(5);
  expect(await storedFilter(page)).toEqual({});
});

test('Sources uses the same filter, keeps the stream playing listed, and changes it from its header', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    preferences: { streamFilter: { resolution: '1080p', cached: true } },
  });
  const mock = await mockPlayback(page, { streams: { [MOVIE]: STREAMS } });
  await page.goto(APP_URL);
  await openAllStreams(page);
  await expect(page.locator('section[aria-label="All streams"] [role="status"]')).toHaveText(
    '2 of 5 streams',
  );

  // Play the first row the filter left.
  await press(page, 'Enter', 'player-surface');
  await expect.poll(() => mock.media.length).toBeGreaterThan(0);
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Sources' });
  await expect(sheet).toContainText('2 of 5 streams');
  const rows = sheet.locator('[data-focus-key^="player-sources-row-"]');
  await expect(rows).toHaveCount(2);
  const playing = sheet.locator('[aria-label*="Playing now"]');
  await expect(playing).toHaveCount(1);
  await expect(playing).toContainText('1080p');

  // Its own Filter button, left of Sort, opens the same menus over the sheet.
  await press(page, 'ArrowUp', 'player-sources-all');
  await press(page, 'ArrowLeft', 'player-sources-sort');
  await press(page, 'ArrowLeft', 'player-sources-filter');
  await expect(page.locator('[data-focus-key="player-sources-filter"]')).toHaveText(
    'Filter: 1080p, cached',
  );
  await press(page, 'Enter', 'player-sources-filter-menu-0');
  // On the size set now, ticked.
  await press(page, 'Enter', 'player-sources-filter-menu-resolution-2');
  await press(page, 'ArrowDown', 'player-sources-filter-menu-resolution-3');
  await press(page, 'Enter', 'player-sources-filter-menu-0');
  await pressBack(page);
  await expectFocus(page, 'player-sources-filter');
  await expect(sheet).toBeVisible();

  // 720p cached is one stream, and the 1080p one playing stays, ticked.
  await expect(page.locator('[data-focus-key="player-sources-filter"]')).toHaveText(
    'Filter: 720p, cached',
  );
  await expect(sheet).toContainText('2 of 5 streams');
  await expect(rows).toHaveCount(2);
  await expect(sheet).toContainText('Open Movie 720p WEBRip');
  await expect(playing).toHaveCount(1);
  await expect(playing).toContainText('1080p');
  // Down goes back to the stream playing.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute('aria-label', /Playing now/);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('bannertv.preferences') ?? '{}').streamFilter,
    ),
  ).toEqual({ resolution: '720p', cached: true });
});
