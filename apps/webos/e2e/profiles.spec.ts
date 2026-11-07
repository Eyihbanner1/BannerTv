import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, type Route, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { seedStreamAddon } from './play';
import { GUEST_ID, KIDS_ID, lockedWith, main, seedProfiles } from './profiles';
import {
  APP_URL,
  expectFocus,
  expectFocusLabel,
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

/** Presses digits on the remote's number keys. */
async function typeDigits(page: Page, digits: string): Promise<void> {
  for (const digit of digits) {
    await page.keyboard.press(digit);
    await page.waitForTimeout(60);
  }
}

/** From Home's first tile to Settings, through the rail. */
async function openSettings(page: Page): Promise<void> {
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'addons', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-stream-choice');
}

test('with one profile BannerTV opens on Home, and a profile added in Settings brings the picker', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('[data-focus-key="rail-profile"]')).toHaveCount(0);

  await openSettings(page);
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'Enter', 'profiles-main');
  await press(page, 'ArrowDown', 'profiles-add');
  await press(page, 'Enter', 'profile-name');
  await page.keyboard.press('Enter');
  const name = page.locator('input[aria-label="Name"]');
  await expect(name).toBeFocused();
  await page.keyboard.type('Sam');
  await press(page, 'Enter', 'profile-name');
  await expect(name).toHaveValue('Sam');
  await expect(name).not.toBeFocused();
  // Down through the colours and the kids choice to Add.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^profile-colour-/,
  );
  await page.waitForTimeout(150);
  await press(page, 'ArrowDown', 'profile-kids');
  await press(page, 'ArrowDown', 'profile-save');
  await press(page, 'Enter', 'profiles-add');
  await expect(page.getByRole('button', { name: 'Sam' })).toBeVisible();
  await press(page, 'ArrowDown', 'profiles-ask');
  await expectFocusLabel(page, "Ask who's watching when BannerTV opens: On");

  // The rail now offers a switch, and the picker lists Sam.
  await pressBack(page);
  await expectFocus(page, 'settings-profiles');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(150);
  // The rail opens on the section in use.
  await press(page, 'ArrowLeft', 'rail-settings');
  await press(page, 'ArrowDown', 'rail-profile');
  await expectFocusLabel(page, 'Switch profile, now Main');
  await press(page, 'Enter', 'profile-main');
  const picker = page.getByRole('dialog', { name: "Who's watching?" });
  await press(page, 'ArrowRight', `profile-${await newProfileId(page)}`);
  await expectFocusLabel(page, 'Sam');
  // Back leaves Main in use.
  await pressBack(page);
  await expect(picker).toHaveCount(0);
  await expectFocus(page, 'rail-profile');
  expect(errors).toEqual([]);
});

async function newProfileId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('bannertv.profiles')!) as {
      profiles: { id: string }[];
    };
    return state.profiles[1]!.id;
  });
}

test('a locked profile asks for its PIN, says when it is wrong, and waits after five tries', async ({
  page,
}) => {
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(lockedWith('2468')), { id: GUEST_ID, name: 'Guest', colour: 2 }],
    lastId: 'main',
    askAtLaunch: true,
  });
  await page.goto(APP_URL);
  await expectFocus(page, 'profile-main');
  await expectFocusLabel(page, 'Main, PIN');
  await page.waitForTimeout(150);
  await press(page, 'Enter', 'picker-pin-1');
  const pad = page.getByRole('dialog', { name: 'Enter the PIN for Main' });
  await typeDigits(page, '1111');
  await expect(pad.getByText('That PIN is not right.')).toBeVisible();
  // The pad's own keys work too, and Back closes it.
  await press(page, 'ArrowRight', 'picker-pin-2');
  await page.keyboard.press('Enter');
  await expect(pad.locator('[aria-label="1 digit entered"]')).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'profile-main');
  await page.waitForTimeout(150);

  // Five wrong tries in a row and the pad says to wait, even for the right PIN.
  await page.keyboard.press('Enter');
  for (const wrong of ['2222', '3333', '4444', '5555']) await typeDigits(page, wrong);
  await expect(pad.getByText('Too many tries. Wait 30 seconds.')).toBeVisible();
  await typeDigits(page, '2468');
  await expect(pad.getByText(/^Too many tries\./)).toBeVisible();
  await pressBack(page);

  // Guest has no PIN and opens at once.
  await press(page, 'ArrowRight', `profile-${GUEST_ID}`);
  await page.keyboard.press('Enter');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  // The count is saved, so closing and opening the app buys no more tries.
  const tries = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('bannertv.pinTries')!) as Record<
        string,
        { lockedUntil: number }
      >,
  );
  expect(tries.main!.lockedUntil).toBeGreaterThan(Date.now());
});

