import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { mockPlayback, readKv, type SeedPlayed, type SeedProgress, seedStreamAddon } from './play';
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

test('coming back to Home from another section lands on Continue watching, and Down goes on to the catalogs', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, EPISODE_FINISHED);
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  for (const row of [
    FIRST_ROW,
    SERIES_ROW,
    'home-0-movie-imdbrating',
    'home-0-series-imdbrating',
  ]) {
    await press(page, 'ArrowDown', `${row}-tile-0`);
  }
  await page.keyboard.press('ArrowLeft');
  const focused = page.locator('[data-focused="true"]');
  await expect(focused).toHaveAttribute('data-focus-key', /^rail-/);
  await page.waitForTimeout(150);
  const rail = ['home', 'search', 'discover', 'library', 'addons', 'settings'];
  const at = (await focused.getAttribute('data-focus-key'))!.slice('rail-'.length);
  for (const item of rail.slice(rail.indexOf(at) + 1)) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-stream-choice');

  await pressBack(page);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expect(focused).toBeInViewport({ ratio: 0.9 });
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);
});

test('when the only catalog row comes back empty under focus, focus goes up to the Continue watching tile it came from', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const SINTEL = 'tt1727587';
  await seedStreamAddon(page, {
    progress: [MOVIE_PART_WAY, { ...MOVIE_PART_WAY, metaId: SINTEL, videoId: SINTEL }],
    played: [
      card('movie', MOVIE, 'Big Buck Bunny', { releaseInfo: '2008' }),
      card('movie', SINTEL, 'Sintel', { releaseInfo: '2010' }),
    ],
  });
  await mockPlayback(page);
  // Every catalog comes back empty; the first one only when the test says.
  let release = () => undefined as void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/^https:\/\/v3-cinemeta\.strem\.io\/catalog\//, async (route) => {
    if (/\/catalog\/movie\/top\.json$/.test(route.request().url())) await held;
    await route.fulfill({ json: { metas: [] }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expect(page.locator('[data-row-key]')).toHaveCount(2);
  await press(page, 'ArrowRight', `${CONTINUE_ROW}-tile-1`);
  // Onto the loading row, which then turns out empty.
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);
  release();
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toHaveCount(0);
  await expectFocus(page, `${CONTINUE_ROW}-tile-1`);
  await expect(page.locator('[data-focused="true"]')).toBeInViewport({ ratio: 0.9 });
  await press(page, 'ArrowLeft', `${CONTINUE_ROW}-tile-0`);
  expect(errors).toEqual([]);
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

/**
 * Where the focused tile sits against the window Home's rows slide in (the
 * box around the track of rows): 'inside', or both boxes when it is not.
 */
function focusAgainstRows(page: Page): Promise<string> {
  return page.evaluate(() => {
    const tile = document.querySelector('[data-focused="true"]');
    const rows = tile?.closest('[data-row-key]')?.parentElement?.parentElement;
    if (!tile || !rows) return 'no focused tile in a row';
    const t = tile.getBoundingClientRect();
    const r = rows.getBoundingClientRect();
    if (t.top >= r.top && t.bottom <= r.bottom && t.left >= r.left && t.right <= r.right) {
      return 'inside';
    }
    const box = (b: DOMRect) =>
      `${Math.round(b.left)},${Math.round(b.top)} to ${Math.round(b.right)},${Math.round(b.bottom)}`;
    return `tile at ${box(t)}, rows at ${box(r)}`;
  });
}

/**
 * How soon the rows must have slid to the focused one: a moment, not the
 * next time Home happens to redraw, which a few seconds later puts it right.
 */
const SLID_WITHIN_MS = 1000;

/** Notes the app's exit, which off the TV is an event instead. */
function watchExit(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as Window & { exitRequested?: boolean };
    window.addEventListener('bannertv:exit', () => (w.exitRequested = true));
  });
}

function exitRequested(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => (window as Window & { exitRequested?: boolean }).exitRequested);
}

