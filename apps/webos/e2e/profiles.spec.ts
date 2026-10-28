import { expect, type Page, type Route, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { GUEST_ID, KIDS_ID, lockedWith, main, seedProfiles } from './profiles';
import { APP_URL, expectFocus, expectFocusLabel, press, pressBack, watchErrors } from './tv';

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

test('Home rows hides and moves rows for this profile only', async ({ page }) => {
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const firstRowTitle = page.locator(`[data-row-key="${FIRST_ROW}"] h2`);
  await expect(firstRowTitle).toBeVisible();

  await openSettings(page);
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  const top = 'home-rows-com-linvo-cinemeta-movie-top';
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
  const series = 'home-rows-com-linvo-cinemeta-series-top';
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
