import { expect, type Locator, test, type Page, type Route } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { mockServices } from '../../webos/e2e/services.ts';
import { mockSports, seedSports, SPORTS_NOW } from '../../webos/e2e/sports.ts';

/*
 * Search on the phone, against the TV journeys' fake addons. The fake Cinemeta's search finds
 * names holding the words; its genre catalogs answer with their whole list.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Opens the app on Search. The fake addons refuse every other address, so the app's own is let through. */
async function openSearch(page: Page) {
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
  await page.getByRole('tab', { name: 'Search' }).click();
  return page.getByPlaceholder('Search for a film or series');
}

const refuse = (route: Route) => route.abort();

test('Search: a genre gets its rows, a title its result, and nothing found offers more', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page);
  const field = await openSearch(page);

  // A genre word asks Cinemeta's Popular catalogs for the genre, as Home would.
  await field.fill('comedy');
  await expect(page.getByText('Comedy films', { exact: true })).toBeVisible();
  await expect(page.getByText('Comedy series', { exact: true })).toBeVisible();
  expect(requests.catalogs).toContain('movie/top/genre=Comedy');
  expect(requests.catalogs).toContain('movie/top/search=comedy');
  await expect(page.getByText(/^Nothing found/)).toHaveCount(0);
  await page.getByRole('button', { name: 'See all' }).first().click();
  await expect(page.getByRole('heading', { name: 'Comedy films' })).toBeVisible();
  await page.getByLabel('Back').last().click();

  // A title: its result, and opening it keeps the words as a recent search.
  await field.fill('sintel');
  await page.getByRole('button', { name: 'Sintel, 2010' }).click();
  await expect(page.getByText('Sintel is a Blender Studio open project.').last()).toBeVisible();
  await page.getByLabel('Back').last().click();

  // A typo of a recent search: "Did you mean" puts it right.
  await field.fill('sintl');
  await expect(page.getByText('Nothing found for “sintl”.')).toBeVisible();
  await page.getByRole('button', { name: 'Did you mean “sintel”?' }).click();
  await expect(field).toHaveValue('sintel');
  await expect(page.getByRole('button', { name: 'Sintel, 2010' })).toBeVisible();

  // Nothing at all: genres to look through instead, which search for the genre.
  await field.fill('zzz');
  await expect(page.getByText('Nothing found for “zzz”.')).toBeVisible();
  await expect(page.getByText('Or look through a genre:')).toBeVisible();
  await page.getByRole('button', { name: 'Comedy', exact: true }).click();
  await expect(field).toHaveValue('Comedy');
  await expect(page.getByText('Comedy films', { exact: true })).toBeVisible();

  // Cleared, the box shows the recent searches.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Recent searches', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'sintel', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Search: Top results from both catalogs, with each addon’s own results folded under', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const field = await openSearch(page);

  // "er" finds Hero among the films and two series.
  await field.fill('er');
  await expect(page.getByText('Top results', { exact: true })).toBeVisible();
  const hero = page.getByRole('button', { name: 'Hero, 2018' });
  await expect(hero).toHaveCount(1);
  const fold = page.getByRole('button', { name: 'Results from each addon' });
  await fold.click();
  await expect(hero).toHaveCount(2);
  await expect(page.getByText('Cinemeta', { exact: true })).toHaveCount(2);

  // Series: only the series catalog is asked. One catalog is no Top results: its own
  // section shows, unfolded, and the films are gone.
  await page.getByRole('button', { name: 'Series', exact: true }).click();
  await expect(hero).toHaveCount(0);
  await expect(page.getByText('Top results', { exact: true })).toHaveCount(0);
  await expect(fold).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pepper and Carrot/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Search: addons that fail say so and offer Try again, not Nothing found', async ({ page }) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page, {
    catalogs: {
      'movie/top/search=broken': refuse,
      'series/top/search=broken': refuse,
      'series/top/search=sintel': refuse,
    },
  });
  const field = await openSearch(page);

  await field.fill('broken');
  await expect(page.getByText(/^None of your addons answered/)).toBeVisible();
  await expect(page.getByText(/^Nothing found/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect
    .poll(() => requests.catalogs.filter((key) => key === 'movie/top/search=broken').length)
    .toBe(2);
  expect(requests.catalogs.filter((key) => key === 'series/top/search=broken')).toHaveLength(2);
  await expect(page.getByText(/^None of your addons answered/)).toBeVisible();

  // One of two failing: what the other found, a section saying so, and a note at the end.
  await field.fill('sintel');
  await expect(page.getByRole('button', { name: 'Sintel, 2010' })).toBeVisible();
  await expect(page.getByText(/could not be reached/)).toBeVisible();
  await expect(
    page.getByText("Some addons didn't answer, so there may be more to find."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('with sport', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('Search: a team is found in Sports, and the sports addon is asked only from its button', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.clock.install({ time: SPORTS_NOW });
    await mockAddons(page);
    await seedSports(page);
    const sports = await mockSports(page);
    await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
    await page.goto('/');
    // Home's Live sport row fetches what Search then answers from.
    await expect(page.getByText('Live sport', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Search' }).click();
    const field = page.getByPlaceholder('Search for a film or series');

    await field.fill('arsenal');
    await expect(page.getByRole('heading', { name: 'Sports', exact: true })).toBeVisible();
    await expect(page.getByLabel(/^Arsenal v Brighton/).last()).toBeVisible();
    await expect(page.getByText(/^Nothing found/)).toHaveCount(0);
    // The sports addon's catalogs stay out of the general results.
    await expect(page.getByText('Test Sports', { exact: true })).toHaveCount(0);
    expect(sports.all.filter((request) => request.includes('/catalog/sport/search'))).toEqual([]);

    await page.getByRole('button', { name: 'Search sports addons' }).click();
    await expect
      .poll(() => sports.all.filter((request) => request.includes('/catalog/sport/search')))
      .toEqual(['sports /bannertv/catalog/sport/search/search=arsenal.json']);
    await expect(page.getByText('Test Sports', { exact: true })).toBeVisible();

    await page
      .getByLabel(/^Arsenal v Brighton/)
      .last()
      .click();
    await expect(page.getByText('Listed by Test Sports')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Search: a film leads and Sports follows it, and a film alone gets only a quiet Search sports addons', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.clock.install({ time: SPORTS_NOW });
    // A made-up film and series named like the team, so one search finds them and sport.
    const named = (type: string, id: string, name: string) => (route: Route) =>
      route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          metas: [
            {
              id,
              type,
              name,
              releaseInfo: '2024',
              poster: `https://images.metahub.space/poster/small/${id}/img`,
            },
          ],
        }),
      });
    await mockAddons(page, {
      catalogs: {
        'movie/top/search=arsenal': named('movie', 'tt9900001', 'Arsenal Nights'),
        'series/top/search=arsenal': named('series', 'tt9900002', 'Arsenal Diaries'),
      },
    });
    await seedSports(page);
    const sports = await mockSports(page);
    await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
    await page.goto('/');
    await expect(page.getByText('Live sport', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Search' }).click();
    const field = page.getByPlaceholder('Search for a film or series');
    const below = async (upper: Locator, lower: Locator) => {
      const [a, b] = [await upper.boundingBox(), await lower.boundingBox()];
      expect(a && b && a.y < b.y).toBe(true);
    };

    // The film's Top results come first, the fixtures after.
    await field.fill('arsenal');
    const top = page.getByRole('heading', { name: 'Top results', exact: true });
    const sport = page.getByRole('heading', { name: 'Sports', exact: true });
    await expect(page.getByRole('button', { name: 'Arsenal Nights, 2024' })).toBeVisible();
    await expect(top).toBeVisible();
    await expect(sport).toBeVisible();
    await below(top, sport);
    // With Films alone there is no Top results: the films' own section leads instead.
    await page.getByRole('button', { name: 'Films', exact: true }).click();
    await expect(top).toHaveCount(0);
    const films = page.getByRole('heading', { name: 'Movies', exact: true });
    await expect(films).toBeVisible();
    await below(films, sport);
    await page.getByRole('button', { name: 'Films and series', exact: true }).click();

    // Nothing in the sports lists: no note over the film, only the button after it.
    await field.fill('sintel');
    const sintel = page.getByRole('button', { name: 'Sintel, 2010' });
    const ask = page.getByRole('button', { name: 'Search sports addons' });
    await expect(sintel).toBeVisible();
    await expect(ask).toBeVisible();
    await expect(sport).toHaveCount(0);
    await expect(page.getByText(/^Nothing in your sports addons/)).toHaveCount(0);
    await below(sintel, ask);
    await ask.click();
    await expect
      .poll(() => sports.all.filter((request) => request.includes('/catalog/sport/search')))
      .toEqual(['sports /bannertv/catalog/sport/search/search=sintel.json']);
    await expect(ask).toHaveCount(0);
    await expect(sintel).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('Search: TMDB adds stand-up rows with its logo, people from suggestions, and titles like one', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const { tmdb } = await mockServices(page, { tmdb: true, search: true });
  const field = await openSearch(page);

  // Stand-up: TMDB's rows by its keywords, with its logo, and no Comedy rows standing in.
  await field.fill('stand-up');
  await expect(page.getByText('Stand-up comedy films', { exact: true })).toBeVisible();
  await expect(page.getByText('Stand-up comedy series', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'From TMDB' }).first()).toBeVisible();
  await expect(page.getByText('Comedy films', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Laugh Out Loud: Live, 2023' })).toBeVisible();
  // The Series chip keeps only the series row.
  await page.getByRole('button', { name: 'Series', exact: true }).click();
  await expect(page.getByText('Stand-up comedy films', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Stand-up comedy series', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Films and series', exact: true }).click();

  // A few letters of a name: suggestions offer the people TMDB knows by them.
  await field.fill('tom h');
  await page.getByRole('button', { name: 'Tom Hanks', exact: true }).click();
  await expect(field).toHaveValue('Tom Hanks');
  await expect(page.getByText('With Tom Hanks', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Band of Neighbours, 2001' })).toBeVisible();

  // Titles like another.
  await field.fill('films like the matrix');
  await expect(page.getByText('Films like The Matrix', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wired Reality, 2023' })).toBeVisible();
  expect(tmdb.searches).toEqual(
    expect.arrayContaining([
      'discover?type=movie&keywords=9716,356038,362573',
      'multi?query=tom hanks',
      'person?id=31&role=cast',
      'like?query=the matrix&type=movie',
    ]),
  );
  expect(errors).toEqual([]);
});