test('a film played to the end from the only tile leaves focus on Home, where the arrows and Back still work', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  // Saved with a longer running time, so the tile resumes it: 35 s is five
  // seconds from the end of the 40 s test file.
  await seedStreamAddon(page, {
    progress: [{ metaId: MOVIE, type: 'movie', videoId: MOVIE, position: 35, duration: 100 }],
    played: [card('movie', MOVIE, 'Big Buck Bunny', { releaseInfo: '2008' })],
  });
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expectFocusLabel(page, 'Big Buck Bunny, 2008');
  await watchExit(page);

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  // At its end the player goes back by itself, and the finished film leaves the row.
  await expect
    .poll(
      async () => {
        const saved = (await readKv(page, 'progress')) as Array<{
          videoId: string;
          watched: boolean;
        }>;
        return saved.find((entry) => entry.videoId === MOVIE)?.watched;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await expect(page.locator(`[data-row-key="${CONTINUE_ROW}"]`)).toHaveCount(0);

  // Focus is not lost with the tile it was on: it goes to the first row there is now.
  await expect(page.locator('[data-focused="true"]')).toHaveCount(1);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  // Back returns to the first row, as on any visit to Home, and does not leave the app.
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.waitForTimeout(500);
  expect(await exitRequested(page)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Back from the second tile lands on the first, where the title just played now is, and the hero names it', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    // The film is the more recent, so the series is on the second tile.
    progress: [...EPISODE_FINISHED.progress, MOVIE_PART_WAY],
    played: [
      ...EPISODE_FINISHED.played,
      card('movie', MOVIE, 'Big Buck Bunny', { releaseInfo: '2008' }),
    ],
  });
  const mock = await mockPlayback(page);
  // Every title the hero names, from the first frame on.
  await page.addInitScript(() => {
    const w = window as Window & { heroNames?: string[] };
    const names: string[] = (w.heroNames = []);
    new MutationObserver(() => {
      const hero = document
        .querySelector('[data-focus-key="home-hero-details"]')
        ?.closest('section');
      const name = hero?.getAttribute('aria-label');
      if (name && names[names.length - 1] !== name) names.push(name);
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expectFocusLabel(page, 'Big Buck Bunny, 2008');
  // The hero starts on the title focus lands on, never on the first catalog title.
  await expect(page.locator('section[aria-label="Big Buck Bunny"]:visible')).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { heroNames?: string[] }).heroNames),
  ).toEqual(['Big Buck Bunny']);
  await press(page, 'ArrowRight', `${CONTINUE_ROW}-tile-1`);
  await expectFocusLabel(page, 'Morevna Project, Next: S1:E2');

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(1);
  expect(mock.streams[0]).toBe(`series/${SERIES}:1:2`);
  await pressBack(page);

  // The series is the most recent now, so it moved to the first tile, and focus went with it.
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'aria-label',
    /^Morevna Project, /,
  );
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-1"]`)).toHaveAttribute(
    'aria-label',
    'Big Buck Bunny, 2008',
  );
  // The row is back at its start, with the focused tile in view.
  await expect.poll(() => focusAgainstRows(page)).toBe('inside');
  // Past the hero's wait for focus to rest.
  await page.waitForTimeout(500);
  await expect(page.locator('section[aria-label="Morevna Project"]:visible')).toBeVisible();
  await expect(page.locator('section[aria-label="Big Buck Bunny"]')).toHaveCount(0);
});

test('when the row arrives above the focused catalog row, the rows slide to keep the focused tile in view', async ({
  page,
}) => {
  await mockAddons(page);
  // Progress with no card: the tile waits for Cinemeta's answer.
  await seedStreamAddon(page, { progress: [MOVIE_PART_WAY] });
  await mockPlayback(page);
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  await page.route(/^https:\/\/v3-cinemeta\.strem\.io\/meta\//, async (route) => {
    await answered;
    return route.fallback();
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => focusAgainstRows(page)).toBe('inside');
  await expect(page.locator(`[data-row-key="${CONTINUE_ROW}"]`)).toHaveCount(0);

  answer();
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    'Big Buck Bunny, 2008',
  );
  await expect(page.locator('[data-row-key]').first()).toHaveAttribute(
    'data-row-key',
    CONTINUE_ROW,
  );
  // Focus stays where it was, and the rows slide at once to keep its row in view.
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => focusAgainstRows(page), { timeout: SLID_WITHIN_MS }).toBe('inside');
});

/**
 * Notes every key focus lands on from the first frame on, with the page's
 * clock (milliseconds since it started loading) when it did.
 */
