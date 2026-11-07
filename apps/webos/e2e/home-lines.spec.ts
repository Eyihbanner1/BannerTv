import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { readKv, seedStreamAddon } from './play';
import { APP_URL, expectFocus, expectFocusLabel, press, pressBack, watchErrors } from './tv';

const CONTINUE_ROW = 'home-continue';
const MY_LIST_ROW = 'home-my-list';
/** Morevna Project, left part way. */
const SERIES = 'tt8000001';

/** Main's My List with one film, as the TV keeps it. */
const LIBRARY = {
  items: [
    {
      id: 'tt1727587',
      type: 'movie',
      name: 'Sintel',
      poster: 'https://images.metahub.space/poster/small/tt1727587/img',
      addedAt: 1000,
    },
  ],
  outbox: [],
  synced: [],
};

test('My List shows as a row under Continue Watching, and Home rows moves it and hides Continue Watching', async ({
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
    kv: { library: LIBRARY },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  const rows = page.locator('main [data-row-key]');
  await expect(rows.nth(1)).toHaveAttribute('data-row-key', MY_LIST_ROW);
  await press(page, 'ArrowDown', `${MY_LIST_ROW}-tile-0`);
  await expectFocusLabel(page, 'Sintel');
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);

  // Settings > Home rows: hide Continue Watching, and move My List down one.
  await press(page, 'ArrowUp', `${MY_LIST_ROW}-tile-0`);
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'addons', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-stream-choice');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'Enter', 'home-rows-bannertv-continue-show');
  await expectFocusLabel(page, 'Hide Continue watching from Home');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Show Continue watching on Home');
  await press(page, 'ArrowDown', 'home-rows-bannertv-my-list-show');
  await press(page, 'ArrowLeft', 'home-rows-bannertv-my-list-down');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => {
      const saved = (await readKv(page, 'homeLayout')) as
        { order: string[]; hidden: string[] } | undefined;
      return saved && { first: saved.order.slice(0, 2), hidden: saved.hidden };
    })
    .toEqual({
      first: ['com.linvo.cinemeta|movie|top|', 'bannertv:my-list'],
      hidden: ['bannertv:continue'],
    });

  await pressBack(page);
  await expectFocus(page, 'settings-home-rows');
  await pressBack(page);
  // Home starts on the first catalog row, with My List under it, and no Continue Watching.
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator(`[data-row-key="${CONTINUE_ROW}"]`)).toHaveCount(0);
  await expect(rows.nth(1)).toHaveAttribute('data-row-key', MY_LIST_ROW);
  await press(page, 'ArrowDown', `${MY_LIST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  // Kept to resume: the series still has its place.
  const saved = (await readKv(page, 'progress')) as { videoId: string }[] | undefined;
  expect(saved?.[0]?.videoId).toBe(`${SERIES}:1:2`);
  expect(errors).toEqual([]);
});

test('with nothing to continue, Home opens on My List', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page, { kv: { library: LIBRARY } });
  await page.goto(APP_URL);
  await expectFocus(page, `${MY_LIST_ROW}-tile-0`);
  await expectFocusLabel(page, 'Sintel');
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);
  // Back returns to the first row, My List.
  await pressBack(page);
  await expectFocus(page, `${MY_LIST_ROW}-tile-0`);
});
