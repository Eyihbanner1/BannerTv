import { expect, type Page, type Route, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { mockPlayback, readKv } from './play';
import {
  crowdedDay,
  MATCHES,
  mockSports,
  oddItems,
  seedSports,
  SPORTS_MANIFEST,
  SPORTS_NOW,
  type SportsOptions,
} from './sports';
import {
  APP_URL,
  expectFocus,
  expectFocusLabel,
  focusedKey,
  openSection,
  press,
  pressBack,
  pressTo,
  railSections,
  slidTo,
  watchErrors,
} from './tv';

// Kick-offs read in the TV's own time zone; SPORTS_NOW is 19:30 in London.
test.use({ timezoneId: 'Europe/London' });

const LIVE_ROW = 'home-live-sport';
const EFL_CUP = 'sports-row-c-eng-league-cup';
const MINUTE = 60 * 1000;

/**
 * Errors other than the browser's own line for a failed request: an addon
 * that answers 502 on purpose, or a logo the test network refuses. Page
 * errors and the app's own errors all count.
 */
function realErrors(errors: string[]): string[] {
  return errors.filter((error) => !/^Failed to load resource: /.test(error));
}

/** The Sports screen's row headings, top down. */
function sportsRows(page: Page) {
  return page.locator('[data-row-key^="sports-row-"] h2');
}

/** What Audio Guidance reads for every tile drawn on the Sports screen. */
function sportsTileLabels(page: Page): Promise<string[]> {
  return page
    .locator('[data-focus-key^="sports-row-"][data-focus-key*="-tile-"]')
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('aria-label') ?? ''));
}

/** Answers a catalog request with these items. */
function answer(route: Route, metas: unknown[]) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ metas }),
  });
}

/** The row a focus key is in: `home-0-movie-top-tile-3` is in `home-0-movie-top`. */
function rowOf(key: string): string {
  return key.replace(/-tile-\d+$/, '');
}

/** What Audio Guidance reads for each tile of a row. */
function tileLabels(page: Page, rowKey: string): Promise<string[]> {
  return page
    .locator(`[data-row-key="${rowKey}"] [data-focus-key^="${rowKey}-tile-"]`)
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('aria-label') ?? ''));
}

/** Notes every script the page adds, since the team list's script removes itself once read. */
async function watchScripts(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as { __scripts?: string[] }).__scripts = seen;
    new MutationObserver((changes) => {
      for (const change of changes) {
        change.addedNodes.forEach((node) => {
          if (node instanceof HTMLScriptElement && node.src) seen.push(node.src);
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

function addedScripts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as { __scripts?: string[] }).__scripts ?? []);
}

/** Notes every row the page ever draws, however briefly. */
async function watchRows(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as { __rows?: string[] }).__rows = seen;
    const note = (node: Node) => {
      if (!(node instanceof Element)) return;
      for (const row of [node, ...Array.from(node.querySelectorAll('[data-row-key]'))]) {
        const key = row.getAttribute('data-row-key');
        if (key && seen.indexOf(key) === -1) seen.push(key);
      }
    };
    new MutationObserver((changes) => {
      for (const change of changes) change.addedNodes.forEach(note);
    }).observe(document, { childList: true, subtree: true });
  });
}

function drawnRows(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as { __rows?: string[] }).__rows ?? []);
}

