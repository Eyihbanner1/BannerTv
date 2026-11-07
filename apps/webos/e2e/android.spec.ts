import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import {
  ANDROID_URL,
  androidCalls,
  androidCues,
  androidOpens,
  androidSays,
  androidTextTracks,
  cardPressed,
  leaveApp,
  linkWaiting,
  openAsAndroid,
  openFocusedTitle,
  playerOps,
  playerState,
  watchNextRow,
} from './android';
import { mockPlayback, readKv, type SeedPlayed, type SeedProgress, seedStreamAddon } from './play';
import { GUEST_ID, lockedWith, main, seedProfiles } from './profiles';
import { expectFocus, expectFocusLabel, press, watchErrors } from './tv';

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
/** Morevna Project, whose first season has eight episodes. */
const SERIES = 'tt8000001';

/** Elephants Dream left at 35 s of 120. */
const MOVIE_PART_WAY: SeedProgress = {
  metaId: MOVIE,
  type: 'movie',
  videoId: MOVIE,
  position: 35,
  duration: 120,
};

/** Continue Watching with a film left part way and, more recently, an episode finished. */
const HISTORY = {
  progress: [
    MOVIE_PART_WAY,
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
    {
      videoId: MOVIE,
      metaId: MOVIE,
      type: 'movie',
      name: 'Elephants Dream',
      poster: `https://images.metahub.space/poster/small/${MOVIE}/img`,
      background: `https://images.metahub.space/background/medium/${MOVIE}/img`,
    },
    {
      videoId: `${SERIES}:1:1`,
      metaId: SERIES,
      type: 'series',
      name: 'Morevna Project',
      season: 1,
      episode: 1,
      next: { videoId: `${SERIES}:1:2`, season: 1, episode: 2 },
    },
  ],
} satisfies { progress: SeedProgress[]; played: SeedPlayed[] };

async function typeDigits(page: Page, digits: string): Promise<void> {
  for (const digit of digits) {
    await page.keyboard.press(digit);
    await page.waitForTimeout(60);
  }
}

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
    // A few seconds early, to pick up the line it left: 10 s, as the seeded progress is
    // long ago, but never before 30 s, where a resume begins.
    .toMatchObject({ op: 'load', startAt: 30 });
  await androidOpens(page, 30, 120);
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

test("Continue Watching reaches Android's own home screen as the app leaves the screen", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, HISTORY);
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, 'home-continue-tile-0');

  // Home pressed on the remote: the cards follow at once, the most recently watched first.
  await leaveApp(page);
  await expect
    .poll(() => watchNextRow(page))
    .toEqual([
      {
        type: 'series',
        meta: SERIES,
        video: `${SERIES}:1:2`,
        title: 'Morevna Project S1:E2',
        season: 1,
        episode: 2,
        position: 0,
        duration: 0,
        next: true,
        watchedAt: 1001,
      },
      {
        type: 'movie',
        meta: MOVIE,
        video: MOVIE,
        title: 'Elephants Dream',
        landscape: `https://images.metahub.space/background/medium/${MOVIE}/img`,
        poster: `https://images.metahub.space/poster/small/${MOVIE}/img`,
        // Where Continue Watching starts it: a little before 35 s, and never before 30 s.
        position: 30,
        duration: 120,
        next: false,
        watchedAt: 1000,
      },
    ]);
  // The same list is not sent again.
  await page.waitForTimeout(1500);
  expect((await androidCalls(page)).watchNext).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a profile with a PIN keeps its history off Android's home screen", async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page, HISTORY);
  await seedProfiles(page, {
    profiles: [main(lockedWith('2468')), { id: GUEST_ID, name: 'Guest', colour: 2 }],
    lastId: 'main',
    askAtLaunch: false,
  });
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  // Nobody has said who is watching yet: the row keeps whatever it had.
  await expectFocusLabel(page, 'Main, PIN');
  expect(await watchNextRow(page)).toBeUndefined();
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await typeDigits(page, '2468');

  // Main's Continue Watching is on its own Home, and the system's row is emptied at once.
  await expectFocus(page, 'home-continue-tile-0');
  await expect.poll(() => watchNextRow(page)).toEqual([]);
  await leaveApp(page);
  await page.waitForTimeout(1500);
  expect((await androidCalls(page)).watchNext).toEqual([[]]);
});

test('a Watch Next card opens its title on Details, ready to resume, cold or while the app runs', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, { progress: [MOVIE_PART_WAY] });
  await openAsAndroid(page, { link: { type: 'movie', meta: MOVIE, video: MOVIE } });
  await page.goto(ANDROID_URL);
  // Started from the card: Details, with Resume where the person can see what plays.
  await expectFocus(page, 'details-watch');
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveText('Resume from 0:35');
  expect(await linkWaiting(page)).toBe(false);
  // Back goes to Home, as after a fresh start.
  await androidSays(page, { type: 'key', key: 'Back' });
  await expectFocus(page, 'home-continue-tile-0');

  // Pressed while the app runs, with one profile nobody is asked: the title opens at once.
  await cardPressed(page, { type: 'series', meta: SERIES, video: `${SERIES}:1:2` });
  await expect(page.getByRole('region', { name: 'Morevna Project' })).toBeVisible();
  expect(await linkWaiting(page)).toBe(false);
  await androidSays(page, { type: 'key', key: 'Back' });
  await expectFocus(page, 'home-continue-tile-0');
  expect(errors).toEqual([]);
});

test("a card pressed while the app runs asks who's watching first when the picker shows at launch", async ({
  page,
}) => {
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(), { id: GUEST_ID, name: 'Guest', colour: 2 }],
    lastId: 'main',
    askAtLaunch: true,
  });
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, 'profile-main');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  // The app starts again with the question, and the card's link waits in Android for the answer.
  await cardPressed(page, { type: 'movie', meta: MOVIE, video: MOVIE });
  await expectFocus(page, 'profile-main');
  expect(await linkWaiting(page)).toBe(true);
  await page.waitForTimeout(150);
  await press(page, 'ArrowRight', `profile-${GUEST_ID}`);
  await page.keyboard.press('Enter');
  await expectFocus(page, 'details-watch');
  // Details, not Home's banner for the same film behind it.
  await expect(page.getByRole('region', { name: 'Elephants Dream' })).toBeVisible();
  expect(await linkWaiting(page)).toBe(false);
});
