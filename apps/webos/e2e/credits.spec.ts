import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { mockPlayback, type PlaybackOptions, readKv, seedStreamAddon } from './play';
import { APP_URL, expectFocus, expectFocusLabel, openSection, press, pressBack } from './tv';

/** The first episode of the series on Home, as Stremio names it, and the one after it. */
const EPISODE = 'tt8000001:1:1';
const NEXT_EPISODE = 'tt8000001:1:2';

/** A 10 minute file, so an intro skipped early on is far from Up Next. */
const LONG_EPISODE = [
  {
    name: 'Test Streams\n1080p',
    description: 'Open Movie 1080p WEB-DL x264\n💾 1.4 GB ⚡ Cached',
    path: '/long-episode-1080p.webm',
  },
];

/**
 * IntroDB's end credits for the 40 s file: from 4 s to its end, so they
 * start well before Up Next's last 30 seconds, and fit this very release.
 */
const CREDITS: PlaybackOptions['skips'] = { [EPISODE]: { outro: [4, 40] } };

/** What the player's video element is doing. */
function video(page: Page) {
  return page.locator('video:not([aria-hidden])').evaluate((element: HTMLVideoElement) => ({
    playing: !element.paused && element.currentTime > 0,
    time: element.currentTime,
  }));
}

/** Plays the series' first episode from its page, as the viewer would. */
async function playFirstEpisode(page: Page) {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
}

const focused = (page: Page) => page.locator('[data-focused="true"]');

test('as the credits start, Up Next offers the next episode or Watch credits, and never starts it by itself', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, { skips: CREDITS });
  await playFirstEpisode(page);

  const card = page.getByRole('dialog', { name: 'Up next' });
  const playNow = page.locator('[data-focus-key="player-upnext-play"]');
  const dismiss = page.locator('[data-focus-key="player-upnext-dismiss"]');
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-upnext-play', {
    timeout: 10000,
  });
  // Before the last 30 seconds it counts nothing: the ending is the viewer's to see.
  expect((await video(page)).time).toBeLessThan(10);
  await expect(card.getByText('Next episode', { exact: true })).toBeVisible();
  await expect(card.getByText('S1:E2', { exact: true })).toBeVisible();
  await expect(playNow).toHaveAttribute('aria-label', 'Play now. Next episode');
  await expect(dismiss).toHaveText('Watch credits');

  // Watch credits: the card goes and the credits play on.
  await press(page, 'ArrowRight', 'player-upnext-dismiss');
  await press(page, 'Enter', 'player-surface');
  await expect(card).toHaveCount(0);
  expect((await video(page)).playing).toBe(true);

  // The last 30 seconds count down to the real end, as ever, with Keep watching.
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-upnext-play', {
    timeout: 10000,
  });
  await expect(card.getByText(/^Next episode in \d+ s$/)).toBeVisible();
  await expect(dismiss).toHaveText('Keep watching');
  // The same episode played on: nothing started by itself at the credits.
  expect((await video(page)).time).toBeGreaterThan(9);
});

test('left in the credits, the episode counts as watched and Continue Watching offers the next one', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, { skips: CREDITS });
  await playFirstEpisode(page);
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-upnext-play', {
    timeout: 10000,
  });

  // Back on the card watches the credits; Back again leaves.
  await pressBack(page);
  await expect(page.getByRole('dialog', { name: 'Up next' })).toHaveCount(0);
  await pressBack(page);
  await expect(focused(page)).toHaveAttribute('data-focus-key', /^details-/);

  // Kept at its end, as Mark as watched keeps it, so it never resumes in the credits.
  await expect
    .poll(async () => {
      const saved = (await readKv(page, 'progress')) as Array<{
        videoId: string;
        position: number;
        duration: number;
        watched: boolean;
      }>;
      const entry = saved.find((item) => item.videoId === EPISODE);
      return entry && { watched: entry.watched, atEnd: entry.position === entry.duration };
    })
    .toEqual({ watched: true, atEnd: true });

  await page.goto(APP_URL);
  await expectFocus(page, 'home-continue-tile-0');
  await expectFocusLabel(page, 'Morevna Project, Next: S1:E2');
});