/** Starts the app at SPORTS_NOW with Cinemeta, the sports addons and OpenSubtitles. */
async function startWithSports(page: Page, options: SportsOptions = {}) {
  await page.clock.install({ time: SPORTS_NOW });
  await watchScripts(page);
  await mockAddons(page);
  await seedSports(page, options);
  const requests = await mockSports(page, options);
  const playback = await mockPlayback(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  return { requests, playback };
}

test('Home rows lists Live sport, which moves to the top and hides like a row', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { requests } = await startWithSports(page);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'Enter', 'home-rows-bannertv-continue-show');
  // Continue Watching, My List, the first catalog row, then Live sport, as on Home.
  await press(page, 'ArrowDown', 'home-rows-bannertv-my-list-show');
  await press(page, 'ArrowDown', 'home-rows-0-movie-top-show');
  await press(page, 'ArrowDown', 'home-rows-bannertv-live-sport-show');
  await press(page, 'ArrowLeft', 'home-rows-bannertv-live-sport-down');
  await press(page, 'ArrowLeft', 'home-rows-bannertv-live-sport-up');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => ((await readKv(page, 'homeLayout')) as { order: string[] })?.order[0])
    .toBe('bannertv:live-sport');
  await pressBack(page);
  await pressBack(page);
  const rows = page.locator('main [data-row-key]');
  await expect(rows.nth(0)).toHaveAttribute('data-row-key', LIVE_ROW);
  await expect(rows.nth(1)).toHaveAttribute('data-row-key', FIRST_ROW);

  // Hidden, it is neither drawn nor asked for again.
  await openSection(page, 'settings');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'Enter', 'home-rows-bannertv-continue-show');
  // Now second, under Continue Watching.
  await press(page, 'ArrowDown', 'home-rows-bannertv-live-sport-show');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Show Live sport on Home');
  await pressBack(page);
  await pressBack(page);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toBeVisible();
  await expect(page.locator(`[data-row-key="${LIVE_ROW}"]`)).toHaveCount(0);
  const asked = requests.all.length;
  await page.waitForTimeout(500);
  expect(requests.all.slice(asked).filter((request) => request.includes('/live.json'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('Sports shows in the rail only while a sports addon is installed', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.install({ time: SPORTS_NOW });
  await watchScripts(page);
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.waitForTimeout(500);
  expect(await railSections(page)).toEqual([
    'home',
    'search',
    'discover',
    'library',
    'addons',
    'settings',
  ]);
  // No sports addon: the team list is never loaded and Home has no Live sport row.
  expect((await addedScripts(page)).filter((src) => src.includes('/data/'))).toEqual([]);
  await expect(page.locator(`[data-row-key="${LIVE_ROW}"]`)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a sports addon adds Sports to the rail and a Live sport row to Home, and leaves Home rows', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { requests } = await startWithSports(page);
  expect(await railSections(page)).toEqual([
    'home',
    'search',
    'discover',
    'sports',
    'library',
    'addons',
    'settings',
  ]);
  await expect
    .poll(async () => (await addedScripts(page)).filter((src) => src.includes('/data/')))
    .toEqual([expect.stringMatching(/\/data\/sports-data\.js$/)]);

  // The addon's catalogs are not Home rows; Live sport is the third row.
  const rows = page.locator('main [data-row-key]');
  await expect(rows.nth(2)).toHaveAttribute('data-row-key', LIVE_ROW);
  const keys = await rows.evaluateAll((list) =>
    list.map((row) => row.getAttribute('data-row-key')),
  );
  expect(keys.filter((key) => /-sport-/.test(key ?? ''))).toEqual([]);
  await expect(page.locator(`[data-row-key="${LIVE_ROW}"] h2`)).toHaveText('Live sport');

  // Only the live catalog's first page is asked for Home.
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${LIVE_ROW}-tile-0`);
  expect(await tileLabels(page, LIVE_ROW)).toEqual([
    'Arsenal v Brighton, EFL Cup, live now',
    'Celtic v Rangers, Scottish football, Starting 19:40',
  ]);
  expect(requests.all.filter((request) => request.includes('/catalog/'))).toEqual([
    'sports /bannertv/catalog/sport/live.json',
  ]);

  // OK opens the match's own page.
  await press(page, 'Enter', 'event-watch');
  const event = page.locator('section[aria-label="Arsenal v Brighton"]');
  await expect(event).toBeVisible();
  await expect(event).toContainText('EFL Cup');
  await expect(event).toContainText('Live now, since 19:00');
  await expect(event).toContainText('Listed by Test Sports');
  await expect(event).toContainText('Arsenal vs Brighton, made up for the journeys.');
  await pressBack(page);
  await expectFocus(page, `${LIVE_ROW}-tile-0`);
  expect(realErrors(errors)).toEqual([]);
});

test('Sports groups the day by competition and works out live from kick-off times', async ({
  page,
}) => {
  const errors = watchErrors(page);
  let held: Promise<void> | undefined;
  let release = () => undefined as void;
  // The live catalog says its copy is fresh for half a minute: it is still asked at
  // most every 2 minutes.
  const { requests } = await startWithSports(page, { held: () => held, liveMaxAge: 30 });
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');
  await expect(page.locator('[data-focus-key="sports-day-1"]')).toHaveText('Today');
  await expect(page.locator('[data-focus-key="sports-day-0"]')).toHaveText('Live now');
  await expect(page.locator('[data-focus-key="sports-day-3"]')).toHaveText('Fri 30');

  // A competition row from the addon's hint, a country row from the team list, then
  // what has ended. Channels and placeholders never show.
  await expect(sportsRows(page)).toHaveText([
    'EFL Cup · 1 live of 2',
    'Scottish football',
    'Earlier today',
  ]);
  expect(await tileLabels(page, EFL_CUP)).toEqual([
    'Arsenal v Brighton, EFL Cup, live now',
    'Manchester City v Burnley, EFL Cup, 20:00',
  ]);
  expect(await tileLabels(page, 'sports-row-earlier')).toEqual([
    'Barnsley v Leeds United, EFL Trophy, Ended',
  ]);
  await expect(page.getByText('Sky Sports Main Event')).toHaveCount(0);
  await expect(page.getByText('No more events today')).toHaveCount(0);
  // Tomorrow's 00:30 tip-off is not today's.
  await expect(page.getByText('Lakers')).toHaveCount(0);

  await press(page, 'ArrowDown', `${EFL_CUP}-tile-0`);
  await press(page, 'ArrowRight', `${EFL_CUP}-tile-1`);
  await press(page, 'ArrowDown', 'sports-row-c-country-gb-sct-football-tile-0');

  // Forty-five minutes on, with no key pressed and no answer yet to what the feed
  // asks again: City and Celtic are live, from the clock alone.
  const asked = requests.all.length;
  held = new Promise((resolve) => (release = resolve));
  await page.clock.fastForward(45 * MINUTE);
  await expect(sportsRows(page).first()).toHaveText('EFL Cup · 2 live of 2');
  await expectFocusLabel(page, 'Celtic v Rangers, Scottish football, live now');
  held = undefined;
  release();
  // One refresh in those 45 minutes: each copy that went stale is asked for once,
  // and the clock's ticks ask nothing.
  const again = () =>
    requests.all
      .slice(asked)
      .filter((request) => request.includes('/catalog/'))
      .sort();
  const refreshed = ['football', 'live', 'today'].map(
    (id) => `sports /bannertv/catalog/sport/${id}.json`,
  );
  await expect.poll(again).toEqual(refreshed);
  await page.waitForTimeout(500);
  expect(again()).toEqual(refreshed);

  // With answers coming, nothing is asked for 2 minutes after the last answer, however
  // often the clock ticks. Then the live catalog is asked again, once; the others stay
  // fresh for 15 minutes.
  const answered = requests.all.length;
  const since = () =>
    requests.all.slice(answered).filter((request) => request.includes('/catalog/'));
  await page.clock.fastForward(90 * 1000);
  await page.waitForTimeout(500);
  expect(since()).toEqual([]);
  await page.clock.fastForward(40 * 1000);
  await expect.poll(since).toEqual(['sports /bannertv/catalog/sport/live.json']);
  await page.waitForTimeout(500);
  expect(since()).toEqual(['sports /bannertv/catalog/sport/live.json']);

  // Live now holds only what is live or about to start.
  await press(page, 'ArrowUp', `${EFL_CUP}-tile-1`);
  await press(page, 'ArrowUp', 'sports-day-1');
  await press(page, 'ArrowLeft', 'sports-day-0');
  await page.waitForTimeout(600);
  await expect(page.locator('[data-focus-key="sports-day-0"]')).toHaveClass(/selected/);
  await expect(page.getByText('Earlier today')).toHaveCount(0);
  await expect(page.getByText('Barnsley')).toHaveCount(0);

  // Back takes the strip to Today, then goes Home.
  await pressBack(page);
  await expectFocus(page, 'sports-day-1');
  await expect(page.locator('[data-focus-key="sports-day-1"]')).toHaveClass(/selected/);
  await expect(sportsRows(page).last()).toHaveText('Earlier today');
  await pressBack(page);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toBeVisible();
  expect(realErrors(errors)).toEqual([]);
});

test('a match plays from the addon that listed it, and leaves nothing in Continue watching', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // More Sports claims the same type and ids, and comes first: a request sent to every
  // addon that could answer would ask it first.
  const { requests, playback } = await startWithSports(page, {
    moreSports: true,
    moreSportsFirst: true,
  });
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${LIVE_ROW}-tile-0`);
  await press(page, 'Enter', 'event-watch');
  await expect(page.locator('section[aria-label="Arsenal v Brighton"]')).toBeVisible();

  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(() =>
      page
        .locator('video:not([aria-hidden])')
        .evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 0),
    )
    .toBe(true);
  expect(playback.media).toContain('/match-1080p.webm');
  // More Sports never listed this match: it is asked for neither its meta nor its streams.
  expect(requests.streams.every((request) => request.indexOf('sports ') === 0)).toBe(true);
  expect(requests.streams).toContain('sports sport/tsport:arsenal-brighton');
  expect(
    requests.all.filter((request) => /^more \/bannertv\/(meta|stream)\//.test(request)),
  ).toEqual([]);
  // A match is not a film to come back to.
  await page.waitForTimeout(1500);
  await pressBack(page);
  await expect(page.locator('section[aria-label="Arsenal v Brighton"]')).toBeVisible();
  await pressBack(page);
  await expectFocus(page, `${LIVE_ROW}-tile-0`);
  await expect(page.locator('[data-row-key="home-continue"]')).toHaveCount(0);
  expect(JSON.stringify((await readKv(page, 'progress')) ?? [])).not.toContain('tsport');
  expect(JSON.stringify((await readKv(page, 'played')) ?? [])).not.toContain('tsport');
  expect(realErrors(errors)).toEqual([]);
});

test('a replay keeps its place, but Home neither shows it to continue nor asks any addon about it', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { replay } = MATCHES;
  // More Sports claims the replay's type and id, and comes first: a request sent to every
  // addon that could answer would ask it first.
  const { requests, playback } = await startWithSports(page, {
    moreSports: true,
    moreSportsFirst: true,
    catalogs: {
      'sport/today': (route) => answer(route, [{ ...replay, type: 'sport' }]),
      'sport/football': (route) => answer(route, []),
    },
  });
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');
  await expect(sportsRows(page).last()).toHaveText('Replays');
  // Down past More Sports' Try again and the matches to the replay.
  let focused = '';
  for (let n = 0; n < 10 && !focused.startsWith('sports-row-replays-'); n++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    focused = await focusedKey(page);
  }
  expect(focused).toBe('sports-row-replays-tile-0');
  await press(page, 'Enter', 'event-watch');
  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(() =>
      page
        .locator('video:not([aria-hidden])')
        .evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 1),
    )
    .toBe(true);
  expect(playback.media).toContain('/match-1080p.webm');

  // Its place is kept to resume, marked to stay off the row.
  const kept = async () =>
    ((await readKv(page, 'progress')) as Array<Record<string, unknown>> | undefined) ?? [];
  await expect
    .poll(async () => (await kept()).filter((entry) => entry.videoId === replay.id))
    .toEqual([expect.objectContaining({ metaId: replay.id, type: 'sport', continueRow: false })]);
  const played = await page
    .locator('video:not([aria-hidden])')
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  await pressBack(page);
  await expectFocus(page, 'event-watch');
  await pressBack(page);
  await expectFocus(page, 'sports-row-replays-tile-0');
  await pressBack(page);
  await expectFocus(page, 'sports-day-1');
  // Where it was left, give or take the last clock reading.
  const position = (await kept()).find((entry) => entry.videoId === replay.id)?.position;
  expect(position).toBeGreaterThan(played - 1);

  // Home shows no card for it, and asks no addon for its page or streams.
  const asked = requests.all.length;
  await pressBack(page);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-row-key="home-continue"]')).toHaveCount(0);
  expect(requests.all.slice(asked).filter((request) => request.includes(replay.id))).toEqual([]);
  expect(JSON.stringify((await readKv(page, 'played')) ?? [])).not.toContain('tsport');
  // Its page and streams came only from the addon that listed it.
  expect(
    requests.all.filter((request) => /^more \/bannertv\/(meta|stream)\//.test(request)),
  ).toEqual([]);
  expect(requests.streams).toEqual([`sports sport/${replay.id}`]);
  expect(realErrors(errors)).toEqual([]);
});

