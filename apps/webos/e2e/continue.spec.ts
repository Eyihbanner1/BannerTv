import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { mockPlayback, type SeedPlayed, type SeedProgress, seedStreamAddon } from './play';
import { APP_URL, expectFocus, expectFocusLabel, press, pressBack, watchErrors } from './tv';

const CONTINUE_ROW = 'home-continue';
/** Big Buck Bunny: not the first title on Home, so focus on it means the row came first. */
const MOVIE = 'tt1254207';
/** Morevna Project, whose first season has eight episodes. */
const SERIES = 'tt8000001';

/** What the player's video element is doing. */
function video(page: Page) {
  return page.locator('video:not([aria-hidden])').evaluate((element: HTMLVideoElement) => ({
    playing: !element.paused && element.currentTime > 0,
    time: element.currentTime,
  }));
}

/** A value the app keeps in its IndexedDB key-value store. */
function readKv(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('bannertv');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('kv').objectStore('kv').get(name);
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
        };
      }),
    key,
  );
}

/** A Continue Watching card with the artwork the fake Cinemeta gives the title. */
function card(
  type: SeedPlayed['type'],
  metaId: string,
  name: string,
  extra: Partial<SeedPlayed> = {},
): SeedPlayed {
  return {
    videoId: metaId,
    metaId,
    type,
    name,
    poster: `https://images.metahub.space/poster/small/${metaId}/img`,
    background: `https://images.metahub.space/background/medium/${metaId}/img`,
    logo: `https://images.metahub.space/logo/medium/${metaId}/img`,
    ...extra,
  };
}

/** A quarter of the way through: 30 s is the least that resumes, and the test file is 40 s. */
const MOVIE_PART_WAY: SeedProgress = {
  metaId: MOVIE,
  type: 'movie',
  videoId: MOVIE,
  position: 30,
  duration: 120,
};

/** The first episode watched to the end, with its card naming the second. */
const EPISODE_FINISHED = {
  progress: [
    {
      metaId: SERIES,
      type: 'series',
      videoId: `${SERIES}:1:1`,
      position: 1500,
      duration: 1500,
      watched: true,
    },
  ],
  played: [
    card('series', SERIES, 'Morevna Project', {
      videoId: `${SERIES}:1:1`,
      releaseInfo: '2016–',
      season: 1,
      episode: 1,
      next: { videoId: `${SERIES}:1:2`, season: 1, episode: 2 },
    }),
  ],
} satisfies { progress: SeedProgress[]; played: SeedPlayed[] };

test('Home opens on a film left part way, with its progress, and OK resumes it in the player', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [MOVIE_PART_WAY],
    played: [card('movie', MOVIE, 'Big Buck Bunny', { releaseInfo: '2008' })],
  });
  const mock = await mockPlayback(page);
  await page.goto(APP_URL);

  // The row comes before the catalogs, and first focus waits for it.
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expectFocusLabel(page, 'Big Buck Bunny, 2008');
  await expect(page.locator('[data-row-key]').first()).toHaveAttribute(
    'data-row-key',
    CONTINUE_ROW,
  );
  await expect(page.locator('section[aria-label="Continue watching"]')).toBeVisible();
  await expect(
    page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"] span[style*="width"]`),
  ).toHaveAttribute('style', /width: 25%/);
  // The hero follows focus onto the row, as on any other.
  await expect(page.locator('section[aria-label="Big Buck Bunny"]:visible')).toBeVisible();
  // The row stays light: nothing asks for streams or tests links until OK.
  await page.waitForTimeout(1500);
  expect(mock.streams).toEqual([]);
  expect(mock.media).toEqual([]);

  // Straight into the player, with no title page on the way.
  await press(page, 'Enter', 'player-surface');
  // Home is covered now: the progress the player saves must not redraw the row underneath.
  await page.evaluate((key) => {
    const w = window as Window & { rowChanges?: number };
    w.rowChanges = 0;
    const row = document.querySelector(`[data-row-key="${key}"]`)!;
    const count = (changes: MutationRecord[]) => (w.rowChanges! += changes.length);
    new MutationObserver(count).observe(row, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    new MutationObserver(count).observe(row.parentElement!, { childList: true });
  }, CONTINUE_ROW);
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).time).toBeGreaterThanOrEqual(30);
  expect(mock.streams).toEqual([`movie/${MOVIE}`]);
  // The tile's title went with the route, so the player names the film at once.
  await expect(page.locator('section[aria-label="Big Buck Bunny"]:visible')).toBeVisible();

  // The player has saved progress, with the test file's own length, and the film's card again.
  await expect
    .poll(async () => {
      const saved = (await readKv(page, 'progress')) as Array<{
        videoId: string;
        duration: number;
      }>;
      return saved.find((entry) => entry.videoId === MOVIE)?.duration;
    })
    .toBeCloseTo(40, 0);
  await expect
    .poll(async () => {
      const cards = (await readKv(page, 'played')) as Array<{ videoId: string; updatedAt: number }>;
      return cards.find((entry) => entry.videoId === MOVIE)?.updatedAt ?? 0;
    })
    .toBeGreaterThan(1000);
  // Stream links can carry debrid keys: none is kept with the card.
  expect(JSON.stringify(await readKv(page, 'played'))).not.toContain('example.com');
  expect(await page.evaluate(() => (window as Window & { rowChanges?: number }).rowChanges)).toBe(
    0,
  );
  expect(errors).toEqual([]);
});

