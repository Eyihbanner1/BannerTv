import { expect, type Page, test } from '@playwright/test';
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
  openSection,
  press,
  pressBack,
  pressTo,
  railSections,
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
  const { requests } = await startWithSports(page);
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

  // Forty-five minutes on, with no key pressed and no new answer: City and Celtic are live.
  const asked = requests.all.length;
  await page.clock.fastForward(45 * MINUTE);
  await expect(sportsRows(page).first()).toHaveText('EFL Cup · 2 live of 2');
  await expectFocusLabel(page, 'Celtic v Rangers, Scottish football, live now');
  // The feed refreshes every two minutes, but answers changed nothing.
  expect(requests.all.length).toBeGreaterThanOrEqual(asked);

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
  const { requests, playback } = await startWithSports(page, { moreSports: true });
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
  // More Sports claims the same ids, but it never listed this match.
  expect(requests.streams.every((request) => request.indexOf('sports ') === 0)).toBe(true);
  expect(requests.streams).toContain('sports sport/tsport:arsenal-brighton');
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

test('odd items, a crowded day and an addon that has gone away never break Sports', async ({
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
  // Rows far from focus are drawn empty, with their headings.
  const headings = await page.locator('section h2').allTextContents();
  expect(headings.filter((heading) => heading.startsWith('Made-up League '))).toHaveLength(40);

  // Down through the rows and along one, quickly.
  for (let n = 0; n < 8; n++) await page.keyboard.press('ArrowDown');
  for (let n = 0; n < 12; n++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    /^sports-row-.+-tile-\d+$/,
  );

  // The script in a name stays text.
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  // A 5,000-letter name stays inside its tile: 384 wide, a little more when focused.
  for (const width of await page
    .locator('[data-focus-key^="sports-row-"][data-focus-key*="-tile-"]')
    .evaluateAll((tiles) => tiles.map((tile) => tile.getBoundingClientRect().width))) {
    expect(width).toBeLessThanOrEqual(384 * 1.1);
  }

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
  expect(realErrors(errors)).toEqual([]);
});

test('Show in Sports: No puts the catalogs back on Home, and removing the addon hides Sports', async ({
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

  // Back to Automatic, then removed: Sports goes, and so does what was kept for it.
  await openSection(page, 'addons');
  await pressTo(page, 'ArrowDown', 'Move Test Sports down');
  await pressTo(page, 'ArrowRight', 'Show Test Sports in Sports: No');
  await page.keyboard.press('Enter');
  await pressTo(page, 'ArrowUp', 'Yes');
  await pressTo(page, 'ArrowUp', 'Automatic');
  await page.keyboard.press('Enter');
  await expectFocusLabel(page, 'Show Test Sports in Sports: Automatic');
  await expect.poll(() => railSections(page)).toContain('sports');
  await pressTo(page, 'ArrowRight', 'Remove Test Sports');
  await press(page, 'Enter', 'remove-addon-cancel');
  await press(page, 'ArrowLeft', 'remove-addon-confirm');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Removed Test Sports.')).toBeVisible();
  await expect.poll(() => railSections(page)).not.toContain('sports');
  await expect.poll(() => readKv(page, 'sports.settings')).toEqual({});
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
    // 15:30 in New York: the Lakers' 00:30 London tip-off is tonight at 20:30.
    const headings = await sportsRows(page).allTextContents();
    expect(headings).toContain('EFL Cup · 1 live of 2');
    const labels = await page
      .locator('[data-focus-key^="sports-row-"][data-focus-key*="-tile-"]')
      .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('aria-label') ?? ''));
    expect(labels).toContain('Manchester City v Burnley, EFL Cup, 16:00');
    expect(
      labels.some((label) => /^Los Angeles Lakers v New York Knicks, .*20:30$/.test(label)),
    ).toBe(true);
    expect(realErrors(errors)).toEqual([]);
  });
});
