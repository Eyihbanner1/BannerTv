import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { APP_URL, expectFocus, openSection, press, pressBack, watchErrors } from './tv';

const FIELD = 'search-field';
const MOVIE_RESULTS = 'search-res-0-movie-top';

test('Search finds titles as typing pauses, and Back returns to the result', async ({ page }) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  await expect(page.getByText('Press OK on the box to type.')).toBeVisible();

  // OK starts typing; landing on the box alone does not.
  const input = page.locator('input[aria-label="Search"]');
  await expect(input).not.toBeFocused();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.type('sintl');
  // Left and Right move the caret while typing, not focus.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('e');
  await page.keyboard.press('ArrowRight');
  await expect(input).toHaveValue('sintel');
  await expectFocus(page, FIELD);

  // Results come as rows grouped by type; the empty Series row disappears.
  const movies = page.locator(`[data-row-key="${MOVIE_RESULTS}"]`);
  await expect(movies.locator('h2')).toHaveText('MoviesCinemeta');
  await expect(page.locator('[data-row-key="search-res-0-series-top"]')).toHaveCount(0);
  expect(requests.catalogs).toContain('movie/top/search=sintel');
  expect(requests.catalogs).toContain('series/top/search=sintel');
  expect(requests.catalogs.filter((key) => key.includes('search=sin'))).toEqual([
    'movie/top/search=sintel',
    'series/top/search=sintel',
  ]);

  await press(page, 'ArrowDown', `${MOVIE_RESULTS}-tile-0`);
  await expect(input).not.toBeFocused();
  await expect(page.locator(`[data-focus-key="${MOVIE_RESULTS}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    'Sintel, 2010',
  );
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('section[aria-label="Sintel"]:visible')).toBeVisible();

  await pressBack(page);
  await expectFocus(page, `${MOVIE_RESULTS}-tile-0`);
  await expect(input).toHaveValue('sintel');
  await press(page, 'ArrowUp', FIELD);

  // Opening a result remembered the search, across launches too.
  await page.waitForTimeout(300);
  await page.reload();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  await press(page, 'ArrowDown', 'search-recent-0');
  await expect(page.locator('[data-focus-key="search-recent-0"]')).toHaveText('sintel');
  await page.keyboard.press('Enter');
  await expectFocus(page, FIELD);
  await expect(input).toHaveValue('sintel');
  await expect(movies.locator('h2')).toHaveText('MoviesCinemeta');
  expect(errors).toEqual([]);
});

test('Search says when nothing matches, and Back stops typing first', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  const input = page.locator('input[aria-label="Search"]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('zzz');
  await expect(page.getByText('Nothing found for “zzz”.')).toBeVisible();

  await pressBack(page);
  await expect(input).not.toBeFocused();
  await expectFocus(page, FIELD);
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
});

test('the Trailer button hands the trailer to the YouTube app', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.evaluate(() => {
    const w = window as Window & { trailer?: string };
    window.addEventListener('bannertv:trailer', (event) => {
      w.trailer = (event as CustomEvent<string>).detail;
    });
  });
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-2`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'ArrowRight', 'details-trailer');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => (window as Window & { trailer?: string }).trailer))
    .toBe('eRsGyueVLvQ');
});

const keyboardShown = (visibility: boolean) =>
  document.dispatchEvent(new CustomEvent('keyboardStateChange', { detail: { visibility } }));

test('the TV keyboard microphone key keeps the box typing, and spoken words search', async ({
  page,
}) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  const input = page.locator('input[aria-label="Search"]');
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();

  // The microphone key hides the keyboard for a moment, then voice input shows it again.
  await page.evaluate(keyboardShown, false);
  await page.waitForTimeout(400);
  await page.evaluate(keyboardShown, true);
  await page.waitForTimeout(2500);
  await expect(input).toBeFocused();

  // The words arrive as text with no key presses, as the TV's voice input sends them.
  await page.keyboard.insertText('sintel');
  await expect(input).toHaveValue('sintel');
  await expect(page.locator(`[data-row-key="${MOVIE_RESULTS}"] h2`)).toHaveText('MoviesCinemeta');

  // The keyboard closing for good still ends typing, with focus left on the box.
  await page.evaluate(keyboardShown, false);
  await expect(input).not.toBeFocused({ timeout: 4000 });
  await expectFocus(page, FIELD);
});