test('a crowded day, odd items and addons that fail or hang never break Sports', async ({
  page,
}) => {
  const errors = watchErrors(page);
  let footballAsked = 0;
  const { requests } = await startWithSports(page, {
    moreSports: true,
    catalogs: {
      'sport/live': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ metas: [...oddItems(), { ...MATCHES.arsenal, type: 'sport' }] }),
        }),
      'sport/today': (route, extra) =>
        extra
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"metas":[]}' })
          : route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({ metas: crowdedDay(3000) }),
            }),
      // This one never answers.
      'sport/football': () => {
        footballAsked++;
        return new Promise<void>(() => {});
      },
    },
  });
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');

  // More Sports answered 502: it is named, with Try again, and the rest still shows.
  await expect(page.getByText("More Sports didn't answer.")).toBeVisible();
  await expect(sportsRows(page).first()).toBeVisible();
  // Rows far from focus are drawn empty, with their headings, once the crowded page is in.
  await expect
    .poll(
      async () =>
        (await page.locator('section h2').allTextContents()).filter((heading) =>
          heading.startsWith('Made-up League '),
        ).length,
    )
    .toBe(40);

  // Down through the rows and along one, quickly.
  for (let n = 0; n < 8; n++) await page.keyboard.press('ArrowDown');
  for (let n = 0; n < 12; n++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^sports-row-.+-tile-\d+$/,
  );

  // Try again asks More Sports again; it is still down.
  const moreAsked = requests.all.filter((r) => r.includes('more_sports_live')).length;
  // Back from a row goes up to the strip.
  await pressBack(page);
  await expectFocus(page, 'sports-day-1');
  await press(page, 'ArrowDown', 'sports-retry');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => requests.all.filter((r) => r.includes('more_sports_live')).length)
    .toBeGreaterThan(moreAsked);
  await expect(page.getByText("More Sports didn't answer.")).toBeVisible();

  // The catalog that hangs gives up in time, and is named too.
  expect(footballAsked).toBeGreaterThan(0);
  await page.clock.fastForward(11 * 1000);
  await expect(page.getByText(/Test Sports.* didn't answer\./)).toBeVisible();
  await expect(sportsRows(page).first()).toBeVisible();
  expect(realErrors(errors)).toEqual([]);
});