test('opening BannerTV again from the launcher asks who is watching when the profile has a PIN', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(lockedWith('2468')), { id: GUEST_ID, name: 'Guest', colour: 2 }],
    lastId: 'main',
    askAtLaunch: false,
  });
  // As on a TV that loses a storage write made just before a reload: the choice comes back.
  await page.addInitScript(() => {
    const lost = sessionStorage.getItem('test.lostChoice');
    if (lost === null) return;
    sessionStorage.removeItem('test.lostChoice');
    sessionStorage.setItem('bannertv.profile', lost);
  });
  const relaunch = () => page.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
  await page.goto(APP_URL);
  // Main was used last, but its PIN means the picker asks.
  await expectFocusLabel(page, 'Main, PIN');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await typeDigits(page, '2468');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await page.evaluate(() => sessionStorage.setItem('test.lostChoice', 'main'));
  await relaunch();
  await expectFocusLabel(page, 'Main, PIN');
  expect(page.url()).not.toContain('#');

  // Guest has no PIN, so opening the app again carries on where it was.
  await press(page, 'ArrowRight', `profile-${GUEST_ID}`);
  await page.keyboard.press('Enter');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await relaunch();
  await page.waitForTimeout(300);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  expect(errors).toEqual([]);
});

test('changing or removing a PIN asks for the one it has, unless it was entered to open the profile', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [
      main(lockedWith('2468')),
      { id: GUEST_ID, name: 'Guest', colour: 2, ...lockedWith('1357') },
    ],
    lastId: GUEST_ID,
    askAtLaunch: false,
  });
  const pinOf = (id: string) =>
    page.evaluate((profileId) => {
      const saved = JSON.parse(localStorage.getItem('bannertv.profiles')!) as {
        profiles: { id: string; pin?: { hash: string } }[];
      };
      return saved.profiles.find((profile) => profile.id === profileId)?.pin?.hash ?? null;
    }, id);
  const pad = (name: string) => page.getByRole('dialog', { name: `Enter the PIN for ${name}` });
  await page.goto(APP_URL);
  await expectFocusLabel(page, 'Guest, PIN');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await typeDigits(page, '1357');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const guestPin = await pinOf(GUEST_ID);

  // Guest's own page opens without the PIN, but its PIN cannot be changed or removed without it.
  await openSettings(page);
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'Enter', 'profiles-main');
  await press(page, 'ArrowDown', `profiles-${GUEST_ID}`);
  await press(page, 'Enter', 'profile-name');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^profile-colour-/,
  );
  await page.waitForTimeout(150);
  await press(page, 'ArrowDown', 'profile-save');
  await press(page, 'ArrowDown', 'profile-pin');
  await press(page, 'ArrowDown', 'profile-pin-remove');
  await press(page, 'Enter', 'profile-pin-pad-1');
  await expect(pad('Guest')).toBeVisible();
  await typeDigits(page, '2468');
  await expect(pad('Guest').getByText('That PIN is not right.')).toBeVisible();
  // Back returns to Remove PIN, and the PIN stays.
  await pressBack(page);
  await expectFocus(page, 'profile-pin-remove');
  expect(await pinOf(GUEST_ID)).toBe(guestPin);

  // Change PIN takes the one it has first, then the new one twice.
  await press(page, 'ArrowUp', 'profile-pin');
  await press(page, 'Enter', 'profile-pin-pad-1');
  await expect(pad('Guest')).toBeVisible();
  await typeDigits(page, '1357');
  const choose = page.getByRole('dialog', { name: 'Choose a four-digit PIN' });
  await expect(choose).toBeVisible();
  await typeDigits(page, '1111');
  await expect(page.getByRole('dialog', { name: 'Enter the PIN again' })).toBeVisible();
  await typeDigits(page, '1111');
  await expectFocus(page, 'profile-pin');
  const changed = await pinOf(GUEST_ID);
  expect(changed).not.toBeNull();
  expect(changed).not.toBe(guestPin);
  // Known on this page now, so Remove PIN asks nothing more.
  await press(page, 'ArrowDown', 'profile-pin-remove');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'profile-pin');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await pinOf(GUEST_ID)).toBeNull();

  // Main's page asks for its PIN to open, so Remove PIN does not ask again.
  await pressBack(page);
  await expectFocus(page, `profiles-${GUEST_ID}`);
  await press(page, 'ArrowUp', 'profiles-main');
  await press(page, 'Enter', 'profiles-pin-1');
  await typeDigits(page, '2468');
  await expectFocus(page, 'profile-name');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await press(page, 'ArrowDown', 'profile-save');
  await press(page, 'ArrowDown', 'profile-pin');
  await press(page, 'ArrowDown', 'profile-pin-remove');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'profile-pin');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await pinOf('main')).toBeNull();
  expect(errors).toEqual([]);
});

