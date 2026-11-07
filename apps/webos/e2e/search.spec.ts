import { expect, type Page, type Route, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { KIDS_ID, main, seedProfiles } from './profiles';
import { mockServices } from './services';
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

test('once the TV keyboard has closed, the remote leaves the box at once', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  const input = page.locator('input[aria-label="Search"]');
  // Remote keys closer together than 100 ms count as one held key.
  const pause = () => page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.keyboard.type('sin');
  await pause();

  // The keyboard's own Back closes it, and only says so: no key reaches the app.
  await page.evaluate(keyboardShown, false);
  await press(page, 'ArrowLeft', 'rail-search');
  await expect(input).not.toBeFocused();

  // OK on the box opens the keyboard again rather than searching.
  await press(page, 'ArrowRight', FIELD);
  await pause();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await pause();
  await page.evaluate(keyboardShown, false);
  await page.keyboard.press('Enter');
  await pause();
  await expect(input).toBeFocused();

  // Back leaves Search in one press.
  await page.evaluate(keyboardShown, false);
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
});

const COMEDY_FILMS = 'search-res-u-0-movie-top-genre-comedy';

test('Search reads a genre in everyday words, and See all opens it in Discover', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  await page.keyboard.press('Enter');
  await page.keyboard.type('funny films');

  // "Funny" is Comedy and "films" keeps it to films: the Popular catalog asked for the genre.
  const comedy = page.locator(`[data-row-key="${COMEDY_FILMS}"]`);
  await expect(comedy.locator('h2')).toHaveText('Comedy filmsCinemeta');
  expect(requests.catalogs).toContain('movie/top/genre=Comedy');
  expect(requests.catalogs).not.toContain('series/top/genre=Comedy');
  // The addons are still asked the words, as titles.
  expect(requests.catalogs).toContain('movie/top/search=funny films');
  await expect(page.getByText(/^Nothing found/)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await press(page, 'ArrowDown', `${COMEDY_FILMS}-tile-0`);
  for (let n = 1; n <= 14; n++) await press(page, 'ArrowRight', `${COMEDY_FILMS}-tile-${n}`);
  await expect(page.locator(`[data-focus-key="${COMEDY_FILMS}-tile-14"]`)).toHaveText('See all');
  await press(page, 'Enter', 'discover-tile-0');
  await expect(page.locator('[data-focus-key="discover-catalog"]')).toHaveAttribute(
    'aria-label',
    'Catalog: Popular',
  );
  await expect(page.locator('[data-focus-key="discover-genre"]')).toHaveAttribute(
    'aria-label',
    'Genre: Comedy',
  );
  await pressBack(page);
  await expectFocus(page, `${COMEDY_FILMS}-tile-14`);
  expect(errors).toEqual([]);
});

