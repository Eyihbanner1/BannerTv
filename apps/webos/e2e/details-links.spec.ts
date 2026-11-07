import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { mockServices } from './services';
import { APP_URL, expectFocus, openSection, press, pressBack, watchErrors } from './tv';

test('a genre on Details opens Discover on it; one no catalog can filter by stays words', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  const details = page.locator('section[aria-label="Elephants Dream"]:visible');
  // Animation is one of Cinemeta's film genres; Short is not.
  await expect(details.getByText('Short', { exact: true })).toBeVisible();
  await expect(page.locator('[data-focus-key^="details-genre-"]')).toHaveCount(1);

  await press(page, 'ArrowUp', 'details-genre-Animation');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'aria-label',
    'Browse Animation from Cinemeta',
  );
  await press(page, 'ArrowDown', 'details-watch');
  await press(page, 'ArrowUp', 'details-genre-Animation');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focus-key="discover-genre"]')).toHaveAttribute(
    'aria-label',
    'Genre: Animation',
  );
  await expect.poll(() => requests.catalogs).toContain('movie/top/genre=Animation');

  await pressBack(page);
  await expectFocus(page, 'details-genre-Animation');
  expect(errors).toEqual([]);
});

test('a face in the cast opens Search on the name, and Back returns to it', async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await mockServices(page, { tmdb: true });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('[data-focus-key="details-cast-0"]')).toHaveAttribute(
    'aria-label',
    'Cas Jansen, search for more with them',
  );

  await press(page, 'ArrowDown', 'details-cast-0');
  await press(page, 'ArrowRight', 'details-cast-1');
  await page.keyboard.press('Enter');
  const input = page.locator('input[aria-label="Search"]');
  await expect(input).toHaveValue('Tygo Gernandt');
  await expectFocus(page, 'search-field');
  // Searched at once, without the TV keyboard.
  await expect(input).not.toBeFocused();

  await pressBack(page);
  await expectFocus(page, 'details-cast-1');
  // Up from the first face is the buttons again, and More like this is under the faces.
  await press(page, 'ArrowLeft', 'details-cast-0');
  await press(page, 'ArrowUp', 'details-watch');
  await press(page, 'ArrowDown', 'details-cast-0');
  await press(page, 'ArrowDown', 'details-more-tile-0');
  await press(page, 'ArrowUp', 'details-cast-0');
  expect(errors).toEqual([]);
});

test('over Discover, a genre opens its catalog, and Discover still answers the remote after Back', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'discover');
  await expectFocus(page, 'discover-tile-0');
  await press(page, 'Enter', 'details-watch');
  await press(page, 'ArrowUp', 'details-genre-Animation');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focus-key="discover-genre"]')).toHaveAttribute(
    'aria-label',
    'Genre: Animation',
  );
  await expect(page.locator('[data-focus-key="discover-genre"]')).toHaveCount(1);

  await pressBack(page);
  await expectFocus(page, 'details-genre-Animation');
  await pressBack(page);
  await expectFocus(page, 'discover-tile-0');
  await press(page, 'ArrowRight', 'discover-tile-1');
  await press(page, 'ArrowUp', 'discover-type');
  await expect(page.locator('[data-focus-key="discover-genre"]')).toHaveAttribute(
    'aria-label',
    'Genre: All genres',
  );
  expect(errors).toEqual([]);
});

test('over Search, a face opens that Search on the name, which still answers the remote', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await mockServices(page, { tmdb: true });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, 'search-field');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sintel');
  await expect(page.locator('[data-row-key="search-res-0-movie-top"]')).toBeVisible();
  await press(page, 'ArrowDown', 'search-res-0-movie-top-tile-0');
  await press(page, 'Enter', 'details-watch');
  // Sintel has a trailer, so its buttons take two lines.
  await press(page, 'ArrowDown', 'details-watched');
  await press(page, 'ArrowDown', 'details-cast-0');
  await page.keyboard.press('Enter');

  const input = page.locator('input[aria-label="Search"]');
  await expect(input).toHaveValue('Cas Jansen');
  await expect(input).toHaveCount(1);
  await expectFocus(page, 'search-field');
  await press(page, 'ArrowLeft', 'rail-search');
  await press(page, 'ArrowRight', 'search-field');
  expect(errors).toEqual([]);
});
