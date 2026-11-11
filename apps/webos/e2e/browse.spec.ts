import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { APP_URL, expectFocus, press, pressBack } from './tv';

/**
 * Whether a season tab sits wholly inside the row that clips it. Playwright's
 * own visibility checks miss a tab slid out of its row, which still draws on
 * the page, only hidden by the row's overflow.
 */
function tabInsideItsRow(page: Page, index: number): Promise<boolean> {
  return page.locator(`[data-focus-key="details-season-${index}"]`).evaluate((tab) => {
    const row = tab.parentElement!.parentElement!.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    return box.left >= row.left && box.right <= row.right;
  });
}

test('Home builds Netflix-style rows from Cinemeta', async ({ page }) => {
  const requests = await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  const titles = page.locator('[data-row-key] h2');
  await expect(titles.nth(0)).toHaveText('PopularMovies');
  await expect(titles.nth(1)).toHaveText('PopularSeries');
  await expect(titles.nth(2)).toHaveText('FeaturedMovies');
  // Featured rows use wide backdrop tiles with the title logo.
  const wide = page.locator('[data-focus-key="home-0-movie-imdbrating-tile-0"]');
  await expect(wide).toHaveCSS('width', '384px');
  await expect(wide.locator('img')).toHaveCount(2);
  // A 1x display keeps the addon's own image sizes.
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-0"] img`)).toHaveAttribute(
    'src',
    /\/poster\/small\//,
  );
  // The hero shows the first title before anything is focused away from it.
  await expect(
    page.locator(
      'section[aria-label="Elephants Dream"] h1, section[aria-label="Elephants Dream"] img',
    ),
  ).not.toHaveCount(0);

  // Only rows near the view were asked for.
  expect([...requests.catalogs].sort()).toEqual(['movie/imdbRating', 'movie/top', 'series/top']);

  // Moving down fetches the next rows, genre rows included.
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', 'home-0-movie-imdbrating-tile-0');
  await press(page, 'ArrowDown', 'home-0-series-imdbrating-tile-0');
  await press(page, 'ArrowDown', 'home-0-movie-top-genre-action-tile-0');
  await expect.poll(() => requests.catalogs).toContain('movie/top/genre=Action');
  await expect(titles.filter({ hasText: 'Action' })).toHaveText('ActionMovies');
});

/** The titles whose backdrop the hero is showing, by the id in each image's address. */
const heroBackdrops = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="/background/"]'))
      // The hero's backdrop is far wider than any tile.
      .filter(
        (img) =>
          img.getBoundingClientRect().width > 1000 && Number(getComputedStyle(img).opacity) > 0.5,
      )
      .map((img) => /tt\d+/.exec(img.src)?.[0]),
  );

for (const heroFade of [true, false]) {
  test(`the hero follows focus back to a title whose backdrop just ${heroFade ? 'faded out' : 'went'}`, async ({
    page,
  }) => {
    await mockAddons(page);
    // The keys are timed against a 250 ms hero wait. By default quick presses
    // wait 800 ms, which a single press after a rest can still race.
    await page.addInitScript(
      (stored) => localStorage.setItem('bannertv.tuning', stored),
      JSON.stringify({ heroBusyMs: 250, heroFade }),
    );
    await page.goto(APP_URL);
    await expectFocus(page, `${FIRST_ROW}-tile-0`);
    await expect.poll(() => heroBackdrops(page)).toEqual(['tt0807840']);
    // Back just as the next title's backdrop has shown, while the old one may be under it.
    // The keys go straight in, since waiting to see focus move would blur the timing.
    for (const rest of [300, 350, 400, 300, 350, 400]) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(rest);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(1000);
      await expectFocus(page, `${FIRST_ROW}-tile-0`);
      await expect.poll(() => heroBackdrops(page)).toEqual(['tt0807840']);
    }
  });
}