test('words read only by forgiving a typo put the addons’ titles first', async ({ page }) => {
  const errors = watchErrors(page);
  // "Comdy" is one letter off Comedy, but an addon has a title by that very name.
  await mockAddons(page, {
    catalogs: {
      'movie/top/search=comdy': (route) =>
        route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            metas: [
              {
                id: 'tt8000010',
                type: 'movie',
                name: 'Comdy Nights',
                releaseInfo: '2019',
                poster: 'https://images.metahub.space/poster/small/tt8000010/img',
                genres: ['Comedy'],
              },
            ],
          }),
        }),
    },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  await page.keyboard.press('Enter');
  await page.keyboard.type('comdy');

  await expect(page.locator(`[data-row-key="${COMEDY_FILMS}"] h2`)).toHaveText(
    'Comedy filmsCinemeta',
  );
  await expect(page.locator(`[data-row-key="${MOVIE_RESULTS}"]`)).toBeVisible();
  const order = await page
    .locator('[data-row-key]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-key')));
  expect(order.indexOf(MOVIE_RESULTS)).toBeLessThan(order.indexOf(COMEDY_FILMS));
  await page.keyboard.press('Escape');
  await press(page, 'ArrowDown', `${MOVIE_RESULTS}-tile-0`);
  await expect(page.locator(`[data-focus-key="${MOVIE_RESULTS}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    /^Comdy Nights/,
  );
  await press(page, 'ArrowDown', `${COMEDY_FILMS}-tile-0`);
  expect(errors).toEqual([]);
});

test('Top results puts the best match from every addon first, once', async ({ page }) => {
  const errors = watchErrors(page);
  // The series catalog finds a title too, so two catalogs answer.
  await mockAddons(page, {
    catalogs: {
      'series/top/search=sintel': (route) =>
        route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            metas: [
              {
                id: 'tt8000009',
                type: 'series',
                name: 'Sintel Stories',
                releaseInfo: '2024–',
                poster: 'https://images.metahub.space/poster/small/tt8000009/img',
                genres: ['Animation'],
              },
            ],
          }),
        }),
    },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  await page.keyboard.press('Enter');
  await page.keyboard.type('sintel');

  const top = page.locator('[data-row-key="search-res-top"]');
  await expect(top.locator('h2')).toHaveText('Top results');
  // Above the addons' own rows, which stay.
  await expect(page.locator(`[data-row-key="${MOVIE_RESULTS}"]`)).toBeVisible();
  await expect(page.locator('[data-row-key="search-res-0-series-top"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await press(page, 'ArrowDown', 'search-res-top-tile-0');
  await expect(page.locator('[data-focus-key="search-res-top-tile-0"]')).toHaveAttribute(
    'aria-label',
    'Sintel, 2010',
  );
  await press(page, 'ArrowRight', 'search-res-top-tile-1');
  await expect(page.locator('[data-focus-key="search-res-top-tile-1"]')).toHaveAttribute(
    'aria-label',
    /^Sintel Stories/,
  );
  await press(page, 'ArrowDown', `${MOVIE_RESULTS}-tile-0`);
  expect(errors).toEqual([]);
});

test('Nothing found offers a spelling from recent searches, and genres', async ({ page }) => {
  const requests = await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  const input = page.locator('input[aria-label="Search"]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sintel');
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-row-key="${MOVIE_RESULTS}"]`)).toBeVisible();

  // A typo a recent search is one swap from.
  await input.fill('sintle');
  await expect(page.getByText('Nothing found for “sintle”.')).toBeVisible();
  const meant = page.locator('[data-focus-key="search-res-help-meant"]');
  await expect(meant).toHaveText('Did you mean “sintel”?');
  await expect(page.getByText('Or look through a genre:')).toBeVisible();
  await page.keyboard.press('Escape');
  await press(page, 'ArrowDown', 'search-res-help-meant');
  await press(page, 'Enter', FIELD);
  await expect(input).toHaveValue('sintel');
  await expect(page.locator(`[data-row-key="${MOVIE_RESULTS}"]`)).toBeVisible();

  // A genre chip searches that genre.
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await input.fill('zzz');
  await expect(page.getByText('Nothing found for “zzz”.')).toBeVisible();
  await expect(page.locator('[data-focus-key="search-res-help-meant"]')).toHaveCount(0);
  await expect(page.locator('[data-focus-key="search-res-help-genre-0"]')).toHaveText('Comedy');
  await page.keyboard.press('Escape');
  await press(page, 'ArrowDown', 'search-res-help-genre-0');
  await press(page, 'Enter', FIELD);
  await expect(input).toHaveValue('Comedy');
  await expect(page.locator(`[data-row-key="${COMEDY_FILMS}"] h2`)).toHaveText(
    'Comedy filmsCinemeta',
  );
  expect(requests.catalogs).toContain('series/top/genre=Comedy');
});

