import { expect, test } from '@playwright/test';
import { mockAddons } from './addons';
import { seedStreamAddon } from './play';
import { APP_URL, watchErrors } from './tv';

const CONTINUE_ROW = 'home-continue';
/** Morevna Project: season 1 has eight episodes, season 2 three. */
const SERIES = 'tt8000001';

/** Season 1's finale, watched when it was the last episode listed: its card knows of no next. */
const FINALE = {
  progress: [
    {
      metaId: SERIES,
      type: 'series' as const,
      videoId: `${SERIES}:1:8`,
      position: 1500,
      duration: 1500,
      watched: true,
    },
  ],
  played: [
    {
      videoId: `${SERIES}:1:8`,
      metaId: SERIES,
      type: 'series' as const,
      name: 'Morevna Project',
      poster: `https://images.metahub.space/poster/small/${SERIES}/img`,
      background: `https://images.metahub.space/background/medium/${SERIES}/img`,
      releaseInfo: '2016–',
      season: 1,
      episode: 8,
    },
  ],
};

test('a series watched to its last episode comes back when a new one is listed, marked New', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page, { recent: [`${SERIES}:2:1`] });
  await seedStreamAddon(page, FINALE);
  await page.goto(APP_URL);
  // Home looks at the series' episodes again, finds season 2 and offers its first episode.
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    /^Morevna Project, New: S2:E1/,
  );
  expect(errors).toEqual([]);
});

test('an episode that came out longer ago says Next, not New', async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, FINALE);
  await page.goto(APP_URL);
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    /^Morevna Project, Next: S2:E1/,
  );
  expect(errors).toEqual([]);
});
