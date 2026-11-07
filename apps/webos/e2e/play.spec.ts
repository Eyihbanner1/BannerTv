import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { DEMO_ROW, FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import {
  COMMENTARY_HLS_PATH,
  DEFAULT_STREAMS,
  HLS_PATH,
  LIVE_HLS_PATH,
  MEDIA_HOST,
  mockPlayback,
  readKv,
  seedStreamAddon,
} from './play';
import { APP_URL, expectFocus, focusedKey, openSection, press, pressBack } from './tv';

/** Elephants Dream, the first title on Home. */
const MOVIE = 'tt0807840';
/** The start of the focus key of an OpenSubtitles version row: its addon id, then the file's. */
const OPENSUBTITLES = 'player-tracks-file-org.stremio.opensubtitlesv3';
/** A row of the Sources sheet: the test addon's stream at this place in its answer. */
const source = (rank: number) => `player-sources-row-0:org.bannertv.test-streams#${rank}`;

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

  // OK pauses and brings up the controls, with what is playing: at the top, and on Quality.
  await press(page, 'Enter', 'player-play');
  await expect(page.locator('[data-focus-key="player-play"]')).toHaveText('Play');
  await expect(page.getByText('1080p', { exact: true })).toHaveCount(2);
  await expect(page.locator('[data-focus-key="player-quality-button"]')).toContainText('1080p');
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
  // The open movies run 15 min; this one runs as long as a feature film, and
  // its files are long enough not to be taken for clips of it.
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
          path: '/long-movie-2160p-remux.webm',
        },
        {
          name: 'Test Streams\n4K',
          description: 'Open Movie 2160p WEB-DL\n💾 15 GB ⚡ Cached',
          path: '/long-movie-2160p-web.webm',
        },
      ],
    },
  });
  await openMovie(page);

  // Over 2 h the remux needs about 95 Mbit/s and the WEB-DL about 18.
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).src).toBe('/long-movie-2160p-web.webm');
  await press(page, 'Enter', 'player-play');
  await expect(page.locator('[data-focus-key="player-quality-button"]')).toContainText('4K');
});

/** Elephants Dream with a page saying it runs 45 minutes, and these streams. */
async function routeLongFilm(page: Page, streams: Parameters<typeof mockPlayback>[1]) {
  await mockAddons(page);
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
          runtime: '45 min',
        },
      }),
    }),
  );
  await seedStreamAddon(page);
  return mockPlayback(page, streams);
}

test('auto-play moves on from a short clip of the film to the film, and keeps nothing of the clip', async ({
  page,
}) => {
  // The 4K stream is a 40 s clip, as a debrid service sends while a file isn't ready.
  const mock = await routeLongFilm(page, {
    streams: {
      [MOVIE]: [
        {
          name: 'Test Streams\n4K',
          description: 'Open Movie 2160p WEB-DL\n💾 9 GB ⚡ Cached',
          path: '/movie-2160p-web.webm',
        },
        {
          name: 'Test Streams\n1080p',
          description: 'Open Movie 1080p WEB-DL\n💾 2 GB ⚡ Cached',
          path: '/long-movie-1080p-web.webm',
        },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/long-movie-1080p-web.webm');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect(mock.media).toContain('/movie-2160p-web.webm');
  await press(page, 'ArrowUp', 'player-play');
  await expect(page.locator('[data-focus-key="player-quality-button"]')).toContainText('1080p');

  // Left, the film's place is kept against the film's length, never the clip's.
  await pressBack(page);
  await pressBack(page);
  await expectFocus(page, 'details-watch');
  const saved = ((await readKv(page, 'progress')) ?? []) as Array<{
    videoId: string;
    duration: number;
  }>;
  expect(saved.filter((entry) => entry.videoId === MOVIE).map((entry) => entry.duration)).toEqual([
    600,
  ]);
});

test('a film whose every stream is a short clip says so, and keeps nothing', async ({ page }) => {
  await routeLongFilm(page, {
    streams: {
      [MOVIE]: [
        {
          name: 'Test Streams\n4K',
          description: 'Open Movie 2160p WEB-DL\n💾 9 GB ⚡ Cached',
          path: '/movie-2160p-web.webm',
        },
        {
          name: 'Test Streams\n1080p',
          description: 'Open Movie 1080p WEB-DL\n💾 2 GB ⚡ Cached',
          path: '/movie-1080p-web.webm',
        },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect(
    page.getByText(
      'This stream is only a short clip, not the video. Its source may not have it ready yet.',
    ),
  ).toBeVisible({ timeout: 15000 });
  const saved = ((await readKv(page, 'progress')) ?? []) as Array<{ videoId: string }>;
  expect(saved.map((entry) => entry.videoId)).not.toContain(MOVIE);
});

test('a clip picked by hand plays with no Up Next over it, and at its end says it was only a clip', async ({
  page,
}) => {
  // The series' page says its episodes run 45 minutes; the 720p release is a 40 s clip.
  await mockAddons(page, { seriesRuntime: '45 min' });
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      'tt8000001:1:1': [
        {
          name: 'Test Streams\n1080p',
          description: 'Open Movie 1080p WEB-DL x264\n💾 1.4 GB ⚡ Cached',
          path: '/long-episode-1080p.webm',
        },
        {
          name: 'Test Streams\n720p',
          description: 'Open Movie 720p WEB-DL x264\n💾 700 MB ⚡ Cached',
          path: '/episode-720p.webm',
        },
      ],
    },
  });
  await playFirstEpisode(page);
  expect((await video(page)).src).toBe('/long-episode-1080p.webm');
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'Enter', source(0));
  await press(page, 'ArrowDown', source(1));
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/episode-720p.webm');

  // Its last 30 seconds are not the episode's: no Up Next counts over them.
  await expect.poll(async () => (await video(page)).time, { timeout: 20000 }).toBeGreaterThan(14);
  await expect(page.getByRole('dialog', { name: 'Up next' })).toHaveCount(0);
  await expectFocus(page, 'player-surface');
  // Next episode is still there to press.
  await press(page, 'ArrowUp', 'player-play');
  await expect(page.locator('[data-focus-key="player-next"]')).toHaveAttribute(
    'aria-label',
    'Next episode',
  );
  await pressBack(page);
  await expectFocus(page, 'player-surface');

  // Its end is not the episode's either: no next episode, and no leaving.
  await press(page, 'ArrowRight', 'player-surface');
  await press(page, 'ArrowRight', 'player-surface');
  await expect(
    page.getByText(
      'This stream is only a short clip, not the video. Its source may not have it ready yet.',
    ),
  ).toBeVisible({ timeout: 20000 });
  // The episode's own release was already tried here, so All streams is the way on.
  await expectFocus(page, 'player-problem-streams');
  await expect(page.getByRole('dialog', { name: 'Up next' })).toHaveCount(0);
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
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(200);
  expect(await focusedKey(page)).toBe('player-surface');
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
  // Both links were tried: it says so, then why the last one stopped.
  await expect(page.getByText('No stream could play')).toBeVisible();
  await expect(page.getByText('Tried 2 streams, and none of them played.')).toBeVisible();
  // A link that answers 404 is the link's fault, not a format the TV lacks.
  await expect(page.getByText('Its source may be busy or offline.')).toBeVisible();
  // The torrent cannot play on a TV: it says what would make it play.
  await expect(
    page.getByText(
      'Test Streams also sent 1 torrent, which plays once a debrid service is set up in its settings.',
    ),
  ).toBeVisible();
  await expect(page.locator('[data-focus-key="player-problem-another"]')).toHaveCount(0);
  await expectFocus(page, 'player-problem-streams');
  // A stray click beside the box neither leaves nor brings the controls up behind it.
  await page.mouse.move(80, 80);
  await page.mouse.click(60, 60);
  await page.waitForTimeout(300);
  await expect(page.getByText('No stream could play')).toBeVisible();
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
  await press(page, 'Enter', 'streams-item-0');
  expect(errors).toEqual([]);
});

test('with only torrents, the player names the addon and says to set up a debrid service', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [
        {
          name: 'Test Streams\n4K',
          description: 'Open Movie 2160p REMUX\n👤 52',
          infoHash: 'a'.repeat(40),
        },
        {
          name: 'Test Streams\n1080p',
          description: 'Open Movie 1080p\n👤 12',
          infoHash: 'b'.repeat(40),
        },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-problem-streams');
  await expect(page.getByText('No stream could play')).toBeVisible();
  await expect(
    page.getByText(
      "Test Streams sent 2 torrents, and BannerTV can't play torrents by itself. Set up a debrid service in the addon's settings, then try again.",
    ),
  ).toBeVisible();
});

test('Play passes over a dub for a release in the language wanted, and Audio can switch back to it', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  const playback = await mockPlayback(page, {
    streams: {
      [MOVIE]: [
        {
          name: 'Test Streams\n1080p',
          description: 'Open Movie 1080p BluRay REMUX 🇪🇸\n💾 9 GB ⚡ Cached',
          path: '/movie-1080p-castellano.webm',
        },
        {
          name: 'Test Streams\n720p',
          description: 'Open Movie 720p WEB-DL\n💾 2 GB ⚡ Cached',
          path: '/movie-720p.webm',
        },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  expect(playback.media).not.toContain('/movie-1080p-castellano.webm');

  // The dub picked by hand, Audio offers the language back from the other stream.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'Enter', source(1));
  await press(page, 'ArrowDown', source(0));
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-1080p-castellano.webm');

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await page.keyboard.press('Enter');
  await pressBack(page);
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  const offer = page.locator('[data-focus-key="player-tracks-audio-switch"]');
  await expect(offer).toContainText('English audio: switch stream');
  await expect(offer).toContainText('720p');
  await press(page, 'ArrowDown', 'player-tracks-audio-switch');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  expect((await video(page)).time).toBeGreaterThan(0);
});

test('Watch starts the release played last for the title', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    kv: {
      releaseChoices: [
        { metaId: MOVIE, addonId: 'org.bannertv.test-streams', bingeGroup: 'test-720p' },
      ],
    },
  });
  await mockPlayback(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  // What is kept names the release, never its link.
  expect(JSON.stringify(await readKv(page, 'releaseChoices'))).not.toContain('media.example.com');
});

test('a release played last that the addon no longer sends leaves the usual pick', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    kv: {
      releaseChoices: [
        { metaId: MOVIE, addonId: 'org.bannertv.test-streams', bingeGroup: 'test-gone' },
      ],
    },
  });
  await mockPlayback(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-1080p.webm');
});

test('Languages and picture in Settings: the highest picture keeps Play within it', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  for (const key of [
    'settings-probing',
    'settings-subtitle-style',
    'settings-still-watching',
    'settings-diagnostics',
    'settings-lab',
    'settings-stream-helper',
    'settings-languages',
  ]) {
    await press(page, 'ArrowDown', key);
  }
  await press(page, 'Enter', 'languages-audio');
  await expect(page.locator('[data-focus-key="languages-audio"]')).toHaveAttribute(
    'aria-label',
    'Audio: Original',
  );

  // Subtitles in English, only when the audio isn't English.
  await press(page, 'ArrowDown', 'languages-subtitles');
  await press(page, 'Enter', 'languages-subtitles-menu-0');
  await press(page, 'ArrowDown', 'languages-subtitles-menu-1');
  await press(page, 'Enter', 'languages-subtitles');
  await expect(page.locator('[data-focus-key="languages-subtitles"]')).toHaveAttribute(
    'aria-label',
    'Subtitles: English',
  );
  await press(page, 'ArrowDown', 'languages-when');
  await press(page, 'Enter', 'languages-when-menu-0');
  await press(page, 'ArrowDown', 'languages-when-menu-1');
  await press(page, 'Enter', 'languages-when');
  await expect(page.locator('[data-focus-key="languages-when"]')).toHaveAttribute(
    'aria-label',
    "Show subtitles: Only when the audio isn't English",
  );

  // At most 720p.
  await press(page, 'ArrowDown', 'languages-picture');
  await press(page, 'Enter', 'languages-picture-menu-0');
  for (const index of [1, 2, 3]) await press(page, 'ArrowDown', `languages-picture-menu-${index}`);
  await press(page, 'Enter', 'languages-picture');
  await expect(page.locator('[data-focus-key="languages-picture"]')).toHaveAttribute(
    'aria-label',
    'Highest picture: 720p',
  );
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem('bannertv.preferences'))) ?? '{}'),
  ).toMatchObject({ subtitleLanguage: 'en', subtitleWhen: 'foreign', maxResolution: '720p' });

  await pressBack(page);
  await expectFocus(page, 'settings-languages');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  // A stream that names no other language is taken to be in English: no subtitles.
  await expect.poll(async () => (await video(page)).time, { timeout: 10000 }).toBeGreaterThan(2);
  await expect(page.getByText('Hello from the test subtitles')).toHaveCount(0);
});

test('subtitles set to show only when the audio is in another language show for a dub', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    preferences: { subtitleLanguage: 'en', subtitleWhen: 'foreign', audioLanguage: 'fr' },
  });
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [
        {
          name: 'Test Streams\n1080p',
          description: 'Open Movie 1080p WEB-DL 🇫🇷',
          path: '/movie-1080p-vf.webm',
        },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-1080p-vf.webm');
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
});

test('when only uncached debrid links were tried, the player says so', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [
        {
          name: '[RD download] Test Streams\n1080p',
          description: 'Open Movie 1080p WEB-DL',
          path: '/movie-1080p.webm',
        },
        {
          name: '[RD download] Test Streams\n720p',
          description: 'Open Movie 720p WEB-DL',
          path: '/movie-720p.webm',
        },
      ],
    },
    broken: ['/movie-1080p.webm', '/movie-720p.webm'],
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect(page.getByText('Tried 2 streams, and none of them played.')).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByText(
      "Only uncached links: your debrid service hasn't downloaded this title yet. Try again later, or pick a cached stream in All streams.",
    ),
  ).toBeVisible();
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
  // A few seconds before it (10 s: the seeded progress is long ago), to pick up the line it left.
  const resumed = (await video(page)).time;
  expect(resumed).toBeGreaterThanOrEqual(25);
  expect(resumed).toBeLessThan(33);
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
  // The resume's own start, 10 s early, kept through All streams.
  expect((await video(page)).time).toBeGreaterThanOrEqual(25);
});

