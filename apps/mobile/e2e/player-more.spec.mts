import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback, seedStreamAddon, type TestStream } from '../../webos/e2e/play.ts';

/*
 * The player's More options on the phone's web build: Episodes, Info, Speed and the sleep timer,
 * as the TV's player has them, against the TV journeys' fake addons. The browser's own video
 * plays here, so the speed is read from it.
 */

/** Morevna Project, whose first season has eight episodes, then two seasons more. */
const SERIES = 'tt8000001';
/** Ten minutes of video, so nothing ends, or counts to the next episode, unless asked to. */
const LONG: readonly TestStream[] = [
  {
    name: 'Test Streams\n1080p',
    description: 'Open Movie 1080p WEB-DL x264\n💾 1.4 GB ⚡ Cached',
    path: '/long-1080p.webm',
    bingeGroup: 'test-1080p',
  },
];
const STREAMS = { [`${SERIES}:1:1`]: LONG, [`${SERIES}:1:2`]: LONG };

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openApp(page: Page): Promise<void> {
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
}

/** Opens the series and plays its first episode from the episode list. */
async function playFirstEpisode(page: Page): Promise<void> {
  await page
    .getByLabel(/^Morevna Project/)
    .first()
    .click();
  await page.getByRole('button', { name: /^1\. Season 1 episode 1,/ }).click();
  const pause = page.getByLabel('Pause', { exact: true }).first();
  await expect(pause).toBeVisible();
  // The browser waits for a tap before it plays; the phone does not.
  await pause.click();
  await page.getByLabel('Play', { exact: true }).first().click();
  await expect.poll(() => videoValue(page, 'currentTime')).toBeGreaterThan(1);
}

function videoValue(page: Page, name: 'currentTime' | 'playbackRate' | 'paused') {
  return page.evaluate((key) => {
    const video = document.querySelector('video');
    return video ? Number(video[key]) : -1;
  }, name);
}

/** Opens More options, tapping the controls up first when they have hidden. */
async function openMore(page: Page): Promise<void> {
  const more = page.getByRole('button', { name: 'More options' });
  if (!(await more.isVisible())) await page.mouse.click(206, 160);
  await more.click();
}

const panel = (page: Page) => page.getByRole('dialog');

