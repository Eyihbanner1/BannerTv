import { expect, type Page, type Route, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { ANDROID_URL, androidOpens, openAsAndroid, openFocusedTitle, playerOps } from './android';
import { DEFAULT_STREAMS, mockPlayback, readKv, seedStreamAddon, type TestStream } from './play';
import { leavePlayer, MOVIE, openMovie, openSheet, subtitlesDiagnostics, video } from './player';
import { KIDS_ID, main, seedProfiles } from './profiles';
import {
  FAKE_SUBDL_KEY,
  standInSubdl,
  SUBDL_EPISODE_RELEASE,
  SUBDL_FILM_RELEASE,
  type SubdlScenario,
} from './subdl';
import { APP_URL, expectFocus, expectFocusLabel, openSection, press, pressBack } from './tv';

/*
 * SubDL beside the addons, with the viewer's own key (ADR 0003, step D), against a stand-in for
 * SubDL's API and download host (e2e/subdl.ts). The key is obviously fake.
 */

/** Elephants Dream's stream, named for the made-up film's release. */
const FILM_STREAM: TestStream = { ...DEFAULT_STREAMS[0]!, filename: `${SUBDL_FILM_RELEASE}.mkv` };

/** The key as the TV keeps it once SubDL accepted it. */
const SAVED_KEY = { 'subdl/key': { key: FAKE_SUBDL_KEY, state: 'works' } };

/** A SubDL version row in the subtitles sheet. */
const subdlRows = (page: Page) => page.locator('[data-focus-key^="player-tracks-file-subdl#"]');

/** Starts the TV with the film's stream, OpenSubtitles' usual files, and SubDL's stand-in. */
async function setUp(
  page: Page,
  scenario: SubdlScenario,
  options: { key?: boolean; streams?: Record<string, readonly TestStream[]> } = {},
) {
  await mockAddons(page);
  await seedStreamAddon(page, {
    preferences: { subtitleLanguage: 'eng' },
    kv: options.key === false ? {} : SAVED_KEY,
  });
  const mock = await mockPlayback(page, { streams: options.streams ?? { [MOVIE]: [FILM_STREAM] } });
  const subdl = await standInSubdl(page, scenario);
  return { mock, subdl };
}

/** Plays Elephants Dream from Home. */
async function playFilm(page: Page) {
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
}

/** Settings > SubDL subtitles, from Home. */
async function openSubdlScreen(page: Page) {
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-subdl');
  await press(page, 'Enter', 'subdl-key');
}

const json = (route: Route, body: unknown) =>
  route.fulfill({
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

const status = (page: Page) => page.getByTestId('subdl-status');

test('a SubDL key typed on the TV is checked, kept and never shown', async ({ page }) => {
  const { subdl } = await setUp(page, 'films', { key: false });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-subdl');
  await expectFocusLabel(page, 'SubDL subtitles: Off');
  await press(page, 'Enter', 'subdl-key');
  await expect(page.getByText("This code opens SubDL's API page.", { exact: false })).toBeVisible();
  await expect(page.locator('[data-focus-key="subdl-remove"]')).toHaveCount(0);

  // Not a key: said so, and nothing is kept or asked.
  const input = page.locator('[data-focus-key="subdl-key"] input');
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.type('not a key');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(
    "That doesn't look like a SubDL key. Check it and try again.",
  );
  expect(await readKv(page, 'subdl/key')).toBeUndefined();

  await input.fill(` ${FAKE_SUBDL_KEY} `);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Your key works. BannerTV will look on SubDL too.');
  await expect(input).toHaveValue('');
  await expect(page.getByText('A key is saved. Type a new one to replace it.')).toBeVisible();
  await expect
    .poll(() => readKv(page, 'subdl/key'))
    .toEqual({ key: FAKE_SUBDL_KEY, state: 'works' });
  expect(subdl.meChecks).toBe(1);
  expect(subdl.searches).toEqual([]);
  // The key shows nowhere on the screen.
  expect(await page.locator('body').innerText()).not.toContain(FAKE_SUBDL_KEY);

  await pressBack(page);
  await expectFocusLabel(page, 'SubDL subtitles: On');
});

test("a film's SubDL file named for the release is chosen, with one search and one download", async ({
  page,
}) => {
  const { subdl } = await setUp(page, 'films');
  await playFilm(page);
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  await expect.poll(() => subdl.downloads).toEqual(['/subtitle/9000001/9200001']);
  expect(subdl.searches).toHaveLength(1);
  expect(subdl.searches[0]).toContain('imdb_id=tt0807840');
  expect(subdl.searches[0]).toContain('languages=en');

  await openSheet(page, 'player-tracks-lang-en');
  await expect(subdlRows(page)).toHaveCount(1);
  await expect(subdlRows(page)).toContainText('SubDL');
  await expect(subdlRows(page)).toContainText('Same release');

  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(/SubDL en 1 in \d+\.\d s/);
  expect(subdl.keyInUrl).toBe(false);
  expect(subdl.strays).toEqual([]);
});

/** "first line after 1.2 s" in Diagnostics, as seconds. */
async function firstLineAfter(page: Page): Promise<number> {
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(/first line after \d+\.\d s/);
  return Number(/first line after (\d+\.\d) s/.exec(await section.innerText())![1]);
}

test('a SubDL that never answers holds the first line back no longer than with no key', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const plain = await browser.newPage();
  await setUp(plain, 'never', { key: false });
  await playFilm(plain);
  await expect(plain.getByText('Hello from the test subtitles')).toBeVisible();
  const without = await firstLineAfter(plain);
  await plain.close();

  const page = await browser.newPage();
  const { subdl } = await setUp(page, 'never');
  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  // SubDL's 8 s pass while playing.
  await page.waitForTimeout(8500);
  const withKey = await firstLineAfter(page);
  expect(Math.abs(withKey - without)).toBeLessThan(0.5);
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Subtitles', exact: true }),
  });
  await expect(section).toContainText('SubDL: no answer in 8 s');
  await page.close();
});