test('subtitles come from the subtitles addon: a language on the left, its versions on the right, numbered by source', async ({
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
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'Enter', 'player-tracks-off');
  const sheet = page.getByRole('dialog', { name: 'Audio & subtitles' });
  await expect(sheet.locator('[data-focus-key="player-tracks-tab-subtitles"]')).toContainText(
    'Off',
  );
  await press(page, 'ArrowDown', 'player-tracks-lang-en');
  await expect(page.locator('[data-focus-key="player-tracks-lang-en"]')).toHaveAttribute(
    'aria-label',
    'English, 2 versions',
  );
  // Its versions show beside it as it takes focus. OpenSubtitles sends no release names.
  const first = page.locator(`[data-focus-key="${OPENSUBTITLES}#en1"]`);
  const second = page.locator(`[data-focus-key="${OPENSUBTITLES}#en2"]`);
  await expect(first).toHaveText('OpenSubtitles v3 1');
  await expect(second).toHaveText('OpenSubtitles v3 2');
  // Moving on to another language shows its versions in their place.
  await press(page, 'ArrowDown', 'player-tracks-lang-fr');
  await expect(page.locator(`[data-focus-key="${OPENSUBTITLES}#fr1"]`)).toBeVisible();
  await expect(first).toHaveCount(0);
  await press(page, 'ArrowUp', 'player-tracks-lang-en');
  await expect(first).toHaveText('OpenSubtitles v3 1');

  await press(page, 'Enter', 'player-tracks-lang-en');
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await expect(sheet.locator('[data-focus-key="player-tracks-tab-subtitles"]')).toContainText(
    'English',
  );
  // The language showing: on to its version showing.
  await press(page, 'Enter', `${OPENSUBTITLES}#en1`);
  await press(page, 'ArrowDown', `${OPENSUBTITLES}#en2`);
  await press(page, 'Enter', `${OPENSUBTITLES}#en2`);
  await expect(page.getByText('The second English file')).toBeVisible();
  await expect(page.getByText('Hello from the test subtitles')).toHaveCount(0);
  // Left goes back to the language, not to the row beside (Off, beside the first version).
  await press(page, 'ArrowUp', `${OPENSUBTITLES}#en1`);
  await press(page, 'ArrowLeft', 'player-tracks-lang-en');
  // Nor to the language chosen: to the one last looked at.
  await press(page, 'ArrowDown', 'player-tracks-lang-fr');
  await press(page, 'ArrowRight', `${OPENSUBTITLES}#fr1`);
  await press(page, 'ArrowLeft', 'player-tracks-lang-fr');

  // Back goes one level at a time: to the tabs, then to the controls.
  await pressBack(page);
  await expectFocus(page, 'player-tracks-tab-subtitles');
  await pressBack(page);
  await expect(sheet).toHaveCount(0);
  await expectFocus(page, 'player-tracks-button');
  // The language is kept for the title; the profile's own, set in Settings, stays as it was.
  await expect
    .poll(async () => ((await readKv(page, 'trackChoices')) ?? []) as unknown[])
    .toEqual([expect.objectContaining({ subtitle: 'eng' })]);
  const saved = await page.evaluate(() => localStorage.getItem('bannertv.preferences'));
  expect(JSON.parse(saved ?? '{}').subtitleLanguage ?? null).toBeNull();
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
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'Enter', source(0));
  await press(page, 'ArrowDown', source(1));
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');

  // In the last 30 seconds (10 s into the 40 s file) the card takes focus,
  // counting to the real end of the episode.
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    'player-upnext-play',
    { timeout: 15000 },
  );
  await expect(page.getByRole('dialog', { name: 'Up next' })).toBeVisible();
  await expectCountToEnd(
    page,
    page.locator('[data-focus-key="player-upnext-play"]'),
    /^Play now\. Next episode in (\d+) s$/,
  );

  // The pointer heading for the card does not bring the controls up and move it.
  const card = page.getByRole('dialog', { name: 'Up next' });
  const where = await card.boundingBox();
  await page.mouse.move(900, 500);
  await page.mouse.move(1000, 600, { steps: 5 });
  await page.waitForTimeout(300);
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
  expect(await card.boundingBox()).toEqual(where);
  await expectFocus(page, 'player-upnext-play');
  // The remote's arrows take over again: the pointer goes.
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('cursorStateChange', { detail: { visibility: false } })),
  );

  // Pause closes it, and focus goes to the controls Pause brought up. Paused, nothing counts.
  await page.keyboard.press('Pause');
  await expect(page.getByRole('dialog', { name: 'Up next' })).toHaveCount(0);
  await expectFocus(page, 'player-play');
  const nextButton = page.locator('[data-focus-key="player-next"]');
  await expect(nextButton).toHaveAttribute('aria-label', 'Next episode');

  // Playing again, the controls stay and the count goes on Next episode, to the
  // same end; once they hide, the card comes back with focus.
  await press(page, 'Enter', 'player-play');
  await expect(card).toHaveCount(0);
  await expectCountToEnd(page, nextButton, /^Next in (\d+) s$/);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    'player-upnext-play',
    { timeout: 8000 },
  );
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
  // A skip takes the card away, and its note says where it lands; the card
  // comes back with focus once it has.
  await pressCode(page, FAST_FORWARD);
  await expect(card).toHaveCount(0);
  await expect(page.getByText('+10 s', { exact: true })).toBeVisible();
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

test('Up or Down on the Up Next card brings the controls up in its place, counting on Next episode', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await playFirstEpisode(page);
  const card = page.getByRole('dialog', { name: 'Up next' });
  const nextButton = page.locator('[data-focus-key="player-next"]');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    'player-upnext-play',
    { timeout: 15000 },
  );
  // Left and Right go along its buttons.
  await press(page, 'ArrowRight', 'player-upnext-dismiss');
  await press(page, 'ArrowLeft', 'player-upnext-play');
  await press(page, 'ArrowUp', 'player-play');
  await expect(card).toHaveCount(0);
  await expectCountToEnd(page, nextButton, /^Next in (\d+) s$/);
  expect((await video(page)).playing).toBe(true);
  // Once they hide, the card comes back with focus, and Down does the same.
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    'player-upnext-play',
    { timeout: 8000 },
  );
  await press(page, 'ArrowDown', 'player-play');
  await expect(card).toHaveCount(0);
  await expectCountToEnd(page, nextButton, /^Next in (\d+) s$/);
});

test('Up Next says what plays next and when, the pointer picks its buttons, and a click beside it brings the controls', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await playFirstEpisode(page);
  const card = page.getByRole('dialog', { name: 'Up next' });
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    'player-upnext-play',
    { timeout: 15000 },
  );
  // "Next episode in 12 s", then the episode's number and its name.
  await expect(card.getByText(/^Next episode in \d+ s$/)).toBeVisible();
  await expect(card.getByText('S1:E2', { exact: true })).toBeVisible();
  await expect(card.locator('[data-focus-key="player-upnext-play"]')).toHaveText('Play now');

  // The pointer over Keep watching takes focus there, and back over Play now.
  const keep = await page.locator('[data-focus-key="player-upnext-dismiss"]').boundingBox();
  const playNow = await page.locator('[data-focus-key="player-upnext-play"]').boundingBox();
  if (!keep || !playNow) throw new Error('Up Next has no buttons on screen');
  await page.mouse.move(keep.x - 200, keep.y - 200);
  await page.mouse.move(keep.x + keep.width / 2, keep.y + keep.height / 2, { steps: 4 });
  await expectFocus(page, 'player-upnext-dismiss');
  await page.mouse.move(playNow.x + playNow.width / 2, playNow.y + playNow.height / 2, {
    steps: 4,
  });
  await expectFocus(page, 'player-upnext-play');
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();

  // A click on the card's own words is the card's: it stays, and the controls do not come.
  const words = (await card.getByText('S1:E2', { exact: true }).boundingBox())!;
  await page.mouse.move(words.x + words.width / 2, words.y + words.height / 2, { steps: 4 });
  await page.mouse.click(words.x + words.width / 2, words.y + words.height / 2);
  await page.waitForTimeout(300);
  await expect(card).toBeVisible();
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();

  // A click on the picture beside it brings the controls in its place, still playing.
  await page.mouse.move(400, 300, { steps: 4 });
  await page.mouse.click(400, 300);
  await expect(page.locator('[data-focus-key="player-play"]')).toBeVisible();
  await expect(card).toHaveCount(0);
  expect((await video(page)).playing).toBe(true);
});

/**
 * Up Next's count, on `where`, is the seconds left to the end of the 40 s
 * file: its ending is never cut.
 */
async function expectCountToEnd(page: Page, where: Locator, pattern: RegExp) {
  await expect(where).toHaveAttribute('aria-label', pattern);
  const label = (await where.getAttribute('aria-label')) ?? '';
  const { time } = await video(page);
  const count = Number(pattern.exec(label)?.[1]);
  expect(count).toBeLessThanOrEqual(30);
  expect(Math.abs(count - (40 - time))).toBeLessThanOrEqual(1.5);
}

/** The episode playing, as the controls name it. */
async function episodePlaying(page: Page) {
  await press(page, 'ArrowUp', 'player-play');
  const name = await page
    .locator('section[aria-label="Morevna Project"]:visible')
    .getByText(/^S\d+:E\d+/)
    .first()
    .textContent();
  await pressBack(page);
  return name;
}

test('Up Next comes back after a rewind, and the next episode starts as this one ends', async ({
  page,
}) => {
  test.slow();
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await playFirstEpisode(page);
  await page.evaluate(() =>
    document.addEventListener(
      'ended',
      () => document.body.setAttribute('data-ended', String(performance.now())),
      true,
    ),
  );

  // Kept watching: the card goes, and stays gone into the end.
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    'player-upnext-play',
    { timeout: 15000 },
  );
  await pressBack(page);
  await expect(page.getByRole('dialog', { name: 'Up next' })).toHaveCount(0);
  await expectFocus(page, 'player-surface');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('dialog', { name: 'Up next' })).toHaveCount(0);

  // A rewind well back from the end brings it back for the end.
  await pressCode(page, REWIND);
  await expect.poll(async () => (await video(page)).time).toBeLessThan(8);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    'player-upnext-play',
    { timeout: 15000 },
  );

  // Left to count, it plays on into the next episode only once this one has ended.
  await pressCode(page, FAST_FORWARD);
  await pressCode(page, FAST_FORWARD);
  await expectFocus(page, 'player-upnext-play');
  expect(await page.locator('body').getAttribute('data-ended')).toBeNull();
  await expect.poll(async () => (await video(page)).time, { timeout: 15000 }).toBeLessThan(5);
  expect(await page.locator('body').getAttribute('data-ended')).not.toBeNull();
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect(await episodePlaying(page)).toMatch(/^S1:E2/);
});

test('an end held by a sheet waits for it, then counts 10 s to the next episode', async ({
  page,
}) => {
  test.slow();
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await playFirstEpisode(page);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    'player-upnext-play',
    { timeout: 15000 },
  );
  await pressCode(page, FAST_FORWARD);
  await pressCode(page, FAST_FORWARD);
  await expectFocus(page, 'player-upnext-play');

  // Audio & subtitles over the end: the card gives way, and the end waits for the sheet.
  await pressCode(page, BLUE);
  const sheet = page.getByRole('dialog', { name: 'Audio & subtitles' });
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Up next' })).toHaveCount(0);
  await expect
    .poll(
      () =>
        page
          .locator('video:not([aria-hidden])')
          .evaluate((element: HTMLVideoElement) => element.ended),
      { timeout: 15000 },
    )
    .toBe(true);
  await page.waitForTimeout(1500);
  await expect(sheet).toBeVisible();
  expect(
    await page.locator('video:not([aria-hidden])').evaluate((e: HTMLVideoElement) => e.ended),
  ).toBe(true);

  // Closed, the card counts 10 s, then the next episode plays.
  await pressCode(page, BLUE);
  await expect(sheet).toHaveCount(0);
  const play = page.locator('[data-focus-key="player-upnext-play"]');
  await expect(play).toHaveAttribute('aria-label', /^Play now\. Next episode in (10|9) s$/);
  await expectFocus(page, 'player-upnext-play');
  await page.waitForTimeout(3000);
  await expect(play).toHaveAttribute('aria-label', /^Play now\. Next episode in [5-7] s$/);
  await expect.poll(async () => (await video(page)).time, { timeout: 12000 }).toBeLessThan(5);
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect(await episodePlaying(page)).toMatch(/^S1:E2/);
});

/** From the controls' Pause, through the tools to Info's Sleep timer tab. */
async function openSleepTimer(page: Page, tools: readonly string[]) {
  await press(page, 'ArrowDown', 'player-tracks-button');
  for (const tool of tools) await press(page, 'ArrowRight', `player-${tool}-button`);
  await press(page, 'ArrowRight', 'player-info-button');
  await press(page, 'Enter', 'player-info-about');
  await press(page, 'ArrowUp', 'player-info-tab-about');
  await press(page, 'ArrowRight', 'player-info-tab-sleep');
}

test('Speed shows in Info once the Lab passed one, and offers only what passed for the stream playing', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    kv: {
      'playback-speed': {
        version: 1,
        results: {
          'native-file': { rates: [1.25], why: 'sound', testedAt: 1000 },
          'hls.js': { rates: [0.75, 1.5], testedAt: 1000 },
        },
      },
    },
  });
  await mockPlayback(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  const rate = () =>
    page
      .locator('video:not([aria-hidden])')
      .evaluate((element: HTMLVideoElement) => element.playbackRate);

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  for (const tool of ['quality', 'streams', 'info']) {
    await press(page, 'ArrowRight', `player-${tool}-button`);
  }
  await press(page, 'Enter', 'player-info-about');
  await press(page, 'ArrowUp', 'player-info-tab-about');
  await press(page, 'ArrowRight', 'player-info-tab-speed');
  const tab = page.locator('[data-focus-key="player-info-tab-speed"]');
  await expect(tab).toHaveAttribute('aria-label', 'Speed, Normal');
  // The film plays on the TV's own player: only what the Lab passed for files.
  await expect(page.locator('[data-focus-key^="player-info-speed-"]')).toHaveText([
    'Normal',
    '1.25×',
  ]);
  await press(page, 'Enter', 'player-info-speed-1');
  await press(page, 'ArrowRight', 'player-info-speed-1.25');
  await page.keyboard.press('Enter');
  await expect.poll(rate).toBe(1.25);
  await expect(tab).toHaveAttribute('aria-label', 'Speed, 1.25×');
  await expect(page.locator('[data-focus-key="player-info-speed-1.25"]')).toHaveAttribute(
    'aria-label',
    '1.25×. Set',
  );
  // The film plays on, faster: the end comes sooner.
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  // Back to Normal, and the sleep timer is still the next tab along.
  await press(page, 'ArrowLeft', 'player-info-speed-1');
  await page.keyboard.press('Enter');
  await expect.poll(rate).toBe(1);
  await expect(tab).toHaveAttribute('aria-label', 'Speed, Normal');
  await press(page, 'ArrowUp', 'player-info-tab-speed');
  await press(page, 'ArrowRight', 'player-info-tab-sleep');
});

const SLEEP_WARNING = /^Sleep timer\. /;
const ASLEEP = 'Paused by the sleep timer';

