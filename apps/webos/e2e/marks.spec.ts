import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { mockPlayback, readKv, type SeedPlayed, seedStreamAddon } from './play';
import { APP_URL, expectFocus, expectFocusLabel, press, pressBack, watchErrors } from './tv';

const CONTINUE_ROW = 'home-continue';
/** Morevna Project, whose first season has eight episodes and second three. */
const SERIES = 'tt8000001';

/** OK held down past the hold, as the remote sends it: one key down, then up. */
async function holdOk(page: Page): Promise<void> {
  await page.keyboard.down('Enter');
  await page.waitForTimeout(800);
  await page.keyboard.up('Enter');
}

function seriesCard(episode: number, extra: Partial<SeedPlayed> = {}): SeedPlayed {
  return {
    videoId: `${SERIES}:1:${episode}`,
    metaId: SERIES,
    type: 'series',
    name: 'Morevna Project',
    poster: `https://images.metahub.space/poster/small/${SERIES}/img`,
    background: `https://images.metahub.space/background/medium/${SERIES}/img`,
    releaseInfo: '2016–',
    season: 1,
    episode,
    ...extra,
  };
}

/** The first season's second episode left part way. */
const PART_WAY = {
  progress: [
    {
      metaId: SERIES,
      type: 'series' as const,
      videoId: `${SERIES}:1:2`,
      position: 600,
      duration: 1500,
    },
  ],
  played: [seriesCard(2)],
};