test('a finished episode offers the next one, and OK plays that from the start', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, EPISODE_FINISHED);
  const mock = await mockPlayback(page);
  await page.goto(APP_URL);

  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expectFocusLabel(page, 'Morevna Project, Next: S1:E2');
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"]`)).toContainText(
    'Next: S1:E2',
  );

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect(mock.streams[0]).toBe(`series/${SERIES}:1:2`);
  expect(mock.streams).not.toContain(`series/${SERIES}:1:1`);
  expect((await video(page)).time).toBeLessThan(5);
  await expect(page.locator('section[aria-label="Morevna Project"]:visible')).toBeVisible();
});

test('Back from the player lands on the tile, and Back moves to the row only from elsewhere', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, EPISODE_FINISHED);
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await press(page, 'Enter', 'player-surface');
  // Past the first reading of the clock, so the second episode's place is saved.
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(1);

  await pressBack(page);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  // Brought up to date once Home is on show again: the second episode, from where it stopped.
  await expectFocusLabel(page, 'Morevna Project, S1:E2');
  await page.evaluate(() => {
    const w = window as Window & { exitRequested?: boolean };
    window.addEventListener('bannertv:exit', () => (w.exitRequested = true));
  });

  // From a catalog row, Back returns to Continue watching, the first row now.
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);
  await pressBack(page);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  // On its tile focus has nowhere to go back to, so Back leaves the app.
  await pressBack(page);
  await expect
    .poll(() => page.evaluate(() => (window as Window & { exitRequested?: boolean }).exitRequested))
    .toBe(true);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
});

test('progress saved before cards existed gets its tile once Cinemeta answers', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    // A finished film needs no tile, so no card either.
    progress: [
      {
        metaId: 'tt1727587',
        type: 'movie',
        videoId: 'tt1727587',
        position: 888,
        duration: 888,
        watched: true,
      },
      MOVIE_PART_WAY,
    ],
  });
  await mockPlayback(page);
  // Cinemeta's title answers wait until the test lets them through.
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  const metas: string[] = [];
  await page.route(/^https:\/\/v3-cinemeta\.strem\.io\/meta\//, async (route) => {
    metas.push(new URL(route.request().url()).pathname);
    await answered;
    return route.fallback();
  });
  await page.goto(APP_URL);

  // With nothing to show yet, Home starts on the catalogs.
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => metas).toEqual([`/meta/movie/${MOVIE}.json`]);
  await expect(page.locator(`[data-row-key="${CONTINUE_ROW}"]`)).toHaveCount(0);

  answer();
  const tile = page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"]`);
  await expect(tile).toHaveAttribute('aria-label', 'Big Buck Bunny, 2008');
  await expect(tile.locator('span[style*="width"]')).toHaveAttribute('style', /width: 25%/);
  // The card is kept, so the title is asked for only once.
  await expect
    .poll(() => readKv(page, 'played'))
    .toEqual([expect.objectContaining({ videoId: MOVIE, metaId: MOVIE, name: 'Big Buck Bunny' })]);

  // The row that arrived late is the first row for Back.
  await pressBack(page);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);

  // Next time the card is there from the start, and Cinemeta is not asked again.
  await page.reload();
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expectFocusLabel(page, 'Big Buck Bunny, 2008');
  expect(metas).toEqual([`/meta/movie/${MOVIE}.json`]);
});