test('Search finds a team by its everyday name, and can ask the sports addons', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { requests } = await startWithSports(page);
  // Today is in BannerTV's own copy once Sports has been opened.
  await openSection(page, 'sports');
  await expect(sportsRows(page).first()).toHaveText('EFL Cup · 1 live of 2');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await openSection(page, 'search');
  await expectFocus(page, 'search-field');
  await page.keyboard.press('Enter');
  await page.keyboard.type('man city');
  const sports = page.locator('[data-row-key="search-res-sports"]');
  await expect(sports.locator('h2')).toHaveText('Sports');
  expect(await tileLabels(page, 'search-res-sports')).toEqual([
    'Manchester City v Burnley, EFL Cup, 20:00',
  ]);
  // The addon's own search is asked only from the button.
  expect(requests.all.filter((r) => r.includes('/catalog/sport/search'))).toEqual([]);

  await page.keyboard.press('Escape');
  await press(page, 'ArrowDown', 'search-res-sports-tile-0');
  await press(page, 'ArrowDown', 'search-sports-addons');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => requests.all.filter((r) => r.includes('/catalog/sport/search')))
    .toEqual(['sports /bannertv/catalog/sport/search/search=man city.json']);
  const asked = page.locator('[data-row-key^="search-res-sports-"]');
  await expect(asked.locator('h2')).toHaveText(/^SportsTest Sports$/);
  // Focus goes on to the addon's row in place of the button, not back to the box.
  const addonRow = (await asked.getAttribute('data-row-key')) ?? '';
  await expectFocus(page, `${addonRow}-tile-0`);
  await page.waitForTimeout(500);
  await expectFocusLabel(page, 'Manchester City v Burnley, EFL Cup, 20:00');
  expect(realErrors(errors)).toEqual([]);
});

test('Show in Sports: No puts the catalogs back on Home, and removing the addon forgets it', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await startWithSports(page);
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  await pressTo(page, 'ArrowDown', 'Move Test Sports down');
  await pressTo(page, 'ArrowRight', 'Show Test Sports in Sports: Automatic');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Show Test Sports in Sports')).toBeVisible();
  await pressTo(page, 'ArrowDown', 'Yes');
  await pressTo(page, 'ArrowDown', 'No');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Show Test Sports in Sports: No');
  // The setting is kept by the addon's id, never its address.
  await expect.poll(() => readKv(page, 'sports.settings')).toEqual({ [SPORTS_MANIFEST.id]: 'no' });
  expect(await railSections(page)).not.toContain('sports');

  // Its catalogs are ordinary Home rows again.
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator(`[data-row-key="${LIVE_ROW}"]`)).toHaveCount(0);
  // Below Cinemeta's rows: Test Sports is the second addon.
  let focused = '';
  for (let n = 0; n < 40 && !focused.startsWith('home-1-sport-'); n++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    focused = (await page.locator('[data-focused="true"]').getAttribute('data-focus-key')) ?? '';
  }
  expect(focused).toMatch(/^home-1-sport-live-tile-\d+$/);
  await expect(page.locator('[data-row-key="home-1-sport-live"] h2')).toHaveText(/^🔴 Live/);
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  // The Live sport row noted the matches' kick-offs at launch, by the addon's id.
  await expect.poll(() => keptKickOffs(page, SPORTS_MANIFEST.id)).not.toEqual([]);

  // Removed while set to No: its setting goes, and so do the kick-offs kept for it.
  await openSection(page, 'addons');
  await pressTo(page, 'ArrowDown', 'Move Test Sports down');
  await pressTo(page, 'ArrowRight', 'Show Test Sports in Sports: No');
  await removeAddon(page, 'Test Sports');
  await expect.poll(() => readKv(page, 'sports.settings')).toEqual({});
  await expect.poll(() => keptKickOffs(page, SPORTS_MANIFEST.id)).toEqual([]);
  expect(realErrors(errors)).toEqual([]);
});

/** Ids of the items the kick-off memory keeps for one addon. */
async function keptKickOffs(page: Page, addonId: string): Promise<string[]> {
  const rows = await readKv(page, 'sports.kickoffs');
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: unknown) => (Array.isArray(row) && typeof row[0] === 'string' ? row[0] : ''))
    .filter((key: string) => key.indexOf(`${addonId}\n`) === 0);
}

/** From the addon's last button in Addons, removes it and waits for the note. */
async function removeAddon(page: Page, name: string) {
  await pressTo(page, 'ArrowRight', `Remove ${name}`);
  await press(page, 'Enter', 'remove-addon-cancel');
  await press(page, 'ArrowLeft', 'remove-addon-confirm');
  await page.keyboard.press('Enter');
  await expect(page.getByText(`Removed ${name}.`)).toBeVisible();
}

test('removing the last sports addon takes Sports out of the rail', async ({ page }) => {
  const errors = watchErrors(page);
  await startWithSports(page);
  await openSection(page, 'addons');
  await expectFocusLabel(page, 'Move Cinemeta up');
  await pressTo(page, 'ArrowDown', 'Move Test Sports down');
  await pressTo(page, 'ArrowRight', 'Show Test Sports in Sports: Automatic');
  expect(await railSections(page)).toContain('sports');
  await removeAddon(page, 'Test Sports');
  await expect.poll(() => railSections(page)).not.toContain('sports');
  await expect.poll(() => keptKickOffs(page, SPORTS_MANIFEST.id)).toEqual([]);
  expect(realErrors(errors)).toEqual([]);
});

test('Sports gives way to Home when its last sports addon goes while it is open', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // The addon's daily refresh brings a version with no sports catalogs left.
  let update: (manifest: unknown) => void = () => undefined;
  const updated = new Promise<unknown>((resolve) => (update = resolve));
  await startWithSports(page, { update: updated });
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');
  await expect(sportsRows(page).first()).toHaveText('EFL Cup · 1 live of 2');

  update({ ...SPORTS_MANIFEST, version: '1.1.0', catalogs: [] });
  // The refresh runs a few seconds after start-up.
  await page.clock.fastForward(10 * 1000);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toBeVisible();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => railSections(page)).not.toContain('sports');
  expect(realErrors(errors)).toEqual([]);
});