test('More has Episodes, Info, Speed and a sleep timer, as the TV’s player', async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    progress: [
      {
        metaId: SERIES,
        type: 'series',
        videoId: `${SERIES}:1:3`,
        position: 1500,
        duration: 1500,
        watched: true,
      },
      { metaId: SERIES, type: 'series', videoId: `${SERIES}:1:4`, position: 600, duration: 1500 },
    ],
  });
  const playback = await mockPlayback(page, { streams: STREAMS });
  await openApp(page);
  await playFirstEpisode(page);

  // Info: the title, the episode's number and name, and when it ends on the phone's clock.
  await openMore(page);
  await panel(page).getByRole('button', { name: 'Info', exact: true }).click();
  await expect(panel(page).getByText('Morevna Project', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('S1:E1 · Season 1 episode 1')).toBeVisible();
  await expectEndsAt(page);
  await page.keyboard.press('Escape');

  // Speed: the TV's choices, and the browser's video plays at the one picked.
  await openMore(page);
  await panel(page).getByRole('button', { name: 'Speed, Normal' }).click();
  for (const name of ['Normal', '0.75×', '1.25×', '1.5×']) {
    await expect(panel(page).getByRole('button', { name, exact: true })).toBeVisible();
  }
  await panel(page).getByRole('button', { name: '1.5×', exact: true }).click();
  await expect.poll(() => videoValue(page, 'playbackRate')).toBe(1.5);
  await openMore(page);
  await expect(panel(page).getByRole('button', { name: 'Speed, 1.5×' })).toBeVisible();
  // Ends at comes sooner at the faster speed.
  await panel(page).getByRole('button', { name: 'Info', exact: true }).click();
  await expectEndsAt(page);
  await page.keyboard.press('Escape');

  // The sleep timer: the TV's choices, and the row says how long is left.
  await openMore(page);
  await panel(page).getByRole('button', { name: 'Sleep timer, Off' }).click();
  for (const name of ['Off', '15 min', '30 min', '45 min', '60 min', '90 min', 'End of episode']) {
    await expect(panel(page).getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(panel(page).getByText('Off: the phone plays on.')).toBeVisible();
  await panel(page).getByRole('button', { name: '30 min', exact: true }).click();
  await openMore(page);
  await expect(
    panel(page).getByRole('button', { name: /^Sleep timer, 30 min left$/ }),
  ).toBeVisible();

  // Episodes: the season playing, the episode playing marked, and what is watched.
  await panel(page).getByRole('button', { name: 'Episodes', exact: true }).click();
  await expect(
    panel(page).getByRole('button', { name: '1. Season 1 episode 1, Playing now' }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: '3. Season 1 episode 3, Watched' }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: '4. Season 1 episode 4, 15 minutes left' }),
  ).toBeVisible();
  // Another season, and back.
  await panel(page).getByRole('button', { name: 'Season 2', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: /^1\. Season 2 episode 1/ })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: /Playing now/ })).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Season 1', exact: true }).click();

  // Another episode plays in the player, at Normal speed, and the sleep timer goes on with it.
  await panel(page)
    .getByRole('button', { name: /^2\. Season 1 episode 2/ })
    .click();
  // The browser's player never says a second stream is ready (its status stays as the first
  // one left it), so here the new episode is seen opening, not playing; Android says so.
  await expect(page.getByText('S1:E2 · Season 1 episode 2').first()).toBeVisible();
  await expect.poll(() => playback.streams).toContain(`series/${SERIES}:1:2`);
  await expect.poll(() => videoValue(page, 'playbackRate')).toBe(1);
  await openMore(page);
  await expect(panel(page).getByRole('button', { name: 'Speed, Normal' })).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: /^Sleep timer, (30|29) min left$/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('the sleep timer at the end of the episode pauses there, under its dark screen', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page, { streams: STREAMS });
  await openApp(page);
  await playFirstEpisode(page);

  await openMore(page);
  await panel(page).getByRole('button', { name: 'Sleep timer, Off' }).click();
  await panel(page).getByRole('button', { name: 'End of episode', exact: true }).click();
  await openMore(page);
  await expect(
    panel(page).getByRole('button', { name: 'Sleep timer, End of episode' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // Near the end: its last minute shows in the corner once the controls go (a tap here: the
  // browser's video can read as buffering after a seek, which keeps them up), and nothing
  // counts to the next episode.
  const bar = page.getByRole('slider');
  if (!(await bar.isVisible())) await page.mouse.click(206, 160);
  const box = await bar.boundingBox();
  if (!box) throw new Error('The seek bar has no size');
  await bar.click({ position: { x: box.width * 0.975, y: box.height / 2 } });
  await expect.poll(() => videoValue(page, 'currentTime')).toBeGreaterThan(570);
  await page.mouse.click(206, 160);
  await expect(page.getByRole('button', { name: 'More options' })).toBeHidden();
  await expect(page.getByText('Pausing when this episode ends')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();
  await expect(page.getByText('Up next')).toHaveCount(0);

  // The end: paused under the dark screen, and the next episode does not start.
  await expect(page.getByText('Paused by the sleep timer')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByText('Paused by the sleep timer')).toBeVisible();
  expect(await videoValue(page, 'currentTime')).toBeGreaterThan(590);
  await expect(page.getByText('Up next')).toHaveCount(0);
  // Carry on watching at the end: Up Next counts to the next episode, over the picture.
  await page.getByRole('button', { name: 'Carry on watching' }).click();
  await expect(page.getByText('Paused by the sleep timer')).toHaveCount(0);
  await expect(page.getByText('Up next')).toBeVisible();
  expect(errors).toEqual([]);
});

/**
 * Info's "Ends at", against what is left of the browser's video at its speed: within a minute
 * either way, as the clock may turn over while it is read.
 */
async function expectEndsAt(page: Page): Promise<void> {
  const shown = panel(page).getByText(/^Ends at \d\d:\d\d$/);
  await expect(shown).toBeVisible();
  const expected = await page.evaluate(() => {
    const video = document.querySelector('video')!;
    const at = Date.now() + ((video.duration - video.currentTime) * 1000) / video.playbackRate;
    const clock = (ms: number) => {
      const when = new Date(ms);
      return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
    };
    return [clock(at - 60_000), clock(at), clock(at + 60_000)].map((time) => `Ends at ${time}`);
  });
  expect(expected).toContain(await shown.textContent());
}