test("Back pressed while Home still reads the profile's rows stays in the app", async ({
  page,
}) => {
  // Holds the read of Home's row settings until the journey lets it go.
  await page.addInitScript(() => {
    const w = window as Window & { releaseLayout?: () => void; exitRequested?: boolean };
    const released = new Promise<void>((resolve) => (w.releaseLayout = resolve));
    window.addEventListener('bannertv:exit', () => (w.exitRequested = true));
    const get = IDBObjectStore.prototype.get;
    const setSuccess = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!.set!;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, query: IDBValidKey) {
      const request = get.call(this, query);
      if (query !== 'homeLayout') return request;
      Object.defineProperty(request, 'onsuccess', {
        set(handler: (this: IDBRequest, event: Event) => void) {
          setSuccess.call(request, (event: Event) => {
            void released.then(() => handler.call(request, event));
          });
        },
      });
      return request;
    };
  });
  await mockAddons(page);
  await page.goto(APP_URL);
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as Window & { releaseLayout?: () => void }).releaseLayout?.());
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  expect(
    await page.evaluate(() => (window as Window & { exitRequested?: boolean }).exitRequested),
  ).toBeUndefined();
});

test('a kids profile sees Family rows only, no Addons, a short Settings, and no unsuitable title', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page, {
    catalogs: {
      'movie/top/genre=Family': (route) =>
        json(route, {
          metas: [
            {
              id: 'tt1254207',
              type: 'movie',
              name: 'Big Buck Bunny',
              poster: 'https://images.metahub.space/poster/small/tt1254207/img',
              genres: ['Animation', 'Family'],
            },
            { id: 'tt0807840', type: 'movie', name: 'Elephants Dream', genres: ['Horror'] },
            { id: 'tt1727587', type: 'movie', name: 'Sintel' },
          ],
        }),
    },
  });
  // Big Buck Bunny's page says it is for families; Sintel's does not.
  await page.route('https://v3-cinemeta.strem.io/meta/movie/tt1254207.json', (route) =>
    json(route, {
      meta: {
        id: 'tt1254207',
        type: 'movie',
        name: 'Big Buck Bunny',
        genres: ['Animation', 'Family'],
        runtime: '10 min',
      },
    }),
  );
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Robin', colour: 3, kids: 'PG' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  await page.goto(APP_URL);

  const kidsRow = 'home-0-movie-top-genre-family';
  await expectFocus(page, `${kidsRow}-tile-0`);
  expect(requests.catalogs).toContain('movie/top/genre=Family');
  expect(requests.catalogs).not.toContain('movie/top');
  // Elephants Dream says Horror, so it is left out; Sintel says nothing, and its row asked for Family.
  const row = page.locator(`[data-row-key="${kidsRow}"]`);
  await expect(row.getByRole('button', { name: /Big Buck Bunny/ })).toBeVisible();
  await expect(row.getByRole('button', { name: /Elephants Dream/ })).toHaveCount(0);

  await press(page, 'Enter', 'details-watch');
  await pressBack(page);
  await expectFocus(page, `${kidsRow}-tile-0`);
  await press(page, 'ArrowRight', `${kidsRow}-tile-1`);
  await page.keyboard.press('Enter');
  await expect(page.getByText("This title isn't available in a kids profile.")).toBeVisible();
  await page.waitForTimeout(150);
  await expectFocus(page, 'details-my-list');
  await expect(page.locator('[data-focus-key="details-watch"]')).toHaveCount(0);
  await pressBack(page);
  await expectFocus(page, `${kidsRow}-tile-1`);

  await press(page, 'ArrowLeft', `${kidsRow}-tile-0`);
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await expect(page.locator('[data-focus-key="rail-addons"]')).toHaveCount(0);
  await press(page, 'Enter', 'settings-subtitle-style');
  await expect(page.locator('[data-focus-key="settings-profiles"]')).toHaveCount(0);
  await expect(page.locator('[data-focus-key="settings-diagnostics"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a kids profile's Discover leaves out a sports catalog, even one offering Family titles", async ({
  page,
}) => {
  const errors = watchErrors(page);
  // Made-up: a film catalog that names a sport and can filter by Family, set
  // to Show in Sports by a grown-up, first in the list so Discover would open on it.
  const replaysUrl = 'https://replays.example.com/bannertv/manifest.json';
  const replays = {
    id: 'org.bannertv.test-replays',
    version: '1.0.0',
    name: 'Test Replays',
    types: ['movie'],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['trep:'],
    catalogs: [
      {
        type: 'movie',
        id: 'football_replays',
        name: 'Football replays',
        extra: [{ name: 'genre', options: ['Family', 'Drama'] }],
      },
    ],
  };
  const core = resolve(import.meta.dirname, '../../../packages/core/src/addons');
  const manifest = (name: string) =>
    JSON.parse(readFileSync(resolve(core, `${name}.manifest.json`), 'utf8')) as unknown;
  const addons = [
    { transportUrl: replaysUrl, manifest: replays, official: false, fetchedAt: 0 },
    {
      transportUrl: 'https://v3-cinemeta.strem.io/manifest.json',
      manifest: manifest('cinemeta'),
      official: true,
      fetchedAt: 0,
    },
    {
      transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json',
      manifest: manifest('opensubtitles-v3'),
      official: true,
      fetchedAt: 0,
    },
  ];
  // Before mockAddons, so its usual list is not stored over this one.
  await page.addInitScript(
    ({ stored, settings }) => {
      if (sessionStorage.getItem('bannertv.test.addons')) return;
      sessionStorage.setItem('bannertv.test.addons', '1');
      const request = indexedDB.open('bannertv', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache').createIndex('storedAt', 'storedAt');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(stored, 'addons');
        tx.objectStore('kv').put(settings, 'sports.settings');
        tx.oncomplete = () => db.close();
      };
    },
    { stored: addons, settings: { [replays.id]: 'yes' } },
  );
  await mockAddons(page, {
    catalogs: {
      'movie/top/genre=Family': (route) =>
        json(route, {
          metas: [{ id: 'tt1254207', type: 'movie', name: 'Big Buck Bunny', genres: ['Family'] }],
        }),
    },
  });
  const replayRequests: string[] = [];
  await page.route(/^https:\/\/replays\.example\.com\//, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    replayRequests.push(path);
    if (path === '/bannertv/manifest.json') return json(route, replays);
    return json(route, {
      metas: [{ id: 'trep:1', type: 'movie', name: 'Arsenal vs Celtic', genres: ['Family'] }],
    });
  });
  await page.route('https://v3-cinemeta.strem.io/meta/movie/tt1254207.json', (route) =>
    json(route, {
      meta: { id: 'tt1254207', type: 'movie', name: 'Big Buck Bunny', genres: ['Family'] },
    }),
  );
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Robin', colour: 3, kids: 'PG' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  await page.goto(APP_URL);

  // Home leaves the sports catalog out: its first row is Cinemeta's.
  await expectFocus(page, 'home-1-movie-top-genre-family-tile-0');
  await openSection(page, 'discover');
  await expectFocus(page, 'discover-tile-0');
  await expect(page.locator('[data-focus-key="discover-catalog"]')).toHaveAttribute(
    'aria-label',
    'Catalog: Popular',
  );
  await press(page, 'ArrowUp', 'discover-type');
  await press(page, 'ArrowRight', 'discover-catalog');
  await press(page, 'Enter', 'discover-catalog-menu-0');
  await expect(page.getByRole('dialog', { name: 'Catalog' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Football replays')).toHaveCount(0);
  await pressBack(page);
  await press(page, 'ArrowDown', 'discover-tile-0');
  // A title opens its own page, with the kids checks, never a match page.
  await press(page, 'Enter', 'details-watch');
  expect(replayRequests.filter((path) => path.indexOf('/catalog/') !== -1)).toEqual([]);
  expect(errors).toEqual([]);
});

test('each profile keeps its own My List', async ({ page }) => {
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(), { id: GUEST_ID, name: 'Guest', colour: 2 }],
    lastId: 'main',
    askAtLaunch: false,
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  // Main saves Big Buck Bunny.
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'ArrowRight', 'details-streams');
  await press(page, 'ArrowRight', 'details-my-list');
  await expectFocusLabel(page, 'Add Big Buck Bunny to My List');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Remove Big Buck Bunny from My List');
  await page.waitForTimeout(150);
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-1`);

  await press(page, 'ArrowLeft', `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'discover-tile-0');
  await expectFocusLabel(page, 'Big Buck Bunny, 2008');

  // Guest's Library is empty.
  await press(page, 'ArrowLeft', 'rail-library');
  for (const item of ['addons', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'ArrowDown', 'rail-profile');
  await press(page, 'Enter', 'profile-main');
  await press(page, 'ArrowRight', `profile-${GUEST_ID}`);
  await page.keyboard.press('Enter');
  // The app opens again as Guest.
  await page.waitForLoadState();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'library-show');
  await expect(page.getByText('Nothing saved yet.')).toBeVisible();
});