test('a title with no backdrop clears the last one from the hero', async ({ page }) => {
  await mockAddons(page);
  await page.route('https://images.metahub.space/background/medium/tt1254207/img', (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => heroBackdrops(page)).toEqual(['tt0807840']);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await expect(page.locator('section[aria-label="Big Buck Bunny"]')).toBeVisible();
  await expect.poll(() => heroBackdrops(page)).toEqual([]);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-2`);
  await expect.poll(() => heroBackdrops(page)).toEqual(['tt1727587']);
});

test('a series opens on season 1, and seasons switch as focus moves', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await expect(page.locator('section[aria-label="Morevna Project"]:visible')).toBeVisible();
  await expect(page.getByText('1. Season 1 episode 1')).toBeVisible();

  for (let n = 1; n <= 6; n++) await press(page, 'ArrowDown', `details-episodes-${n}`);
  // The list slides so the focused episode stays near the top.
  await expect(page.getByText('7. Season 1 episode 7')).toBeInViewport();

  await press(page, 'ArrowUp', 'details-episodes-5');
  for (let n = 4; n >= 0; n--) await press(page, 'ArrowUp', `details-episodes-${n}`);
  await press(page, 'ArrowUp', 'details-season-0');
  await expect.poll(() => tabInsideItsRow(page, 0)).toBe(true);
  await press(page, 'ArrowRight', 'details-season-1');
  await expect(page.getByText('1. Season 2 episode 1')).toBeVisible();
  await expect.poll(() => tabInsideItsRow(page, 1)).toBe(true);
  await press(page, 'ArrowRight', 'details-season-2');
  await expect(page.getByText('1. Behind the scenes')).toBeVisible();
  await expect(page.locator('[data-focus-key="details-season-2"]')).toHaveText('Specials');
  await expect.poll(() => tabInsideItsRow(page, 2)).toBe(true);

  await press(page, 'ArrowDown', 'details-episodes-0');
  // No stream addon is installed, so the player says so.
  await press(page, 'Enter', 'player-problem-streams');
  await expect(page.getByText('No stream could play')).toBeVisible();
  await expect(
    page.getByText('You have no addon that finds streams yet. Add one in Addons.'),
  ).toBeVisible();

  await pressBack(page);
  await expectFocus(page, 'details-episodes-0');
  await pressBack(page);
  await expectFocus(page, `${SERIES_ROW}-tile-0`);
});

test('a row whose addon fails says so and can try again', async ({ page }) => {
  let calls = 0;
  await mockAddons(page, {
    catalogs: {
      'series/top': (route) => {
        calls++;
        return calls === 1
          ? route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' } })
          : undefined;
      },
    },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.getByText('Cinemeta answered with an error (500).')).toBeVisible();

  // Try again sits where the first tile goes, so focus stays put when the titles arrive.
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Cinemeta answered with an error')).toHaveCount(0);
  await expectFocus(page, `${SERIES_ROW}-tile-0`);
  await expect(page.locator(`[data-focus-key="${SERIES_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    'Morevna Project, 2016–',
  );
});

test('an empty catalog leaves no gap in Home', async ({ page }) => {
  await mockAddons(page, {
    catalogs: {
      'series/top': (route) =>
        route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: '{"metas":[]}',
        }),
    },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator(`[data-row-key="${SERIES_ROW}"]`)).toHaveCount(0);
  await press(page, 'ArrowDown', 'home-0-movie-imdbrating-tile-0');
});

test('the second launch shows Home from storage, even offline', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    'Elephants Dream, 2006',
  );
  // Give IndexedDB a moment to finish writing.
  await page.waitForTimeout(300);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.reload();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    'Elephants Dream, 2006',
  );
});

test.describe('on a 4K TV', () => {
  test.use({ deviceScaleFactor: 2 });

  test('artwork is asked for at the size the screen draws it', async ({ page }) => {
    await mockAddons(page);
    await page.goto(APP_URL);
    await expectFocus(page, `${FIRST_ROW}-tile-0`);
    await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-0"] img`)).toHaveAttribute(
      'src',
      /\/poster\/medium\/tt/,
    );
    const hero = page.locator('section[aria-label="Elephants Dream"]');
    // Metahub's medium backdrop is already 1920x1080.
    await expect(hero.locator('img').first()).toHaveAttribute('src', /\/background\/medium\/tt/);
    await expect(hero.locator('img').last()).toHaveAttribute('src', /\/logo\/large\/tt/);
    // Wide tiles already get enough pixels from the medium backdrop.
    await expect(
      page.locator('[data-focus-key="home-0-movie-imdbrating-tile-0"] img').first(),
    ).toHaveAttribute('src', /\/background\/medium\/tt/);
  });

  test('the hero can still ask for large backdrops from tuning', async ({ page }) => {
    await mockAddons(page);
    await page.addInitScript(() =>
      localStorage.setItem('bannertv.tuning', JSON.stringify({ heroArt: 'large' })),
    );
    await page.goto(APP_URL);
    await expectFocus(page, `${FIRST_ROW}-tile-0`);
    const hero = page.locator('section[aria-label="Elephants Dream"]');
    await expect(hero.locator('img').first()).toHaveAttribute('src', /\/background\/large\/tt/);
  });

  test('wide tiles can ask for small art from tuning, and the hero keeps its own size', async ({
    page,
  }) => {
    await mockAddons(page);
    await page.addInitScript(() =>
      localStorage.setItem('bannertv.tuning', JSON.stringify({ wideArt: 'small' })),
    );
    await page.goto(APP_URL);
    await expectFocus(page, `${FIRST_ROW}-tile-0`);
    await expect(
      page.locator('[data-focus-key="home-0-movie-imdbrating-tile-0"] img').first(),
    ).toHaveAttribute('src', /\/background\/small\/tt/);
    const hero = page.locator('section[aria-label="Elephants Dream"]');
    await expect(hero.locator('img').first()).toHaveAttribute('src', /\/background\/medium\/tt/);
  });
});