test('a long day is paged by its matches, not by every item', async ({ page }) => {
  const errors = watchErrors(page);
  const { requests } = await startWithSports(page);
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');
  // Saturday is past the first page's last kick-off.
  await press(page, 'ArrowRight', 'sports-day-2');
  await press(page, 'ArrowRight', 'sports-day-3');
  await press(page, 'ArrowRight', 'sports-day-4');
  await expect(page.locator('[data-focus-key="sports-day-4"]')).toHaveText('Sat 31');
  await expect(page.locator('[data-focus-key="sports-day-4"]')).toHaveClass(/selected/);
  await expect
    .poll(() => requests.all.filter((r) => r.includes('/catalog/sport/today')))
    .toEqual([
      'sports /bannertv/catalog/sport/today.json',
      // The first page held 48 matches among 50 items: two are asked again, none skipped.
      'sports /bannertv/catalog/sport/today/skip=46.json',
    ]);
  // Saturday's football runs from Club 36 FC at midnight to Club 59 FC at 23:00.
  const row = page.locator('[data-row-key^="sports-row-"]').first();
  await expect(row.locator('[data-focus-key$="-tile-0"]')).toHaveAttribute(
    'aria-label',
    /^Club 36 FC v Athletic 36 FC, .*00:00$/,
  );
  const rowKey = await row.getAttribute('data-row-key');
  await press(page, 'ArrowDown', `${rowKey}-tile-0`);
  for (let n = 1; n < 24; n++) await press(page, 'ArrowRight', `${rowKey}-tile-${n}`);
  await expectFocusLabel(page, 'Club 59 FC v Athletic 59 FC, Other football, 23:00');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await expectFocus(page, `${rowKey}-tile-23`);
  expect(realErrors(errors)).toEqual([]);
});

test.describe('in New York', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('kick-offs and days follow the TV’s own time zone', async ({ page }) => {
    const errors = watchErrors(page);
    await startWithSports(page);
    await openSection(page, 'sports');
    await expectFocus(page, 'sports-day-1');
    // 15:30 in New York: the Lakers' 00:30 London tip-off is tonight at 20:30. The
    // rows first draw from what the Live sport row had; today's page follows.
    await expect(sportsRows(page)).toContainText(['EFL Cup · 1 live of 2']);
    await expect
      .poll(() => sportsTileLabels(page))
      .toContain('Manchester City v Burnley, EFL Cup, 16:00');
    await expect
      .poll(async () =>
        (await sportsTileLabels(page)).some((label) =>
          /^Los Angeles Lakers v New York Knicks, .*20:30$/.test(label),
        ),
      )
      .toBe(true);
    expect(realErrors(errors)).toEqual([]);
  });
});

test('a sports addon first in the list never has its catalogs on Home, even for a moment', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.clock.install({ time: SPORTS_NOW });
  await watchRows(page);
  await mockAddons(page);
  await seedSports(page, { sportsFirst: true });
  const requests = await mockSports(page);
  await page.goto(APP_URL);
  // Cinemeta is the second addon now.
  await expectFocus(page, 'home-1-movie-top-tile-0');
  await expect(page.locator('main [data-row-key]').nth(2)).toHaveAttribute(
    'data-row-key',
    LIVE_ROW,
  );
  await page.waitForTimeout(500);
  expect((await drawnRows(page)).filter((key) => key.indexOf('home-0-') === 0)).toEqual([]);
  // Only the Live sport row's request: none for the catalogs as Home rows.
  expect(requests.all.filter((request) => request.includes('/catalog/'))).toEqual([
    'sports /bannertv/catalog/sport/live.json',
  ]);
  expect(realErrors(errors)).toEqual([]);
});