test('the sleep timer, set in Info, warns a minute before, takes 15 minutes more, then pauses under a dark screen', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 9, 30, 22, 0, 0).getTime() });
  await playMovie(page);
  await press(page, 'ArrowUp', 'player-play');
  await openSleepTimer(page, ['quality', 'streams']);
  const tab = page.locator('[data-focus-key="player-info-tab-sleep"]');
  await expect(tab).toHaveAttribute('aria-label', 'Sleep timer, Off');
  await press(page, 'ArrowDown', 'player-info-sleep-off');
  await press(page, 'ArrowRight', 'player-info-sleep-15');
  await page.keyboard.press('Enter');
  await expect(tab).toHaveAttribute('aria-label', 'Sleep timer, Until 22:15');
  await expect(page.getByText('Pauses at 22:15, playing or paused.')).toBeVisible();
  await expect(page.locator('[data-focus-key="player-info-sleep-15"]')).toHaveAttribute(
    'aria-label',
    '15 min. Set',
  );
  // Back goes to the tabs, then closes onto the chip, which says the timer is on.
  await pressBack(page);
  await expectFocus(page, 'player-info-tab-sleep');
  await pressBack(page);
  await expectFocus(page, 'player-info-button');
  await expect(page.locator('[data-focus-key="player-info-button"]')).toHaveAttribute(
    'aria-label',
    'Info, Sleep 22:15',
  );
  await pressBack(page);
  await expectFocus(page, 'player-surface');

  // A minute before, the warning takes focus from the picture; Add 15 min moves the time on.
  await page.clock.fastForward(14 * 60 * 1000 + 5000);
  const warning = page.getByRole('dialog', { name: SLEEP_WARNING });
  await expect(warning).toHaveAttribute('aria-label', 'Sleep timer. Pausing at 22:15');
  await expectFocus(page, 'player-sleepwarn-add');
  await page.keyboard.press('Enter');
  await expect(warning).toHaveCount(0);
  await expectFocus(page, 'player-surface');
  await page.clock.fastForward(15 * 60 * 1000);
  await expect(warning).toHaveAttribute('aria-label', 'Sleep timer. Pausing at 22:30');

  // Then the film pauses under the dark screen, and Carry on watching plays on, with the timer off.
  await page.clock.fastForward(60 * 1000);
  await expect(page.getByRole('dialog', { name: ASLEEP })).toBeVisible();
  await expectFocus(page, 'player-asleep-wake');
  await expect.poll(async () => (await video(page)).playing).toBe(false);
  // The TV going to another app and back leaves the remote with the dark screen.
  await page.evaluate(() => {
    const turn = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    turn(true);
    turn(false);
  });
  await page.waitForTimeout(300);
  await expectFocus(page, 'player-asleep-wake');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: ASLEEP })).toHaveCount(0);
  await expectFocus(page, 'player-play');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expect(page.locator('[data-focus-key="player-play"]')).toHaveText('Pause');
  await expect(page.locator('[data-focus-key="player-info-button"]')).toHaveAttribute(
    'aria-label',
    'Info',
  );

  // Set again: Up on the warning brings the controls up in its place, as over the picture.
  await openSleepTimer(page, ['quality', 'streams']);
  await press(page, 'ArrowDown', 'player-info-sleep-off');
  await press(page, 'ArrowRight', 'player-info-sleep-15');
  await page.keyboard.press('Enter');
  await expect(tab).toHaveAttribute('aria-label', /^Sleep timer, Until 22:4[56]$/);
  await pressBack(page);
  await pressBack(page);
  await pressBack(page);
  await expectFocus(page, 'player-surface');
  await page.clock.fastForward(14 * 60 * 1000 + 5000);
  await expectFocus(page, 'player-sleepwarn-add');
  await press(page, 'ArrowUp', 'player-play');
  await expect(warning).toHaveCount(0);
  // Back on the dark screen wakes it still paused, with the controls on Play.
  await page.clock.fastForward(60 * 1000);
  await expect(page.getByRole('dialog', { name: ASLEEP })).toBeVisible();
  await expectFocus(page, 'player-asleep-wake');
  await pressBack(page);
  await expect(page.getByRole('dialog', { name: ASLEEP })).toHaveCount(0);
  await expectFocus(page, 'player-play');
  await expect(page.locator('[data-focus-key="player-play"]')).toHaveText('Play');
  await page.waitForTimeout(300);
  expect((await video(page)).playing).toBe(false);
});

test('a sleep timer goes with the player: the film played again starts with it off', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 9, 30, 22, 0, 0).getTime() });
  await playMovie(page);
  await press(page, 'ArrowUp', 'player-play');
  await openSleepTimer(page, ['quality', 'streams']);
  await press(page, 'ArrowDown', 'player-info-sleep-off');
  await press(page, 'ArrowRight', 'player-info-sleep-15');
  await page.keyboard.press('Enter');
  await pressBack(page);
  await pressBack(page);
  await expect(page.locator('[data-focus-key="player-info-button"]')).toHaveAttribute(
    'aria-label',
    'Info, Sleep 22:15',
  );
  await pressBack(page);
  await pressBack(page);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^details-/,
  );

  // Played again before its time, the film starts with no timer.
  await page.clock.fastForward(5 * 60 * 1000);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await page.waitForTimeout(1000);
  await expect(page.getByRole('dialog', { name: ASLEEP })).toHaveCount(0);
  await press(page, 'ArrowUp', 'player-play');
  await expect(page.locator('[data-focus-key="player-info-button"]')).toHaveAttribute(
    'aria-label',
    'Info',
  );
});

test('a sleep timer carried into All streams goes when All streams is left for anything else', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 9, 30, 22, 0, 0).getTime() });
  await playMovie(page);
  await press(page, 'ArrowUp', 'player-play');
  await openSleepTimer(page, ['quality', 'streams']);
  await press(page, 'ArrowDown', 'player-info-sleep-off');
  await press(page, 'ArrowRight', 'player-info-sleep-15');
  await page.keyboard.press('Enter');
  await pressBack(page);
  await pressBack(page);
  await expectFocus(page, 'player-info-button');

  // On to All streams from Sources, then away to Settings, and Home.
  await press(page, 'ArrowLeft', 'player-streams-button');
  await press(page, 'Enter', source(0));
  await press(page, 'ArrowUp', 'player-sources-all');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^streams-/,
  );
  await openSection(page, 'settings');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  // The film again, well within the 15 minutes: no timer.
  await page.clock.fastForward(60 * 1000);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^details-/,
  );
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await press(page, 'ArrowUp', 'player-play');
  await expect(page.locator('[data-focus-key="player-info-button"]')).toHaveAttribute(
    'aria-label',
    'Info',
  );
});

test('"End of episode" pauses at its end in place of the next one, and waking counts 10 s to it', async ({
  page,
}) => {
  test.slow();
  await page.clock.install({ time: new Date(2026, 9, 30, 22, 0, 0).getTime() });
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await playFirstEpisode(page);
  await press(page, 'ArrowUp', 'player-play');
  await openSleepTimer(page, ['quality', 'streams', 'episodes']);
  // OK on the tab goes on to its choices.
  await press(page, 'Enter', 'player-info-sleep-off');
  for (const choice of ['15', '30', '45', '60', '90', 'end']) {
    await press(page, 'ArrowRight', `player-info-sleep-${choice}`);
  }
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Pauses when this episode ends, instead of playing the next one.'),
  ).toBeVisible();
  await pressBack(page);
  await pressBack(page);
  await expectFocus(page, 'player-info-button');
  await expect(page.locator('[data-focus-key="player-info-button"]')).toHaveAttribute(
    'aria-label',
    'Info, Sleep at end',
  );
  await pressBack(page);

  // The 40 s file is all its last minute: the warning shows, and Up Next does not.
  const warning = page.getByRole('dialog', { name: SLEEP_WARNING });
  await expect(warning).toHaveAttribute(
    'aria-label',
    'Sleep timer. Pausing when this episode ends',
  );
  await expectFocus(page, 'player-sleepwarn-off');
  await pressCode(page, FAST_FORWARD);
  await pressCode(page, FAST_FORWARD);
  await expectFocus(page, 'player-sleepwarn-off');
  await expect(page.getByRole('dialog', { name: 'Up next' })).toHaveCount(0);
  // Then 91 minutes without a key, so "Still watching?" would ask before the next one.
  await page.clock.fastForward(91 * 60 * 1000);

  // At the end it pauses under the dark screen, and nothing plays on.
  await expect(page.getByRole('dialog', { name: ASLEEP })).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(1500);
  expect(
    await page
      .locator('video:not([aria-hidden])')
      .evaluate((element: HTMLVideoElement) => element.ended),
  ).toBe(true);

  // Awake, the controls count 10 s on Next episode, then it plays: waking was
  // the answer to "Still watching?", which does not ask again.
  await page.keyboard.press('Enter');
  await expectFocus(page, 'player-play');
  await expect(page.getByRole('dialog', { name: 'Still watching?' })).toHaveCount(0);
  await expect(page.locator('[data-focus-key="player-next"]')).toHaveAttribute(
    'aria-label',
    /^Next in (10|9) s$/,
  );
  await expect.poll(async () => (await video(page)).time, { timeout: 13000 }).toBeLessThan(5);
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect(await episodePlaying(page)).toMatch(/^S1:E2/);
});