test('a title taken off My List from its page leaves focus on the Library', async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page, {
    kv: {
      library: {
        items: [
          {
            id: 'tt1254207',
            type: 'movie',
            name: 'Big Buck Bunny',
            releaseInfo: '2008',
            addedAt: 2,
          },
          { id: 'tt1727587', type: 'movie', name: 'Sintel', releaseInfo: '2010', addedAt: 1 },
        ],
        outbox: [],
        synced: [],
      },
    },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'library');
  await expectFocus(page, 'discover-tile-0');
  await press(page, 'ArrowRight', 'discover-tile-1');
  await expectFocusLabel(page, 'Sintel, 2010');
  await press(page, 'Enter', 'details-watch');
  await press(page, 'ArrowRight', 'details-trailer');
  await press(page, 'ArrowRight', 'details-streams');
  await press(page, 'ArrowRight', 'details-my-list');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Add Sintel to My List');
  await page.waitForTimeout(150);
  // Back: the tile it came from has gone, so focus goes to the one left.
  await pressBack(page);
  await expectFocus(page, 'discover-tile-0');
  await expectFocusLabel(page, 'Big Buck Bunny, 2008');
  await press(page, 'ArrowUp', 'library-show');
});

test('Home rows hides and moves rows for this profile only', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const firstRowTitle = page.locator(`[data-row-key="${FIRST_ROW}"] h2`);
  await expect(firstRowTitle).toBeVisible();

  await openSettings(page);
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  const top = 'home-rows-0-movie-top';
  await press(page, 'Enter', `${top}-up`);
  // Hide the first row, then move the series row to the top.
  await press(page, 'ArrowRight', `${top}-down`);
  await press(page, 'ArrowRight', `${top}-show`);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'aria-label',
    /^Show .* on Home$/,
  );
  await page.waitForTimeout(150);
  const series = 'home-rows-0-series-top';
  await press(page, 'ArrowDown', `${series}-show`);
  await press(page, 'ArrowLeft', `${series}-down`);
  await press(page, 'ArrowLeft', `${series}-up`);
  await press(page, 'Enter', `${series}-up`);

  await pressBack(page);
  await expectFocus(page, 'settings-home-rows');
  await pressBack(page);
  // Home now starts on the series row, and the films row is gone.
  await expectFocus(page, 'home-0-series-top-tile-0');
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toHaveCount(0);

  await page.reload();
  await expectFocus(page, 'home-0-series-top-tile-0');
});