test('with "Start next at credits" on, the card counts ten seconds from the credits and plays the next episode', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  const mock = await mockPlayback(page, { skips: CREDITS });

  // Off until turned on, in Settings under "Still watching?".
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowDown', 'settings-probing');
  await press(page, 'ArrowDown', 'settings-subtitle-style');
  await press(page, 'ArrowDown', 'settings-still-watching');
  await press(page, 'ArrowDown', 'settings-next-at-credits');
  const setting = page.locator('[data-focus-key="settings-next-at-credits"]');
  await expect(setting).toHaveAttribute('aria-label', 'Start next episode at the credits: Off');
  await page.keyboard.press('Enter');
  await expect(setting).toHaveAttribute('aria-label', 'Start next episode at the credits: On');

  await playFirstEpisode(page);
  const card = page.getByRole('dialog', { name: 'Up next' });
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-upnext-play', {
    timeout: 10000,
  });
  const label = card.getByText(/^Next episode in \d+ s$/);
  await expect(label).toBeVisible();
  const count = Number(/(\d+)/.exec((await label.textContent()) ?? '')?.[1]);
  const { time } = await video(page);
  // Ten seconds from where the credits came up (4 s), not the 30 left to the end.
  expect(count).toBeLessThanOrEqual(10);
  expect(Math.abs(count - (14 - time))).toBeLessThanOrEqual(1.5);
  await expect(page.locator('[data-focus-key="player-upnext-dismiss"]')).toHaveText(
    'Watch credits',
  );

  // The next episode starts as the count runs out, long before the file's end.
  let latest = 0;
  await expect
    .poll(
      async () => {
        const now = (await video(page)).time;
        if (now >= latest) latest = now;
        return mock.streams.includes(`series/${NEXT_EPISODE}`) && now < latest;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  expect(latest).toBeLessThan(20);
});

test('a skip by hand over the intro is learned, and the next episode offers Skip intro there', async ({
  page,
}) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  // IntroDB has no timings for either episode.
  await mockPlayback(page, { streams: { [EPISODE]: LONG_EPISODE, [NEXT_EPISODE]: LONG_EPISODE } });
  await playFirstEpisode(page);
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(1);

  // Six presses of Right add up to a minute, landing once.
  const from = (await video(page)).time;
  for (let press = 0; press < 6; press++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(from + 55);
  const landed = (await video(page)).time;
  expect(await readKv(page, 'learnedIntros')).toBeUndefined();

  // Once it has played on past where it landed, the skip was the intro.
  await expect
    .poll(
      async () =>
        (await readKv(page, 'learnedIntros')) as Record<string, { start: number; end: number }>,
      { timeout: 25000 },
    )
    .toMatchObject({ tt8000001: { start: expect.any(Number), end: expect.any(Number) } });
  const learned = (
    (await readKv(page, 'learnedIntros')) as Record<string, { start: number; end: number }>
  )['tt8000001']!;
  expect(Math.abs(learned.start - from)).toBeLessThan(1);
  expect(Math.abs(learned.end - landed)).toBeLessThan(2);

  // The next episode offers Skip intro at the same place, and OK skips it.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowRight', 'player-fwd10');
  await press(page, 'ArrowRight', 'player-next');
  await page.keyboard.press('Enter');
  const skip = page.getByRole('dialog', { name: 'Skip intro' });
  await expect(skip).toBeVisible({ timeout: 10000 });
  expect((await video(page)).time).toBeLessThan(learned.end);
  await expectFocus(page, 'player-skip-button');
  await page.keyboard.press('Enter');
  await expect(skip).toHaveCount(0);
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(learned.end - 1);
});

test('a skip undone at once teaches nothing', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, { streams: { [EPISODE]: LONG_EPISODE } });
  await playFirstEpisode(page);
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(1);

  const from = (await video(page)).time;
  for (let press = 0; press < 6; press++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(from + 55);
  // Straight back: the viewer wanted the intro after all.
  for (let press = 0; press < 6; press++) await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await video(page)).time).toBeLessThan(from + 10);
  await expect
    .poll(async () => (await video(page)).time, { timeout: 20000 })
    .toBeGreaterThan(from + 16);
  expect(await readKv(page, 'learnedIntros')).toBeUndefined();
});

test('a skip by hand in an episode whose intro IntroDB times teaches nothing', async ({ page }) => {
  test.slow();
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, {
    streams: { [EPISODE]: LONG_EPISODE },
    skips: { [EPISODE]: { intro: [1, 6] } },
  });
  await playFirstEpisode(page);
  // Past IntroDB's intro, the viewer passes over a scene.
  await expect.poll(async () => (await video(page)).time, { timeout: 15000 }).toBeGreaterThan(7);
  const from = (await video(page)).time;
  for (let press = 0; press < 6; press++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(from + 55);
  await expect
    .poll(async () => (await video(page)).time, { timeout: 25000 })
    .toBeGreaterThan(from + 60 + 16);
  expect(await readKv(page, 'learnedIntros')).toBeUndefined();
});