test('SubDL asking to slow down rests it, and its screen says so', async ({ page }) => {
  const { subdl } = await setUp(page, 'busy');
  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await expect.poll(() => subdl.searches.length).toBe(1);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('SubDL: too many requests, resting');
  await expect.poll(() => readKv(page, 'subdl/rest')).toMatchObject({ why: 'busy' });

  // Played again while resting: SubDL is not asked.
  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await page.waitForTimeout(500);
  expect(subdl.searches).toHaveLength(1);
  const again = await subtitlesDiagnostics(page);
  await expect(again).toContainText('SubDL: resting (too many requests)');

  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);
  await expect(status(page)).toHaveText(
    "SubDL asked BannerTV to slow down. It'll look there again later.",
  );
});

test('a key SubDL refuses is marked so, and not sent again', async ({ page }) => {
  const { subdl } = await setUp(page, 'refused');
  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await expect
    .poll(() => readKv(page, 'subdl/key'))
    .toEqual({ key: FAKE_SUBDL_KEY, state: 'refused' });
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('SubDL: key not accepted');
  expect(subdl.searches).toHaveLength(1);

  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-subdl');
  await expectFocusLabel(page, 'SubDL subtitles: Key not accepted');
  await press(page, 'Enter', 'subdl-key');
  await expect(status(page)).toHaveText("SubDL didn't accept this key. Check it and try again.");
  expect(subdl.searches).toHaveLength(1);
});

