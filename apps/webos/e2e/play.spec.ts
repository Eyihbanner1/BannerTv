import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import {
  DEFAULT_STREAMS,
  HLS_PATH,
  LIVE_HLS_PATH,
  mockPlayback,
  readKv,
  seedStreamAddon,
} from './play';
import { APP_URL, expectFocus, press, pressBack } from './tv';

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

/** Tells the page it was hidden or shown, as webOS does when another app comes to the front. */
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function openMovie(page: Page) {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('section[aria-label="Elephants Dream"]:visible')).toBeVisible();
}

/** The same with the film left part way: Home opens on Continue watching, above the catalogs. */
async function openResumableMovie(page: Page) {
  await page.goto(APP_URL);
  await expectFocus(page, 'home-continue-tile-0');
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('section[aria-label="Elephants Dream"]:visible')).toBeVisible();
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

test('Watch passes over a disc remux too big for the connection', async ({ page }) => {
  await mockAddons(page);
  // The open movies run 15 min; this one runs as long as a feature film.
  await page.route(`https://v3-cinemeta.strem.io/meta/movie/${MOVIE}.json`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        meta: {
          id: MOVIE,
          imdb_id: MOVIE,
          type: 'movie',
          name: 'Elephants Dream',
          releaseInfo: '2006',
          runtime: '2h 1min',
          poster: `https://images.metahub.space/poster/small/${MOVIE}/img`,
          background: `https://images.metahub.space/background/medium/${MOVIE}/img`,
        },
      }),
    }),
  );
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      // The addon lists the remux first, and it would rank first on picture alone.
      [MOVIE]: [
        {
          name: 'Test Streams\n4K',
          description: 'Open Movie 2160p REMUX\n💾 80 GB ⚡ Cached',
          path: '/movie-2160p-remux.webm',
        },
        {
          name: 'Test Streams\n4K',
          description: 'Open Movie 2160p WEB-DL\n💾 15 GB ⚡ Cached',
          path: '/movie-2160p-web.webm',
        },
      ],
    },
  });
  await openMovie(page);

  // Over 2 h the remux needs about 95 Mbit/s and the WEB-DL about 18.
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).src).toBe('/movie-2160p-web.webm');
  await press(page, 'Enter', 'player-play');
  await expect(page.getByText('15 GB', { exact: true })).toBeVisible();
});

test('OK while a stream starts pauses it with Play ready, as does coming back from another app', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  // Media answers late, so the stream is still starting when OK is pressed.
  await mockPlayback(page, { mediaDelayMs: 3000 });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  // The TV's player was told to play, and nothing has shown yet.
  await expect
    .poll(() =>
      page
        .locator('video:not([aria-hidden])')
        .evaluate((element: HTMLVideoElement) => !element.paused),
    )
    .toBe(true);
  await expect(page.getByRole('status', { name: 'Starting' })).toBeVisible();

  await press(page, 'Enter', 'player-play');
  await expect(page.getByRole('status', { name: 'Starting' })).toHaveCount(0);
  await expect(page.locator('[data-focus-key="player-play"]')).toHaveText('Play');
  await press(page, 'Enter', 'player-play');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  // Hidden, the stream pauses; shown again, Play is ready even with the controls hidden before.
  await pressBack(page);
  await expectFocus(page, 'player-surface');
  await setHidden(page, true);
  await setHidden(page, false);
  await expectFocus(page, 'player-play');
  await expect(page.locator('[data-focus-key="player-play"]')).toHaveText('Play');
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
  // Not on arrival: only once focus has rested.
  expect(mock.streams).toEqual([]);
  expect(mock.media).toEqual([]);
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
  // Page errors only: the dead links log console errors of their own.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, { broken: ['/movie-1080p.webm', '/movie-720p.webm'] });
  await openMovie(page);

  await press(page, 'Enter', 'player-surface');
  await expect(page.getByText("This stream won't play")).toBeVisible();
  // A link that answers 404 is the link's fault, not a format the TV lacks.
  await expect(page.getByText('Its source may be busy or offline.')).toBeVisible();
  // The torrent cannot play on a TV, so there is nothing left to try.
  await expect(page.locator('[data-focus-key="player-problem-another"]')).toHaveCount(0);
  await expectFocus(page, 'player-problem-streams');
  await press(page, 'Enter', 'streams-item-0');
  expect(errors).toEqual([]);
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
    // Saved with a longer running time than the 40 s test file, so 35 s is not its closing minute.
    progress: [{ metaId: MOVIE, type: 'movie', videoId: MOVIE, position: 35, duration: 120 }],
  });
  await mockPlayback(page);
  await openResumableMovie(page);
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveText('Resume from 0:35');
  await expect(page.locator('[data-focus-key="details-restart"]')).toHaveText('Start over');

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).time).toBeGreaterThanOrEqual(35);
});

