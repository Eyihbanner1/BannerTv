import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { HLS_PATH, mockPlayback, seedStreamAddon } from './play';
import { APP_URL, expectFocus, press, pressBack, watchErrors } from './tv';

/** Elephants Dream, the first title on Home. */
const MOVIE = 'tt0807840';

/** What the player's video element is doing. */
function video(page: Page) {
  // Not the link test's hidden player, which stays in the page.
  return page.locator('video:not([aria-hidden])').evaluate((element: HTMLVideoElement) => ({
    src: element.currentSrc.replace(/^https:\/\/media\.example\.com/, ''),
    playing: !element.paused && element.currentTime > 0,
    time: element.currentTime,
  }));
}

async function openMovie(page: Page) {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('section[aria-label="Elephants Dream"]')).toBeVisible();
}

test('Watch plays the best stream at once, with no list to choose from', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockAddons(page);
  await seedStreamAddon(page);
  const mock = await mockPlayback(page);
  await openMovie(page);

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).src).toBe('/movie-1080p.webm');
  expect(mock.streams).toContain(`movie/${MOVIE}`);
  await expect(page.getByRole('status', { name: 'Starting' })).toHaveCount(0);

  // The LG store's rule: the picture at 0,0, full size, with no transform on it or above it.
  const layout = await page.evaluate(() => {
    const element = document.querySelector('video:not([aria-hidden])')!;
    const box = element.getBoundingClientRect();
    let transformed = false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (getComputedStyle(node).transform !== 'none') transformed = true;
    }
    // Painted over the page's background, under the controls.
    const stack = document.elementsFromPoint(960, 540);
    const shown =
      stack.indexOf(element) !== -1 && stack.indexOf(element) < stack.indexOf(document.body);
    return { box: [box.x, box.y, box.width, box.height], transformed, shown };
  });
  expect(layout).toEqual({ box: [0, 0, 1920, 1080], transformed: false, shown: true });

  // OK pauses and brings up the controls, with what is playing.
  await press(page, 'Enter', 'player-play');
  await expect(page.locator('[data-focus-key="player-play"]')).toHaveText('Play');
  await expect(page.getByText('1080p', { exact: true })).toBeVisible();
  await press(page, 'Enter', 'player-play');
  await expect(page.locator('[data-focus-key="player-play"]')).toHaveText('Pause');

  // Back hides the controls, then leaves the player for the title.
  await pressBack(page);
  await expectFocus(page, 'player-surface');
  await pressBack(page);
  await expectFocus(page, 'details-watch');
  expect(errors).toEqual([]);
});

test('a title asks for its streams and tests the best one only once focus rests there', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  const mock = await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  // Home never asks: browsing stays quick.
  await page.waitForTimeout(2000);
  expect(mock.streams).toEqual([]);
  expect(mock.media).toEqual([]);

  await press(page, 'Enter', 'details-watch');
  await expect.poll(() => mock.streams).toEqual([`movie/${MOVIE}`]);
  // The link test opens the best stream on a hidden player, ahead of Watch.
  await expect.poll(() => mock.media).toContain('/movie-1080p.webm');

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  // The answers were kept, so the player did not ask again.
  expect(mock.streams).toEqual([`movie/${MOVIE}`]);
});

test('a stream that will not open is swapped for the next best', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  const mock = await mockPlayback(page, { broken: ['/movie-1080p.webm'] });
  await openMovie(page);

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect(mock.media).toContain('/movie-1080p.webm');
});

test('when nothing plays, the player says why and offers the list', async ({ page }) => {
  watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, { broken: ['/movie-1080p.webm', '/movie-720p.webm'] });
  await openMovie(page);

  await press(page, 'Enter', 'player-surface');
  await expect(page.getByText("This stream won't play")).toBeVisible();
  // The torrent cannot play on a TV, so there is nothing left to try.
  await expect(page.locator('[data-focus-key="player-problem-another"]')).toHaveCount(0);
  await expectFocus(page, 'player-problem-streams');
  await press(page, 'Enter', 'streams-item-0');
});