/** The profiles saved in localStorage, by id. */
async function savedProfiles(
  page: Page,
): Promise<Record<string, { name: string; kids?: string; pin?: unknown }>> {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('bannertv.profiles')!) as {
      profiles: { id: string; name: string; kids?: string; pin?: unknown }[];
    };
    return Object.fromEntries(state.profiles.map((p) => [p.id, p]));
  });
}

/** From the first key of an open PIN pad down to its "Forgot PIN?". */
async function toForgot(page: Page, pad: string): Promise<void> {
  for (const key of ['4', '7', 'delete']) await press(page, 'ArrowDown', `${pad}-${key}`);
  await press(page, 'ArrowDown', `${pad}-forgot`);
}

test("Forgot PIN? on another profile asks for Main's PIN, then opens it with the PIN off", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [
      main(lockedWith('2468')),
      { id: GUEST_ID, name: 'Guest', colour: 2, ...lockedWith('1111') },
    ],
    lastId: 'main',
    askAtLaunch: true,
  });
  await page.goto(APP_URL);
  await expectFocus(page, 'profile-main');
  await page.waitForTimeout(150);
  await press(page, 'ArrowRight', `profile-${GUEST_ID}`);
  await press(page, 'Enter', 'picker-pin-1');
  await toForgot(page, 'picker-pin');
  await expectFocusLabel(page, 'Forgot PIN?');
  await press(page, 'Enter', 'forgot-pin-main-1');
  const pad = page.getByRole('dialog', { name: "Enter Main's PIN to take the PIN off Guest" });
  await expect(pad).toBeVisible();
  // Guest's own PIN is no use here.
  await typeDigits(page, '1111');
  await expect(pad.getByText('That PIN is not right.')).toBeVisible();
  await typeDigits(page, '2468');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const saved = await savedProfiles(page);
  expect(saved[GUEST_ID]!.pin).toBeUndefined();
  expect(saved.main!.pin).toBeDefined();
  expect(errors).toEqual([]);
});

