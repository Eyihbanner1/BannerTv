import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { mockPlayback, seedStreamAddon } from './play';
import { APP_URL, expectFocus, press, watchErrors } from './tv';

test('More like this waits for focus, slides the page up, and opens another title', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  const details = page.locator('section[aria-label="Elephants Dream"]:visible');
  await expect(details.getByText('More Animation from Cinemeta')).toBeAttached();
  // Resting on Watch looks for its stream, and the line under the buttons says how it went.
  await expect(details.getByText(/^Best stream ready/)).toBeVisible();
  // Nothing asked for the row yet.
  expect(requests.catalogs.filter((key) => key.indexOf('genre=') !== -1)).toEqual([]);

  await press(page, 'ArrowDown', 'details-more-tile-0');
  await expect.poll(() => requests.catalogs).toContain('movie/top/genre=Animation');
  // The page slides up so the row shows whole, and the title itself is not in it.
  await expect(page.locator('[data-row-key="details-more"]')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('[data-focus-key^="details-more-tile-"]').first()).not.toHaveAttribute(
    'aria-label',
    /^Elephants Dream/,
  );
  const label = await page.locator('[data-focused="true"]').getAttribute('aria-label');
  const name = (label ?? '').split(',')[0]!;
  await press(page, 'ArrowUp', 'details-watch');
  await expect(page.locator('[data-row-key="details-more"]')).not.toBeInViewport({ ratio: 1 });

  await press(page, 'ArrowDown', 'details-more-tile-0');
  await page.keyboard.press('Enter');
  await expect(page.locator(`section[aria-label="${name}"]:visible`)).toBeVisible();
  expect(errors).toEqual([]);
});

test('beside the episodes, Left comes back to the first button, not to More like this', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page);
  await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  const details = page.locator('section[aria-label="Morevna Project"]:visible');
  await expect(details.getByText('More Animation from Cinemeta')).toBeAttached();

  await press(page, 'ArrowLeft', 'details-start');
  await press(page, 'ArrowDown', 'details-more-tile-0');
  await expect(page.locator('[data-row-key="details-more"]')).toBeInViewport({ ratio: 1 });
  // Up from the row and over to the episodes, then back: the first button again.
  await press(page, 'ArrowUp', 'details-start');
  await expect(page.locator('[data-row-key="details-more"]')).not.toBeInViewport({ ratio: 1 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'details-episodes-0');
  await press(page, 'ArrowLeft', 'details-start');
  expect(errors).toEqual([]);
});