test('Details opens a series at the episode after the one finished, with Next on its button', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [
      {
        metaId: SERIES,
        type: 'series',
        videoId: `${SERIES}:1:8`,
        position: 1500,
        duration: 1500,
        watched: true,
      },
    ],
  });
  await page.goto(APP_URL);
  // The finished episode's card is fetched, and Continue Watching offers the next.
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'aria-label',
    /^Morevna Project, Next: S2:E1/,
  );
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  // Focus is on that episode, in season 2, with the button saying so.
  await press(page, 'Enter', 'details-episodes-0');
  await expect(page.locator('[data-focus-key="details-start"]')).toHaveText('Next: S2:E1');
  await expect(page.getByText('1. Season 2 episode 1')).toBeVisible();
  await expect(page.getByText('1. Season 1 episode 1')).toHaveCount(0);

  // Looking back at season 1 does not stop the page opening where the viewer is up to next time.
  await press(page, 'ArrowUp', 'details-season-1');
  await press(page, 'ArrowLeft', 'details-season-0');
  await press(page, 'ArrowDown', 'details-episodes-0');
  await press(page, 'ArrowDown', 'details-episodes-1');
  await pressBack(page);
  await expectFocus(page, `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await expect(page.locator('[data-focus-key="details-start"]')).toHaveText('Next: S2:E1');
  await expect(page.getByText('1. Season 2 episode 1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Back from the episode Details opened on, far down the season, returns to it', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [
      {
        metaId: SERIES,
        type: 'series',
        videoId: `${SERIES}:1:7`,
        position: 1500,
        duration: 1500,
        watched: true,
      },
    ],
  });
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  // The last of season 1's eight, below the five in view at the top.
  await press(page, 'Enter', 'details-episodes-7');
  // Played straight away, without moving in the list first.
  await press(page, 'Enter', 'player-surface');
  await pressBack(page);
  await expectFocus(page, 'details-episodes-7');
  await expect(page.getByText('8. Season 1 episode 8')).toBeVisible();
  expect(errors).toEqual([]);
});

test('OK on an episode not out yet says when it is out, and opens nothing', async ({ page }) => {
  await mockAddons(page, { upcoming: [`${SERIES}:1:2`] });
  const mock = await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await press(page, 'ArrowDown', 'details-episodes-1');
  await press(page, 'Enter', 'details-episodes-1');
  await expect(page.getByText(/^Not out yet\. Out on /)).toBeVisible();
  await page.waitForTimeout(500);
  expect(mock.streams).toEqual([]);
});

test('OK held on a Continue Watching tile takes the title off the row, and focus goes on to the catalogs', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, PART_WAY);
  const mock = await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);

  await holdOk(page);
  await expectFocus(page, 'continue-menu-0');
  await expectFocusLabel(page, 'Remove from Continue Watching');
  await expect(page.getByRole('dialog', { name: 'Morevna Project' })).toBeVisible();
  // Held, not pressed: nothing played.
  expect(mock.streams).toEqual([]);

  await press(page, 'Enter', `${FIRST_ROW}-tile-0`);
  await expect(page.locator(`[data-row-key="${CONTINUE_ROW}"]`)).toHaveCount(0);
  // Kept to resume all the same, marked to stay off the row.
  await expect
    .poll(async () => {
      const saved = (await readKv(page, 'progress')) as { continueRow?: false }[] | undefined;
      return saved?.[0]?.continueRow;
    })
    .toBe(false);
  expect(errors).toEqual([]);
});

test('a quick OK on a Continue Watching tile still plays it', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page, PART_WAY);
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await press(page, 'Enter', 'player-surface');
});

test('Back from the held menu returns to the tile, and Add to My List saves the title', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, PART_WAY);
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await holdOk(page);
  await press(page, 'ArrowDown', 'continue-menu-1');
  await press(page, 'ArrowDown', 'continue-menu-2');
  await expectFocusLabel(page, 'Add to My List');
  await press(page, 'Enter', `${CONTINUE_ROW}-tile-0`);
  await expect
    .poll(async () => {
      const saved = (await readKv(page, 'library')) as { items: { id: string }[] } | undefined;
      return saved?.items.map((item) => item.id);
    })
    .toEqual([SERIES]);
});

test('OK held on an episode marks it, and its season, watched and not watched', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page);
  // Details looks for the focused episode's streams.
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');

  await holdOk(page);
  await expectFocus(page, 'details-marks-0');
  await expectFocusLabel(page, 'Mark as watched');
  await press(page, 'Enter', 'details-episodes-0');
  await expect(page.locator('[data-focus-key="details-episodes-0"]')).toHaveAttribute(
    'aria-label',
    /, watched$/,
  );
  // Now there is a place to go on from.
  await expect(page.locator('[data-focus-key="details-start"]')).toHaveText('Next: S1:E2');

  await holdOk(page);
  await expectFocusLabel(page, 'Mark as unwatched');
  await press(page, 'ArrowDown', 'details-marks-1');
  await expectFocusLabel(page, 'Mark season 1 as watched');
  await press(page, 'Enter', 'details-episodes-0');
  // The episodes near the view are drawn.
  for (let n = 0; n < 5; n++) {
    await expect(page.locator(`[data-focus-key="details-episodes-${n}"]`)).toHaveAttribute(
      'aria-label',
      /, watched$/,
    );
  }
  await expect(page.locator('[data-focus-key="details-start"]')).toHaveText('Next: S2:E1');

  await holdOk(page);
  await press(page, 'ArrowDown', 'details-marks-1');
  await expectFocusLabel(page, 'Mark season 1 as unwatched');
  await press(page, 'Enter', 'details-episodes-0');
  await expect(page.locator('[data-focus-key="details-episodes-0"]')).not.toHaveAttribute(
    'aria-label',
    /, watched$/,
  );
  expect(errors).toEqual([]);
});

test('a film can be marked watched from its page', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  const button = page.locator('[data-focus-key="details-watched"]');
  await expect(button).toHaveAttribute('aria-label', /^Mark .+ as watched$/);
  // A pointer click well after OK, which would count as that OK's own click.
  await page.waitForTimeout(500);
  await button.dispatchEvent('click');
  await expect(button).toHaveAttribute('aria-label', /^Watched\. Mark .+ as unwatched$/);
  await page.waitForTimeout(500);
  await button.dispatchEvent('click');
  await expect(button).toHaveAttribute('aria-label', /^Mark .+ as watched$/);
});