test('after 90 minutes with nothing pressed the next episode asks "Still watching?" first, unless Settings turns that off', async ({
  page,
}) => {
  test.slow();
  await page.clock.install({ time: new Date(2026, 9, 30, 22, 0, 0).getTime() });
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  /** From the first episode's start, to its end 91 minutes after the last key. */
  const sitThrough = async () => {
    await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
      'data-focus-key',
      'player-upnext-play',
      { timeout: 15000 },
    );
    await pressCode(page, FAST_FORWARD);
    await pressCode(page, FAST_FORWARD);
    await expectFocus(page, 'player-upnext-play');
    await page.clock.fastForward(91 * 60 * 1000);
  };
  await playFirstEpisode(page);
  await sitThrough();
  const still = page.getByRole('dialog', { name: 'Still watching?' });
  await expect(still).toBeVisible({ timeout: 20000 });
  await expectFocus(page, 'player-still-play');
  await expect(still.getByText('The next episode of Morevna Project is ready.')).toBeVisible();
  // Stop goes back to the series.
  await press(page, 'ArrowRight', 'player-still-stop');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^details-/,
  );

  // Turned off in Settings, the next episode plays on without asking.
  await pressBack(page);
  await expectFocus(page, `${SERIES_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowDown', 'settings-probing');
  await press(page, 'ArrowDown', 'settings-subtitle-style');
  await press(page, 'ArrowDown', 'settings-still-watching');
  const setting = page.locator('[data-focus-key="settings-still-watching"]');
  await expect(setting).toHaveAttribute('aria-label', 'Ask "Still watching?": On');
  await page.keyboard.press('Enter');
  await expect(setting).toHaveAttribute('aria-label', 'Ask "Still watching?": Off');
  // Continue Watching has the next episode.
  await pressBack(page);
  await expectFocus(page, 'home-continue-tile-0');
  await press(page, 'Enter', 'player-surface');
  await sitThrough();
  await expect.poll(async () => (await video(page)).time, { timeout: 20000 }).toBeLessThan(5);
  await expect(still).toHaveCount(0);
  expect(await episodePlaying(page)).toMatch(/^S1:E3/);
});

test('HLS with audio and subtitle choices plays through hls.js, and both show in the sheet', async ({
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
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'Enter', 'player-tracks-off');
  // The stream's own English track is one more version of English, the first.
  await press(page, 'ArrowDown', 'player-tracks-lang-en');
  await expect(page.locator('[data-focus-key="player-tracks-lang-en"]')).toHaveAttribute(
    'aria-label',
    'English, 3 versions',
  );
  await press(page, 'ArrowRight', 'player-tracks-track-eng|English');
  await expect(page.locator('[data-focus-key="player-tracks-track-eng|English"]')).toHaveText(
    'In the stream',
  );
  await press(page, 'Enter', 'player-tracks-track-eng|English');
  await expect(page.getByText('Hello from the stream')).toBeVisible();

  // French audio on the Audio tab, remembered for the next stream.
  await press(page, 'ArrowUp', 'player-tracks-tab-subtitles');
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  await expect(page.locator('[data-focus-key="player-tracks-tab-audio"]')).toContainText('English');
  await press(page, 'ArrowDown', 'player-tracks-audio-eng|English');
  await press(page, 'ArrowDown', 'player-tracks-audio-fre|French');
  await press(page, 'Enter', 'player-tracks-audio-fre|French');
  await expect(page.locator('[data-focus-key="player-tracks-tab-audio"]')).toContainText('French');
  await expect
    .poll(async () => ((await readKv(page, 'trackChoices')) ?? []) as unknown[])
    .toContainEqual(expect.objectContaining({ audio: 'fre' }));
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
  await press(page, 'ArrowDown', 'player-tracks-button');
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

  // Rewind goes back within the broadcast as on a film: it lands a moment
  // later, and the note says how far behind live. The controls stay hidden.
  // hls.js joins a few seconds behind the live edge of the 10 s window, so there is room.
  const before = (await video(page)).time;
  await pressCode(page, REWIND);
  await expect(page.locator('[class*="skipNote"]').getByText(/^0:0\d behind live$/)).toBeVisible();
  await expect.poll(async () => (await video(page)).time).toBeLessThan(before);
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();

  // The controls give no length to a broadcast: on the right is how far behind live it is.
  await press(page, 'ArrowUp', 'player-play');
  await expect(page.locator('[data-focus-key="player-seek"] > span').last()).toHaveText(/^−0:0\d$/);

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

  // A broadcast has no start to go back to: Start over keeps its place, dimmed, and says so.
  // The controls wait for the jump to the live edge to land.
  await expect(page.getByRole('status', { name: 'Starting' })).toHaveCount(0);
  await press(page, 'ArrowUp', 'player-play');
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
  await expect(page.locator('[data-focus-key="player-restart"]')).toHaveAttribute(
    'aria-label',
    'Start over. No start on live',
  );
  // Pressed, it does nothing.
  const seeks = await countSeeks(page);
  await press(page, 'ArrowLeft', 'player-back10');
  await press(page, 'ArrowLeft', 'player-restart');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect(await seeks()).toBe(0);
  // Back 10 s and Forward 10 s add up and land once, a moment after the last press, within
  // what the broadcast keeps, as on a film.
  await press(page, 'ArrowRight', 'player-back10');
  const live = (await video(page)).time;
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // Waiting to land, Forward 10 s has somewhere to come back from.
  await expect(page.locator('[data-focus-key="player-fwd10"]')).toHaveAttribute(
    'aria-label',
    'Forward 10 s',
  );
  await page.waitForTimeout(300);
  expect(await seeks()).toBe(0);
  await expect.poll(seeks, { timeout: 2000 }).toBe(1);
  // To the oldest moment kept, and on from there as it plays.
  await expect.poll(async () => (await video(page)).time).toBeLessThan(live - 3);
  await page.waitForTimeout(1000);
  expect(await seeks()).toBe(1);
  await press(page, 'ArrowRight', 'player-play');
  await press(page, 'ArrowRight', 'player-fwd10');
  await expect(page.locator('[data-focus-key="player-fwd10"]')).toHaveAttribute(
    'aria-label',
    'Forward 10 s',
  );
  const behind = (await video(page)).time;
  await page.keyboard.press('Enter');
  await expect.poll(seeks, { timeout: 2000 }).toBe(2);
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(behind + 5);
  // Never past live: playing live, it has nowhere further to go.
  await expect(page.locator('[data-focus-key="player-fwd10"]')).toHaveAttribute(
    'aria-label',
    'Forward 10 s. Playing live',
  );
  await pressBack(page);
  await pressBack(page);
  await expectFocus(page, 'details-watch');
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveText('Watch');
  const saved = ((await readKv(page, 'progress')) ?? []) as Array<{ videoId: string }>;
  expect(saved.map((entry) => entry.videoId)).not.toContain(MOVIE);
});

test('behind a broadcast, LIVE goes grey with how far behind, and Go to live comes back to it', async ({
  page,
}) => {
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
  const seekBar = page.locator('[data-focus-key="player-seek"]');
  const goToLive = page.locator('[data-focus-key="player-live"]');
  const forward = page.locator('[data-focus-key="player-fwd10"]');
  const behindTime = seekBar.locator('> span').last();

  // Playing live: Go to live takes Next episode's place, dimmed, as Forward 10 s is.
  await expect(goToLive).toHaveAttribute('aria-label', 'Go to live. Playing live', {
    timeout: 10000,
  });
  await press(page, 'ArrowUp', 'player-play');
  await expect(seekBar).toHaveAttribute('aria-valuetext', 'Playing live');
  await expect(behindTime).toHaveText('');
  await expect(forward).toHaveAttribute('aria-label', 'Forward 10 s. Playing live');
  await expect(page.locator('[class*="liveBehind"]')).toHaveCount(0);

  // Back 10 s: behind live, and the controls say by how much.
  const seeks = await countSeeks(page);
  await press(page, 'ArrowLeft', 'player-back10');
  await page.keyboard.press('Enter');
  await expect.poll(seeks, { timeout: 2000 }).toBe(1);
  await expect(seekBar).toHaveAttribute('aria-valuetext', /^0:0\d behind live$/);
  await expect(behindTime).toHaveText(/^−0:0\d$/);
  await expect(page.locator('[class*="liveBehind"]')).toHaveText('LIVE');
  await expect(goToLive).toHaveAttribute('aria-label', 'Go to live');
  await expect(forward).toHaveAttribute('aria-label', 'Forward 10 s');

  // Go to live, from where Next episode would be. A rewind still to land gives way to it.
  await press(page, 'ArrowRight', 'player-play');
  await press(page, 'ArrowRight', 'player-fwd10');
  await press(page, 'ArrowRight', 'player-live');
  const behind = (await video(page)).time;
  await pressCode(page, REWIND);
  await page.keyboard.press('Enter');
  await expectSeekAtOnce(seeks, 2, OK);
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(behind + 3);
  await expect(seekBar).toHaveAttribute('aria-valuetext', 'Playing live');
  await expect(behindTime).toHaveText('');
  await expect(goToLive).toHaveAttribute('aria-label', 'Go to live. Playing live');
  await expect(page.locator('[class*="liveBehind"]')).toHaveCount(0);
  // Dimmed now, it does nothing, and the rewind never lands.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  expect(await seeks()).toBe(2);
  await expect(seekBar).toHaveAttribute('aria-valuetext', 'Playing live');

  // The pointer: the bar is what the broadcast keeps, the time over it how
  // far behind live a click lands, and the click goes there.
  await page.mouse.move(900, 500);
  const bar = seekBar.locator('> div');
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + box.height / 2, { steps: 3 });
  await expectFocus(page, 'player-seek');
  await expect(bar.getByText(/^−0:0\d$/)).toBeVisible();
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await expectSeekAtOnce(seeks, 3, 'click');
  await expect(seekBar).toHaveAttribute('aria-valuetext', /^0:0\d behind live$/);
  // The right end is live: a click there goes to live, and playing live does nothing.
  await page.mouse.click(box.x + box.width, box.y + box.height / 2);
  await expectSeekAtOnce(seeks, 4, 'click');
  await expect(seekBar).toHaveAttribute('aria-valuetext', 'Playing live');
  await page.waitForTimeout(1000);
  await page.mouse.click(box.x + box.width, box.y + box.height / 2);
  await page.waitForTimeout(500);
  expect(await seeks()).toBe(4);
  await expect(seekBar).toHaveAttribute('aria-valuetext', 'Playing live');
});

test('on a broadcast, Left and Right with the controls hidden add up behind live and land once', async ({
  page,
}) => {
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
  const goToLive = page.locator('[data-focus-key="player-live"]');
  await expect(goToLive).toHaveAttribute('aria-label', 'Go to live. Playing live', {
    timeout: 10000,
  });
  const note = page.locator('[class*="skipNote"]');
  const seeks = await countSeeks(page);

  // Playing live, Right has nowhere to go, and says so.
  await page.keyboard.press('ArrowRight');
  await expect(note).toHaveText('Playing live');
  await page.waitForTimeout(1200);
  expect(await seeks()).toBe(0);

  // Left twice: one total, never further back than the broadcast keeps (10 s
  // here, so it stops short of 20), how far behind live it lands, and nothing moves yet.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(note.getByText(/^−\d s$/)).toBeVisible();
  await expect(note.getByText(/^0:0\d behind live$/)).toBeVisible();
  await page.waitForTimeout(300);
  expect(await seeks()).toBe(0);
  await expectFocus(page, 'player-surface');
  // It lands once, a moment after the last press, and the controls stay hidden.
  await expect.poll(seeks, { timeout: 2000 }).toBe(1);
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
  await expect(goToLive).toHaveAttribute('aria-label', 'Go to live');

  // Right twice comes back to live: it goes to live, once.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(note.getByText('Playing live', { exact: true })).toBeVisible();
  await expect.poll(seeks, { timeout: 2000 }).toBe(2);
  await expect(goToLive).toHaveAttribute('aria-label', 'Go to live. Playing live', {
    timeout: 5000,
  });
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
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'Enter', 'player-tracks-off');
  const focused = page.locator('[data-focused="true"]');
  // Down past English to the Korean check.
  for (let step = 0; step < 8; step++) {
    if ((await focused.getAttribute('data-focus-key')) === 'player-tracks-lang-ko') break;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
  }
  await expectFocus(page, 'player-tracks-lang-ko');
  await press(page, 'Enter', 'player-tracks-lang-ko');
  await expect(page.getByText('Subtitle check in Korean')).toBeVisible();
  // Its version names the Demo and the release name it sends.
  await page.keyboard.press('ArrowRight');
  await expect(focused).toContainText('BannerTV Demo');
  await expect(focused).toContainText('Subtitle check');

  await pressBack(page);
  await expectFocus(page, 'player-tracks-tab-subtitles');
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
const OK = 13;

/** A skip lands by itself this long after its last press: SCRUB_COMMIT_MS in PlayerScreen.tsx. */
const SKIP_LANDS_MS = 800;

/** A remote key by its keyCode, or 'click' for the pointer going down. */
type Input = number | 'click';
type SeekWindow = Window & { seekInputs?: Array<[Input, number]> };
type SeekVideo = HTMLVideoElement & { seekTimes?: number[] };

/** The player's seeks since countSeeks. */
interface Seeks {
  /** How many have begun. */
  (): Promise<number>;
  /** How long the `nth` began after the last `input` before it, in ms by the page's clock. */
  after(nth: number, input: Input): Promise<number>;
}

/** Counts the player's seeks from now on, and keeps when each began and each key or click went down. */
async function countSeeks(page: Page): Promise<Seeks> {
  const video = page.locator('video:not([aria-hidden])');
  await video.evaluate((element: SeekVideo) => {
    const w = window as SeekWindow;
    if (!w.seekInputs) {
      const inputs: Array<[Input, number]> = (w.seekInputs = []);
      // On the window, capturing: it hears each key and click before the app can stop it.
      window.addEventListener(
        'keydown',
        (event) => inputs.push([event.keyCode, performance.now()]),
        true,
      );
      window.addEventListener('pointerdown', () => inputs.push(['click', performance.now()]), true);
    }
    const times: number[] = (element.seekTimes = []);
    element.dataset.seeks = '0';
    element.addEventListener('seeking', () => {
      times.push(performance.now());
      element.dataset.seeks = String(Number(element.dataset.seeks) + 1);
    });
  });
  const seeks = (() =>
    video.evaluate((element: HTMLVideoElement) => Number(element.dataset.seeks))) as Seeks;
  seeks.after = (nth, input) =>
    video.evaluate(
      (element: SeekVideo, [index, wanted]) => {
        const began = element.seekTimes?.[index] ?? NaN;
        const before = ((window as SeekWindow).seekInputs ?? []).filter(
          ([what, at]) => what === wanted && at <= began,
        );
        return began - (before[before.length - 1]?.[1] ?? NaN);
      },
      [nth - 1, input] as const,
    );
  return seeks;
}

/**
 * Waits for the player's `nth` seek, and checks it began at once after `since`, the press that
 * asked for it: sooner than a skip lands by itself. Timed in the page, so slow round trips on
 * a busy runner cannot fail a seek that came at once, and one that waited for the skip delay
 * still fails.
 */
async function expectSeekAtOnce(seeks: Seeks, nth: number, since: Input): Promise<void> {
  await expect.poll(seeks).toBe(nth);
  expect(await seeks.after(nth, since)).toBeLessThan(SKIP_LANDS_MS);
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

  // OK lands a skip there and then, well before it would land by itself, and leaves the film playing.
  await pressCode(page, FAST_FORWARD);
  await page.keyboard.press('Enter');
  await expectSeekAtOnce(seeks, 3, FAST_FORWARD);
  await page.waitForTimeout(1000);
  expect(await seeks()).toBe(3);
  expect((await video(page)).playing).toBe(true);
  await expectControlsHidden(page);
});

test('the wheel never skips: a notch brings the controls up on Pause, and with them up it moves a row', async ({
  page,
}) => {
  await playMovie(page);
  const seeks = await countSeeks(page);
  const play = page.locator('[data-focus-key="player-play"]');

  // Hidden, a notch brings them up on Pause, as Up and Down do, and the TV's own focus goes there too.
  // The rest of the same roll stays there, however long it goes on: a quick roll on the TV takes half
  // a second or more, in flicks with a quarter of a second between them.
  await page.evaluate(async () => {
    const under = document.elementFromPoint(960, 540);
    for (let notch = 0; notch < 16; notch++) {
      under?.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, notch % 5 === 4 ? 300 : 40));
    }
  });
  await expectFocus(page, 'player-play');
  await expect(play).toBeFocused();
  // Rested, a notch is a row, down to the tools and up to the bar, where it stops, as Up does.
  await page.waitForTimeout(600);
  expect(await focusedKey(page)).toBe('player-play');
  await page.mouse.wheel(0, 100);
  await expectFocus(page, 'player-tracks-button');
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -100);
  await expectFocus(page, 'player-play');
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -100);
  await expectFocus(page, 'player-seek');
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(200);
  expect(await focusedKey(page)).toBe('player-seek');

  // Away from the viewer too.
  await pressBack(page);
  await expectFocus(page, 'player-surface');
  await expect(play).toBeHidden();
  await page.mouse.wheel(0, -100);
  await expectFocus(page, 'player-play');

  // Brought up by the pointer, the controls leave focus on the picture, and a notch takes it to Pause.
  await pressBack(page);
  await expect(play).toBeHidden();
  await page.mouse.move(900, 400);
  await page.mouse.move(960, 420, { steps: 3 });
  await expect(page.locator('html')).toHaveClass(/pointer-mode/);
  await expect(play).toBeVisible();
  expect(await focusedKey(page)).toBe('player-surface');
  await page.mouse.wheel(0, 100);
  await expectFocus(page, 'player-play');
  // A click is then Pause's, where the wheel put focus, even with the pointer on the picture: on the TV
  // the Magic Remote's OK is a click alone while the pointer shows.
  await page.mouse.click(960, 420);
  await expect.poll(async () => (await video(page)).playing).toBe(false);
  await page.waitForTimeout(300);
  expect(await play.isVisible()).toBe(true);
  expect(await focusedKey(page)).toBe('player-play');

  // The same after a notch with the controls hidden and the pointer moved before it.
  await page.mouse.move(980, 430, { steps: 2 });
  await pressBack(page);
  await expect(play).toBeHidden();
  await page.mouse.wheel(0, 100);
  await expectFocus(page, 'player-play');
  await page.mouse.click(980, 430);
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await page.waitForTimeout(300);
  expect(await play.isVisible()).toBe(true);
  expect(await focusedKey(page)).toBe('player-play');
  // Not one skip all along.
  expect(await seeks()).toBe(0);
});

test('a roll of the wheel longer than the controls stay up for keeps them up, on Pause', async ({
  page,
}) => {
  await playMovie(page);
  // Seven seconds of flicks, the controls hiding after five without a press.
  const seen = await page.evaluate(async () => {
    const under = document.elementFromPoint(960, 540);
    const focused: string[] = [];
    for (let notch = 0; notch < 40; notch++) {
      under?.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, notch % 5 === 4 ? 300 : 120));
      focused.push(
        document.querySelector('[data-focused="true"]')?.getAttribute('data-focus-key') ?? '',
      );
    }
    return focused;
  });
  expect(seen.slice(1).filter((key) => key !== 'player-play')).toEqual([]);
  await expectFocus(page, 'player-play');
});

test('Sources comes over the film, which plays on, and Back from All streams goes back to it where it was', async ({
  page,
}) => {
  await playMovie(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(15);
  const src = (await video(page)).src;

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  // On the stream playing, ticked, with the addon, the release and its facts.
  await press(page, 'Enter', source(0));
  const sheet = page.getByRole('dialog', { name: 'Sources' });
  await expect(sheet).toContainText('3 streams');
  await expect(page.locator(`[data-focus-key="${source(0)}"]`)).toHaveAttribute(
    'aria-label',
    'Test Streams. Open Movie 1080p WEB-DL x264. 1080p, 1.4 GB, Cached. Playing now',
  );
  await expect(page.locator(`[data-focus-key="${source(1)}"]`)).toContainText('700 MB');
  expect((await video(page)).playing).toBe(true);
  expect((await video(page)).src).toBe(src);

  // Back closes it onto its chip; the film never stopped.
  await pressBack(page);
  await expect(sheet).toHaveCount(0);
  await expectFocus(page, 'player-streams-button');
  expect((await video(page)).playing).toBe(true);

  // The playing stream again: the sheet just closes.
  await press(page, 'Enter', source(0));
  await press(page, 'Enter', 'player-surface');
  await expect(sheet).toHaveCount(0);
  expect((await video(page)).src).toBe(src);

  // All streams is in its header, and Back from it goes back to the film where it was.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'Enter', source(0));
  await press(page, 'ArrowUp', 'player-sources-all');
  await press(page, 'ArrowLeft', 'player-sources-sort');
  await press(page, 'ArrowRight', 'player-sources-all');
  const at = (await video(page)).time;
  await press(page, 'Enter', 'streams-item-0');
  await pressBack(page);
  await expectFocus(page, 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).src).toBe(src);
  expect((await video(page)).time).toBeGreaterThan(at - 2);

  // Back from the film still leaves for the title it was opened from.
  await pressBack(page);
  await expectFocus(page, 'details-watch');
});

test('a stream picked in Sources plays from where the film was, and one that fails stops at the problem box', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    broken: ['/movie-480p.webm'],
    streams: {
      [MOVIE]: [
        DEFAULT_STREAMS[0]!,
        DEFAULT_STREAMS[1]!,
        {
          name: 'Test Streams\n480p',
          description: 'Open Movie 480p\n💾 300 MB',
          path: '/movie-480p.webm',
        },
        {
          name: 'Test Streams\n360p',
          description: 'Open Movie 360p\n💾 200 MB',
          path: '/movie-360p.webm',
        },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(15);

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'Enter', source(0));
  await press(page, 'ArrowDown', source(1));
  // It answers late, so the note shows while it opens.
  await page.route(`${MEDIA_HOST}/movie-720p.webm`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
  });
  const at = (await video(page)).time;
  await press(page, 'Enter', 'player-surface');
  await expect(page.getByText('Switching to another stream…')).toBeVisible();
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).time).toBeGreaterThan(at - 2);

  // Picked by hand, a stream that fails is not swapped for another behind the viewer's back.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'Enter', source(1));
  await press(page, 'ArrowDown', source(2));
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focus-key="player-problem-another"]')).toBeVisible();
  expect((await video(page)).src).not.toBe('/movie-360p.webm');
});

test('in Sources, rows keep their places as a late addon answers, Sort is kept for All streams, and a click picks', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, { slowAddon: true });
  const mock = await mockPlayback(page);
  // The slow addon answers only once the sheet is open, with a release that ranks first.
  let answer = () => undefined as void;
  const gate = new Promise<void>((done) => (answer = done));
  await page.route(/^https:\/\/slow\.example\.com\/bannertv\/stream\//, async (route) => {
    await gate;
    mock.slowAnswers++;
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        streams: [
          {
            name: 'Slow Streams\n1080p',
            description: 'Open Movie 1080p BluRay REMUX\n💾 1.6 GB ⚡ Cached',
            url: `${MEDIA_HOST}/movie-1080p-remux.webm`,
            behaviorHints: { filename: 'movie-1080p-remux.webm' },
          },
        ],
      }),
    });
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'Enter', source(0));
  const sheet = page.getByRole('dialog', { name: 'Sources' });
  await expect(sheet).toContainText('Asking 1 addon…');
  // Once the sheet has risen.
  await page.waitForTimeout(500);
  const playing = page.locator(`[data-focus-key="${source(0)}"]`);
  const where = (await playing.boundingBox())!;

  // Its remux ranks first, but the rows shown stay put: it goes after them.
  answer();
  await expect.poll(() => mock.slowAnswers).toBe(1);
  await expect(sheet).toContainText('4 streams');
  const late = page.locator('[data-focus-key$=":org.bannertv.slow-streams#0"]');
  expect(await playing.boundingBox()).toEqual(where);
  await expectFocus(page, source(0));
  expect((await late.boundingBox())!.y).toBeGreaterThan(
    (await page.locator(`[data-focus-key="${source(1)}"]`).boundingBox())!.y,
  );

  // Sort goes round the orders, and All streams keeps the one chosen.
  await press(page, 'ArrowUp', 'player-sources-all');
  await press(page, 'ArrowLeft', 'player-sources-sort');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focus-key="player-sources-sort"]')).toHaveText(
    'Sort: Fastest start',
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('bannertv.preferences') ?? '{}').allStreamsOrder,
    ),
  ).toBe('fast');

  // The pointer over a row takes focus, and a click plays it (well after that OK,
  // which a click would otherwise be part of).
  await page.waitForTimeout(500);
  const row = page.locator(`[data-focus-key="${source(1)}"]`);
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 40, { steps: 5 });
  await expectFocus(page, source(1));
  await expect(sheet).toBeVisible();
  await page.mouse.click(box.x + 300, box.y + 40);
  await expect(sheet).toHaveCount(0);
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
});

for (const [list, streams] of [
  ['a list that fills the sheet', DEFAULT_STREAMS],
  // Two rows of three: the view must not settle back to the top.
  ['a list shorter than the sheet', [DEFAULT_STREAMS[1]!, DEFAULT_STREAMS[2]!]],
] as const) {
  test(`in Sources, the row under a resting pointer stays under it as a late addon answers above it, on ${list}`, async ({
    page,
  }) => {
    await mockAddons(page);
    await seedStreamAddon(page, { slowAddon: true });
    const mock = await mockPlayback(page, { streams: { [MOVIE]: streams } });
    let answer = () => undefined as void;
    const gate = new Promise<void>((done) => (answer = done));
    await page.route(/^https:\/\/slow\.example\.com\/bannertv\/stream\//, async (route) => {
      await gate;
      mock.slowAnswers++;
      await route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          streams: [
            {
              name: 'Slow Streams\n1080p',
              description: 'Open Movie 1080p BluRay REMUX\n💾 1.6 GB ⚡ Cached',
              url: `${MEDIA_HOST}/movie-1080p-remux.webm`,
              behaviorHints: { filename: 'movie-1080p-remux.webm' },
            },
          ],
        }),
      });
    });
    await openMovie(page);
    await press(page, 'Enter', 'player-surface');
    await expect.poll(async () => (await video(page)).playing).toBe(true);
    const playing = (await video(page)).src;
    await press(page, 'ArrowUp', 'player-play');
    await press(page, 'ArrowDown', 'player-tracks-button');
    await press(page, 'ArrowRight', 'player-quality-button');
    await press(page, 'ArrowRight', 'player-streams-button');
    await press(page, 'Enter', source(0));
    const sheet = page.getByRole('dialog', { name: 'Sources' });
    await page.waitForTimeout(500);

    // The pointer rests on the P2P row, last, as one that can't play here.
    const p2p = page.locator(`[data-focus-key="${source(streams.length - 1)}"]`);
    const box = (await p2p.boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + 40, { steps: 5 });
    await expectFocus(page, source(streams.length - 1));
    // Off the side of the list and back, passing no other row: it holds the row again.
    await page.mouse.move(box.x + box.width + 40, box.y + 40, { steps: 5 });
    await page.mouse.move(box.x + 300, box.y + 40, { steps: 5 });
    await expectFocus(page, source(streams.length - 1));

    // The remux goes above it, among those that play, and the view moves with it.
    answer();
    await expect(sheet).toContainText(`${streams.length + 1} streams`);
    expect(await p2p.boundingBox()).toEqual(box);
    await expectFocus(page, source(streams.length - 1));
    // So a click presses the row pointed at, not the one that came in.
    await page.mouse.click(box.x + 300, box.y + 40);
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500);
    expect(mock.media).not.toContain('/movie-1080p-remux.webm');
    expect((await video(page)).src).toBe(playing);

    // Away from the list, it no longer holds a row in place: one that fits
    // the sheet shows every row again, the stream playing first.
    const list = (await p2p.locator('xpath=../..').boundingBox())!;
    await page.mouse.move(box.x + 300, 60, { steps: 5 });
    await expect(sheet).toBeVisible();
    const first = page.locator(`[data-focus-key="${source(0)}"]`);
    if (streams.length + 1 <= 3) {
      await expect.poll(async () => (await first.boundingBox())!.y).toBe(list.y);
    }
  });
}

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
  await press(page, 'ArrowLeft', 'player-back10');
  await press(page, 'ArrowLeft', 'player-restart');
  // A skip still to land gives way to Start over.
  await pressCode(page, FAST_FORWARD);
  await press(page, 'Enter', 'player-restart');
  await expect.poll(async () => (await video(page)).time).toBeLessThan(5);
  await expect(restart).toHaveText(/^Back to 0:[12]\d$/);
  await page.waitForTimeout(1000);
  expect((await video(page)).time).toBeLessThan(5);

  // The controls stay up while it offers to go back, past their usual 5 s.
  await page.waitForTimeout(4500);
  expect(await focusedKey(page)).toBe('player-restart');
  expect(await restart.textContent()).toMatch(/^Back to 0:[12]\d$/);
  await press(page, 'Enter', 'player-restart');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(15);
  await expect(restart).toHaveText('Start over');
  expect((await video(page)).playing).toBe(true);

  // The offer goes after 8 s.
  await press(page, 'Enter', 'player-restart');
  await expect(restart).toHaveText(/^Back to /);
  await page.waitForTimeout(8500);
  expect(await restart.textContent()).toBe('Start over');
  // Under 10 s in, there is nothing worth going back to.
  expect((await video(page)).time).toBeLessThan(10);
  await press(page, 'Enter', 'player-restart');
  await page.waitForTimeout(300);
  expect(await restart.textContent()).toBe('Start over');
});

test('Blue opens and closes audio and subtitles, which stay open while the film plays on, and Style shows each choice on a sample line', async ({
  page,
}) => {
  await playMovie(page);
  const focused = page.locator('[data-focused="true"]');
  const panel = page.getByRole('dialog', { name: 'Audio & subtitles' });

  // From anywhere, with the controls hidden. Held down, it does not close again.
  await pressCode(page, BLUE);
  await pressCode(page, BLUE, true);
  await expect(panel).toBeVisible();
  await expect(focused).toHaveAttribute('data-focus-key', /^player-tracks-/);
  await pressCode(page, BLUE);
  await expect(panel).toHaveCount(0);
  await expectFocus(page, 'player-surface');
  // Opened with the controls hidden, Back twice closes it onto them, and they show.
  await pressCode(page, BLUE);
  await expect(panel).toBeVisible();
  await pressBack(page);
  await expect(focused).toHaveAttribute('data-focus-key', /^player-tracks-tab-/);
  await pressBack(page);
  await expect(panel).toHaveCount(0);
  await expectFocus(page, 'player-tracks-button');
  await expect(page.locator('[data-focus-key="player-tracks-button"]')).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'player-surface');

  // Opened from the controls, the panel outlasts their 5 s, a skip included.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await pressCode(page, FAST_FORWARD);
  await expect(page.getByText('+10 s', { exact: true })).toBeVisible();
  await page.waitForTimeout(5500);
  await expect(panel).toBeVisible();
  await expect(focused).toHaveAttribute('data-focus-key', /^player-tracks-/);

  // So it does with the Magic Remote pointer resting over it, coming from the
  // picture above. The controls make way for it, and come back after.
  const box = (await panel.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(500);
  await page.mouse.move(300, box.y - 40);
  await page.mouse.move(300, box.y + 220, { steps: 3 });
  await page.waitForTimeout(6000);
  expect(await panel.isVisible()).toBe(true);
  expect(await focusedKey(page)).toMatch(/^player-tracks-/);
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('cursorStateChange', { detail: { visibility: false } })),
  );

  // Style: every choice a sample, and a sample line above the sheet while nobody speaks.
  await pressBack(page);
  await expect(focused).toHaveAttribute('data-focus-key', /^player-tracks-tab-/);
  for (let step = 0; step < 4; step++) {
    if ((await focused.getAttribute('data-focus-key')) === 'player-tracks-tab-style') break;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
  }
  await expectFocus(page, 'player-tracks-tab-style');
  const sample = page.getByText('This is how subtitles will look.');
  await expect(sample).toBeVisible();
  const tab = page.locator('[data-focus-key="player-tracks-tab-style"]');
  await expect(tab).toContainText('Medium, white');
  await press(page, 'ArrowDown', 'player-tracks-style-size-medium');
  await press(page, 'ArrowRight', 'player-tracks-style-size-large');
  await page.keyboard.press('Enter');
  await expect(tab).toContainText('Large, white');
  await expect.poll(() => sample.evaluate((line) => getComputedStyle(line).fontSize)).toBe('64px');
  // The line sits just above the sheet.
  const line = (await sample.boundingBox())!;
  expect(line.y + line.height).toBeLessThanOrEqual(box.y);
  await press(page, 'ArrowDown', 'player-tracks-style-colour-white');
  await press(page, 'ArrowRight', 'player-tracks-style-colour-yellow');
  await page.keyboard.press('Enter');
  await expect(tab).toContainText('Large, yellow');
  // Back to the tabs, then the sheet closes onto the controls, and the sample goes.
  await pressBack(page);
  await expectFocus(page, 'player-tracks-tab-style');
  await pressBack(page);
  await expect(panel).toHaveCount(0);
  await expectFocus(page, 'player-tracks-button');
  await expect(sample).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('bannertv.preferences'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({
    subtitleStyle: { size: 'large', colour: 'yellow' },
  });
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

  await press(page, 'ArrowDown', 'player-tracks-button');
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
  // Well after the OK that started the film, whose click the one on the bar would
  // otherwise be (a click within 400 ms of an OK is that OK's): half a second played.
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(0.5);
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

test('an arrow takes the time off the bar, and only a move over the bar brings it back', async ({
  page,
}) => {
  await playMovie(page);
  await page.mouse.move(900, 500);
  await page.mouse.move(960, 540, { steps: 3 });
  const bar = page.locator('[data-focus-key="player-seek"] > div');
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await expectFocus(page, 'player-seek');
  await expect(bar.getByText('0:20', { exact: true })).toBeVisible();

  // Down hides the pointer where it rests, so no mouseleave comes: the time goes anyway.
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focusedKey(page)).not.toBe('player-seek');
  await expect(bar.locator('span')).toHaveCount(0);

  // The TV can show the pointer again before it moves: the old time stays off.
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('cursorStateChange', { detail: { visibility: true } })),
  );
  await expect(page.locator('html')).toHaveClass(/pointer-mode/);
  await page.waitForTimeout(300);
  await expect(bar.locator('span')).toHaveCount(0);

  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 3 });
  await expect(bar.getByText('0:10', { exact: true })).toBeVisible();
});

test('the controls are two rows, the transport over the tools, with the time left, the clock and when it ends', async ({
  page,
}) => {
  await playMovie(page);
  await press(page, 'ArrowUp', 'player-play');
  const transport = ['player-restart', 'player-back10', 'player-play', 'player-fwd10'];
  const names = ['Start over', 'Back 10 s', 'Pause', 'Forward 10 s'];
  for (const [index, key] of transport.entries()) {
    // The name is under the icon, and is what Audio Guidance reads.
    const button = page.locator(`[data-focus-key="${key}"]`);
    await expect(button).toHaveAttribute('aria-label', names[index]!);
    await expect(button.getByText(names[index]!, { exact: true })).toBeVisible();
  }
  // A film has no Next episode, and nothing takes its place.
  await expect(page.locator('[data-focus-key="player-next"]')).toHaveCount(0);
  await press(page, 'ArrowLeft', 'player-back10');
  await press(page, 'ArrowLeft', 'player-restart');
  await page.keyboard.press('ArrowLeft');
  await expectFocus(page, 'player-restart');
  await press(page, 'ArrowRight', 'player-back10');
  await press(page, 'ArrowRight', 'player-play');
  await press(page, 'ArrowRight', 'player-fwd10');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'player-fwd10');

  // Down from anywhere on the transport reaches the first tool, and Up from any tool reaches Pause.
  await press(page, 'ArrowDown', 'player-tracks-button');
  await page.keyboard.press('ArrowLeft');
  await expectFocus(page, 'player-tracks-button');
  // Each chip says what is on now, and Audio Guidance reads it with the name.
  const tracks = page.locator('[data-focus-key="player-tracks-button"]');
  await expect(tracks).toContainText('Audio & subtitles');
  await expect(tracks).toContainText('Subtitles off');
  await expect(tracks).toHaveAttribute('aria-label', 'Audio & subtitles, Subtitles off');
  await expect(page.locator('[data-focus-key="player-quality-button"]')).toHaveAttribute(
    'aria-label',
    'Quality, 1080p',
  );
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await expect(page.locator('[data-focus-key="player-streams-button"]')).toHaveText('Sources');
  // A film has no Episodes.
  await expect(page.locator('[data-focus-key="player-episodes-button"]')).toHaveCount(0);
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowUp', 'player-seek');
  await press(page, 'ArrowDown', 'player-play');

  // The time played, the bar and the time left; the clock, and when the film would end.
  const seek = page.locator('[data-focus-key="player-seek"]');
  await expect(seek.locator('> span').first()).toHaveText(/^0:\d\d$/);
  await expect(seek.locator('> span').last()).toHaveText(/^−0:[1-3]\d$/);
  // Late in a minute, so an end counted from the minute's start would show a minute early:
  // about 35 s of the 40 s film are left.
  await page.clock.setFixedTime(new Date(2026, 9, 30, 20, 15, 58));
  await expect(page.getByText(/^\d\d:\d\d$/)).toHaveText('20:15');
  await expect(page.getByText(/^Ends at /)).toHaveText('Ends at 20:16');
});

test('on a series, Next episode sits after Forward 10 s and plays the next one; on the last it says there is none', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  const mock = await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await press(page, 'ArrowUp', 'details-season-0');
  await press(page, 'ArrowRight', 'details-season-1');
  await press(page, 'ArrowDown', 'details-episodes-0');
  await press(page, 'ArrowDown', 'details-episodes-1');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-fwd10');
  await press(page, 'ArrowRight', 'player-next');
  const next = page.locator('[data-focus-key="player-next"]');
  await expect(next).toHaveAttribute('aria-label', 'Next episode');
  await page.keyboard.press('Enter');
  await expect.poll(() => mock.streams).toContain('series/tt8000001:2:3');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  // Season 2 episode 3 is the last: Next episode stays, dimmed, and does nothing.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-fwd10');
  await press(page, 'ArrowRight', 'player-next');
  await expect(next).toHaveAttribute('aria-label', 'Next episode. Last episode');
  await expect(next).toContainText('Last episode');
  const asked = mock.streams.length;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect(mock.streams.length).toBe(asked);
  await expectFocus(page, 'player-next');
  expect((await video(page)).playing).toBe(true);
});

/** Plays the series' first episode from its page, as the viewer would. */
/** `opensAt`: the episode Details opens on, the one after the furthest Trakt ticks. */
async function playFirstEpisode(page: Page, opensAt = 0) {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', `details-episodes-${opensAt}`);
  for (let index = opensAt - 1; index >= 0; index--) {
    await press(page, 'ArrowUp', `details-episodes-${index}`);
  }
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
}

async function openEpisodes(page: Page, focusKey: string) {
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'ArrowRight', 'player-episodes-button');
  await press(page, 'Enter', focusKey);
}

test('Episodes opens on the episode playing, says where each one is, and plays another from the same release', async ({
  page,
}) => {
  await mockAddons(page, { upcoming: ['tt8000001:2:3'] });
  await seedStreamAddon(page, { kv: { traktWatched: ['tt8000001:1:2'] } });
  const mock = await mockPlayback(page);
  // Details opens on the episode after the one Trakt ticks.
  await playFirstEpisode(page, 2);

  // The 720p release, picked in Quality: auto-play chooses 1080p.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'Enter', 'player-quality-0');
  await press(page, 'ArrowDown', 'player-quality-1');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(3);

  // Over the picture, which plays on: the series, and the focused episode's story.
  await openEpisodes(page, 'player-episodes-ep-0');
  const sheet = page.getByRole('dialog', { name: 'Episodes' });
  await expect(sheet).toContainText('Morevna Project');
  await expect(sheet).toContainText('What happens in season 1, episode 1.');
  await expect(page.locator('[data-focus-key="player-episodes-ep-0"]')).toHaveAttribute(
    'aria-label',
    '1. Season 1 episode 1, Playing now',
  );
  await expect(page.locator('[data-focus-key="player-episodes-season-1"]')).toHaveAttribute(
    'aria-label',
    'Season 1, 8 episodes',
  );
  expect((await video(page)).playing).toBe(true);
  // Watched on Trakt, so ticked here too.
  await press(page, 'ArrowDown', 'player-episodes-ep-1');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'aria-label',
    '2. Season 1 episode 2, Watched',
  );
  await expect(sheet).toContainText('What happens in season 1, episode 2.');

  // Left to the seasons, on the one playing; down a season shows its episodes beside it.
  await press(page, 'ArrowLeft', 'player-episodes-season-1');
  await press(page, 'ArrowDown', 'player-episodes-season-2');
  await expect(page.locator('[data-focus-key="player-episodes-ep-2"]')).toHaveAttribute(
    'aria-label',
    /^3\. Season 2 episode 3, Coming /,
  );
  await press(page, 'ArrowRight', 'player-episodes-ep-0');
  // One not out yet says when, and does nothing.
  await press(page, 'ArrowDown', 'player-episodes-ep-1');
  await press(page, 'ArrowDown', 'player-episodes-ep-2');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await expectFocus(page, 'player-episodes-ep-2');
  expect(mock.streams).not.toContain('series/tt8000001:2:3');

  // Another plays from the release playing: auto-play would pick 1080p again.
  await press(page, 'ArrowUp', 'player-episodes-ep-1');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(() => mock.streams).toContain('series/tt8000001:2:2');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).src).toBe('/movie-720p.webm');
  await expect(sheet).toHaveCount(0);

  // The one left part way says how much is left, with a bar.
  await openEpisodes(page, 'player-episodes-ep-1');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'aria-label',
    '2. Season 2 episode 2, Playing now',
  );
  await press(page, 'ArrowLeft', 'player-episodes-season-2');
  await press(page, 'ArrowUp', 'player-episodes-season-1');
  await press(page, 'ArrowRight', 'player-episodes-ep-0');
  const first = page.locator('[data-focus-key="player-episodes-ep-0"]');
  await expect(first).toHaveAttribute('aria-label', '1. Season 1 episode 1, 1 minute left');
  await expect(first.locator('span > span')).toHaveCount(1);

  // Back closes onto the chip it was opened from, and the episode plays on.
  await pressBack(page);
  await expect(sheet).toHaveCount(0);
  await expectFocus(page, 'player-episodes-button');
  expect((await video(page)).playing).toBe(true);
});

test('with the pointer, passing over a season changes nothing, a click shows it, and a click above closes', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  const mock = await mockPlayback(page);
  await playFirstEpisode(page);
  await openEpisodes(page, 'player-episodes-ep-0');
  // Once the sheet has risen, and well after the OK that opened it.
  await page.waitForTimeout(500);

  const second = page.locator('[data-focus-key="player-episodes-season-2"]');
  const box = (await second.boundingBox())!;
  await page.mouse.move(1500, 300);
  await page.mouse.move(box.x + 100, box.y + 30, { steps: 8 });
  await expectFocus(page, 'player-episodes-season-2');
  // Still season 1's eight episodes beside it.
  await expect(page.locator('[data-focus-key="player-episodes-ep-0"]')).toHaveAttribute(
    'aria-label',
    '1. Season 1 episode 1, Playing now',
  );
  await page.mouse.click(box.x + 100, box.y + 30);
  const episode = page.locator('[data-focus-key="player-episodes-ep-0"]');
  await expect(episode).toHaveAttribute('aria-label', '1. Season 2 episode 1');
  // The pointer stays where it was clicked: focus does not jump to the episodes.
  await expectFocus(page, 'player-episodes-season-2');

  // A click above the sheet closes it; the episode plays on.
  await page.mouse.click(900, 200);
  await expect(page.getByRole('dialog', { name: 'Episodes' })).toHaveCount(0);
  expect((await video(page)).playing).toBe(true);

  // Opened again with a click on its chip, a click on an episode plays it.
  await page.mouse.move(960, 540, { steps: 3 });
  const chip = page.locator('[data-focus-key="player-episodes-button"]');
  await expect(chip).toBeVisible();
  const where = (await chip.boundingBox())!;
  await page.mouse.move(where.x + where.width / 2, where.y + where.height / 2, { steps: 3 });
  await page.mouse.click(where.x + where.width / 2, where.y + where.height / 2);
  await expect(page.getByRole('dialog', { name: 'Episodes' })).toBeVisible();
  // Once the sheet has risen.
  await page.waitForTimeout(500);
  const row = (await page.locator('[data-focus-key="player-episodes-ep-1"]').boundingBox())!;
  await page.mouse.move(row.x + 200, row.y + 30, { steps: 3 });
  await expectFocus(page, 'player-episodes-ep-1');
  await page.mouse.click(row.x + 200, row.y + 30);
  await expect.poll(() => mock.streams).toContain('series/tt8000001:1:2');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
});

test('Back 10 s and Forward 10 s add up as the skip keys do, and land once', async ({ page }) => {
  await playMovie(page);
  const seeks = await countSeeks(page);
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-fwd10');
  const from = (await video(page)).time;
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // The bar shows where the two will land, then they land as one jump.
  await expect(page.locator('[data-focus-key="player-seek"] > span').first()).toHaveText(/^0:2\d$/);
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(from + 18);
  expect(await seeks()).toBe(1);
  await expectFocus(page, 'player-fwd10');
  expect((await video(page)).playing).toBe(true);

  await press(page, 'ArrowLeft', 'player-play');
  await press(page, 'ArrowLeft', 'player-back10');
  const before = (await video(page)).time;
  await page.keyboard.press('Enter');
  await expect.poll(seeks).toBe(2);
  expect((await video(page)).time).toBeLessThan(before - 8);
  await expectFocus(page, 'player-back10');
});

test('Quality keeps to the language heard, says when a resolution has only another, and offers no clip', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [
        {
          ...DEFAULT_STREAMS[0]!,
          description: 'Open Movie 1080p WEB-DL x264\n🗣 EN\n💾 1.4 GB ⚡ Cached',
        },
        // Ranked before the English 720p, but in Spanish.
        {
          name: 'Test Streams\n720p',
          description: 'Open Movie 720p WEB-DL\n🗣 ES\n💾 700 MB',
          path: '/movie-720p-es.webm',
        },
        {
          name: 'Test Streams\n720p',
          description: 'Open Movie 720p WEBRip\n🗣 EN\n💾 700 MB',
          path: '/movie-720p.webm',
        },
        {
          name: 'Test Streams\n480p',
          description: 'Open Movie 480p WEB-DL\n🗣 ES\n💾 400 MB',
          path: '/movie-480p-es.webm',
        },
        {
          name: 'Test Streams\n360p',
          description: 'Open Movie sample 360p\n💾 5 MB',
          path: '/movie-360p-sample.webm',
        },
      ],
    },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect((await video(page)).src).toBe('/movie-1080p.webm');

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'Enter', 'player-quality-0');
  const labels = await page
    .locator('[data-focus-key^="player-quality-"]:not([data-focus-key="player-quality-button"])')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')));
  expect(labels).toEqual(['1080p', '720p', '480p, Spanish audio']);

  // 720p is the English one, though the Spanish one ranks first.
  await press(page, 'ArrowDown', 'player-quality-1');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).src).toBe('/movie-720p.webm');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
});

test('Quality with one stream found keeps its place, dimmed, says why, and does nothing', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, { streams: { [MOVIE]: [DEFAULT_STREAMS[0]!] } });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  const quality = page.locator('[data-focus-key="player-quality-button"]');
  await expect(quality).toHaveAttribute('aria-label', 'Quality. Only 1080p found');
  await expect(quality).toContainText('Only 1080p found');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectFocus(page, 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
});

test('Info says what plays and what it is over the picture, and OK or Back closes it onto its chip', async ({
  page,
}) => {
  await playMovie(page);
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  // A film has no Episodes: Info comes straight after Sources, last.
  await press(page, 'ArrowRight', 'player-info-button');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'player-info-button');
  await press(page, 'Enter', 'player-info-about');
  const sheet = page.getByRole('dialog', { name: 'Info' });
  const body = page.locator('[data-focus-key="player-info-about"]');
  // The addon's name and the size are back, with how the stream is played.
  await expect(body).toHaveAttribute(
    'aria-label',
    "Elephants Dream. Source, Test Streams. Release, Open Movie 1080p WEB-DL x264. Size, 1.4 GB. Picture, 1080p · H.264. Length, 0:40. Played by, The TV's own player. 2006 · IMDb 7.1 · 15 min · Animation, Short. Elephants Dream is a Blender Studio open project. Starring Proog, Emo",
  );
  await expect(sheet).toContainText('1.4 GB');
  expect((await video(page)).playing).toBe(true);

  // Nothing to choose: OK closes it, as Back does, onto its chip.
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await expect(sheet).toHaveCount(0);
  await expectFocus(page, 'player-info-button');
  await press(page, 'Enter', 'player-info-about');
  await pressBack(page);
  await expect(sheet).toHaveCount(0);
  await expectFocus(page, 'player-info-button');
  expect((await video(page)).playing).toBe(true);
});

test('the tools row fits the screen at its widest: a series, subtitles off, and Quality saying why it has nothing', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      'tt8000001:1:1': [
        { name: 'Test Streams', description: 'Open Movie WEBRip', path: '/movie-other.webm' },
      ],
    },
  });
  await playFirstEpisode(page);
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await expect(page.locator('[data-focus-key="player-quality-button"]')).toContainText(
    'No other quality found',
  );
  await press(page, 'ArrowUp', 'player-play');
  const keys = await page
    .locator('[data-focus-key^="player-"][data-focus-key$="-button"]')
    .evaluateAll((chips) => chips.map((chip) => chip.getAttribute('data-focus-key')));
  expect(keys).toEqual([
    'player-tracks-button',
    'player-quality-button',
    'player-streams-button',
    'player-episodes-button',
    'player-info-button',
  ]);
  // Inside the safe area: 96px from each side of the 1920px screen.
  const info = page.locator('[data-focus-key="player-info-button"]');
  const last = (await info.boundingBox())!;
  expect(last.x + last.width).toBeLessThanOrEqual(1920 - 96);
  // With the sleep timer on, Info says until when, and still fits.
  await openSleepTimer(page, ['quality', 'streams', 'episodes']);
  await press(page, 'ArrowDown', 'player-info-sleep-off');
  await press(page, 'ArrowRight', 'player-info-sleep-15');
  await page.keyboard.press('Enter');
  await pressBack(page);
  await pressBack(page);
  await expectFocus(page, 'player-info-button');
  await expect(info).toHaveAttribute('aria-label', /^Info, Sleep \d\d:\d\d$/);
  const widest = (await info.boundingBox())!;
  expect(widest.x + widest.width).toBeLessThanOrEqual(1920 - 96);
});

/** Repeats a held OK as the remote does, more slowly than navigation's 100 ms throttle, then lets go. */
async function holdOk(page: Page, repeats: number) {
  for (let i = 0; i < repeats; i++) {
    await page.waitForTimeout(150);
    await page.keyboard.down('Enter');
  }
  await page.keyboard.up('Enter');
}

test('a held OK opens a menu and leaves it open, but still repeats on what it went down on', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  // The remote sends a held OK as one press and then its repeats: they must
  // not press the choice the menu opened on, which would close it again.
  await page.keyboard.down('Enter');
  await expectFocus(page, 'player-quality-0');
  await holdOk(page, 3);
  await page.waitForTimeout(300);
  await expectFocus(page, 'player-quality-0');
  await press(page, 'Enter', 'player-quality-button');
  // Held on Forward 10 s, which had focus when it went down, OK keeps adding 10 s.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-fwd10');
  const from = (await video(page)).time;
  await page.keyboard.down('Enter');
  await holdOk(page, 2);
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(from + 28);
});

test('a click on the picture hides the controls and another brings them back; the arrow at the top leaves', async ({
  page,
}) => {
  await playMovie(page);
  const play = page.locator('[data-focus-key="player-play"]');
  await page.mouse.move(900, 400);
  await page.mouse.move(960, 420, { steps: 3 });
  await expect(play).toBeVisible();

  // Well after the OK that started the film, whose click it would be.
  await page.waitForTimeout(500);
  await page.mouse.click(960, 420);
  await expect(play).toBeHidden();
  expect((await video(page)).playing).toBe(true);
  await page.mouse.click(960, 420);
  await expect(play).toBeVisible();
  expect((await video(page)).playing).toBe(true);

  // The Magic Remote OK can come as a key press and a click. Over the picture
  // both are the picture's, once: Pause kept focus but is not pressed.
  await expectFocus(page, 'player-play');
  await page.keyboard.press('Enter');
  await page.mouse.click(960, 420);
  await expect(play).toBeHidden();
  await page.waitForTimeout(300);
  await expect(play).toBeHidden();
  expect((await video(page)).playing).toBe(true);
  await page.keyboard.press('Enter');
  await expect(play).toBeVisible();
  expect((await video(page)).playing).toBe(true);

  // A click on a control, well after that OK, is the control's, not the picture's.
  const seeks = await countSeeks(page);
  await page.waitForTimeout(500);
  const clicked = (await video(page)).time;
  await page.locator('[data-focus-key="player-back10"]').click();
  await expect.poll(seeks).toBe(1);
  // A few seconds in, it goes back to the start.
  expect((await video(page)).time).toBeLessThan(Math.max(1, clicked - 5));
  await expectFocus(page, 'player-back10');
  await expect(play).toBeVisible();

  // With a skip under way, OK over the picture lands it, and Sources, which kept focus, stays put.
  await page.locator('[data-focus-key="player-streams-button"]').hover();
  await expectFocus(page, 'player-streams-button');
  // Straight there, over nothing else on the way.
  await page.mouse.move(960, 420);
  await pressCode(page, FAST_FORWARD);
  await page.keyboard.press('Enter');
  await page.mouse.click(960, 420);
  await expectSeekAtOnce(seeks, 2, FAST_FORWARD);
  await expectFocus(page, 'player-streams-button');
  await expect(play).toBeVisible();

  // After the wheel moved focus, OK is the focused control's even with the pointer on the picture.
  await page.mouse.wheel(0, -100);
  await expectFocus(page, 'player-play');
  // One row a notch, and notches closer than 150 ms count once.
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, 100);
  await expectFocus(page, 'player-tracks-button');
  await page.keyboard.press('Enter');
  await page.mouse.click(960, 420);
  const panel = page.getByRole('dialog', { name: 'Audio & subtitles' });
  await expect(panel).toBeVisible();
  await expectFocus(page, 'player-tracks-off');
  await pressBack(page);
  await pressBack(page);
  await expect(panel).toHaveCount(0);
  await expectFocus(page, 'player-tracks-button');

  // Hidden, the bar is not under the pointer either: OK there shows the controls and jumps nowhere.
  const bar = page.locator('[data-focus-key="player-seek"] > div');
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 3 });
  await expectFocus(page, 'player-seek');
  await pressBack(page);
  await expect(play).toBeHidden();
  await page.keyboard.press('Enter');
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await expect(play).toBeVisible();
  await page.waitForTimeout(500);
  expect(await seeks()).toBe(2);

  // Hidden, the controls are not under the pointer: OK over the place of the
  // back arrow shows them, and the click that comes with it presses nothing.
  const back = page.locator('[data-focus-key="player-back"]');
  const arrow = (await back.boundingBox())!;
  await page.mouse.move(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2, { steps: 3 });
  await expectFocus(page, 'player-back');
  await pressBack(page);
  await expect(play).toBeHidden();
  await page.keyboard.press('Enter');
  await page.mouse.click(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2);
  await expect(play).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('section[aria-label="Elephants Dream"]:visible')).toBeVisible();
  expect((await video(page)).playing).toBe(true);

  // A click by itself on the back arrow leaves.
  await back.click();
  await expectFocus(page, 'details-watch');
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

/** Opens the audio and subtitle sheet from the controls, on the subtitles showing. */
async function openSheet(page: Page, focusKey: string) {
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'Enter', focusKey);
}

/** Whether a sheet row sits wholly inside its list's window, not slid out of sight. */
async function inSight(page: Page, focusKey: string) {
  const row = page.locator(`[data-focus-key="${focusKey}"]`);
  const box = await row.boundingBox();
  const list = await row.locator('xpath=../..').boundingBox();
  return !!box && !!list && box.y >= list.y && box.y + box.height <= list.y + list.height;
}

test('each version says where it is from and how it is doing, and its timing is kept for that file', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' } });
  await mockPlayback(page, {
    subtitleList: [
      { id: 'en1', lang: 'eng', label: 'Open.Movie.1080p.WEB-DL' },
      { id: 'en2', lang: 'eng', label: 'Open.Movie.720p.BluRay' },
      { id: 'missing', lang: 'eng' },
      { id: 'fr1', lang: 'fre' },
    ],
    subtitleDelayMs: { en2: 1500 },
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();

  await openSheet(page, 'player-tracks-lang-en');
  const sheet = page.getByRole('dialog', { name: 'Audio & subtitles' });
  const en1 = page.locator(`[data-focus-key="${OPENSUBTITLES}#en1"]`);
  const en2 = page.locator(`[data-focus-key="${OPENSUBTITLES}#en2"]`);
  const missing = page.locator(`[data-focus-key="${OPENSUBTITLES}#missing"]`);
  // The release names it sends, and a best guess at which matches the stream (1080p WEB-DL).
  await expect(en1).toHaveText('OpenSubtitles v3 1Matches your video · Open.Movie.1080p.WEB-DL');
  await expect(en2).toHaveText('OpenSubtitles v3 2Open.Movie.720p.BluRay');
  await expect(missing).toHaveText('OpenSubtitles v3 3');

  // The subtitle line sits just above the sheet.
  const line = (await page.getByText('Hello from the test subtitles').boundingBox())!;
  const top = (await sheet.boundingBox())!.y;
  expect(line.y + line.height).toBeLessThanOrEqual(top);
  expect(line.y + line.height).toBeGreaterThan(top - 120);

  // A file says Loading… until its first line is ready.
  await press(page, 'ArrowRight', `${OPENSUBTITLES}#en1`);
  await press(page, 'ArrowDown', `${OPENSUBTITLES}#en2`);
  await page.keyboard.press('Enter');
  await expect(en2).toContainText('Loading…');
  await expect(page.getByText('The second English file')).toBeVisible();
  await expect(en2).not.toContainText('Loading…');

  // One that can't be read says so, and the next that can takes over.
  await press(page, 'ArrowDown', `${OPENSUBTITLES}#missing`);
  await page.keyboard.press('Enter');
  await expect(missing).toContainText("Couldn't load, skipped");
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();

  // Timing: half a second later, said in words, and kept for this file.
  await pressBack(page);
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  await press(page, 'ArrowRight', 'player-tracks-tab-timing');
  await expect(page.getByText('Subtitles as the file has them')).toBeVisible();
  await press(page, 'ArrowDown', 'player-tracks-timing-p01');
  await press(page, 'ArrowRight', 'player-tracks-timing-p05');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Subtitles 0.5 s later')).toBeVisible();
  const timing = page.locator('[data-focus-key="player-tracks-tab-timing"]');
  await expect(timing).toContainText('+0.5 s');
  await press(page, 'ArrowLeft', 'player-tracks-timing-p01');
  await press(page, 'ArrowLeft', 'player-tracks-timing-m01');
  await page.keyboard.press('Enter');
  await expect(timing).toContainText('+0.4 s');
  await expect
    .poll(async () => ((await readKv(page, 'subtitleOffsets')) ?? []) as unknown[])
    .toEqual([{ key: expect.stringMatching(/^[0-9a-z]+$/), offset: 0.4 }]);

  // Another file starts as it is; back on the first, its timing is there again.
  await pressBack(page);
  await press(page, 'ArrowLeft', 'player-tracks-tab-audio');
  await press(page, 'ArrowLeft', 'player-tracks-tab-subtitles');
  await press(page, 'ArrowDown', 'player-tracks-lang-en');
  await press(page, 'ArrowRight', `${OPENSUBTITLES}#en1`);
  await press(page, 'ArrowDown', `${OPENSUBTITLES}#en2`);
  await page.keyboard.press('Enter');
  await expect(timing).toContainText('0.0 s');
  await press(page, 'ArrowUp', `${OPENSUBTITLES}#en1`);
  await page.keyboard.press('Enter');
  await expect(timing).toContainText('+0.4 s');

  // Reset puts it back, and nothing is kept.
  await pressBack(page);
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  await press(page, 'ArrowRight', 'player-tracks-tab-timing');
  await press(page, 'ArrowDown', 'player-tracks-timing-p01');
  for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'player-tracks-timing-reset');
  await page.keyboard.press('Enter');
  await expect(timing).toContainText('0.0 s');
  await expect.poll(async () => readKv(page, 'subtitleOffsets')).toEqual([]);
});

