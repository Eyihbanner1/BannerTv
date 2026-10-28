import { expect, type Route, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { APP_URL, expectFocus, expectFocusLabel, press } from './tv';

const MOVIES = [
  'Elephants Dream',
  'Big Buck Bunny',
  'Sintel',
  'Tears of Steel',
  'Caminandes',
  'Cosmos Laundromat',
  'Glass Half',
  'Agent 327',
  'Hero',
  'Spring',
  'Coffee Run',
  'Sprite Fright',
  'Charge',
  'Wing It!',
];

const answer = (route: Route, body: unknown) =>
  route.fulfill({
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

test('a row reloading far from where it was left keeps focus on the tile it lands on', async ({
  page,
}) => {
  // The first row's titles expire at once, and coming back for them is slow.
  let calls = 0;
  await mockAddons(page, {
    catalogs: {
      'movie/top': async (route) => {
        calls++;
        if (calls > 1) await new Promise((resolve) => setTimeout(resolve, 1500));
        await answer(route, {
          metas: MOVIES.map((name, n) => ({
            id: `tt66${String(n).padStart(5, '0')}`,
            type: 'movie',
            name,
            poster: `https://images.metahub.space/poster/small/tt66${n}/img`,
          })),
          cacheMaxAge: 1,
          staleRevalidate: 0,
          staleError: 0,
        });
      },
    },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  for (let n = 1; n <= 11; n++) await press(page, 'ArrowRight', `${FIRST_ROW}-tile-${n}`);
  const rows = [
    SERIES_ROW,
    'home-0-movie-imdbrating',
    'home-0-series-imdbrating',
    'home-0-movie-top-genre-action',
  ];
  for (const row of rows) await press(page, 'ArrowDown', `${row}-tile-0`);
  // Far enough that the first row is no longer drawn, and long enough that it expired.
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-11"]`)).toHaveCount(0);
  await page.waitForTimeout(1200);
  for (const row of rows.slice(0, 3).reverse()) await press(page, 'ArrowUp', `${row}-tile-0`);

  // While it reloads it shows fewer tiles, so focus lands on the last one drawn,
  // and stays there when the titles arrive.
  await press(page, 'ArrowUp', `${FIRST_ROW}-tile-6`);
  await expectFocusLabel(page, 'Glass Half');
  await page.waitForTimeout(500);
  await expectFocus(page, `${FIRST_ROW}-tile-6`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-7`);
});