test('a title with no stream left to try keeps its resume point through All streams', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [{ metaId: MOVIE, type: 'movie', videoId: MOVIE, position: 35, duration: 120 }],
  });
  await mockPlayback(page);
  // Both links are down at first, so Watch is left with nothing it has not seen fail.
  let down = true;
  await page.route(/^https:\/\/media\.example\.com\/movie-(1080|720)p\.webm$/, (route) =>
    down ? route.fulfill({ status: 404, body: '' }) : route.fallback(),
  );
  await openResumableMovie(page);
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveText('Resume from 0:35');
  await press(page, 'Enter', 'player-problem-streams');
  await pressBack(page);
  await expectFocus(page, 'details-watch');

  down = false;
  await press(page, 'Enter', 'player-problem-streams');
  await press(page, 'Enter', 'streams-item-0');
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

  // The 720p release, picked by hand: auto-play chooses 1080p.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'Enter', 'streams-item-0');
  await press(page, 'ArrowDown', 'streams-item-1');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');

  // In the last 30 seconds (10 s into the 40 s file) the card takes focus.
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    'player-upnext-play',
    { timeout: 15000 },
  );
  await expect(page.getByText('Up next')).toBeVisible();

  // Pause closes it, and focus goes to the controls Pause brought up.
  await page.keyboard.press('Pause');
  await expect(page.getByText('Up next')).toHaveCount(0);
  await expectFocus(page, 'player-play');

  // Playing again brings it back, and the controls do not hide and take focus from it.
  await press(page, 'Enter', 'player-upnext-play');
  await page.waitForTimeout(6000);
  await expectFocus(page, 'player-upnext-play');

  await press(page, 'Enter', 'player-surface');
  await expect.poll(() => mock.streams).toContain('series/tt8000001:1:2');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  // Only the release's bingeGroup leads here: auto-play would pick 1080p again.
  expect((await video(page)).src).toBe('/movie-720p.webm');
  await expect(page.locator('section[aria-label="Morevna Project"]:visible')).toBeVisible();

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

test("in the language last chosen, the stream's own subtitles come before an addon's file", async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' } });
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [{ name: 'Test Streams\nHLS', description: 'Open Movie HLS', path: HLS_PATH }],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  // OpenSubtitles answered long before hls.js listed the stream's English track.
  await expect(page.getByText('Hello from the stream')).toBeVisible();
  await expect(page.getByText('Hello from the test subtitles')).toHaveCount(0);
});