/** Records every piece of text the page draws, for a check that some never showed. */
async function recordDrawnText(page: Page) {
  await page.addInitScript(() => {
    const drawn: string[] = [];
    (window as unknown as { drawnText: string[] }).drawnText = drawn;
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') drawn.push(record.target.textContent ?? '');
        record.addedNodes.forEach((node) => drawn.push(node.textContent ?? ''));
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}

function drawnText(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { drawnText: string[] }).drawnText.join('\n'));
}

test('the first subtitles to show are the full file: signs only, lines for the hard of hearing and a file running past the end are passed over, and adverts never show', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' } });
  await mockPlayback(page, {
    // The 10-minute video, so the files' lengths can be judged against it.
    streams: { [MOVIE]: [{ ...DEFAULT_STREAMS[0]!, path: '/long-movie-1080p.webm' }] },
    // As OpenSubtitles might list them: the worst first, and no release names.
    subtitleList: [
      { id: 'signs', lang: 'eng' },
      { id: 'sdh', lang: 'eng' },
      { id: 'past', lang: 'eng' },
      { id: 'full', lang: 'eng' },
    ],
    // The full file comes last, as from a slow server: the first lines wait for it.
    subtitleDelayMs: { full: 1200 },
  });
  await recordDrawnText(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  // The full file's first line, at 3 s; its advert, at the very start, was taken out.
  await expect(page.getByText('The full file, line 1')).toBeVisible();
  const drawn = await drawnText(page);
  expect(drawn).not.toContain('OpenSubtitles.org');
  expect(drawn).not.toContain('Advertise your product');
  // The signs file listed first, the one for the hard of hearing and the one running past the
  // end never showed a line. Neither of the first two fits as it is, so the next two were read.
  expect(drawn).not.toContain('A SIGN');
  expect(drawn).not.toContain('For the hard of hearing');
  expect(drawn).not.toContain('Running past the end');

  // The sheet says why: the signs file has only a few lines, and is dimmed.
  await openSheet(page, 'player-tracks-lang-en');
  await expect(page.locator('[data-focus-key="player-tracks-lang-en"]')).toHaveAttribute(
    'aria-label',
    'English, 4 versions',
  );
  const signs = page.locator(`[data-focus-key="${OPENSUBTITLES}#signs"]`);
  const sdh = page.locator(`[data-focus-key="${OPENSUBTITLES}#sdh"]`);
  const past = page.locator(`[data-focus-key="${OPENSUBTITLES}#past"]`);
  const full = page.locator(`[data-focus-key="${OPENSUBTITLES}#full"]`);
  await expect(signs).toHaveText('OpenSubtitles v3 1Only a few lines');
  await expect(signs).toHaveClass(/dim/);
  await expect(sdh).toHaveText('OpenSubtitles v3 2For the hard of hearing');
  await expect(past).toHaveText('OpenSubtitles v3 3');
  await expect(full).toHaveText('OpenSubtitles v3 4');
  await expect(sdh).not.toHaveClass(/dim/);
  await expect(past).not.toHaveClass(/dim/);
  await expect(full).not.toHaveClass(/dim/);
  await press(page, 'ArrowRight', `${OPENSUBTITLES}#full`);

  // Picked by hand, the file running past the end shows, its drift fixed for it, and the
  // pick is kept for this release by who the file is, never its link.
  await press(page, 'ArrowUp', `${OPENSUBTITLES}#past`);
  await page.keyboard.press('Enter');
  // Its lines come every 2 s and last 4, so two show at once.
  await expect(page.getByText(/^Running past the end, line \d+$/).first()).toBeVisible({
    timeout: 12000,
  });
  await expect(past).toHaveText('OpenSubtitles v3 3Drift fixed for you');
  await expect(page.locator('[data-focus-key="player-tracks-tab-timing"]')).toContainText(
    'drift fixed',
  );
  await expect
    .poll(async () => readKv(page, 'subtitlePicks'))
    .toEqual([
      {
        metaId: MOVIE,
        release: 'binge:test-1080p',
        file: expect.stringMatching(/^[0-9a-z]+$/),
      },
    ]);
  // Nothing of the fix is kept while the player made it.
  expect((await readKv(page, 'subtitleDrift')) ?? []).toEqual([]);

  // A tenth of a second later: the timing moves by that, and the fix stays on, kept with the
  // timing as the player's own, so another release of the film works it out again.
  await pressBack(page);
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  await press(page, 'ArrowRight', 'player-tracks-tab-timing');
  await expect(page.locator('[data-focus-key="player-tracks-drift-behind"]')).toHaveAttribute(
    'aria-label',
    'Falling behind, in use',
  );
  await press(page, 'ArrowDown', 'player-tracks-timing-p01');
  await page.keyboard.press('Enter');
  const timing = page.locator('[data-focus-key="player-tracks-tab-timing"]');
  await expect(timing).toContainText('+0.1 s');
  await expect(timing).toContainText('drift fixed');
  await expect(page.locator('[data-focus-key="player-tracks-drift-behind"]')).toHaveAttribute(
    'aria-label',
    'Falling behind, in use',
  );
  await expect
    .poll(async () => readKv(page, 'subtitleDrift'))
    .toEqual([{ key: expect.stringMatching(/^[0-9a-z]+$/), drift: 'auto' }]);
  await expect
    .poll(async () => readKv(page, 'subtitleOffsets'))
    .toEqual([{ key: expect.stringMatching(/^[0-9a-z]+$/), offset: 0.1 }]);
  expect(await drawnText(page)).not.toContain('OpenSubtitles.org');
});