test('the Live sport row coming and going leaves Home on the row in view', async ({ page }) => {
  const errors = watchErrors(page);
  // Live now: Arsenal until 21:30 and Celtic until 22:10. Starting at 23:00, City.
  const { arsenal, celtic, city } = MATCHES;
  const late = { ...city, released: '2026-10-28T23:00:00.000Z' };
  await startWithSports(page, {
    catalogs: {
      'sport/live': (route) =>
        answer(
          route,
          [arsenal, celtic, late].map((match) => ({ ...match, type: 'sport' })),
        ),
    },
  });
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${LIVE_ROW}-tile-0`);
  // Two rows under it, so its going and coming moves the row in view.
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  const tile = await focusedKey(page);
  expect(tile).toMatch(/^home-0-.+-tile-0$/);
  await expect.poll(() => slidTo(page, rowOf(tile))).toBe(true);

  // 22:30: nothing is live, and the row goes.
  await page.clock.fastForward(3 * 60 * MINUTE);
  await expect(page.locator(`[data-row-key="${LIVE_ROW}"]`)).toHaveCount(0);
  await expect.poll(() => slidTo(page, rowOf(tile))).toBe(true);
  await expectFocus(page, tile);

  // 22:46: City is starting soon, and the row is back.
  await page.clock.fastForward(16 * MINUTE);
  await expect(page.locator(`[data-row-key="${LIVE_ROW}"]`)).toHaveCount(1);
  await expect.poll(() => slidTo(page, rowOf(tile))).toBe(true);
  await expectFocus(page, tile);
  expect(realErrors(errors)).toEqual([]);
});

test('a Home row that turns out to be sport under focus hands focus to the row above', async ({
  page,
}) => {
  const errors = watchErrors(page);
  let release = () => undefined as void;
  const firstPage = new Promise<void>((resolve) => (release = resolve));
  await startWithSports(page, { liveEvents: firstPage });
  // Live Events is last on Home: down to it while its first page is on its way.
  let focused = '';
  for (let n = 0; n < 40 && !/^home-\d+-tv-events-tile-/.test(focused); n++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    focused = await focusedKey(page);
  }
  expect(focused).toMatch(/^home-\d+-tv-events-tile-0$/);
  const row = rowOf(focused);
  const above = await page
    .locator(`[data-row-key="${row}"]`)
    .evaluate((element) => element.previousElementSibling?.getAttribute('data-row-key') ?? '');
  expect(above).toMatch(/^home-0-/);

  // Its first page is all matches: it goes to Sports, and focus and the view to the row above.
  release();
  await expect(page.locator(`[data-row-key="${row}"]`)).toHaveCount(0);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    new RegExp(`^${above}-tile-\\d+$`),
  );
  await page.waitForTimeout(500);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    new RegExp(`^${above}-tile-\\d+$`),
  );
  await expect.poll(() => slidTo(page, above)).toBe(true);
  expect(realErrors(errors)).toEqual([]);
});

test('moving on into the rows before a day opens keeps the day they belong to', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await startWithSports(page);
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');
  const today = ['EFL Cup · 1 live of 2', 'Scottish football', 'Earlier today'];
  await expect(sportsRows(page)).toHaveText(today);

  // Over Tomorrow and down into Today's rows, quicker than a rest on Tomorrow.
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'sports-day-2');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^sports-row-.+-tile-0$/,
  );
  const tile = await focusedKey(page);
  await page.waitForTimeout(800);
  await expect(page.locator('[data-focus-key="sports-day-1"]')).toHaveClass(/selected/);
  await expect(sportsRows(page)).toHaveText(today);
  await expectFocus(page, tile);
  expect(realErrors(errors)).toEqual([]);
});

test('a competition on two days starts at its first match on each', async ({ page }) => {
  const errors = watchErrors(page);
  // Six more EFL Cup ties live at 19:30, so the row is longer than the screen on both days.
  const ties = [0, 1, 2, 3, 4, 5].map((n) => ({
    id: `tsport:cup-${n}`,
    type: 'sport',
    name: `Borough ${n} vs Rovers ${n}`,
    genres: ['Football', 'EFL Cup'],
    released: `2026-10-28T19:0${n}:00.000Z`,
  }));
  const { arsenal, celtic } = MATCHES;
  await startWithSports(page, {
    catalogs: {
      'sport/live': (route) =>
        answer(route, [
          ...[arsenal, celtic].map((match) => ({ ...match, type: 'sport' })),
          ...ties,
        ]),
    },
  });
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');
  await expect(sportsRows(page).first()).toHaveText('EFL Cup · 7 live of 8');
  await press(page, 'ArrowDown', `${EFL_CUP}-tile-0`);
  for (let n = 1; n <= 5; n++) await press(page, 'ArrowRight', `${EFL_CUP}-tile-${n}`);

  // Live now has the same competition: its row starts at its first match.
  await press(page, 'ArrowUp', 'sports-day-1');
  await press(page, 'ArrowLeft', 'sports-day-0');
  await page.waitForTimeout(600);
  await expect(page.locator('[data-focus-key="sports-day-0"]')).toHaveClass(/selected/);
  await expect(sportsRows(page).first()).toHaveText('EFL Cup · 7 live of 7');
  await press(page, 'ArrowDown', `${EFL_CUP}-tile-0`);
  await expect(
    page.locator(`[data-row-key="${EFL_CUP}"] [data-focus-key="${EFL_CUP}-tile-0"]`),
  ).toBeInViewport();
  expect(realErrors(errors)).toEqual([]);
});

test('a Live now row whose last match ends hands focus to the row in its place', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await startWithSports(page);
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');
  await expect(sportsRows(page).first()).toHaveText('EFL Cup · 1 live of 2');
  await press(page, 'ArrowLeft', 'sports-day-0');
  await page.waitForTimeout(600);
  await expect(sportsRows(page)).toHaveText(['EFL Cup · 1 live of 1', 'Scottish football']);
  const scottish = 'sports-row-c-country-gb-sct-football';
  await press(page, 'ArrowDown', `${EFL_CUP}-tile-0`);
  await press(page, 'ArrowDown', `${scottish}-tile-0`);

  // 22:15: Celtic's match is over; City's is still on, in the EFL Cup row above.
  await page.clock.fastForward((2 * 60 + 45) * MINUTE);
  await expect(sportsRows(page)).toHaveText(['EFL Cup · 1 live of 1']);
  await expectFocus(page, `${EFL_CUP}-tile-0`);
  await page.waitForTimeout(500);
  await expectFocus(page, `${EFL_CUP}-tile-0`);
  await expectFocusLabel(page, 'Manchester City v Burnley, EFL Cup, live now');
  await expect.poll(() => slidTo(page, EFL_CUP)).toBe(true);
  expect(realErrors(errors)).toEqual([]);
});

test('Search answers from what the Live sport row fetched, and asks nothing itself', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { requests } = await startWithSports(page);
  await openSection(page, 'search');
  await expectFocus(page, 'search-field');
  const asked = requests.all.length;
  await page.keyboard.press('Enter');
  await page.keyboard.type('arsenal');
  await expect(page.locator('[data-row-key="search-res-sports"] h2')).toHaveText('Sports');
  expect(await tileLabels(page, 'search-res-sports')).toEqual([
    'Arsenal v Brighton, EFL Cup, live now',
  ]);
  // Minutes on Search ask the sports addons nothing: only Sports and the Live sport row do.
  await page.clock.fastForward(5 * MINUTE);
  await page.waitForTimeout(500);
  expect(requests.all.slice(asked).filter((request) => request.includes('/catalog/'))).toEqual([]);
  expect(realErrors(errors)).toEqual([]);
});

test('sports rows coming and going above Search results leave the view on the focused row', async ({
  page,
}) => {
  const errors = watchErrors(page);
  let release = () => undefined as void;
  const searched = new Promise<void>((resolve) => (release = resolve));
  // The addon's search finds only a channel, which is not a match: its row goes.
  const channel = {
    id: 'tsport:ch-1',
    type: 'sport',
    name: 'Sky Sports Main Event',
    releaseInfo: '24/7',
  };
  await startWithSports(page, {
    catalogs: { 'sport/search': (route) => searched.then(() => answer(route, [channel])) },
  });
  await openSection(page, 'search');
  await expectFocus(page, 'search-field');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sintel');
  await expect(page.getByText("Nothing in your sports addons' lists matches.")).toBeVisible();
  await page.keyboard.press('Escape');
  await press(page, 'ArrowDown', 'search-sports-addons');
  await page.keyboard.press('Enter');
  const addonRow = page.locator('[data-row-key^="search-res-sports-"]');
  await expect(addonRow).toHaveCount(1);
  const addonKey = (await addonRow.getAttribute('data-row-key')) ?? '';
  await expectFocus(page, `${addonKey}-tile-0`);

  // Down to the films: the view slides them to the top.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^search-res-0-movie-.+-tile-0$/,
  );
  const films = rowOf(await focusedKey(page));
  await expect.poll(() => slidTo(page, films)).toBe(true);

  // The addon answers: its row goes from above, and the films stay in view.
  release();
  await expect(addonRow).toHaveCount(0);
  await expect.poll(() => slidTo(page, films)).toBe(true);
  await expectFocus(page, `${films}-tile-0`);
  expect(realErrors(errors)).toEqual([]);
});

test('a kick-off on another day keeps its time on a tile', async ({ page }) => {
  const errors = watchErrors(page);
  await startWithSports(page);
  await openSection(page, 'search');
  await expectFocus(page, 'search-field');
  await page.keyboard.press('Enter');
  await page.keyboard.type('wolves');
  await expect(page.getByText("Nothing in your sports addons' lists matches.")).toBeVisible();
  // The films found nothing either: Search says so, above the button.
  await expect(page.getByText('Nothing found for “wolves”.')).toBeVisible();
  await page.keyboard.press('Escape');
  await press(page, 'ArrowDown', 'search-sports-addons');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'aria-label',
    /^Wolves v Aston Villa, .*, Tomorrow, about 20:00$/,
  );
  // The whole of it shows, time and all.
  const shown = await page.locator('[data-focused="true"]').evaluate((tile) =>
    Array.from(tile.querySelectorAll('span'))
      .filter((span) => span.children.length === 0 && span.textContent === 'Tomorrow, about 20:00')
      .map((span) => span.scrollWidth <= span.clientWidth),
  );
  expect(shown).toEqual([true]);
  expect(realErrors(errors)).toEqual([]);
});

test('odd items stay text, inside their tiles', async ({ page }) => {
  const errors = watchErrors(page);
  // Only the odd items and Arsenal: few enough rows that every one is drawn.
  await startWithSports(page, {
    catalogs: {
      'sport/live': (route) =>
        answer(route, [...oddItems(), { ...MATCHES.arsenal, type: 'sport' }]),
      'sport/today': (route) => answer(route, []),
      'sport/football': (route) => answer(route, []),
    },
  });
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');

  // The script in a name stays text.
  const script = page.locator('[data-focus-key^="sports-row-"][data-focus-key*="-tile-"]', {
    hasText: '<img src=x onerror="window.__xss=1">',
  });
  await expect(script).toHaveCount(1);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();

  // A 5,000-letter name stays inside its tile, and nothing of it shows beyond.
  const long = page.locator('[data-focus-key^="sports-row-"][aria-label^="QQQQ"]');
  await expect(long).toHaveCount(1);
  const tile = await long.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const name = element.querySelector('span + span') ?? element;
    const line = name.getBoundingClientRect();
    // Just past the tile's right edge, level with the name: the gap before the next tile.
    const beyond = document.elementFromPoint(box.right + 8, line.top + line.height / 2);
    return {
      width: box.width,
      height: box.height,
      hit: beyond !== null,
      beyond: beyond !== null && element.contains(beyond),
    };
  });
  expect(tile.width).toBeLessThanOrEqual(384 * 1.1);
  expect(tile.height).toBeLessThanOrEqual(176 * 1.1);
  expect(tile.hit).toBe(true);
  expect(tile.beyond).toBe(false);
  expect(realErrors(errors)).toEqual([]);
});

/** A match page's Follow buttons, in their order. */
function followButtons(page: Page) {
  return page.locator('[data-focus-key^="event-follow-"]');
}

/** The first line of each tile's label in a row: the two sides. */
async function rowMatches(page: Page, rowKey: string): Promise<string[]> {
  return (await tileLabels(page, rowKey)).map((label) => label.split(',')[0]!);
}

test('following a team or a competition puts its matches first, on Sports and on Home', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await startWithSports(page);
  // Before anything is followed, the Live sport row goes by competition.
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${LIVE_ROW}-tile-0`);
  expect(await rowMatches(page, LIVE_ROW)).toEqual(['Arsenal v Brighton', 'Celtic v Rangers']);

  // Celtic v Rangers' page offers both sides, but not Scottish football: that row is
  // BannerTV's guess from the teams, not a competition.
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');
  await press(page, 'ArrowDown', `${EFL_CUP}-tile-0`);
  await press(page, 'ArrowDown', 'sports-row-c-country-gb-sct-football-tile-0');
  await press(page, 'Enter', 'event-watch');
  await expect(followButtons(page)).toHaveText(['Follow Celtic', 'Follow Rangers']);
  await press(page, 'ArrowDown', 'event-follow-0');
  await press(page, 'Enter', 'event-follow-0');
  await expect(followButtons(page)).toHaveText(['Following Celtic', 'Follow Rangers']);

  // Back finds the match in the Following row, first; the row it came from has gone.
  await pressBack(page);
  await expectFocus(page, 'sports-row-following-tile-0');
  await expect(sportsRows(page)).toHaveText([
    'Following',
    'EFL Cup · 1 live of 2',
    'Earlier today',
  ]);
  expect(await tileLabels(page, 'sports-row-following')).toEqual([
    expect.stringMatching(/^Celtic v Rangers, Scottish football, /),
  ]);
  // Kept for this profile, by the team's key rather than the name on the page.
  const saved = (await readKv(page, 'sports.follows')) as Array<{ kind: string; id: string }>;
  expect(saved.map((follow) => `${follow.kind} ${follow.id}`)).toEqual(['team football:celtic']);

  // Home's Live sport row now starts with it.
  await pressBack(page);
  await expectFocus(page, 'sports-day-1');
  await pressBack(page);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toBeVisible();
  await expect
    .poll(() => rowMatches(page, LIVE_ROW))
    .toEqual(['Celtic v Rangers', 'Arsenal v Brighton']);

  // A competition: every EFL Cup match joins Following, by kick-off.
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');
  await press(page, 'ArrowDown', 'sports-row-following-tile-0');
  await press(page, 'ArrowDown', `${EFL_CUP}-tile-0`);
  await press(page, 'ArrowRight', `${EFL_CUP}-tile-1`);
  await press(page, 'Enter', 'event-watch');
  await expect(followButtons(page)).toHaveText([
    'Follow Manchester City',
    'Follow Burnley',
    'Follow EFL Cup',
  ]);
  await press(page, 'ArrowDown', 'event-follow-0');
  await press(page, 'ArrowRight', 'event-follow-1');
  await press(page, 'ArrowRight', 'event-follow-2');
  await press(page, 'Enter', 'event-follow-2');
  await expect(followButtons(page).last()).toHaveText('Following EFL Cup');
  await pressBack(page);
  await expectFocus(page, 'sports-row-following-tile-2');
  await expect(sportsRows(page)).toHaveText(['Following · 1 live of 3', 'Earlier today']);
  expect(await rowMatches(page, 'sports-row-following')).toEqual([
    'Arsenal v Brighton',
    'Celtic v Rangers',
    'Manchester City v Burnley',
  ]);
  // Live now starts with Following too.
  await press(page, 'ArrowUp', 'sports-day-1');
  await press(page, 'ArrowLeft', 'sports-day-0');
  await expect(sportsRows(page).first()).toHaveText('Following · 1 live of 2');

  // Unfollowing gives the competition its row back, and Back finds the match in it.
  await press(page, 'ArrowRight', 'sports-day-1');
  await expect(sportsRows(page).first()).toHaveText('Following · 1 live of 3');
  await press(page, 'ArrowDown', 'sports-row-following-tile-0');
  await press(page, 'ArrowRight', 'sports-row-following-tile-1');
  await press(page, 'ArrowRight', 'sports-row-following-tile-2');
  await press(page, 'Enter', 'event-watch');
  await press(page, 'ArrowDown', 'event-follow-0');
  await press(page, 'ArrowRight', 'event-follow-1');
  await press(page, 'ArrowRight', 'event-follow-2');
  await press(page, 'Enter', 'event-follow-2');
  await expect(followButtons(page).last()).toHaveText('Follow EFL Cup');
  await pressBack(page);
  await expectFocus(page, `${EFL_CUP}-tile-1`);
  await expect(sportsRows(page)).toHaveText([
    'Following',
    'EFL Cup · 1 live of 2',
    'Earlier today',
  ]);
  expect(realErrors(errors)).toEqual([]);
});