test('All streams lists every stream, says which cannot play, and plays the one picked', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await openMovie(page);

  await press(page, 'ArrowRight', 'details-streams');
  await press(page, 'Enter', 'streams-item-0');
  const rows = page.locator('[data-focus-key^="streams-item-"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Open Movie 1080p WEB-DL x264');
  await expect(rows.nth(0)).toContainText('Cached');
  await expect(rows.nth(2)).toContainText('2160p');
  await expect(rows.nth(2)).toContainText(/torrent/i);

  await press(page, 'ArrowDown', 'streams-item-1');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  // The list made way for the player, so Back goes to the title.
  await pressBack(page);
  await expectFocus(page, 'details-streams');
});

test('a title left part way through resumes from where it stopped', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [{ metaId: MOVIE, type: 'movie', videoId: MOVIE, position: 35, duration: 0 }],
  });
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveText('Resume from 0:35');
  await expect(page.locator('[data-focus-key="details-restart"]')).toHaveText('Start over');

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).time).toBeGreaterThanOrEqual(35);
});

test('subtitles come from the subtitles addon, and pressing a language again moves to its next version', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  const mock = await mockPlayback(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  // The subtitles addon was asked with the stream's file name, to match the release.
  await expect.poll(() => mock.subtitles.join()).toContain('filename=movie-1080p.webm');

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-tracks-button');
  await press(page, 'Enter', 'player-tracks-off');
  await press(page, 'ArrowDown', 'player-tracks-lang-en');
  await expect(page.locator('[data-focus-key="player-tracks-lang-en"]')).toContainText(
    '2 versions',
  );
  await press(page, 'Enter', 'player-tracks-lang-en');
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await expect(page.locator('[data-focus-key="player-tracks-lang-en"]')).toContainText(
    'version 1 of 2',
  );

  await press(page, 'Enter', 'player-tracks-lang-en');
  await expect(page.getByText('The second English file')).toBeVisible();
  await expect(page.getByText('Hello from the test subtitles')).toHaveCount(0);

  await pressBack(page);
  await expectFocus(page, 'player-tracks-button');
  // The language is remembered: the next video starts with it.
  const saved = await page.evaluate(() => localStorage.getItem('bannertv.preferences'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ subtitleLanguage: 'eng' });
});

test('near the end of an episode, Up Next plays the next one from the same release', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  const mock = await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  // Skip ahead to the last 30 seconds.
  await press(page, 'ArrowRight', 'player-seek');
  await press(page, 'ArrowRight', 'player-seek');
  await expectFocus(page, 'player-upnext-play');
  await expect(page.getByText('Up next')).toBeVisible();

  await press(page, 'Enter', 'player-surface');
  await expect.poll(() => mock.streams).toContain('series/tt8000001:1:2');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).src).toBe('/movie-1080p.webm');
  await expect(page.locator('section[aria-label="Morevna Project"]')).toBeVisible();

  // Back leaves the second episode for the series.
  await pressBack(page);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^details-/,
  );
});

test('HLS with audio and subtitle choices plays through hls.js, and both show in the panel', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [{ name: 'Test Streams\nHLS', description: 'Open Movie HLS', path: HLS_PATH }],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  // hls.js came from its own script, and plays through Media Source Extensions.
  expect(await page.evaluate(() => typeof (window as { Hls?: unknown }).Hls)).toBe('function');
  expect((await video(page)).src).toMatch(/^blob:/);

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-tracks-button');
  await press(page, 'Enter', 'player-tracks-off');
  await expect(page.locator('[data-focus-key="player-tracks-audio-eng|English"]')).toBeVisible();
  await press(page, 'ArrowDown', 'player-tracks-track-eng|English');
  await expect(page.locator('[data-focus-key="player-tracks-track-eng|English"]')).toContainText(
    'in the stream',
  );
  await press(page, 'Enter', 'player-tracks-track-eng|English');
  await expect(page.getByText('Hello from the stream')).toBeVisible();

  // French audio, remembered for the next stream.
  await press(page, 'ArrowUp', 'player-tracks-off');
  await press(page, 'ArrowUp', 'player-tracks-audio-fre|French');
  await press(page, 'Enter', 'player-tracks-audio-fre|French');
  await expect
    .poll(async () =>
      JSON.parse((await page.evaluate(() => localStorage.getItem('bannertv.preferences'))) ?? '{}'),
    )
    .toMatchObject({ audioLanguage: 'fre' });
});