test('English turned on from the sheet starts on its best version, read first, and stays the viewer’s language', async ({
  page,
}) => {
  await mockAddons(page);
  // No subtitle language chosen yet, so the film starts with subtitles off.
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: { [MOVIE]: [{ ...DEFAULT_STREAMS[0]!, path: '/long-movie-1080p.webm' }] },
    subtitleList: [
      { id: 'signs', lang: 'eng' },
      { id: 'sdh', lang: 'eng' },
      { id: 'past', lang: 'eng' },
      { id: 'full', lang: 'eng' },
    ],
  });
  await recordDrawnText(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  // English, pressed: none of its files has been read, and the signs file is listed first.
  await openSheet(page, 'player-tracks-off');
  await press(page, 'ArrowDown', 'player-tracks-lang-en');
  await page.keyboard.press('Enter');
  const signs = page.locator(`[data-focus-key="${OPENSUBTITLES}#signs"]`);
  const full = page.locator(`[data-focus-key="${OPENSUBTITLES}#full"]`);
  // Its files are read before a line shows, and the full one is chosen.
  await expect(full).toHaveClass(/selected/);
  await expect(page.getByText(/^The full file, line \d+$/).first()).toBeVisible();
  await expect(signs).toHaveText('OpenSubtitles v3 1Only a few lines');
  const drawn = await drawnText(page);
  expect(drawn).not.toContain('A SIGN');
  expect(drawn).not.toContain('For the hard of hearing, line');
  expect(drawn).not.toContain('Running past the end, line');
  // English is the viewer's for the title, and no version is kept as picked by hand.
  await expect
    .poll(async () => ((await readKv(page, 'trackChoices')) ?? []) as unknown[])
    .toContainEqual(expect.objectContaining({ metaId: MOVIE, subtitle: 'eng' }));
  expect((await readKv(page, 'subtitlePicks')) ?? []).toEqual([]);

  // Off, then English again: back on the full file, not the first listed.
  await press(page, 'ArrowUp', 'player-tracks-off');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^The full file, line \d+$/)).toHaveCount(0);
  await press(page, 'ArrowDown', 'player-tracks-lang-en');
  await page.keyboard.press('Enter');
  await expect(full).toHaveClass(/selected/);
  await expect(page.getByText(/^The full file, line \d+$/).first()).toBeVisible();
  expect(await drawnText(page)).not.toContain('A SIGN');
});