/** The reminder banner, by what it says. */
function reminderBanner(page: Page, name: string) {
  return page.getByRole('dialog', { name: `${name} is starting` });
}

test('Remind me shows a banner just before kick-off, after the player if it was open', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { playback } = await startWithSports(page);
  await openSection(page, 'sports');
  await expectFocus(page, 'sports-day-1');

  // Arsenal v Brighton is live: nothing to remind of.
  await press(page, 'ArrowDown', `${EFL_CUP}-tile-0`);
  await press(page, 'Enter', 'event-watch');
  await expect(page.locator('[data-focus-key="event-remind"]')).toHaveCount(0);
  await pressBack(page);
  await expectFocus(page, `${EFL_CUP}-tile-0`);

  // Manchester City v Burnley kicks off at 20:00: a reminder at 19:55.
  await press(page, 'ArrowRight', `${EFL_CUP}-tile-1`);
  await press(page, 'Enter', 'event-watch');
  await press(page, 'ArrowRight', 'event-streams');
  await press(page, 'ArrowRight', 'event-remind');
  await expect(page.locator('[data-focus-key="event-remind"]')).toHaveText('Remind me');
  await press(page, 'Enter', 'event-remind');
  await expect(page.locator('[data-focus-key="event-remind"]')).toHaveText('Reminder on');
  await expect(page.getByText("BannerTV reminds you at 19:55 if it's open then.")).toBeVisible();
  await pressBack(page);

  // Celtic v Rangers at 19:40: a reminder at 19:35. Kept for this profile, by the
  // match's key and its two sides, never the addon's address.
  await press(page, 'ArrowDown', 'sports-row-c-country-gb-sct-football-tile-0');
  await press(page, 'Enter', 'event-watch');
  await press(page, 'ArrowRight', 'event-streams');
  await press(page, 'ArrowRight', 'event-remind');
  await press(page, 'Enter', 'event-remind');
  await expect(page.getByText("BannerTV reminds you at 19:35 if it's open then.")).toBeVisible();
  const saved = (await readKv(page, 'sports.reminders')) as Array<{ name: string }>;
  expect(saved.map((reminder) => reminder.name)).toEqual([
    'Celtic v Rangers',
    'Manchester City v Burnley',
  ]);
  expect(JSON.stringify(saved)).not.toContain('example.com');
  await pressBack(page);

  // Arsenal v Brighton plays through 19:35: the player is never covered.
  await press(page, 'ArrowUp', `${EFL_CUP}-tile-1`);
  await press(page, 'ArrowLeft', `${EFL_CUP}-tile-0`);
  await press(page, 'Enter', 'event-watch');
  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(() =>
      page
        .locator('video:not([aria-hidden])')
        .evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 0),
    )
    .toBe(true);
  expect(playback.media).toContain('/match-1080p.webm');
  await page.clock.fastForward(6 * MINUTE);
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Leaving it, the banner comes, with focus on Watch; Back gives focus back.
  await pressBack(page);
  await expect(reminderBanner(page, 'Celtic v Rangers')).toBeVisible();
  await expect(reminderBanner(page, 'Celtic v Rangers')).toContainText('Starts at 19:40');
  await expectFocus(page, 'reminder-banner-watch');
  await pressBack(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectFocus(page, 'event-watch');
  await expect(page.locator('section[aria-label="Arsenal v Brighton"]')).toBeVisible();

  // At 19:55, Watch opens Manchester City v Burnley, and Back returns to where focus was.
  await page.clock.fastForward(20 * MINUTE);
  await expect(reminderBanner(page, 'Manchester City v Burnley')).toBeVisible();
  await expectFocus(page, 'reminder-banner-watch');
  await page.keyboard.press('Enter');
  await expect(page.locator('section[aria-label="Manchester City v Burnley"]')).toBeVisible();
  await expectFocus(page, 'event-watch');
  await expect(page.locator('[data-focus-key="event-remind"]')).toHaveCount(0);
  await pressBack(page);
  await expect(page.locator('section[aria-label="Arsenal v Brighton"]')).toBeVisible();
  await expectFocus(page, 'event-watch');
  // Each shows once.
  await expect.poll(() => readKv(page, 'sports.reminders')).toEqual([]);
  expect(realErrors(errors)).toEqual([]);
});

