import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import {
  ANDROID_URL,
  androidCalls,
  androidCues,
  androidOpens,
  androidSays,
  androidTextTracks,
  openAsAndroid,
  openFocusedTitle,
  playerOps,
  playerState,
} from './android';
import { mockPlayback, readKv, seedStreamAddon } from './play';
import { expectFocus, press, watchErrors } from './tv';

/** The page's own colours, which must let Android's picture through while it plays. */
function backgrounds(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector('video:not([aria-hidden])');
    return {
      androidVideo: document.documentElement.classList.contains('android-video'),
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      video: video ? getComputedStyle(video).backgroundColor : null,
    };
  });
}

const CLEAR = 'rgba(0, 0, 0, 0)';
/** Elephants Dream, the first title on Home. */
const MOVIE = 'tt0807840';

/** Elements shown over the middle of the screen with a background that would hide the video. */
function coversPicture(page: Page) {
  return page.evaluate(() => {
    const covering: string[] = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const style = getComputedStyle(element);
      if (style.visibility !== 'visible' || style.display === 'none') continue;
      if (Number(style.opacity) === 0) continue;
      const box = element.getBoundingClientRect();
      if (box.left > 960 || box.right < 960 || box.top > 540 || box.bottom < 540) continue;
      const clear = /rgba\(0, 0, 0, 0\)|transparent/.test(style.backgroundColor);
      if (clear && style.backgroundImage === 'none') continue;
      covering.push(`${element.tagName.toLowerCase()}.${String(element.className)}`);
    }
    return covering;
  });
}

test("the Android app plays in Android's player under the page, and its remote drives it", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  expect((await backgrounds(page)).androidVideo).toBe(false);

  await press(page, 'Enter', 'details-watch');
  await press(page, 'Enter', 'player-surface');
  // Android opens the link itself; the page's video element stays empty.
  await expect
    .poll(async () => (await androidCalls(page)).player.find((command) => command.op === 'load'))
    .toEqual({
      op: 'load',
      id: expect.any(Number),
      url: 'https://media.example.com/movie-1080p.webm',
      startAt: 0,
      mime: '',
    });
  expect(await backgrounds(page)).toEqual({
    androidVideo: true,
    html: CLEAR,
    body: CLEAR,
    video: CLEAR,
  });
  expect(await page.locator('video:not([aria-hidden])').getAttribute('src')).toBeNull();

  await androidOpens(page);
  await playerState(page, { playing: true, position: 1 });
  await expect(page.getByRole('status', { name: 'Starting' })).toHaveCount(0);
  // Nothing the page shows over the middle of the screen hides Android's picture.
  expect(await coversPicture(page)).toEqual([]);

  // OK pauses through Android, and the remote's one Play/Pause button plays again.
  await press(page, 'Enter', 'player-play');
  await expect.poll(async () => (await playerOps(page)).at(-1)).toBe('pause');
  await playerState(page, { playing: false, playWhenReady: false, position: 2 });
  // Info says whose player it is.
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-streams-button');
  await press(page, 'ArrowRight', 'player-info-button');
  await press(page, 'Enter', 'player-info-about');
  await expect(page.locator('[data-focus-key="player-info-about"]')).toHaveAttribute(
    'aria-label',
    /Played by, Android's player\./,
  );
  await androidSays(page, { type: 'key', key: 'Back' });
  await expectFocus(page, 'player-info-button');
  await androidSays(page, { type: 'key', key: 'MediaPlayPause' });
  await expect.poll(async () => (await playerOps(page)).at(-1)).toBe('play');
  await playerState(page, { playing: true, position: 2 });
  await androidSays(page, { type: 'key', key: 'MediaPlayPause' });
  await expect.poll(async () => (await playerOps(page)).at(-1)).toBe('pause');

  // Android's Back hides the controls, then leaves the player, which frees Android's.
  await androidSays(page, { type: 'key', key: 'Back' });
  await expectFocus(page, 'player-surface');
  await androidSays(page, { type: 'key', key: 'Back' });
  await expectFocus(page, 'details-watch');
  await expect.poll(async () => (await playerOps(page)).at(-1)).toBe('release');
  expect((await backgrounds(page)).androidVideo).toBe(false);

  // Back on Home's first row leaves the app.
  await androidSays(page, { type: 'key', key: 'Back' });
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await androidSays(page, { type: 'key', key: 'Back' });
  await expect.poll(async () => (await androidCalls(page)).exits).toBe(1);
  expect(errors).toEqual([]);
});