test('a version picked by hand comes back first when the film plays again, though the stream lists its own English track as it starts', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' } });
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [{ name: 'Test Streams\nHLS', description: 'Open Movie HLS', path: HLS_PATH }],
    },
  });
  await recordDrawnText(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  // The stream's own English track comes first.
  await expect(page.getByText('Hello from the stream')).toBeVisible();
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(1);

  // Paused, so the short stream does not end, and OpenSubtitles' first file picked by hand:
  // kept for this release.
  await press(page, 'Enter', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'Enter', 'player-tracks-lang-en');
  await press(page, 'ArrowRight', 'player-tracks-track-eng|English');
  await press(page, 'ArrowDown', `${OPENSUBTITLES}#en1`);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await expect
    .poll(async () => readKv(page, 'subtitlePicks'))
    .toEqual([
      { metaId: MOVIE, release: `video:${MOVIE}`, file: expect.stringMatching(/^[0-9a-z]+$/) },
    ]);

  // Out to the title, and Watch again: Back goes to the languages, closes the sheet, hides the
  // controls and leaves.
  for (let step = 0; step < 3; step++) await pressBack(page);
  await expectFocus(page, 'player-surface');
  await pressBack(page);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^details-/,
  );
  await page.evaluate(() => {
    (window as unknown as { drawnText: string[] }).drawnText.length = 0;
  });
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  // hls.js listed the stream's English track before the first picture; the file picked by
  // hand still comes first, and the track never shows a line.
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await openSheet(page, 'player-tracks-lang-en');
  await press(page, 'ArrowRight', `${OPENSUBTITLES}#en1`);
  await expect(page.locator('[data-focus-key="player-tracks-track-eng|English"]')).toHaveText(
    'In the stream',
  );
  expect(await drawnText(page)).not.toContain('Hello from the stream');
});