test('a kids profile has no SubDL row and never asks SubDL, even with a key stored', async ({
  page,
}) => {
  // Big Buck Bunny, a family film, as the kids row's first title (as in profiles.spec.ts).
  const bunny = {
    id: 'tt1254207',
    type: 'movie',
    name: 'Big Buck Bunny',
    genres: ['Animation', 'Family'],
  };
  await mockAddons(page, {
    catalogs: { 'movie/top/genre=Family': (route) => json(route, { metas: [bunny] }) },
  });
  await page.route('https://v3-cinemeta.strem.io/meta/movie/tt1254207.json', (route) =>
    json(route, { meta: { ...bunny, runtime: '10 min' } }),
  );
  await seedStreamAddon(page, {
    preferences: { subtitleLanguage: 'eng' },
    kv: {
      ...SAVED_KEY,
      [`p/${KIDS_ID}/subdl/key`]: { key: FAKE_SUBDL_KEY, state: 'works' },
    },
  });
  // The kids profile's own choice: English subtitles, so SubDL would be asked if it could be.
  await page.addInitScript(
    (key) => localStorage.setItem(key, JSON.stringify({ subtitleLanguage: 'eng' })),
    `bannertv.preferences.${KIDS_ID}`,
  );
  await mockPlayback(page);
  const subdl = await standInSubdl(page, 'films');
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Robin', colour: 3, kids: 'PG' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  await page.goto(APP_URL);
  const kidsRow = 'home-0-movie-top-genre-family';
  await expectFocus(page, `${kidsRow}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await page.waitForTimeout(1000);

  for (
    let step = 0;
    step < 4 && (await page.locator('[data-focus-key="details-watch"]').count()) === 0;
    step++
  ) {
    await pressBack(page);
  }
  await expectFocus(page, 'details-watch');
  await pressBack(page);
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-subtitle-style');
  await expect(page.locator('[data-focus-key="settings-subdl"]')).toHaveCount(0);
  expect(subdl.searches).toEqual([]);
  expect(subdl.downloads).toEqual([]);
  expect(subdl.meChecks).toBe(0);
});

test("a season pack's file for the episode playing is downloaded, never another episode's", async ({
  page,
}) => {
  const episodeStream: TestStream = {
    ...DEFAULT_STREAMS[0]!,
    filename: `${SUBDL_EPISODE_RELEASE}.mkv`,
  };
  const { subdl } = await setUp(page, 'pack', {
    streams: { 'tt8000001:2:3': [episodeStream] },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await press(page, 'ArrowUp', 'details-season-0');
  await press(page, 'ArrowRight', 'details-season-1');
  await press(page, 'ArrowDown', 'details-episodes-0');
  await press(page, 'ArrowDown', 'details-episodes-1');
  await press(page, 'ArrowDown', 'details-episodes-2');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expect(page.getByText('SubDL episode 3, line 1')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  expect(subdl.searches[0]).toContain('season=2&episode=3');
  expect(subdl.downloads).toEqual(['/subtitle/9000002/9200013']);
  await page.waitForTimeout(1000);
  // Neither the file named E04 that SubDL says is E03, nor E04's own.
  expect(subdl.downloads).not.toContain('/subtitle/9000002/9200024');
  expect(subdl.downloads).not.toContain('/subtitle/9000002/9200014');
});

test("a film's subtitles in a ZIP are unpacked in the page", async ({ page }) => {
  const { subdl } = await setUp(page, 'zip-film');
  await playFilm(page);
  await expect(page.getByText('From the ZIP, line 1')).toBeVisible();
  expect(subdl.downloads).toEqual(['/subtitle/9000003-9100003.zip']);
});

test('the second play of a film uses the saved answer and asks SubDL nothing', async ({ page }) => {
  const { subdl } = await setUp(page, 'films');
  await playFilm(page);
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  await leavePlayer(page);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'Enter', 'player-surface');
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(/SubDL en 1 \(saved answer\)/);
});

test('a removed key is forgotten, and SubDL is not asked', async ({ page }) => {
  const { subdl } = await setUp(page, 'films');
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);
  await expect(page.getByText('A key is saved. Type a new one to replace it.')).toBeVisible();
  await press(page, 'ArrowDown', 'subdl-save');
  await press(page, 'ArrowDown', 'subdl-remove');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText("Key removed. BannerTV won't look on SubDL.");
  await expectFocus(page, 'subdl-key');
  await expect.poll(() => readKv(page, 'subdl/key')).toBeNull();
  await pressBack(page);
  await expectFocusLabel(page, 'SubDL subtitles: Off');

  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await page.waitForTimeout(500);
  expect(subdl.searches).toEqual([]);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('SubDL: no key');
});

/** Every value the page keeps: its key-value store, its cache, and the browser's storage. */
function everythingKept(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ kv: Array<[string, string]>; cache: string[]; local: string; session: string }>(
        (resolve, reject) => {
          const request = indexedDB.open('bannertv');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['kv', 'cache']);
            const kvKeys = tx.objectStore('kv').getAllKeys();
            const kvValues = tx.objectStore('kv').getAll();
            const cacheKeys = tx.objectStore('cache').getAllKeys();
            const cacheValues = tx.objectStore('cache').getAll();
            tx.oncomplete = () => {
              db.close();
              resolve({
                kv: (kvKeys.result as string[]).map((key, i) => [
                  String(key),
                  JSON.stringify(kvValues.result[i]),
                ]),
                cache: [
                  ...(cacheKeys.result as string[]).map(String),
                  ...cacheValues.result.map((value) => JSON.stringify(value)),
                ],
                local: JSON.stringify({ ...localStorage }),
                session: JSON.stringify({ ...sessionStorage }),
              });
            };
          };
        },
      ),
  );
}

test('the key is kept only in its own store, and never logged or put in an address', async ({
  page,
}) => {
  const lines: string[] = [];
  page.on('console', (message) => lines.push(message.text()));
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  const { subdl } = await setUp(page, 'films');
  await playFilm(page);
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('SubDL');
  expect(await page.locator('body').innerText()).not.toContain(FAKE_SUBDL_KEY);

  const kept = await everythingKept(page);
  for (const [key, value] of kept.kv) {
    if (key === 'subdl/key' || /^p\/[^/]+\/subdl\/key$/.test(key)) continue;
    expect(value, key).not.toContain(FAKE_SUBDL_KEY);
    expect(key).not.toContain(FAKE_SUBDL_KEY);
  }
  expect(kept.kv.find(([key]) => key === 'subdl/key')?.[1]).toContain(FAKE_SUBDL_KEY);
  for (const value of kept.cache) expect(value).not.toContain(FAKE_SUBDL_KEY);
  expect(kept.local).not.toContain(FAKE_SUBDL_KEY);
  expect(kept.session).not.toContain(FAKE_SUBDL_KEY);
  for (const line of lines) expect(line).not.toContain(FAKE_SUBDL_KEY);
  for (const url of urls) expect(url).not.toContain(FAKE_SUBDL_KEY);
  expect(subdl.keyInUrl).toBe(false);
});

test("on Android, a film's SubDL file named for the release is chosen", async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' }, kv: SAVED_KEY });
  await mockPlayback(page, { streams: { [MOVIE]: [FILM_STREAM] } });
  const subdl = await standInSubdl(page, 'films');
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openFocusedTitle(page);
  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(async () => (await playerOps(page)).filter((op) => op === 'load'))
    .toHaveLength(1);
  await androidOpens(page);
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  expect(subdl.downloads).toEqual(['/subtitle/9000001/9200001']);
  await openSheet(page, 'player-tracks-lang-en');
  await expect(subdlRows(page)).toContainText('Same release');
  expect(subdl.keyInUrl).toBe(false);
});
