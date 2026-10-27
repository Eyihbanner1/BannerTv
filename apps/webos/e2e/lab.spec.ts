import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Route, test } from '@playwright/test';
import { APP_URL, expectFocus, press } from './tv';

// 40 s of blank VP8, which test Chromium plays (it has no H.264).
const FIXTURE = readFileSync(resolve(import.meta.dirname, 'fixtures/blank-40s.webm'));

/** Serves the fixture with byte ranges, which the media element needs to seek. */
function serveFixture(route: Route) {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : FIXTURE.length - 1;
  return route.fulfill({
    status: range ? 206 : 200,
    contentType: 'video/webm',
    headers: {
      'accept-ranges': 'bytes',
      ...(range && { 'content-range': `bytes ${start}-${end}/${FIXTURE.length}` }),
    },
    body: FIXTURE.subarray(start, end + 1),
  });
}

test('a seek left over from a failed load does not move the next one', async ({ page }) => {
  await page.route('**/big_buck_bunny.mp4', (route) => route.fulfill({ status: 404 }));
  await page.route('**/test5.mkv', serveFixture);
  await page.goto(APP_URL);
  await expectFocus(page, 'home-row-0-tile-0');

  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'addons', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-diagnostics');
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
  await expect(page.getByText(/playing at: \d/)).toHaveText('Started playing at: 0.0 s');
  // An engine that counts no frames says so instead of claiming zero drops.
  await expect(page.getByText(/^Video:/)).not.toContainText('0 dropped of 0');
});