test('when no addon answers, Search says so and offers Try again', async ({ page }) => {
  let failing = true;
  const fail = (route: Route) =>
    failing
      ? route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' } })
      : undefined;
  const requests = await mockAddons(page, {
    catalogs: { 'movie/top/search=sintel': fail, 'series/top/search=sintel': fail },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  await page.keyboard.press('Enter');
  await page.keyboard.type('sintel');

  await expect(page.getByText(/^None of your addons answered/)).toBeVisible();
  await expect(page.getByText(/^Nothing found/)).toHaveCount(0);
  // One Try again for them all, not a row each.
  await expect(page.locator('[data-row-key^="search-res-0-"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await press(page, 'ArrowDown', 'search-res-help-retry');

  failing = false;
  const before = requests.catalogs.filter((key) => key.includes('search=sintel')).length;
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-row-key="${MOVIE_RESULTS}"] h2`)).toHaveText('MoviesCinemeta');
  expect(requests.catalogs.filter((key) => key.includes('search=sintel')).length).toBeGreaterThan(
    before,
  );
  // Focus goes on to the results that came back, not lost with the button.
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    new RegExp(`^${MOVIE_RESULTS}-tile-0$`),
  );
});

/** Opens Search from Home and starts typing in the box. */
async function typeInSearch(page: Page, words: string, firstTile = `${FIRST_ROW}-tile-0`) {
  await page.goto(APP_URL);
  await expectFocus(page, firstTile);
  await openSection(page, 'search');
  await expectFocus(page, FIELD);
  await page.keyboard.press('Enter');
  await page.keyboard.type(words);
}

test('Search asks TMDB for stand-up comedy, with TMDB’s logo and no stand-in rows', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const { tmdb } = await mockServices(page, { tmdb: true, search: true });
  await typeInSearch(page, 'stand-up');

  const films = page.locator('[data-row-key="search-res-t-tmdb-movie-standup"]');
  await expect(films.locator('h2')).toHaveText('Stand-up comedy films');
  await expect(films.getByRole('img', { name: 'From TMDB' })).toBeVisible();
  await expect(films.locator('[data-focus-key$="-tile-0"]')).toHaveAttribute(
    'aria-label',
    'Laugh Out Loud: Live, 2023',
  );
  const series = page.locator('[data-row-key="search-res-t-tmdb-series-standup"]');
  await expect(series.locator('h2')).toHaveText('Stand-up comedy series');
  // TMDB answers the mood by its keywords, so the addons' Comedy rows do not stand in for it.
  await expect(page.locator('[data-row-key^="search-res-u-"]')).toHaveCount(0);
  expect(tmdb.searches).toEqual(
    expect.arrayContaining([
      'discover?type=movie&keywords=9716,356038,362573',
      'discover?type=series&keywords=9716,356038,362573',
    ]),
  );
  // The words are understood, so nobody is looked for.
  expect(tmdb.searches.filter((asked) => asked.indexOf('multi') === 0)).toEqual([]);

  // Down from the box: the suggestion first, then the rows.
  // Each suggestion is keyed by its words, so one stays focused as others come in.
  await press(page, 'ArrowDown', 'search-suggest-standupcomedy');
  await expect(page.locator('[data-focus-key="search-suggest-standupcomedy"]')).toHaveText(
    'Stand-up comedy',
  );
  await press(page, 'ArrowDown', 'search-res-t-tmdb-movie-standup-tile-0');
  await press(page, 'ArrowDown', 'search-res-t-tmdb-series-standup-tile-0');
  expect(errors).toEqual([]);
});

test('suggestions offer people TMDB knows, and a person’s name gives a row of their work', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const { tmdb } = await mockServices(page, { tmdb: true, search: true });
  await typeInSearch(page, 'tom h');

  const suggestion = (index: number) =>
    page.locator('[data-focus-key^="search-suggest-"]').nth(index);
  await expect(suggestion(0)).toHaveText('Tom Hanks');
  await expect(suggestion(1)).toHaveText('Tom Hardy');
  await expect(suggestion(2)).toHaveText('Tomb Raider (2018)');
  // Two words a few letters short of a name are not that person yet.
  await expect(page.locator('[data-row-key^="search-res-t-tmdb-person"]')).toHaveCount(0);

  await press(page, 'ArrowDown', 'search-suggest-tomhank');
  await page.keyboard.press('Enter');
  await expectFocus(page, FIELD);
  await expect(page.locator('input[aria-label="Search"]')).toHaveValue('Tom Hanks');
  const person = page.locator('[data-row-key="search-res-t-tmdb-person-31"]');
  await expect(person.locator('h2')).toHaveText('With Tom Hanks');
  await expect(person.getByRole('img', { name: 'From TMDB' })).toBeVisible();
  await expect(person.locator('[data-focus-key$="-tile-1"]')).toHaveAttribute(
    'aria-label',
    'Band of Neighbours, 2001',
  );
  // The person is no longer suggested once searched; the others still are.
  await expect(suggestion(0)).toHaveText('Tom Hardy');
  expect(tmdb.searches).toEqual(
    expect.arrayContaining([
      'multi?query=tom h',
      'multi?query=tom hanks',
      'person?id=31&role=cast',
    ]),
  );
  expect(errors).toEqual([]);
});

test('“films like” a title asks TMDB for titles like it', async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const { tmdb } = await mockServices(page, { tmdb: true, search: true });
  await typeInSearch(page, 'films like the matrix');

  const like = page.locator('[data-row-key="search-res-t-tmdb-like"]');
  await expect(like.locator('h2')).toHaveText('Films like The Matrix');
  await expect(like.locator('[data-focus-key$="-tile-0"]')).toHaveAttribute(
    'aria-label',
    'Wired Reality, 2023',
  );
  expect(tmdb.searches).toContain('like?query=the matrix&type=movie');
  expect(tmdb.searches.filter((asked) => asked.indexOf('multi') === 0)).toEqual([]);

  // Without a type the words may be a title's own name: TMDB is asked what it knows first.
  const box = page.locator('input[aria-label="Search"]');
  await box.fill('something like summer');
  await expect(page.getByText('Nothing found for “something like summer”.')).toBeVisible();
  await expect(like).toHaveCount(0);
  expect(tmdb.searches).toContain('multi?query=something like summer');
  expect(tmdb.searches).not.toContain('like?query=summer');
  // TMDB knows no title of that name: the words ask for titles like one.
  await box.fill('something like inception');
  await expect(like.locator('h2')).toHaveText('Films like The Matrix');
  expect(tmdb.searches).toEqual(
    expect.arrayContaining(['multi?query=something like inception', 'like?query=inception']),
  );
  expect(errors).toEqual([]);
});

test('a kids profile’s TMDB rows keep to titles within its UK rating', async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const { tmdb } = await mockServices(page, { tmdb: true, search: true });
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Robin', colour: 3, kids: 'PG' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  await typeInSearch(page, 'snow', 'home-0-movie-top-genre-family-tile-0');

  // Words that name no genre: TMDB's titles by name, each checked by its rating.
  const titles = page.locator('[data-row-key="search-res-t-tmdb-titles"]');
  await expect(titles.locator('h2')).toHaveText('Suitable for kids');
  await expect(titles.locator('[data-focus-key$="-tile-0"]')).toHaveAttribute(
    'aria-label',
    'Snow Friends, 2023',
  );
  // Rated 12A at the cinema and 15 at home: a 15, above the profile's PG.
  await expect(titles.locator('[data-focus-key$="-tile-1"]')).toHaveCount(0);
  expect(tmdb.searches).toContain('titles?query=snow&ratings=1');
  // A kids profile is never offered people, so nobody is looked for.
  expect(tmdb.searches.filter((asked) => asked.indexOf('multi') === 0)).toEqual([]);

  // A genre: TMDB's family titles of it, within the rating.
  const input = page.locator('input[aria-label="Search"]');
  await input.fill('comedy');
  const comedy = page.locator('[data-row-key="search-res-t-tmdb-movie-comedy"]');
  await expect(comedy.locator('[data-focus-key$="-tile-0"]')).toHaveAttribute(
    'aria-label',
    'Puddle Jumpers, 2023',
  );
  await expect(comedy.locator('[data-focus-key$="-tile-1"]')).toHaveCount(0);
  expect(tmdb.searches).toContain('discover?type=movie&genres=35&any=10751&certification=PG');
  expect(errors).toEqual([]);
});

test('a service without Search’s routes leaves Search to the addons', async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const { tmdb } = await mockServices(page, { tmdb: true });
  await typeInSearch(page, 'stand-up');
  // The stand-in rows from the addons' Comedy catalogs, as before.
  await expect(page.locator('[data-row-key^="search-res-u-"]').first()).toBeVisible();
  await expect(page.locator('[data-row-key^="search-res-t-"]')).toHaveCount(0);
  expect(tmdb.searches).toEqual([]);
  expect(errors).toEqual([]);
});
