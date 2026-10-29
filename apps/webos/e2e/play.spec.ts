import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { DEMO_ROW, FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import {
  DEFAULT_STREAMS,
  HLS_PATH,
  LIVE_HLS_PATH,
  MEDIA_HOST,
  mockPlayback,
  readKv,
  seedStreamAddon,
} from './play';
import { APP_URL, expectFocus, focusedKey, press, pressBack } from './tv';

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

/**
 * BannerTV Demo's films are the journeys' small HLS stream, and its subtitle
 * check tracks one line each.
 */
async function routeDemoFilms(page: Page) {
  const types: Record<string, string> = {
    m3u8: 'application/vnd.apple.mpegurl',
    mp4: 'video/mp4',
    m4s: 'video/mp4',
    vtt: 'text/vtt',
  };
  await page.route(/^https:\/\/demo\.bannertv\.workers\.dev\/media\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': '*' };
    const check = /\/subs\/(eng|kor)\.vtt$/.exec(path);
    if (check) {
      const language = check[1] === 'eng' ? 'English' : 'Korean';
      return route.fulfill({
        contentType: 'text/vtt',
        headers,
        body: `WEBVTT\n\n00:00.000 --> 01:00.000\nSubtitle check in ${language}\n`,
      });
    }
    const file = path.replace(/^.*\//, '');
    if (!/^[\w-]+\.(m3u8|mp4|m4s|vtt)$/.test(file)) return route.fulfill({ status: 404 });
    return route.fulfill({
      contentType: types[file.replace(/^.*\./, '')],
      headers,
      body: readFileSync(resolve(import.meta.dirname, 'fixtures/hls', file)),
    });
  });
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

test('OK while a stream starts lets it start and then shows the controls, and coming back from another app has Play ready', async ({
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

  // Nothing to pause yet: the stream goes on starting, and nothing hidden takes the remote.
  await press(page, 'Enter', 'player-surface');
  for (const key of ['ArrowRight', 'ArrowUp', 'ArrowDown'])
    await press(page, key, 'player-surface');
  await expect(page.getByRole('status', { name: 'Starting' })).toBeVisible();
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expectFocus(page, 'player-play');
  await expect(page.locator('[data-focus-key="player-play"]')).toHaveText('Pause');

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
  // A stray click beside the box neither leaves nor brings the controls up behind it.
  await page.mouse.move(80, 80);
  await page.mouse.click(60, 60);
  await page.waitForTimeout(300);
  await expect(page.getByText("This stream won't play")).toBeVisible();
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
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

  // The 720p stream answers late, so the note shows while it opens.
  await page.route(`${MEDIA_HOST}/movie-720p.webm`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
  });
  await press(page, 'Enter', 'player-quality-0');
  await press(page, 'ArrowDown', 'player-quality-1');
  // The controls give way while the other stream opens, and stay away once it plays.
  await press(page, 'Enter', 'player-surface');
  await expect(page.getByText('Switching to 720p…')).toBeVisible();
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await page.waitForTimeout(500);
  await expectControlsHidden(page);
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

test('BannerTV Demo’s subtitle checks wait to be picked, and leave the language other titles start with', async ({
  page,
}) => {
  await mockAddons(page, { firstRun: true });
  await mockPlayback(page);
  await routeDemoFilms(page);
  // This viewer reads English subtitles.
  await page.addInitScript(() =>
    localStorage.setItem('bannertv.preferences', JSON.stringify({ subtitleLanguage: 'eng' })),
  );
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  await press(page, 'Enter', `${DEMO_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await page.waitForTimeout(1500);
  await expect(page.getByText(/^Subtitle check/)).toHaveCount(0);
  await expect(page.getByText('Hello from the stream')).toHaveCount(0);

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-tracks-button');
  await press(page, 'Enter', 'player-tracks-off');
  const focused = page.locator('[data-focused="true"]');
  // Down past the stream's own tracks to the Korean check.
  for (let step = 0; step < 8; step++) {
    if ((await focused.getAttribute('data-focus-key')) === 'player-tracks-lang-ko') break;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
  }
  await expectFocus(page, 'player-tracks-lang-ko');
  await expect(focused).toContainText('BannerTV Demo');
  await press(page, 'Enter', 'player-tracks-lang-ko');
  await expect(page.getByText('Subtitle check in Korean')).toBeVisible();

  await pressBack(page);
  await expectFocus(page, 'player-tracks-button');
  const saved = await page.evaluate(() => localStorage.getItem('bannertv.preferences'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ subtitleLanguage: 'eng' });
});

/** A remote key a desktop keyboard cannot type, such as Fast forward (417) or Blue (406). */
async function pressCode(page: Page, keyCode: number, repeat = false) {
  await page.evaluate(
    ({ code, held }) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, repeat: held });
      Object.defineProperty(event, 'keyCode', { get: () => code });
      Object.defineProperty(event, 'which', { get: () => code });
      (document.activeElement ?? document.body).dispatchEvent(event);
    },
    { code: keyCode, held: repeat },
  );
  await page.waitForTimeout(120);
}

/**
 * The controls are hidden right now. Checked once: a retry could outlast the
 * 5 s they take to hide by themselves if they had wrongly shown.
 */
async function expectControlsHidden(page: Page) {
  expect(await focusedKey(page)).toBe('player-surface');
  expect(await page.locator('[data-focus-key="player-play"]').isVisible()).toBe(false);
}

const FAST_FORWARD = 417;
const REWIND = 412;
const BLUE = 406;

/** Counts the player's seeks from now on. */
async function countSeeks(page: Page): Promise<() => Promise<number>> {
  await page.locator('video:not([aria-hidden])').evaluate((element: HTMLVideoElement) => {
    element.dataset.seeks = '0';
    element.addEventListener('seeking', () => {
      element.dataset.seeks = String(Number(element.dataset.seeks) + 1);
    });
  });
  return () =>
    page
      .locator('video:not([aria-hidden])')
      .evaluate((element: HTMLVideoElement) => Number(element.dataset.seeks));
}

async function playMovie(page: Page) {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
}

test('every way of skipping adds 10 s a press and lands once, with a note while the controls stay hidden', async ({
  page,
}) => {
  await playMovie(page);
  const seeks = await countSeeks(page);
  const play = page.locator('[data-focus-key="player-play"]');
  const from = (await video(page)).time;

  // Two quick presses: one jump of 20 s, a moment after the last, and the picture stays clear.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('+20 s', { exact: true })).toBeVisible();
  await expect(page.getByText(/^0:[23]\d of 0:40$/)).toBeVisible();
  await expectFocus(page, 'player-surface');
  await expect(play).toBeHidden();
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(from + 18);
  expect(await seeks()).toBe(1);

  // Rewind takes the same 10 s.
  const before = (await video(page)).time;
  await pressCode(page, REWIND);
  await expect(page.getByText('−10 s', { exact: true })).toBeVisible();
  await expect.poll(seeks).toBe(2);
  expect((await video(page)).time).toBeLessThan(before - 8);

  // So does a notch of the wheel.
  const wheeled = (await video(page)).time;
  await page.mouse.wheel(0, 100);
  await expect(page.getByText('+10 s', { exact: true })).toBeVisible();
  await expect.poll(seeks).toBe(3);
  expect((await video(page)).time).toBeGreaterThan(wheeled + 8);
  await expectFocus(page, 'player-surface');

  // OK lands a skip there and then, well before it would land by itself, and leaves the film playing.
  await pressCode(page, FAST_FORWARD);
  await page.keyboard.press('Enter');
  await expect.poll(seeks, { timeout: 400 }).toBe(4);
  await page.waitForTimeout(1000);
  expect(await seeks()).toBe(4);
  expect((await video(page)).playing).toBe(true);
  await expectControlsHidden(page);
});

test('Start over is always there, and offers for a moment to go back to where the film was', async ({
  page,
}) => {
  await playMovie(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(15);

  await press(page, 'ArrowUp', 'player-play');
  const restart = page.locator('[data-focus-key="player-restart"]');
  await expect(restart).toHaveText('Start over');
  for (const key of [
    'player-tracks-button',
    'player-quality-button',
    'player-streams-button',
    'player-restart',
  ]) {
    await press(page, 'ArrowRight', key);
  }
  // A skip still to land gives way to Start over.
  await pressCode(page, FAST_FORWARD);
  await press(page, 'Enter', 'player-restart');
  await expect.poll(async () => (await video(page)).time).toBeLessThan(5);
  await expect(restart).toHaveText(/^Back to 0:[12]\d$/);
  await page.waitForTimeout(1000);
  expect((await video(page)).time).toBeLessThan(5);

  await press(page, 'Enter', 'player-restart');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(15);
  await expect(restart).toHaveText('Start over');
  expect((await video(page)).playing).toBe(true);
});

test('Blue opens and closes audio and subtitles, which stay open while the film plays on, and Back from Style goes back to them', async ({
  page,
}) => {
  await playMovie(page);
  const focused = page.locator('[data-focused="true"]');
  const panel = page.getByRole('dialog', { name: 'Audio and subtitles' });

  // From anywhere, with the controls hidden. Held down, it does not close again.
  await pressCode(page, BLUE);
  await pressCode(page, BLUE, true);
  await expect(panel).toBeVisible();
  await expect(focused).toHaveAttribute('data-focus-key', /^player-tracks-/);
  await pressCode(page, BLUE);
  await expect(panel).toHaveCount(0);
  await expectFocus(page, 'player-surface');

  // Opened from the controls, the panel outlasts their 5 s, a skip included.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-tracks-button');
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await pressCode(page, FAST_FORWARD);
  await expect(page.getByText('+10 s', { exact: true })).toBeVisible();
  await page.waitForTimeout(5500);
  await expect(panel).toBeVisible();
  await expect(focused).toHaveAttribute('data-focus-key', /^player-tracks-/);

  // Down to Style, in and back out, one level at a time.
  for (let step = 0; step < 8; step++) {
    if ((await focused.getAttribute('data-focus-key')) === 'player-tracks-style') break;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
  }
  await expectFocus(page, 'player-tracks-style');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Subtitle style' })).toBeVisible();
  await pressBack(page);
  await expect(panel).toBeVisible();
  await expectFocus(page, 'player-tracks-style');
  await pressBack(page);
  await expect(panel).toHaveCount(0);
  await expectFocus(page, 'player-tracks-button');
});

test('Back just after the controls fade by themselves asks again before leaving', async ({
  page,
}) => {
  await playMovie(page);
  const faded = () =>
    expect(page.locator('[data-focused="true"]')).toHaveAttribute(
      'data-focus-key',
      'player-surface',
      { timeout: 8000 },
    );

  // Brought back and hidden by hand since, the controls had their Back: the next one leaves.
  await press(page, 'ArrowUp', 'player-play');
  await faded();
  await press(page, 'ArrowUp', 'player-play');
  await pressBack(page);
  await expectFocus(page, 'player-surface');
  await pressBack(page);
  await expectFocus(page, 'details-watch');

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await press(page, 'ArrowUp', 'player-play');
  await faded();
  await pressBack(page);
  await expect(page.getByText('Press Back again to leave.')).toBeVisible();
  await expectFocus(page, 'player-surface');
  await pressBack(page);
  await expectFocus(page, 'details-watch');
});

test('Quality on a paused film opens the other stream paused, with Play ready', async ({
  page,
}) => {
  await playMovie(page);
  const play = page.locator('[data-focus-key="player-play"]');
  await press(page, 'Enter', 'player-play');
  await expect(play).toHaveText('Play');

  await press(page, 'ArrowRight', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'Enter', 'player-quality-0');
  await press(page, 'ArrowDown', 'player-quality-1');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  await expectFocus(page, 'player-play');
  await expect(play).toHaveText('Play');
  await page.waitForTimeout(1000);
  expect(
    await page
      .locator('video:not([aria-hidden])')
      .evaluate((element: HTMLVideoElement) => element.paused),
  ).toBe(true);

  await press(page, 'Enter', 'player-play');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expect(play).toHaveText('Pause');
});

test('the pointer brings the controls up, shows the time over the bar, and a click goes there', async ({
  page,
}) => {
  await playMovie(page);
  const play = page.locator('[data-focus-key="player-play"]');
  await page.mouse.move(900, 500);
  await page.mouse.move(960, 540, { steps: 3 });
  await expect(play).toBeVisible();

  const bar = page.locator('[data-focus-key="player-seek"] > div');
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await expectFocus(page, 'player-seek');
  await expect(bar.getByText('0:20', { exact: true })).toBeVisible();

  // The Magic Remote's OK there comes as a key press and a click: it jumps, and the film plays on.
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 3 });
  await page.keyboard.press('Enter');
  await page.mouse.click(box.x + box.width / 4, box.y + box.height / 2);
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(9);
  expect((await video(page)).time).toBeLessThan(14);
  expect((await video(page)).playing).toBe(true);
  await expect(play).toHaveText('Pause');

  // Resting on the bar keeps the controls up past their 5 s.
  await page.waitForTimeout(5500);
  await expect(play).toBeVisible();

  // Over the time beside the bar, a click does nothing.
  const end = page.locator('[data-focus-key="player-seek"] > span').last();
  const label = (await end.boundingBox())!;
  const before = (await video(page)).time;
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2, { steps: 3 });
  await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2);
  await page.waitForTimeout(300);
  const after = await video(page);
  expect(after.playing).toBe(true);
  expect(after.time).toBeLessThan(before + 3);
});

test('Back while a stream starts leaves at once, even after the pointer moved', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, { mediaDelayMs: 3000 });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect(page.getByRole('status', { name: 'Starting' })).toBeVisible();
  await page.mouse.move(900, 500);
  await page.mouse.move(960, 540, { steps: 3 });
  await pressBack(page);
  await expectFocus(page, 'details-watch');
});