test('the best file, read only after the lines show, takes over once, and one as good read later does not', async ({
  page,
}) => {
  let sendFull!: () => void;
  let sendCopy!: () => void;
  const fullGate = new Promise<void>((done) => (sendFull = done));
  const copyGate = new Promise<void>((done) => (sendCopy = done));
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' } });
  await mockPlayback(page, {
    streams: { [MOVIE]: [{ ...DEFAULT_STREAMS[0]!, path: '/long-movie-1080p.webm' }] },
    subtitleList: [
      { id: 'copy', lang: 'eng' },
      { id: 'sdh', lang: 'eng' },
      { id: 'full', lang: 'eng' },
    ],
    // Both whole plain files come from a slow server: each arrives when the test says.
    subtitleGates: { full: fullGate, copy: copyGate },
  });
  await recordDrawnText(page);
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  // The hold ends without them: the lines for the hard of hearing show.
  const sdhLine = page.getByText(/^For the hard of hearing, line \d+$/).first();
  await expect(sdhLine).toBeVisible({ timeout: 12000 });

  // The full file, read after, fits clearly better (plain, not for the hard of hearing):
  // it takes over.
  sendFull();
  const fullLine = page.getByText(/^The full file, line \d+$/).first();
  await expect(fullLine).toBeVisible();
  const switchedAt = await page.evaluate(
    () => (window as unknown as { drawnText: string[] }).drawnText.length,
  );

  // The copy, listed first, read later still: it fits as well, no better, so nothing changes.
  const copyRead = page.waitForResponse((response) => response.url().endsWith('/copy.srt'));
  sendCopy();
  await copyRead;
  const number = Number(/\d+$/.exec((await fullLine.textContent()) ?? '')![0]);
  // Two lines on, 4 s later, still the full file.
  await expect(page.getByText(`The full file, line ${number + 2}`, { exact: true })).toBeVisible({
    timeout: 12000,
  });
  const since = await page.evaluate(
    (from) => (window as unknown as { drawnText: string[] }).drawnText.slice(from).join('\n'),
    switchedAt,
  );
  expect(since).not.toContain('Another full file');
  expect(since).not.toContain('For the hard of hearing, line');
  await openSheet(page, 'player-tracks-lang-en');
  await expect(page.locator(`[data-focus-key="${OPENSUBTITLES}#full"]`)).toHaveClass(/selected/);
});

test('rows keep their places as more subtitles arrive, and every row answers the pointer', async ({
  page,
}) => {
  let answer = () => undefined as void;
  const gate = new Promise<void>((done) => (answer = done));
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [
        {
          ...DEFAULT_STREAMS[0]!,
          subtitles: [{ id: 's1', path: '/fr2.srt', lang: 'fre', label: 'Open Movie French' }],
        },
      ],
    },
    subtitlesGate: gate,
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  await openSheet(page, 'player-tracks-off');
  await expect(page.getByText('Still asking 1 addon…')).toBeVisible();
  await press(page, 'ArrowDown', 'player-tracks-lang-fr');
  const french = page.locator('[data-focus-key="player-tracks-lang-fr"]');
  const english = page.locator('[data-focus-key="player-tracks-lang-en"]');
  const where = (await french.boundingBox())!;

  // English comes before French by name, but French was there first: it stays put.
  answer();
  await expect(english).toBeVisible();
  await expect(page.getByText('Still asking 1 addon…')).toHaveCount(0);
  expect(await french.boundingBox()).toEqual(where);
  expect((await english.boundingBox())!.y).toBeGreaterThan(where.y);
  await expectFocus(page, 'player-tracks-lang-fr');
  // French's own versions: the stream's first, then the addon's after it.
  await expect(page.locator('[data-focus-key^="player-tracks-file-"]')).toHaveCount(2);
  const versions = await page
    .locator('[data-focus-key^="player-tracks-file-"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-focus-key')));
  expect(versions).toEqual(['player-tracks-file-stream#s1', `${OPENSUBTITLES}#fr1`]);

  // The pointer: over a row it takes focus, and a click picks it. Passing over
  // the tabs and the languages on its way changes neither what shows below nor beside.
  const target = (await english.boundingBox())!;
  await page.mouse.move(1500, 300);
  await page.mouse.move(300, target.y + 30, { steps: 8 });
  await expectFocus(page, 'player-tracks-lang-en');
  await expect(page.locator('[data-focus-key="player-tracks-file-stream#s1"]')).toBeVisible();
  await page.mouse.click(300, target.y + 30);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  const second = page.locator(`[data-focus-key="${OPENSUBTITLES}#en2"]`);
  const box = (await second.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 30, { steps: 3 });
  await expectFocus(page, `${OPENSUBTITLES}#en2`);
  await page.mouse.click(box.x + 100, box.y + 30);
  await expect(page.getByText('The second English file')).toBeVisible();
  // A tab answers it too, opening on a click, and so does a choice inside it.
  const style = (await page.locator('[data-focus-key="player-tracks-tab-style"]').boundingBox())!;
  await page.mouse.move(style.x + 60, style.y + 50, { steps: 3 });
  await expectFocus(page, 'player-tracks-tab-style');
  await expect(page.locator('[data-focus-key^="player-tracks-file-"]')).toHaveCount(2);
  await page.mouse.click(style.x + 60, style.y + 50);
  const yellow = page.locator('[data-focus-key="player-tracks-style-colour-yellow"]');
  const swatch = (await yellow.boundingBox())!;
  await page.mouse.click(swatch.x + 40, swatch.y + 30);
  await expect(page.locator('[data-focus-key="player-tracks-tab-style"]')).toContainText(
    'Medium, yellow',
  );
});

test('an English commentary listed first gives way to the main English track, which says its channels', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { audioLanguage: 'eng' } });
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [
        { name: 'Test Streams\nHLS', description: 'Open Movie HLS', path: COMMENTARY_HLS_PATH },
      ],
    },
    subtitles: false,
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);

  await openSheet(page, 'player-tracks-off');
  await pressBack(page);
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  const tab = page.locator('[data-focus-key="player-tracks-tab-audio"]');
  // The commentary played first; the main track took over.
  await expect(tab).toContainText('English 5.1');
  await press(page, 'ArrowDown', 'player-tracks-audio-eng|English');
  await expect(page.locator('[data-focus-key="player-tracks-audio-eng|English"]')).toHaveText(
    'EnglishOpus 5.1',
  );
  await expect(
    page.locator('[data-focus-key="player-tracks-audio-eng|English Commentary"]'),
  ).toHaveText('EnglishOpus · English Commentary');
});

test('a long list lands on the version showing however far it was moved, and no row holds a link', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    subtitleList: [
      { id: 'en1', lang: 'eng' },
      ...Array.from({ length: 9 }, (_, i) => ({ id: `x${i + 1}`, lang: 'eng' })),
      // Sent with no id: its link must not become its key.
      { id: 'en2', lang: 'eng', withoutId: true },
    ],
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await openSheet(page, 'player-tracks-off');
  await press(page, 'ArrowDown', 'player-tracks-lang-en');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  const showing = `${OPENSUBTITLES}#en1`;
  const moveDown = async () => {
    await press(page, 'ArrowRight', showing);
    for (let i = 1; i <= 6; i++) await press(page, 'ArrowDown', `${OPENSUBTITLES}#x${i}`);
    await press(page, 'ArrowLeft', 'player-tracks-lang-en');
  };
  // OK on the language showing goes to its version, scrolled out of sight or not.
  await moveDown();
  expect(await inSight(page, showing)).toBe(false);
  await press(page, 'Enter', showing);
  await expect.poll(() => inSight(page, showing)).toBe(true);
  // And Right into the list lands on it too.
  await press(page, 'ArrowLeft', 'player-tracks-lang-en');
  await moveDown();
  await press(page, 'ArrowRight', showing);
  await expect.poll(() => inSight(page, showing)).toBe(true);
  // The file sent with no id has a key of its own, and no key holds a link.
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => focusedKey(page))
    .toMatch(/^player-tracks-file-org\.stremio\.opensubtitlesv3#h[0-9a-z]+$/);
  expect(
    await page.locator('[data-focus-key*="://"], [data-focus-key*="subs.example"]').count(),
  ).toBe(0);

  // OK on a tab with nothing to choose below it stays on the tab.
  await pressBack(page);
  await expectFocus(page, 'player-tracks-tab-subtitles');
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  await expect(page.getByText('This stream has no other audio to choose from.')).toBeVisible();
  await press(page, 'Enter', 'player-tracks-tab-audio');
  await press(page, 'ArrowRight', 'player-tracks-tab-timing');
});

test("the stream's own subtitles stay first when it lists them after the sheet opened", async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [{ name: 'Test Streams\nHLS', description: 'Open Movie HLS', path: HLS_PATH }],
    },
    mediaDelayMs: 2000,
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  // Opened while the stream starts: the addon's files are there before the stream's track.
  await pressCode(page, BLUE);
  await expectFocus(page, 'player-tracks-off');
  await expect(page.locator('[data-focus-key="player-tracks-lang-en"]')).toBeVisible();
  await press(page, 'ArrowDown', 'player-tracks-lang-en');
  const versions = page.locator(
    '[data-focus-key^="player-tracks-file-"], [data-focus-key^="player-tracks-track-"]',
  );
  await expect(versions).toHaveCount(2);
  await expect(versions).toHaveCount(3, { timeout: 15000 });
  expect(
    await versions.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-focus-key'))),
  ).toEqual(['player-tracks-track-eng|English', `${OPENSUBTITLES}#en1`, `${OPENSUBTITLES}#en2`]);
});

test('a track the stream lists late keeps the focused version in sight', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: {
      [MOVIE]: [{ name: 'Test Streams\nHLS', description: 'Open Movie HLS', path: HLS_PATH }],
    },
    subtitleList: Array.from({ length: 10 }, (_, i) => ({ id: `en${i + 1}`, lang: 'eng' })),
    mediaDelayMs: 4000,
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await pressCode(page, BLUE);
  await expectFocus(page, 'player-tracks-off');
  await press(page, 'ArrowDown', 'player-tracks-lang-en');
  await press(page, 'ArrowRight', `${OPENSUBTITLES}#en1`);
  for (let i = 2; i <= 10; i++) await press(page, 'ArrowDown', `${OPENSUBTITLES}#en${i}`);
  const last = page.locator(`[data-focus-key="${OPENSUBTITLES}#en10"]`);
  const place = () => last.evaluate((row) => (row as HTMLElement).style.top);
  const before = await place();
  // The stream's own track comes in above the files, and moves every row down one.
  await expect.poll(place, { timeout: 15000 }).not.toBe(before);
  await expectFocus(page, `${OPENSUBTITLES}#en10`);
  await expect.poll(() => inSight(page, `${OPENSUBTITLES}#en10`)).toBe(true);
});

test('a stream that fails with the sheet open closes it, and the problem box has the remote', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    broken: ['/movie-1080p.webm', '/movie-720p.webm'],
    mediaDelayMs: 1500,
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await pressCode(page, BLUE);
  const sheet = page.getByRole('dialog', { name: 'Audio & subtitles' });
  await expect(sheet).toBeVisible();
  await expect(page.getByText('No stream could play')).toBeVisible({ timeout: 15000 });
  await expect(sheet).toHaveCount(0);
  await expectFocus(page, 'player-problem-streams');
});

test('Settings shows subtitle style in the same sheet, with a sample line above it', async ({
  page,
}) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowDown', 'settings-probing');
  await press(page, 'ArrowDown', 'settings-subtitle-style');
  await press(page, 'Enter', 'settings-style-choices-size-medium');
  const dialog = page.getByRole('dialog', { name: 'Subtitle style' });
  await expect(dialog).toBeVisible();
  await expect(page.getByText('This is how subtitles will look.')).toBeVisible();
  // A sheet from the bottom, with the line just above it.
  const sheet = (await dialog.boundingBox())!;
  expect(sheet.y).toBeGreaterThanOrEqual(500);
  const line = (await page.getByText('This is how subtitles will look.').boundingBox())!;
  expect(line.y + line.height).toBeLessThanOrEqual(sheet.y);
  await press(page, 'ArrowDown', 'settings-style-choices-colour-white');
  await press(page, 'ArrowRight', 'settings-style-choices-colour-yellow');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page
        .getByText('This is how subtitles will look.')
        .evaluate((line) => getComputedStyle(line).color),
    )
    .toBe('rgb(255, 228, 92)');
  // Reset to default, at the end of the last row.
  await press(page, 'ArrowDown', 'settings-style-choices-background-outline');
  await press(page, 'ArrowDown', 'settings-style-choices-position-bottom');
  for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'settings-style-choices-reset');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page
        .getByText('This is how subtitles will look.')
        .evaluate((line) => getComputedStyle(line).color),
    )
    .toBe('rgb(255, 255, 255)');
  await pressBack(page);
  await expect(page.getByRole('dialog', { name: 'Subtitle style' })).toHaveCount(0);
  await expectFocus(page, 'settings-subtitle-style');
});

test('with timing marks on, the stages of a Play read in order, and no mark names an address', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('bannertv.tuning', JSON.stringify({ marks: true })),
  );
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await openMovie(page);

  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  const read = () =>
    page.evaluate(() => (window as { __bannertvPlay?: () => unknown }).__bannertvPlay?.());
  await expect
    .poll(async () => {
      const marks = (await read()) as { stages: Record<string, number> } | null;
      return marks ? Object.keys(marks.stages).sort() : [];
    })
    .toEqual(
      [
        'press',
        'open',
        'finder-start',
        'first-stream',
        'settled',
        'chosen',
        'load',
        'metadata',
        'first-frame',
      ].sort(),
    );
  const { stages, streams } = (await read()) as {
    stages: Record<string, number>;
    streams: number;
  };
  expect(stages.press).toBe(0);
  expect(stages.open).toBeGreaterThanOrEqual(0);
  expect(stages.chosen).toBeGreaterThanOrEqual(stages.open!);
  expect(stages.load).toBeGreaterThanOrEqual(stages.chosen!);
  expect(stages['first-frame']).toBeGreaterThanOrEqual(stages.load!);
  expect(streams).toBe(1);
  const names = await page.evaluate(() =>
    performance.getEntriesByType('mark').map((entry) => entry.name),
  );
  expect(names).toContain('play:press');
  expect(names.filter((name) => /https?:|\/\//.test(name))).toEqual([]);
});