test('a film resumes on Android where it was left, and keeps its place', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [{ metaId: MOVIE, type: 'movie', videoId: MOVIE, position: 35, duration: 120 }],
  });
  await mockPlayback(page);
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, 'home-continue-tile-0');
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveText('Resume from 0:35');

  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(async () => (await androidCalls(page)).player.find((command) => command.op === 'load'))
    .toMatchObject({ op: 'load', startAt: 35 });
  await androidOpens(page, 35, 120);
  for (const position of [36, 38, 40, 42, 44]) {
    await androidSays(page, { type: 'player', event: 'time', position, duration: 120 });
    await page.waitForTimeout(250);
  }
  // Opened once, at its place: not started again from the beginning as a broadcast would be.
  expect((await playerOps(page)).filter((op) => op === 'load')).toHaveLength(1);
  await expect
    .poll(async () => {
      const saved = (await readKv(page, 'progress')) as Array<{
        videoId: string;
        position: number;
      }>;
      return saved.find((entry) => entry.videoId === MOVIE)?.position ?? 0;
    })
    .toBeGreaterThanOrEqual(35);
});

test('a stream Android cannot play moves on to the next, as on the TV', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(async () => (await playerOps(page)).filter((op) => op === 'load'))
    .toHaveLength(1);

  await androidSays(page, {
    type: 'player',
    event: 'error',
    kind: 'format',
    message: 'This device cannot play the file',
    detail: 'ERROR_CODE_DECODING_FORMAT_UNSUPPORTED (4005)',
  });
  await expect
    .poll(async () => (await androidCalls(page)).player.filter((command) => command.op === 'load'))
    .toHaveLength(2);
  const loads = (await androidCalls(page)).player.filter((command) => command.op === 'load');
  expect(loads[1]!.url).not.toBe(loads[0]!.url);
});

test("subtitles inside the file are drawn in the profile's style on Android, and follow its timing", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    preferences: {
      subtitleLanguage: 'eng',
      subtitleStyle: { size: 'large', colour: 'yellow', background: 'box', position: 'bottom' },
    },
  });
  await mockPlayback(page, { subtitles: false });
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openFocusedTitle(page);
  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(async () => (await playerOps(page)).filter((op) => op === 'load'))
    .toHaveLength(1);
  await androidOpens(page);

  // English inside the file, as last chosen: the page asks Android for its lines.
  await androidTextTracks(page, [
    { id: '2:0', lang: 'en' },
    { id: '2:1', lang: 'fr' },
  ]);
  await expect
    .poll(async () => (await androidCalls(page)).player.filter((command) => command.op === 'text'))
    .toContainEqual({ op: 'text', id: '2:0', cues: true });

  // The page draws the line in the profile's style: large, yellow, in a box, italic as marked.
  await playerState(page, { playing: true, position: 5 });
  await androidCues(page, 5, [{ text: '<i>Hello from inside the file</i>' }]);
  const hello = page.getByText('Hello from inside the file');
  await expect(hello).toBeVisible();
  expect(
    await hello.evaluate((span) => {
      const own = getComputedStyle(span);
      return {
        fontSize: own.fontSize,
        color: own.color,
        fontStyle: own.fontStyle,
        box: getComputedStyle(span.parentElement!).backgroundColor,
      };
    }),
  ).toEqual({
    fontSize: '64px',
    color: 'rgb(255, 228, 92)',
    fontStyle: 'italic',
    box: 'rgba(0, 0, 0, 0.6)',
  });
  // An empty group ends it.
  await androidSays(page, { type: 'player', event: 'time', position: 7, duration: 900 });
  await androidCues(page, 7, []);
  await expect(hello).toHaveCount(0);

  // Timing: half a second later. No drift fix for these, which keep in step with the video.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'Enter', 'player-tracks-lang-en');
  await androidSays(page, { type: 'key', key: 'Back' });
  await expectFocus(page, 'player-tracks-tab-subtitles');
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  await press(page, 'ArrowRight', 'player-tracks-tab-timing');
  await expect(page.getByText('Kept for this file.')).toBeVisible();
  await expect(page.locator('[data-focus-key^="player-tracks-drift-"]')).toHaveCount(0);
  await press(page, 'ArrowDown', 'player-tracks-timing-p01');
  await press(page, 'ArrowRight', 'player-tracks-timing-p05');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Subtitles 0.5 s later')).toBeVisible();

  // With the clock held at 20, a line Android shows from 20 waits until 20.5...
  await playerState(page, { playing: false, playWhenReady: false, position: 20 });
  await androidCues(page, 20, [{ text: 'Half a second later' }]);
  const later = page.getByText('Half a second later');
  await page.waitForTimeout(600);
  await expect(later).toHaveCount(0);
  await androidSays(page, { type: 'player', event: 'time', position: 20.6, duration: 900 });
  await expect(later).toBeVisible();
  // ...and goes half a second after Android ends it.
  await androidCues(page, 21, []);
  await androidSays(page, { type: 'player', event: 'time', position: 21.2, duration: 900 });
  await page.waitForTimeout(600);
  await expect(later).toBeVisible();
  await androidSays(page, { type: 'player', event: 'time', position: 21.6, duration: 900 });
  await expect(later).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Trailer opens the YouTube app on Android', async ({ page }) => {
  await mockAddons(page);
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-2`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'ArrowRight', 'details-trailer');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await androidCalls(page)).opened)
    .toEqual(['https://www.youtube.com/watch?v=eRsGyueVLvQ']);
});