async function recordFocus(page: Page): Promise<() => Promise<Array<[string, number]>>> {
  await page.addInitScript(() => {
    const w = window as Window & { focusKeys?: Array<[string, number]> };
    const keys: Array<[string, number]> = (w.focusKeys = []);
    new MutationObserver(() => {
      const key = document.querySelector('[data-focused="true"]')?.getAttribute('data-focus-key');
      if (key && keys[keys.length - 1]?.[0] !== key) keys.push([key, performance.now()]);
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-focused'],
    });
  });
  return () =>
    page.evaluate(
      () => (window as Window & { focusKeys?: Array<[string, number]> }).focusKeys ?? [],
    );
}

/** How long Home waits at most at launch for a title's card (CARD_WAIT_MS is 3 s). */
const WELL_BEFORE_CAP_MS = 2500;

test('progress with no card yet, as after an update: Home waits a moment for it and opens on the row', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const focusKeys = await recordFocus(page);
  await mockAddons(page);
  await seedStreamAddon(page, { progress: [MOVIE_PART_WAY] });
  await mockPlayback(page);
  // Cinemeta takes a moment over the title, as on a TV.
  await page.route(/^https:\/\/v3-cinemeta\.strem\.io\/meta\//, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return route.fallback();
  });
  await page.goto(APP_URL);

  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expectFocusLabel(page, 'Big Buck Bunny, 2008');
  // Focus went nowhere else first.
  expect((await focusKeys()).map(([key]) => key)).toEqual([`${CONTINUE_ROW}-tile-0`]);
  await expect(page.locator('section[aria-label="Big Buck Bunny"]:visible')).toBeVisible();
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);
  expect(errors).toEqual([]);
});

test('a title lookup that fails at launch does not hold Home: it opens on the catalogs at once', async ({
  page,
}) => {
  const focusKeys = await recordFocus(page);
  await mockAddons(page);
  await seedStreamAddon(page, { progress: [MOVIE_PART_WAY] });
  await mockPlayback(page);
  await page.route(/^https:\/\/v3-cinemeta\.strem\.io\/meta\//, (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.goto(APP_URL);

  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const [first] = await focusKeys();
  expect(first?.[0]).toBe(`${FIRST_ROW}-tile-0`);
  expect(first?.[1]).toBeLessThan(WELL_BEFORE_CAP_MS);
  await expect(page.locator(`[data-row-key="${CONTINUE_ROW}"]`)).toHaveCount(0);
});

/** Opens Home with saved progress whose card lookup waits for the returned function. */
async function openWaitingForCard(page: Page): Promise<() => void> {
  await mockAddons(page);
  await seedStreamAddon(page, { progress: [MOVIE_PART_WAY] });
  await mockPlayback(page);
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  await page.route(/^https:\/\/v3-cinemeta\.strem\.io\/meta\//, async (route) => {
    await answered;
    return route.fallback();
  });
  await page.goto(APP_URL);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toBeVisible();
  return answer;
}

test('an arrow pressed while Home waits for a card shows focus where Home opens, and the row then leaves it alone', async ({
  page,
}) => {
  const focusKeys = await recordFocus(page);
  const answer = await openWaitingForCard(page);
  expect(await focusKeys()).toEqual([]);

  // As on any screen with nothing focused, the press shows where focus is.
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const shown = await focusKeys();
  expect(shown.map(([key]) => key)).toEqual([`${FIRST_ROW}-tile-0`]);
  expect(shown[0]![1]).toBeLessThan(WELL_BEFORE_CAP_MS);

  answer();
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    'Big Buck Bunny, 2008',
  );
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
});

test('OK pressed while Home waits for a card opens nothing it did not show focused', async ({
  page,
}) => {
  await openWaitingForCard(page);
  await page.keyboard.press('Enter');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveCount(0);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
});

test('Back pressed while Home waits for a card does not leave the app', async ({ page }) => {
  await openWaitingForCard(page);
  await watchExit(page);
  // A real key press, which the browser hands to each listener in turn (Escape counts as Back).
  await page.keyboard.press('Escape');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.waitForTimeout(500);
  expect(await exitRequested(page)).toBeUndefined();
});