test("the stream's own subtitles take over from a file picked while the TV's player had the stream", async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' } });
  await mockPlayback(page, {
    subtitles: false,
    // The player's look at the playlist and the TV's own player both get 503, so the TV's
    // player has the stream first and hls.js takes it over before the first picture.
    refused: { [HLS_PATH]: ['fetch', 'media'] },
    streams: {
      [MOVIE]: [
        {
          name: 'Test Streams\nHLS',
          description: 'Open Movie HLS',
          path: HLS_PATH,
          subtitles: [{ id: '1', path: '/en1.srt', lang: 'eng' }],
        },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).src).toMatch(/^blob:/);
  await expect(page.getByText('Hello from the stream')).toBeVisible();
  await expect(page.getByText('Hello from the test subtitles')).toHaveCount(0);
});

test('a subtitle file that fails gives way to one in its language from an addon that answers later', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' } });
  // OpenSubtitles answers only once the failure has shown, however long the picture takes.
  let answer!: () => void;
  const subtitlesGate = new Promise<void>((resolve) => (answer = resolve));
  await mockPlayback(page, {
    subtitlesGate,
    streams: {
      [MOVIE]: [
        { ...DEFAULT_STREAMS[0]!, subtitles: [{ id: '1', path: '/missing.srt', lang: 'eng' }] },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expect(page.getByText("Those subtitles couldn't be loaded.")).toBeVisible();
  answer();
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Those subtitles couldn't be loaded.")).toHaveCount(0);
});

test('Quality leaves the resolution playing alone, and another starts without its subtitles', async ({
  page,
}) => {
  await mockAddons(page);
  // The slow addon answers after the player has started, so the list is rebuilt under it,
  // with its own 1080p ranked above the one playing.
  await seedStreamAddon(page, { slowAddon: true, preferences: { subtitleLanguage: 'eng' } });
  const mock = await mockPlayback(page, {
    subtitles: false,
    streams: {
      // Both streams name their own subtitles "1".
      [MOVIE]: [
        { ...DEFAULT_STREAMS[0]!, subtitles: [{ id: '1', path: '/en1.srt', lang: 'eng' }] },
        { ...DEFAULT_STREAMS[1]!, subtitles: [{ id: '1', path: '/missing.srt', lang: 'eng' }] },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await expect.poll(() => mock.slowAnswers).toBe(1);
  await page.evaluate(() => {
    const element = document.querySelector('video:not([aria-hidden])')!;
    element.addEventListener('emptied', () => element.setAttribute('data-reloaded', 'true'));
  });

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  // The resolution already playing: nothing reloads, though another 1080p now ranks first.
  await press(page, 'Enter', 'player-quality-0');
  await expect(page.locator('[data-focused="true"]')).toHaveText('1080p');
  await press(page, 'Enter', 'player-quality-button');
  await page.waitForTimeout(500);
  await expect(page.locator('video[data-reloaded]')).toHaveCount(0);
  expect((await video(page)).src).toBe('/movie-1080p.webm');

  await press(page, 'Enter', 'player-quality-0');
  await press(page, 'ArrowDown', 'player-quality-1');
  await press(page, 'Enter', 'player-quality-button');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  // The 720p stream's own file is missing; the 1080p stream's lines must not stand in for it.
  await expect(page.getByText("Those subtitles couldn't be loaded.")).toBeVisible();
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(1);
  await expect(page.getByText('Hello from the test subtitles')).toHaveCount(0);
});

test('a live broadcast plays with no end shown, and saves nothing to resume or continue', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [
        { name: 'Test Streams\nLive', description: 'Open Movie live', path: LIVE_HLS_PATH },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).src).toMatch(/^blob:/);

  // The controls give no length to a broadcast.
  await press(page, 'ArrowUp', 'player-play');
  await expect(page.locator('[data-focus-key="player-seek"] > span').last()).toHaveText('');

  // Hidden, shown and left: each would save the position of a film.
  await setHidden(page, true);
  await setHidden(page, false);
  await pressBack(page);
  await pressBack(page);
  await expectFocus(page, 'details-watch');
  const saved = ((await readKv(page, 'progress')) ?? []) as Array<{ videoId: string }>;
  expect(saved.map((entry) => entry.videoId)).not.toContain(MOVIE);
  const cards = ((await readKv(page, 'played')) ?? []) as Array<{ videoId: string }>;
  expect(cards.map((card) => card.videoId)).not.toContain(MOVIE);
  expect(errors).toEqual([]);
});

test('a broadcast an older build saved to resume opens at the live edge, and offers Resume no more', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [{ metaId: MOVIE, type: 'movie', videoId: MOVIE, position: 35, duration: 120 }],
  });
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [
        { name: 'Test Streams\nLive', description: 'Open Movie live', path: LIVE_HLS_PATH },
      ],
    },
  });
  await openResumableMovie(page);
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveText('Resume from 0:35');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  // A broadcast has no start to go back to.
  await press(page, 'ArrowUp', 'player-play');
  await expect(page.locator('[data-focus-key="player-restart"]')).toHaveCount(0);
  await pressBack(page);
  await pressBack(page);
  await expectFocus(page, 'details-watch');
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveText('Watch');
  const saved = ((await readKv(page, 'progress')) ?? []) as Array<{ videoId: string }>;
  expect(saved.map((entry) => entry.videoId)).not.toContain(MOVIE);
});
