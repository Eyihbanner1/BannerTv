import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { serveFixture } from './play';
import { APP_URL, expectFocus, press } from './tv';

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
  await expect(page.getByText(/^Clock at start: \d/)).toHaveText(
    /^Clock at start: 0\.0 s at the playing event, 0\.\d s at the first timeupdate/,
  );
  // An engine that counts no frames says so instead of claiming zero drops.
  await expect(page.getByText(/^Video:/)).not.toContainText('0 dropped of 0');
});
