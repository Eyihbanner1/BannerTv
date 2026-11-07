import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { readKv, serveFixture } from './play';
import { APP_URL, expectFocus, press, pressBack } from './tv';

test('a seek left over from a failed load does not move the next one', async ({ page }) => {
  await mockAddons(page);
  await page.route('**/big_buck_bunny.mp4', (route) => route.fulfill({ status: 404 }));
  await page.route('**/test5.mkv', serveFixture);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'addons', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-stream-choice');
  await press(page, 'ArrowDown', 'settings-probing');
  await press(page, 'ArrowDown', 'settings-subtitle-style');
  await press(page, 'ArrowDown', 'settings-still-watching');
  await press(page, 'ArrowDown', 'settings-next-at-credits');
  await press(page, 'ArrowDown', 'settings-diagnostics');
  await press(page, 'ArrowDown', 'settings-lab');
  await press(page, 'Enter', 'lab-start-mode');

  // "30 s by seeking", then a source that fails before its metadata arrives.
  await press(page, 'Enter', 'lab-start-mode');
  await press(page, 'Enter', 'lab-start-mode');
  await expect(page.getByText('Start: 30 s by seeking')).toBeVisible();
  await press(page, 'ArrowDown', 'lab-source-0');
  await press(page, 'ArrowDown', 'lab-source-1');
  await press(page, 'ArrowDown', 'lab-source-2');
  await press(page, 'Enter', 'lab-source-2');
  await expect(page.getByText(/^Error:/)).toBeVisible();

  // Back to "from the beginning" for the next source.
  await press(page, 'ArrowUp', 'lab-source-1');
  await press(page, 'ArrowUp', 'lab-source-0');
  await press(page, 'ArrowUp', 'lab-start-mode');
  await press(page, 'Enter', 'lab-start-mode');
  await expect(page.getByText('Start: from the beginning')).toBeVisible();
  await press(page, 'ArrowDown', 'lab-source-0');
  await press(page, 'Enter', 'lab-source-0');
  await expect(page.getByText(/^Clock at start: \d/)).toHaveText(
    /^Clock at start: 0\.0 s at the playing event, 0\.\d s at the first timeupdate/,
  );
  // An engine that counts no frames says so instead of claiming zero drops.
  await expect(page.getByText(/^Video:/)).not.toContainText('0 dropped of 0');

  // The same source in BannerTV's own player, without asking any addon.
  await press(page, 'ArrowDown', 'lab-source-1');
  await press(page, 'ArrowDown', 'lab-source-2');
  await press(page, 'ArrowDown', 'lab-fullscreen');
  await press(page, 'ArrowDown', 'lab-player');
  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(() =>
      page
        .locator('video:not([aria-hidden])')
        .evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 0),
    )
    .toBe(true);
  await pressBack(page);
  await expect(page.getByText('Start: from the beginning')).toBeVisible();
});

test('the Lab measures each speed on what plays, asks about sound, and keeps what passed', async ({
  page,
}) => {
  test.slow();
  await mockAddons(page);
  await page.route('**/test5.mkv', serveFixture);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'addons', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-stream-choice');
  for (const item of [
    'probing',
    'subtitle-style',
    'still-watching',
    'next-at-credits',
    'diagnostics',
    'lab',
  ]) {
    await press(page, 'ArrowDown', `settings-${item}`);
  }
  await press(page, 'Enter', 'lab-start-mode');
  for (const item of ['source-0', 'source-1', 'source-2', 'fullscreen', 'player']) {
    await press(page, 'ArrowDown', `lab-${item}`);
  }
  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(() =>
      page
        .locator('video:not([aria-hidden])')
        .evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 0),
    )
    .toBe(true);

  // In the Lab, Info has Speed before anything has passed, to run the test.
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'ArrowRight', 'player-quality-button');
  await press(page, 'ArrowRight', 'player-info-button');
  await press(page, 'Enter', 'player-info-about');
  await press(page, 'ArrowUp', 'player-info-tab-about');
  await press(page, 'ArrowRight', 'player-info-tab-speed');
  await expect(
    page.getByText(/^Measures 0\.75×, 1\.25× and 1\.5× for the TV's player, files/),
  ).toBeVisible();
  await expect(page.locator('[data-focus-key^="player-info-speed-1"]')).toHaveText(['Normal']);
  await press(page, 'Enter', 'player-info-speed-test');
  // Stop takes focus, under a key of its own: a held OK does not stop what it started.
  await press(page, 'Enter', 'player-info-speed-stop');
  await expect(page.getByText('Measuring normal speed…')).toBeVisible();
  // A speed pressed while the test sets them is not taken: Normal now would
  // read as the TV putting 0.75× back.
  await expect(page.getByText('Measuring 0.75×…')).toBeVisible({ timeout: 15000 });
  await press(page, 'ArrowDown', 'player-info-speed-1');
  await page.keyboard.press('Enter');

  // Each speed that kept time plays while the tester says whether there is sound.
  const yes = page.locator('[data-focus-key="player-info-speed-yes"]');
  for (const [rate, heard] of [
    ['0.75', true],
    ['1.25', true],
    ['1.5', false],
  ] as const) {
    await expect(yes).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(`Playing at ${rate}×. Can you hear the sound, at the right pitch?`),
    ).toBeVisible();
    await expectFocus(page, 'player-info-speed-yes');
    if (!heard) await press(page, 'ArrowRight', 'player-info-speed-no');
    await page.keyboard.press('Enter');
    await expect(yes).toHaveCount(0);
    await expectFocus(page, 'player-info-speed-stop');
  }
  await expect(
    page.getByText(
      "Saved for the TV's player, files. 0.75×: passed · 1.25×: passed · 1.5×: no sound · Normal again: passed",
    ),
  ).toBeVisible({ timeout: 15000 });
  await expectFocus(page, 'player-info-speed-test');

  // What passed is offered at once, and kept for the whole TV.
  await expect(page.locator('[data-focus-key^="player-info-speed-"]')).toHaveText([
    'Test again',
    'Normal',
    '0.75×',
    '1.25×',
  ]);
  const kept = (await readKv(page, 'playback-speed')) as {
    results: Record<string, { rates: number[]; why?: string }>;
  };
  expect(kept.results['native-file']).toMatchObject({ rates: [0.75, 1.25], why: 'sound' });
});
