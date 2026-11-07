import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { mockPlayback, seedStreamAddon } from './play';
import { APP_URL, expectFocus, press, pressBack } from './tv';

/** The first episode of the series on Home, as Stremio names it. */
const EPISODE = 'tt8000001:1:1';

/** A 10 minute file, so Up Next's last 30 seconds are well away from the intro. */
const LONG_EPISODE = [
  {
    name: 'Test Streams\n1080p',
    description: 'Open Movie 1080p WEB-DL x264\n💾 1.4 GB ⚡ Cached',
    path: '/long-episode-1080p.webm',
  },
];

/** What the player's video element is doing. */
function video(page: Page) {
  return page.locator('video:not([aria-hidden])').evaluate((element: HTMLVideoElement) => ({
    playing: !element.paused && element.currentTime > 0,
    time: element.currentTime,
  }));
}

async function playEpisode(
  page: Page,
  timings: { intro?: readonly [number, number]; recap?: readonly [number, number] },
) {
  await mockAddons(page);
  await seedStreamAddon(page);
  const mock = await mockPlayback(page, {
    streams: { [EPISODE]: LONG_EPISODE },
    skips: { [EPISODE]: timings },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  return mock;
}

const focused = (page: Page) => page.locator('[data-focused="true"]');

test('Skip intro shows as the intro starts, and OK jumps to its end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mock = await playEpisode(page, { intro: [3, 25] });
  await expect.poll(() => mock.skips).toEqual(['tt8000001:1:1']);
  const card = page.getByRole('dialog', { name: 'Skip intro' });
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-skip-button', {
    timeout: 10000,
  });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Skip intro');

  // The wheel over it never skips.
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(400);
  expect((await video(page)).time).toBeLessThan(20);
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('cursorStateChange', { detail: { visibility: false } })),
  );

  // The pointer heading for it brings no controls up, and the card keeps focus.
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-skip-button');

  // OK skips to the end of the intro, the card goes, and the picture plays on.
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThanOrEqual(24);
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  expect(errors).toEqual([]);
});

test('Back lets Skip recap go, and the recap plays on without it', async ({ page }) => {
  await playEpisode(page, { recap: [0, 40] });
  const card = page.getByRole('dialog', { name: 'Skip recap' });
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-skip-button', {
    timeout: 10000,
  });
  await expect(card).toContainText('Skip recap');

  await pressBack(page);
  await expect(card).toHaveCount(0);
  await expectFocus(page, 'player-surface');
  await page.waitForTimeout(1500);
  await expect(card).toHaveCount(0);
  const { time, playing } = await video(page);
  expect(playing).toBe(true);
  expect(time).toBeLessThan(20);
});

test('Skip intro goes by itself after a few seconds, never skipping', async ({ page }) => {
  test.slow();
  await playEpisode(page, { intro: [1, 60] });
  const card = page.getByRole('dialog', { name: 'Skip intro' });
  await expect(card).toBeVisible({ timeout: 10000 });
  await expect(card).toHaveCount(0, { timeout: 15000 });
  const { time } = await video(page);
  expect(time).toBeGreaterThan(9);
  expect(time).toBeLessThan(30);
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
});

test('Back before the intro brings Skip intro back after Back let it go', async ({ page }) => {
  await playEpisode(page, { intro: [3, 25] });
  const card = page.getByRole('dialog', { name: 'Skip intro' });
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-skip-button', {
    timeout: 10000,
  });
  await pressBack(page);
  await expect(card).toHaveCount(0);

  // Rewind to before the intro and play into it again: the card is back.
  await page
    .locator('video:not([aria-hidden])')
    .evaluate((element: HTMLVideoElement) => void (element.currentTime = 0.5));
  await expect(card).toBeVisible({ timeout: 10000 });
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-skip-button');
});

test('with the controls up, Skip intro waits above the bar: Up from the bar reaches it, and it skips', async ({
  page,
}) => {
  const mock = await playEpisode(page, { intro: [3, 25] });
  await expect.poll(() => mock.skips).toEqual([EPISODE]);
  const card = page.getByRole('dialog', { name: 'Skip intro' });
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-skip-button', {
    timeout: 10000,
  });
  // Up brings the controls in the card's place, and Skip intro with them.
  await press(page, 'ArrowUp', 'player-play');
  await expect(card).toHaveCount(0);
  const skip = page.locator('[data-focus-key="player-skip-chrome"]');
  await expect(skip).toBeVisible();
  await expect(skip).toHaveText('Skip intro');
  await press(page, 'ArrowUp', 'player-seek');
  await press(page, 'ArrowUp', 'player-skip-chrome');
  // Down goes back to the bar, and Up again to it.
  await press(page, 'ArrowDown', 'player-seek');
  await press(page, 'ArrowUp', 'player-skip-chrome');

  // OK skips to the end of the intro, and the controls go with it.
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThanOrEqual(24);
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
  await expect(skip).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expectFocus(page, 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
});

test('Left and Right on Skip intro skip as they do over the picture, adding up', async ({
  page,
}) => {
  await playEpisode(page, { intro: [3, 120] });
  const card = page.getByRole('dialog', { name: 'Skip intro' });
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-skip-button', {
    timeout: 10000,
  });
  const start = (await video(page)).time;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('+20 s', { exact: true })).toBeVisible();
  // It lands once, a moment after the last press.
  expect((await video(page)).time).toBeLessThan(start + 5);
  await expect
    .poll(async () => (await video(page)).time, { timeout: 3000 })
    .toBeGreaterThan(start + 18);
  // Its few seconds are past: the card goes, and focus is back on the picture.
  await expect(card).toHaveCount(0);
  await expectFocus(page, 'player-surface');
  await expect(page.locator('[data-focus-key="player-play"]')).toBeHidden();
});

test('a jump of two minutes or more offers for a moment to go back: Skip recap, and a click on the bar', async ({
  page,
}) => {
  await playEpisode(page, { recap: [3, 150] });
  const card = page.getByRole('dialog', { name: 'Skip recap' });
  await expect(focused(page)).toHaveAttribute('data-focus-key', 'player-skip-button', {
    timeout: 10000,
  });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await video(page)).time).toBeGreaterThanOrEqual(149);
  await expect(card).toHaveCount(0);

  // Start over's place says where it came from, and goes back there.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowLeft', 'player-back10');
  await press(page, 'ArrowLeft', 'player-restart');
  const restart = page.locator('[data-focus-key="player-restart"]');
  await expect(restart).toHaveText(/^Back to 0:0\d$/);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await video(page)).time).toBeLessThan(15);
  await expect(restart).toHaveText('Start over');

  // A click halfway along the bar does the same. Not straight after the OK,
  // which on the TV comes with a click of its own that the player ignores.
  await page.waitForTimeout(500);
  const bar = page.locator('[data-focus-key="player-seek"] > div');
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y - 120);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await video(page)).time).toBeGreaterThan(250);
  await expect(restart).toHaveText(/^Back to 0:[01]\d$/);
});