/** Holds the app's read of one stored value until the returned function is called, as on a busy TV. */
async function holdRead(page: Page, key: string): Promise<() => Promise<void>> {
  await page.addInitScript((held) => {
    const w = window as Window & { releaseRead?: () => void };
    const released = new Promise<void>((resolve) => (w.releaseRead = resolve));
    const get = IDBObjectStore.prototype.get;
    const setSuccess = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!.set!;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, query: IDBValidKey) {
      const request = get.call(this, query);
      if (query !== held) return request;
      Object.defineProperty(request, 'onsuccess', {
        set(handler: (this: IDBRequest, event: Event) => void) {
          setSuccess.call(request, (event: Event) => {
            void released.then(() => handler.call(request, event));
          });
        },
      });
      return request;
    };
  }, key);
  return () =>
    page.evaluate(() => (window as Window & { releaseRead?: () => void }).releaseRead?.());
}

test('Back pressed while Home still reads saved progress stays in the app, and focus lands only on Continue watching', async ({
  page,
}) => {
  const focusKeys = await recordFocus(page);
  const releaseProgress = await holdRead(page, 'progress');
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [MOVIE_PART_WAY],
    played: [card('movie', MOVIE, 'Big Buck Bunny', { releaseInfo: '2008' })],
  });
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toBeVisible();
  await watchExit(page);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Nothing is shown focused on a row that Continue Watching is about to come above.
  expect(await focusKeys()).toEqual([]);

  await releaseProgress();
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expectFocusLabel(page, 'Big Buck Bunny, 2008');
  expect((await focusKeys()).map(([key]) => key)).toEqual([`${CONTINUE_ROW}-tile-0`]);
  expect(await exitRequested(page)).toBeUndefined();
});

test('Back pressed while the addon list is still being read stays in the app', async ({ page }) => {
  const focusKeys = await recordFocus(page);
  const releaseAddons = await holdRead(page, 'addons');
  await mockAddons(page);
  await page.goto(APP_URL);
  await expect(page.locator('[data-focus-key="rail-home"]')).toBeVisible();
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toHaveCount(0);
  await watchExit(page);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await exitRequested(page)).toBeUndefined();
  expect(await focusKeys()).toEqual([]);

  await releaseAddons();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  expect((await focusKeys()).map(([key]) => key)).toEqual([`${FIRST_ROW}-tile-0`]);
  expect(await exitRequested(page)).toBeUndefined();
});

test('a tile the pointer moves onto while Home waits for a card keeps focus', async ({ page }) => {
  const focusKeys = await recordFocus(page);
  const answer = await openWaitingForCard(page);
  const tile = page.locator(`[data-focus-key="${SERIES_ROW}-tile-2"]`);
  const box = await tile.boundingBox();
  if (!box) throw new Error('tile 2 of the second row is not drawn');
  await page.mouse.move(10, 10);
  // Straight there, crossing nothing; the second row's top edge shows at the bottom of the screen.
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await expectFocus(page, `${SERIES_ROW}-tile-2`);
  // Home's own first focus does not take it away once the wait is over.
  await page.waitForTimeout(500);
  await expectFocus(page, `${SERIES_ROW}-tile-2`);
  expect((await focusKeys()).map(([key]) => key)).toEqual([`${SERIES_ROW}-tile-2`]);

  answer();
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    'Big Buck Bunny, 2008',
  );
  await expectFocus(page, `${SERIES_ROW}-tile-2`);
});

test('an episode played from a catalog row brings the row in above it, and the focused tile stays in view', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator(`[data-row-key="${CONTINUE_ROW}"]`)).toHaveCount(0);

  // A film played for a few seconds is barely started and stays off the row; an episode joins it.
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(2);
  await pressBack(page);
  await expectFocus(page, 'details-episodes-0');
  await pressBack(page);

  await expectFocus(page, `${SERIES_ROW}-tile-0`);
  await expect(page.locator('[data-row-key]').first()).toHaveAttribute(
    'data-row-key',
    CONTINUE_ROW,
  );
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    /^Morevna Project, /,
  );
  await expect.poll(() => focusAgainstRows(page), { timeout: SLID_WITHIN_MS }).toBe('inside');
});