test('Forgot PIN? when Main has no PIN says anyone could do it, and Cancel keeps the PIN', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(), { id: GUEST_ID, name: 'Guest', colour: 2, ...lockedWith('1111') }],
    lastId: 'main',
    askAtLaunch: true,
  });
  await page.goto(APP_URL);
  await expectFocus(page, 'profile-main');
  await page.waitForTimeout(150);
  await press(page, 'ArrowRight', `profile-${GUEST_ID}`);
  await press(page, 'Enter', 'picker-pin-1');
  await toForgot(page, 'picker-pin');
  await press(page, 'Enter', 'forgot-pin-warn-cancel');
  const warn = page.getByRole('dialog', { name: 'Take the PIN off Guest?' });
  await expect(warn.getByText(/Main has no PIN, so anyone using BannerTV here/)).toBeVisible();
  await press(page, 'Enter', `profile-${GUEST_ID}`);
  expect((await savedProfiles(page))[GUEST_ID]!.pin).toBeDefined();

  await press(page, 'Enter', 'picker-pin-1');
  await toForgot(page, 'picker-pin');
  await press(page, 'Enter', 'forgot-pin-warn-cancel');
  await press(page, 'ArrowLeft', 'forgot-pin-warn-confirm');
  await page.keyboard.press('Enter');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  expect((await savedProfiles(page))[GUEST_ID]!.pin).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Forgot PIN? for Main on a TV with no account resets BannerTV and starts it as new', async ({
  page,
}) => {
  await mockAddons(page, { firstRun: true });
  // Seeded once per tab: the reset reloads the page, and must not find them again.
  const state = {
    profiles: [main(lockedWith('2468')), { id: GUEST_ID, name: 'Guest', colour: 2 }],
    lastId: 'main',
    askAtLaunch: true,
  };
  await page.addInitScript((saved) => {
    if (window.name === 'seeded') return;
    window.name = 'seeded';
    localStorage.setItem('bannertv.welcomed', '1');
    localStorage.setItem('bannertv.profiles', saved);
    localStorage.setItem('bannertv.tuning', '{"kept":true}');
  }, JSON.stringify(state));
  // What is taken out of localStorage is noted as it goes, before and after the restart. Read
  // afterwards, it can't tell: over file://, this test browser sometimes starts the reloaded
  // page with none of what was stored, even keys nothing touched (a bare page does the same).
  const removed: string[] = [];
  await page.exposeFunction('noteRemoved', (key: string) => removed.push(key));
  await page.addInitScript(() => {
    const note = (key: string) =>
      void (window as unknown as { noteRemoved: (key: string) => Promise<void> }).noteRemoved(key);
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (this: Storage, key: string) {
      if (this === window.localStorage) note(key);
      removeItem.call(this, key);
    };
    const clear = Storage.prototype.clear;
    Storage.prototype.clear = function (this: Storage) {
      if (this === window.localStorage) note('(everything)');
      clear.call(this);
    };
  });
  await page.goto(APP_URL);
  await expectFocus(page, 'profile-main');
  await page.waitForTimeout(150);
  await press(page, 'Enter', 'picker-pin-1');
  await toForgot(page, 'picker-pin');
  await press(page, 'Enter', 'forgot-pin-reset-cancel');
  const reset = page.getByRole('dialog', { name: 'Reset BannerTV on this TV?' });
  await expect(reset.getByText(/Every profile, addon, My List/)).toBeVisible();
  await press(page, 'ArrowLeft', 'forgot-pin-reset-confirm');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Welcome to BannerTV' })).toBeVisible({
    timeout: 15000,
  });
  // The profiles and the welcome went; the TV's own measurements were never taken out.
  expect(removed).toEqual(expect.arrayContaining(['bannertv.profiles', 'bannertv.welcomed']));
  expect(removed).not.toContain('bannertv.tuning');
  expect(removed).not.toContain('(everything)');
  const left = await page.evaluate(() => ({
    profiles: localStorage.getItem('bannertv.profiles'),
  }));
  // Only a fresh Main, with no PIN, if anything.
  if (left.profiles !== null) {
    const fresh = JSON.parse(left.profiles) as { profiles: { id: string; pin?: unknown }[] };
    expect(fresh.profiles.map((p) => p.id)).toEqual(['main']);
    expect(fresh.profiles[0]!.pin).toBeUndefined();
  }
});

