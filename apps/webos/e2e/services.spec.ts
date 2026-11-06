import { expect, type Page, type Route, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { mockPlayback, readKv, seedStreamAddon } from './play';
import { KIDS_ID, main, seedProfiles } from './profiles';
import { mockServices, traktSignIn } from './services';
import {
  APP_URL,
  expectFocus,
  expectFocusLabel,
  expectLoadedFocus,
  openSection,
  press,
  pressBack,
  watchErrors,
} from './tv';

const json = (route: Route, body: unknown) =>
  route.fulfill({
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

/** A row tile shows "Loading" until its catalog answers, and OK on it opens nothing yet. */
async function expectTitleFocused(page: Page): Promise<void> {
  await expect(page.locator('[data-focused="true"]')).not.toHaveAttribute('aria-label', 'Loading');
}

/** From Settings' first button to the Services group on the right. */
async function openServices(page: Page, first: string): Promise<void> {
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', first);
}

test('Trakt signs in with a code shown on the TV, then brings in My List and where you stopped', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const { trakt } = await mockServices(page, { trakt: true });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await openServices(page, 'settings-trakt');
  await press(page, 'Enter', 'trakt-sign-in');
  await expectFocusLabel(page, 'Sign in to Trakt');

  // The code to enter at trakt.tv, while the TV asks whether it has been.
  await page.keyboard.press('Enter');
  await expect(page.getByText('BT4K7Q2Z')).toBeVisible();
  await expect(
    page.getByText('On your phone or computer, go to trakt.tv/activate and enter'),
  ).toBeVisible();
  await expect(page.getByText('The code works for 10 more minutes.')).toBeVisible();
  await expectFocusLabel(page, 'Get a new code');
  await expect.poll(() => trakt.callsTo('/oauth/device/token').length).toBeGreaterThan(0);
  expect(trakt.callsTo('/oauth/device/token')[0]?.body).toEqual({ code: 'device-1' });

  // Entered: the TV signs in, says as whom, and syncs at once.
  trakt.approve();
  await expectFocus(page, 'trakt-sync');
  await expect(page.getByText('Signed in to Trakt as sam_watches.')).toBeVisible();
  await expect(page.getByText(/^Synced at \d\d:\d\d\.$/)).toBeVisible();
  expect(trakt.callsTo('/sync/last_activities')[0]?.token).toBe('fresh-access');
  // Nothing secret leaves the TV but the viewer's own token.
  expect(trakt.calls.some((call) => JSON.stringify(call).includes('client_secret'))).toBe(false);
  expect(await readKv(page, 'traktWatched')).toEqual(
    expect.arrayContaining(['tt0807840', 'tt8000001:1:1', 'tt8000001:1:2']),
  );

  // Trakt's watchlist is in My List.
  await pressBack(page);
  await expectFocus(page, 'settings-trakt');
  await press(page, 'ArrowLeft', 'settings-still-watching');
  await press(page, 'ArrowLeft', 'rail-settings');
  await press(page, 'ArrowUp', 'rail-addons');
  await press(page, 'ArrowUp', 'rail-library');
  await press(page, 'Enter', 'discover-tile-0');
  await expectFocusLabel(page, 'Sintel, 2010');

  // And the film paused on another device waits on Home.
  await press(page, 'ArrowLeft', 'rail-library');
  for (const item of ['discover', 'search', 'home']) await press(page, 'ArrowUp', `rail-${item}`);
  await page.keyboard.press('Enter');
  await expect(
    page.locator('[data-row-key="home-continue"]').getByRole('button', { name: /Tears of Steel/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('signed in to Trakt, Details ticks what was watched, the player says what plays, and signing out forgets the sign-in', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    kv: { trakt: traktSignIn(), traktWatched: ['tt8000001:1:1'] },
  });
  await mockPlayback(page);
  const { trakt } = await mockServices(page, { trakt: true });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  // Watched elsewhere: the first episode has its tick, the second has none.
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await expectTitleFocused(page);
  await press(page, 'Enter', 'details-episodes-0');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute('aria-label', /, watched$/);
  await press(page, 'ArrowDown', 'details-episodes-1');
  await expect(page.locator('[data-focused="true"]')).not.toHaveAttribute('aria-label', /watched/);
  await pressBack(page);
  await expectFocus(page, `${SERIES_ROW}-tile-0`);

  // A film plays: Trakt hears it start, and stop where it got to when the player closes.
  await press(page, 'ArrowUp', `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(() => trakt.callsTo('/scrobble/start').length).toBe(1);
  const start = trakt.callsTo('/scrobble/start')[0]!;
  expect(start.token).toBe('seeded-access');
  expect(start.body).toMatchObject({ movie: { ids: { imdb: 'tt0807840' } } });
  await page.waitForTimeout(1500);
  await pressBack(page);
  if (
    (await page.locator('[data-focused="true"]').getAttribute('data-focus-key')) !== 'details-watch'
  ) {
    await pressBack(page);
  }
  await expectFocus(page, 'details-watch');
  await expect.poll(() => trakt.callsTo('/scrobble/stop').length).toBe(1);
  const stop = trakt.callsTo('/scrobble/stop')[0]!.body!;
  expect(stop.progress).toBeGreaterThan(0);
  expect(stop.progress).toBeLessThan(100);

  // Signing out asks first, then lets Trakt know and forgets the tokens.
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await openServices(page, 'settings-trakt');
  await press(page, 'Enter', 'trakt-sync');
  await expect(page.getByText('Signed in to Trakt as sam_watches.')).toBeVisible();
  await press(page, 'ArrowDown', 'trakt-sign-out');
  await press(page, 'Enter', 'trakt-sign-out-dialog-cancel');
  await press(page, 'ArrowLeft', 'trakt-sign-out-dialog-confirm');
  await press(page, 'Enter', 'trakt-sign-in');
  await expectFocusLabel(page, 'Sign in to Trakt');
  await expect.poll(() => trakt.callsTo('/oauth/revoke').length).toBe(1);
  expect(trakt.callsTo('/oauth/revoke')[0]?.body).toEqual({ token: 'seeded-access' });
  await expect.poll(() => readKv(page, 'trakt')).toEqual({});
  await expect.poll(() => readKv(page, 'traktWatched')).toEqual([]);
  expect(errors).toEqual([]);
});

test('TMDB adds the UK rating, studio and cast photos to Details, and can be turned off', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const { tmdb } = await mockServices(page, { tmdb: true, certificate: '12A' });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expectTitleFocused(page);

  await press(page, 'Enter', 'details-watch');
  const details = page.locator('section[aria-label="Elephants Dream"]');
  await expect(details.getByText(/· 12 · Blender Studio$/)).toBeVisible();
  const cast = details.getByRole('list', { name: 'Cast' });
  await expect(cast.getByText('Cas Jansen')).toBeVisible();
  await expect(cast.getByText('Tygo Gernandt')).toBeVisible();
  // Only people with photos, and in place of the addon's line of names.
  await expect(cast.getByText('No Photo')).toHaveCount(0);
  await expect(details.getByText(/^Starring/)).toHaveCount(0);
  expect(tmdb.paths).toEqual(expect.arrayContaining(['find/tt0807840', 'movie/807840']));

  // Off in Settings, Details shows only what the addon says.
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await expect(page.getByText(/not endorsed or certified by TMDB/)).toBeVisible();
  await expect(page.locator('[data-focus-key="settings-trakt"]')).toHaveCount(0);
  await openServices(page, 'settings-tmdb');
  await expectFocusLabel(page, 'Extra details from TMDB: On');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Extra details from TMDB: Off');
  await expect(page.getByText(/not endorsed or certified by TMDB/)).toHaveCount(0);

  await press(page, 'ArrowLeft', 'settings-still-watching');
  await press(page, 'ArrowLeft', 'rail-settings');
  for (const item of ['addons', 'library', 'discover', 'search', 'home']) {
    await press(page, 'ArrowUp', `rail-${item}`);
  }
  await page.keyboard.press('Enter');
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await expectTitleFocused(page);
  await press(page, 'Enter', 'details-watch');
  const bunny = page.locator('section[aria-label="Big Buck Bunny"]');
  await expect(bunny.getByText('Starring Proog, Emo')).toBeVisible();
  await expect(bunny.getByRole('list', { name: 'Cast' })).toHaveCount(0);
  expect(tmdb.paths).not.toContain('find/tt1254207');
  expect(errors).toEqual([]);
});

test("a kids profile can't play a film TMDB rates above the profile's age rating, even from Continue watching", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page, {
    catalogs: {
      'movie/top/genre=Family': (route) =>
        json(route, {
          metas: [
            {
              id: 'tt1254207',
              type: 'movie',
              name: 'Big Buck Bunny',
              genres: ['Animation', 'Family'],
            },
          ],
        }),
    },
  });
  // The addon says it is for families; TMDB's UK rating is 15.
  await page.route('https://v3-cinemeta.strem.io/meta/movie/tt1254207.json', (route) =>
    json(route, {
      meta: {
        id: 'tt1254207',
        type: 'movie',
        name: 'Big Buck Bunny',
        genres: ['Animation', 'Family'],
        trailerStreams: [{ title: 'Trailer', ytId: 'aqz-KE-bpKQ' }],
      },
    }),
  );
  await mockServices(page, { tmdb: true, certificate: '15' });
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Robin', colour: 3, kids: 'PG' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  // Started before the profile was a kids profile.
  await seedStreamAddon(page, {
    kv: {
      [`p/${KIDS_ID}/progress`]: [
        {
          metaId: 'tt1254207',
          type: 'movie',
          videoId: 'tt1254207',
          position: 120,
          duration: 600,
          updatedAt: 1000,
          watched: false,
        },
      ],
      [`p/${KIDS_ID}/played`]: [
        {
          videoId: 'tt1254207',
          metaId: 'tt1254207',
          type: 'movie',
          name: 'Big Buck Bunny',
          updatedAt: 1000,
        },
      ],
    },
  });
  await page.goto(APP_URL);
  // OK on Continue watching opens the title's page rather than the player.
  await expectFocus(page, 'home-continue-tile-0');
  await page.keyboard.press('Enter');
  const details = page.locator('section[aria-label="Big Buck Bunny"]');
  await expect(details.getByText("This title isn't available in a kids profile.")).toBeVisible();
  await expectFocus(page, 'details-my-list');
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveCount(0);
  await expect(page.locator('[data-focus-key="details-trailer"]')).toHaveCount(0);
  await expect(page.locator('video:not([aria-hidden])')).toHaveCount(0);
  await pressBack(page);
  await expectFocus(page, 'home-continue-tile-0');

  const kidsRow = 'home-0-movie-top-genre-family';
  await press(page, 'ArrowDown', `${kidsRow}-tile-0`);
  await expectTitleFocused(page);
  await page.keyboard.press('Enter');
  await expect(page.getByText("This title isn't available in a kids profile.")).toBeVisible();
  await expectFocus(page, 'details-my-list');
  expect(errors).toEqual([]);
});

test('a kids profile goes by the strictest UK rating, while Details shows the cinema one', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page, {
    catalogs: {
      'movie/top/genre=Family': (route) =>
        json(route, {
          metas: [{ id: 'tt1254207', type: 'movie', name: 'Big Buck Bunny', genres: ['Family'] }],
        }),
    },
  });
  await page.route('https://v3-cinemeta.strem.io/meta/movie/tt1254207.json', (route) =>
    json(route, {
      meta: { id: 'tt1254207', type: 'movie', name: 'Big Buck Bunny', genres: ['Family'] },
    }),
  );
  // PG at the cinema, 15 on disc (an extended cut).
  await mockServices(page, { tmdb: true, certificate: 'PG', homeCertificate: '15' });
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Robin', colour: 3, kids: 'PG' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  await page.goto(APP_URL);

  await expectFocus(page, 'home-0-movie-top-genre-family-tile-0');
  // OK on a tile still loading opens nothing, so it waits for the title as a person would.
  await expectLoadedFocus(page);
  await page.keyboard.press('Enter');
  const details = page.locator('section[aria-label="Big Buck Bunny"]');
  await expect(details.getByText("This title isn't available in a kids profile.")).toBeVisible();
  await expect(details.getByText('PG · Blender Studio', { exact: true })).toBeVisible();
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a kids profile plays a film its Family row offers when TMDB rates it within the profile, without a Family tag', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page, {
    catalogs: {
      'movie/top/genre=Family': (route) =>
        json(route, {
          metas: [{ id: 'tt1254207', type: 'movie', name: 'Big Buck Bunny', genres: [] }],
        }),
    },
  });
  // As Cinemeta lists Moana: in its Family catalog, but its details say only Animation.
  await page.route('https://v3-cinemeta.strem.io/meta/movie/tt1254207.json', (route) =>
    json(route, {
      meta: {
        id: 'tt1254207',
        type: 'movie',
        name: 'Big Buck Bunny',
        genres: ['Animation', 'Adventure'],
      },
    }),
  );
  await mockServices(page, { tmdb: true, certificate: 'PG' });
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Robin', colour: 3, kids: 'PG' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  await page.goto(APP_URL);

  const kidsRow = 'home-0-movie-top-genre-family';
  await expectFocus(page, `${kidsRow}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await expect(page.getByText("This title isn't available in a kids profile.")).toHaveCount(0);
  expect(errors).toEqual([]);
});