/** The films the fake Cinemeta knows, oldest first. */
const FILMS = [
  ['tt0807840', 'Elephants Dream', '2006'],
  ['tt1254207', 'Big Buck Bunny', '2008'],
  ['tt1727587', 'Sintel', '2010'],
  ['tt2285752', 'Tears of Steel', '2012'],
  ['tt9000005', 'Caminandes', '2013'],
  ['tt9000006', 'Cosmos Laundromat', '2015'],
] as const;

/** How far the Continue row's tiles have slid. */
function track(page: Page): Promise<string | undefined> {
  return page
    .locator(`[data-row-key="${CONTINUE_ROW}"] div[style*="translateX"]`)
    .evaluate((element: HTMLElement) => element.style.transform);
}

test('Back from a title that never started lands on that title again, and the row stays put after', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [
      // The oldest: saved with no card, so the row fills it in once Cinemeta answers.
      { metaId: SERIES, type: 'series', videoId: `${SERIES}:1:1`, position: 600, duration: 1500 },
      // Every film a quarter through, Elephants Dream the most recent.
      ...[...FILMS].reverse().map(([id]) => ({ ...MOVIE_PART_WAY, metaId: id, videoId: id })),
    ],
    played: FILMS.map(([id, name, year]) => card('movie', id, name, { releaseInfo: year })),
  });
  // The media never answers while the test runs: nothing plays, so nothing is saved.
  await mockPlayback(page, { mediaDelayMs: 120_000 });
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  await page.route(new RegExp(`/meta/series/${SERIES}\\.json`), async (route) => {
    await answered;
    return route.fallback();
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${CONTINUE_ROW}-tile-0`);
  await expectFocusLabel(page, 'Elephants Dream, 2006');

  // Tile 1, where the first tile is drawn beside it.
  await press(page, 'ArrowRight', `${CONTINUE_ROW}-tile-1`);
  await press(page, 'Enter', 'player-surface');
  await page.waitForTimeout(1000);
  await pressBack(page);
  await expectFocus(page, `${CONTINUE_ROW}-tile-1`);
  await expectFocusLabel(page, 'Big Buck Bunny, 2008');

  // Tile 4, where it is not.
  for (const tile of [2, 3, 4]) await press(page, 'ArrowRight', `${CONTINUE_ROW}-tile-${tile}`);
  const slid = await track(page);
  await press(page, 'Enter', 'player-surface');
  await page.waitForTimeout(1000);
  await pressBack(page);
  await expectFocus(page, `${CONTINUE_ROW}-tile-4`);
  await expectFocusLabel(page, 'Caminandes, 2013');
  expect(await track(page)).toBe(slid);

  // A card filled in now adds a tile at the end; the row does not jump away from focus.
  answer();
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-6"]`)).toHaveAttribute(
    'aria-label',
    /^Morevna Project, /,
  );
  await page.waitForTimeout(300);
  expect(await track(page)).toBe(slid);
  await expectFocus(page, `${CONTINUE_ROW}-tile-4`);
  await expect.poll(() => focusAgainstRows(page)).toBe('inside');
  expect(errors).toEqual([]);
});

test('a next episode that airs while Home sits untouched joins the row on the hour', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  // Ten past an hour, with the next episode out twenty minutes later.
  const start = Math.floor(Date.now() / hour) * hour + 10 * minute;
  await page.clock.install({ time: start });
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: EPISODE_FINISHED.progress,
    played: [
      {
        ...EPISODE_FINISHED.played[0]!,
        next: { videoId: `${SERIES}:1:2`, season: 1, episode: 2, released: start + 20 * minute },
      },
    ],
  });
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator(`[data-row-key="${CONTINUE_ROW}"]`)).toHaveCount(0);
  // Past the addons' refresh a few seconds in, which redraws Home once anyway.
  await page.clock.fastForward(30 * 1000);
  await page.waitForTimeout(500);
  await expect(page.locator(`[data-row-key="${CONTINUE_ROW}"]`)).toHaveCount(0);

  // Past the release and the next hour, with no key pressed.
  await page.clock.fastForward(50 * minute);
  await expect(page.locator(`[data-focus-key="${CONTINUE_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    'Morevna Project, Next: S1:E2',
  );
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => focusAgainstRows(page), { timeout: SLID_WITHIN_MS }).toBe('inside');
  expect(errors).toEqual([]);
});