test('making a kids profile offers to lock the grown-up profiles that have no PIN', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(), { id: GUEST_ID, name: 'Guest', colour: 2 }],
    lastId: 'main',
    askAtLaunch: false,
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'Enter', 'profiles-main');
  await press(page, 'ArrowDown', `profiles-${GUEST_ID}`);
  await press(page, 'ArrowDown', 'profiles-add');
  await press(page, 'Enter', 'profile-name');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ada');
  await press(page, 'Enter', 'profile-name');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await press(page, 'ArrowDown', 'profile-kids');
  await press(page, 'Enter', 'profile-kids-menu-0');
  await press(page, 'ArrowDown', 'profile-kids-menu-1');
  await press(page, 'Enter', 'profile-kids');
  await expectFocusLabel(page, 'Kids profile: Kids, up to U');
  await press(page, 'ArrowDown', 'profile-save');
  await press(page, 'Enter', 'lock-grown-ups-main');
  const offer = page.getByRole('dialog', { name: 'Lock the grown-up profiles?' });
  await expect(offer).toBeVisible();
  await expectFocusLabel(page, 'Set a PIN for Main');
  await expect(offer.getByRole('button', { name: 'Not now' })).toBeVisible();

  // Main gets a PIN, typed twice; the second time wrong first.
  await press(page, 'Enter', 'lock-grown-ups-pin-1');
  await expect(
    page.getByRole('dialog', { name: 'Choose a four-digit PIN for Main' }),
  ).toBeVisible();
  await typeDigits(page, '1357');
  await typeDigits(page, '1358');
  await expect(page.getByText("Those PINs didn't match. Choose one again.")).toBeVisible();
  await typeDigits(page, '1357');
  await typeDigits(page, '1357');
  await expectFocus(page, 'lock-grown-ups-done');
  await expect(offer.getByRole('button', { name: 'Main has a PIN' })).toBeVisible();

  // Guest too, and the button says Done.
  await press(page, 'ArrowUp', `lock-grown-ups-${GUEST_ID}`);
  await page.keyboard.press('Enter');
  await typeDigits(page, '2468');
  await typeDigits(page, '2468');
  await expectFocus(page, 'lock-grown-ups-done');
  await expectFocusLabel(page, 'Done');
  await page.keyboard.press('Enter');
  await expect(offer).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Profiles' })).toBeVisible();

  const saved = await savedProfiles(page);
  expect(saved.main!.pin).toBeDefined();
  expect(saved[GUEST_ID]!.pin).toBeDefined();
  const ada = Object.values(saved).filter((p) => p.name === 'Ada')[0]!;
  expect(ada.kids).toBe('U');
  expect(ada.pin).toBeUndefined();
  expect(errors).toEqual([]);
});