/** The team list's script, once the page has added it. */
async function dataScripts(page: Page): Promise<string[]> {
  return (await addedScripts(page)).filter((src) => src.includes('/data/'));
}

test.describe('with the team list held back until the launch settles (matcherAt idle)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('bannertv.tuning', JSON.stringify({ matcherAt: 'idle' })),
    );
  });

  test('it loads once Home has been still a moment', async ({ page }) => {
    const errors = watchErrors(page);
    await startWithSports(page);
    expect(await dataScripts(page)).toEqual([]);
    await expect
      .poll(() => dataScripts(page))
      .toEqual([expect.stringMatching(/\/data\/sports-data\.js$/)]);
    expect(realErrors(errors)).toEqual([]);
  });

  test('focus going into the Live sport row loads it at once, and its matches read the same', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await startWithSports(page);
    expect(await dataScripts(page)).toEqual([]);
    await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
    await press(page, 'ArrowDown', `${LIVE_ROW}-tile-0`);
    // Sooner than the launch could settle after these presses.
    await expect
      .poll(() => dataScripts(page), { timeout: 1500 })
      .toEqual([expect.stringMatching(/\/data\/sports-data\.js$/)]);
    await expect
      .poll(() => tileLabels(page, LIVE_ROW))
      .toEqual([
        'Arsenal v Brighton, EFL Cup, live now',
        'Celtic v Rangers, Scottish football, Starting 19:40',
      ]);
    expect(realErrors(errors)).toEqual([]);
  });

  test('opening Sports loads it at once', async ({ page }) => {
    await startWithSports(page);
    await openSection(page, 'sports');
    await expect
      .poll(() => dataScripts(page), { timeout: 1500 })
      .toEqual([expect.stringMatching(/\/data\/sports-data\.js$/)]);
  });
});
