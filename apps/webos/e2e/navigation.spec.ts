import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { APP_URL, expectFocus, expectFocusLabel, press, pressBack, watchErrors } from './tv';

test.beforeEach(async ({ page }) => {
  await mockAddons(page);
});

test('the packaged build loads from file:// as a classic script', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('script[type="module"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.fonts.check('600 24px Urbanist'))).toBe(true);
  // Posters from the addon are on screen.
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-0"] img`)).toHaveJSProperty(
    'complete',
    true,
  );
  expect(errors).toEqual([]);
});

test('arrows move through rows, remember the tile per row, and reach the hero and rail', async ({
  page,
}) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-2`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-3`);
  // The hero follows focus once it rests.
  await expect(page.locator('section[aria-label="Tears of Steel"]:visible')).toBeVisible();

  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowRight', `${SERIES_ROW}-tile-1`);
  // Back up to the tile this row was left on, not column 0.
  await press(page, 'ArrowUp', `${FIRST_ROW}-tile-3`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-1`);
  await press(page, 'ArrowUp', `${FIRST_ROW}-tile-3`);

  await press(page, 'ArrowUp', 'home-hero-details');
  await press(page, 'ArrowDown', `${FIRST_ROW}-tile-3`);

  await press(page, 'ArrowLeft', `${FIRST_ROW}-tile-2`);
  await press(page, 'ArrowLeft', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowLeft', `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowLeft', 'rail-home');
  // The rail opens and shows its labels while it has focus.
  const label = page.locator('[data-focus-key="rail-home"] span');
  await expect(label).toHaveCSS('opacity', '1');

  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-0`);
  await expect(label).toHaveCSS('opacity', '0');
});

test('OK opens details and Back returns to the same tile', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-2`);
  // Home stays mounted under Details, so Back shows the same elements, not new ones.
  const markRow = (key: string) => {
    const row = document.querySelector<HTMLElement>(`[data-row-key="${key}"]`);
    if (row) row.dataset.kept = 'yes';
  };
  await page.evaluate(markRow, FIRST_ROW);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('section[aria-label="Sintel"]:visible')).toBeVisible();
  // Hidden Home is out of reach: the remote cannot move into it from Details.
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toBeHidden();
  await expect(page.getByText('Starring Proog, Emo')).toBeVisible();
  await expect(page.getByText('Directed by Bassam Kurdali')).toBeVisible();

  // No stream addon is installed, so the player says so.
  await press(page, 'Enter', 'player-problem-streams');
  await expect(page.getByText('No stream could play')).toBeVisible();
  await expect(
    page.getByText('You have no addon that finds streams yet. Add one in Addons.'),
  ).toBeVisible();

  await pressBack(page);
  await expectFocus(page, 'details-watch');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-2`);
  await expect(page.locator(`[data-row-key="${FIRST_ROW}"]`)).toHaveAttribute('data-kept', 'yes');
  // Home comes back with the row already at that tile, not sliding there.
  const slides = await page.evaluate(
    (key) =>
      document.querySelector(`[data-focus-key="${key}"]`)?.parentElement?.getAnimations().length,
    `${FIRST_ROW}-tile-2`,
  );
  expect(slides).toBe(0);
});

test('a press made before an opened screen draws its first frame stays where it went', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 9, 31, 12, 0, 0).getTime() });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  // A busy TV can draw a screen's first frame after the next press: frames wait here.
  await page.clock.pauseAt(new Date(2026, 9, 31, 12, 1, 0).getTime());
  await page.keyboard.press('Enter');
  await expectFocus(page, 'details-watch');
  await page.keyboard.press('ArrowLeft');
  await expectFocus(page, 'rail-home');
  await page.clock.resume();
  // The screen settles two frames after it opens, after it would have taken focus.
  await expect(page.locator('.screen-settling')).toHaveCount(0);
  await expectFocus(page, 'rail-home');
  await press(page, 'ArrowRight', 'details-watch');
});

test('Back closes screens, goes Home, returns to the first row, then exits', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.evaluate(() => {
    const w = window as Window & { exitRequested?: boolean };
    window.addEventListener('bannertv:exit', () => (w.exitRequested = true));
  });

  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'addons', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-stream-choice');
  await press(page, 'ArrowDown', 'settings-probing');
  await press(page, 'ArrowDown', 'settings-subtitle-style');
  await press(page, 'ArrowDown', 'settings-still-watching');
  await press(page, 'ArrowDown', 'settings-diagnostics');
  await press(page, 'Enter', 'diagnostics-refresh');
  await expect(page.getByText('classic script')).toBeVisible();

  await pressBack(page);
  await expectFocus(page, 'settings-diagnostics');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await pressBack(page);
  await expect
    .poll(() => page.evaluate(() => (window as Window & { exitRequested?: boolean }).exitRequested))
    .toBe(true);
});

test('Back from far down Home returns to the first row', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  const rows = [
    SERIES_ROW,
    'home-0-movie-imdbrating',
    'home-0-series-imdbrating',
    'home-0-movie-top-genre-action',
  ];
  for (const row of rows) await press(page, 'ArrowDown', `${row}-tile-0`);
  // The first row is far enough up to be drawn as an empty box by now.
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-1"]`)).toHaveCount(0);

  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-1`);
});

/** Every row Home makes from Cinemeta, top to bottom. */
const HOME_ROWS = [
  FIRST_ROW,
  SERIES_ROW,
  'home-0-movie-imdbrating',
  'home-0-series-imdbrating',
  'home-0-movie-top-genre-action',
  'home-0-series-top-genre-crime',
  'home-0-movie-top-genre-comedy',
  'home-0-series-top-genre-drama',
  'home-0-movie-top-genre-sci-fi',
  'home-0-series-top-genre-animation',
];
const CATALOGS = /^https:\/\/v3-cinemeta\.strem\.io\/catalog\//;
const LAST_CATALOG = /\/catalog\/series\/top\/genre=Animation\.json$/;
const RAIL = ['home', 'search', 'discover', 'library', 'addons', 'settings'];

/** The rows slide so the focused one sits in view under the hero. */
async function expectFocusInView(page: Page): Promise<void> {
  await expect(page.locator('[data-focused="true"]')).toBeInViewport({ ratio: 0.9 });
}

test('Down reaches the last row while rows are still loading', async ({ page }) => {
  // Each catalog answers well after focus reaches its row, as on a cold start,
  // and the last one only once focus is resting on its placeholder.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(CATALOGS, async (route) => {
    if (LAST_CATALOG.test(route.request().url())) await held;
    else await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fallback();
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  for (const row of HOME_ROWS.slice(1)) await press(page, 'ArrowDown', `${row}-tile-0`);
  await expectFocusInView(page);
  await expectFocusLabel(page, 'Loading');

  // Once the row loads, the hero catches up with the title under focus.
  release();
  await expectFocusLabel(page, 'Blender Today, 2021–');
  await expect(page.locator('section[aria-label="Blender Today"]:visible')).toBeVisible();
});

test('a row that turns out empty under focus hands focus to the row below', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/catalog\/series\/imdbRating\.json$/, async (route) => {
    await held;
    await route.fulfill({
      json: { metas: [] },
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  for (const row of HOME_ROWS.slice(1, 4)) await press(page, 'ArrowDown', `${row}-tile-0`);
  release();
  await expectFocus(page, `${HOME_ROWS[4]}-tile-0`);
  await expectFocusInView(page);
});

test('a row that empties before the rows slide to it leaves focus in view', async ({ page }) => {
  // Animation frames run late, as on a busy TV, so the empty answer lands first.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    const late = new Map<number, ReturnType<typeof setTimeout>>();
    let next = 1e6;
    window.requestAnimationFrame = (callback) => {
      if (!(window as unknown as { slowFrames?: boolean }).slowFrames) return raf(callback);
      const id = ++next;
      late.set(
        id,
        setTimeout(() => late.delete(id) && raf(callback), 400),
      );
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      clearTimeout(late.get(id));
      if (!late.delete(id)) caf(id);
    };
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/catalog\/series\/imdbRating\.json$/, async (route) => {
    await held;
    await route.fulfill({
      json: { metas: [] },
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  for (const row of HOME_ROWS.slice(1, 3)) await press(page, 'ArrowDown', `${row}-tile-0`);
  await page.evaluate(() => ((window as unknown as { slowFrames: boolean }).slowFrames = true));
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, `${HOME_ROWS[3]}-tile-0`);
  release();
  await expectFocus(page, `${HOME_ROWS[4]}-tile-0`);
  // Once the late frame has run, not eventually: the view must not leave focus.
  await page.waitForTimeout(1000);
  const box = await page.locator('[data-focused="true"]').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(1080);
});

test('an empty last row under focus hands focus to the row above', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(LAST_CATALOG, async (route) => {
    await held;
    await route.fulfill({
      json: { metas: [] },
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  for (const row of HOME_ROWS.slice(1)) await press(page, 'ArrowDown', `${row}-tile-0`);
  release();
  await expectFocus(page, `${HOME_ROWS[8]}-tile-0`);
  await expectFocusInView(page);
  await press(page, 'ArrowUp', `${HOME_ROWS[7]}-tile-0`);
});

test('coming back to Home from another section puts focus on the first row', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  for (const row of HOME_ROWS.slice(1, 6)) await press(page, 'ArrowDown', `${row}-tile-0`);
  await page.keyboard.press('ArrowLeft');
  const focused = page.locator('[data-focused="true"]');
  await expect(focused).toHaveAttribute('data-focus-key', /^rail-/);
  await page.waitForTimeout(150);
  const at = (await focused.getAttribute('data-focus-key'))!.slice('rail-'.length);
  for (const item of RAIL.slice(RAIL.indexOf(at) + 1))
    await press(page, 'ArrowDown', `rail-${item}`);
  // Settings opens on its first setting, how Watch chooses a stream.
  await press(page, 'Enter', 'settings-stream-choice');

  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expectFocusInView(page);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
});

test('Down crosses rows whose catalogs failed', async ({ page }) => {
  await page.route(CATALOGS, (route) =>
    route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.getByText('Cinemeta answered with an error (500).').first()).toBeVisible();
  // Each row's Try again takes focus.
  for (const row of HOME_ROWS.slice(1)) await press(page, 'ArrowDown', `${row}-tile-0`);
  await expectFocusInView(page);
});

test('a row slides into view when focus comes back to its See all tile', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  for (let n = 1; n <= 5; n++) await press(page, 'ArrowRight', `${SERIES_ROW}-tile-${n}`);
  await press(page, 'ArrowDown', `${HOME_ROWS[2]}-tile-0`);
  await press(page, 'ArrowUp', `${SERIES_ROW}-tile-5`);
  await expectFocusInView(page);
});

test('Home still works with every tuning switch at its leanest', async ({ page }) => {
  const lean = {
    motion: 'jump',
    zoom: 'off',
    heroPan: false,
    heroDelayMs: 0,
    heroBusyMs: 800,
    heroArt: 'medium',
    rowsAround: 1,
    overscan: 1,
    decoding: 'async',
    mips: false,
  };
  await page.addInitScript(
    (value) => localStorage.setItem('bannertv.tuning', value),
    JSON.stringify(lean),
  );
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('html')).toHaveClass(
    /tune-motion-jump tune-zoom-off tune-no-pan tune-no-mips/,
  );
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-0"] img`)).toHaveAttribute(
    'decoding',
    'async',
  );

  for (let n = 1; n <= 3; n++) await press(page, 'ArrowRight', `${FIRST_ROW}-tile-${n}`);
  for (const row of HOME_ROWS.slice(1)) await press(page, 'ArrowDown', `${row}-tile-0`);
  await expectFocusInView(page);
  await expect(page.locator('section[aria-label="Blender Today"]:visible')).toBeVisible();
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-3`);
});

test('the earlier sliding look still works from tuning', async ({ page }) => {
  const earlier = {
    motion: 'slide',
    zoom: 'animate',
    heroBusyMs: 250,
    heroArt: 'large',
    heroPan: true,
    mips: true,
    heroFade: true,
  };
  await page.addInitScript(
    (value) => localStorage.setItem('bannertv.tuning', value),
    JSON.stringify(earlier),
  );
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('html')).not.toHaveClass(/tune-/);
  await expect(page.locator('[data-row-key] > div > div').first()).toHaveCSS(
    'transition-property',
    'transform',
  );

  for (let n = 1; n <= 3; n++) await press(page, 'ArrowRight', `${FIRST_ROW}-tile-${n}`);
  for (const row of HOME_ROWS.slice(1, 5)) await press(page, 'ArrowDown', `${row}-tile-0`);
  await expectFocusInView(page);
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-3`);
});

test('quick presses all count, and a held arrow moves at most once per 100 ms', async ({
  page,
}) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  // Presses a busy TV delivers together, after a pause, are not dropped.
  for (let n = 0; n < 3; n++) await page.keyboard.press('ArrowRight');
  await expectFocus(page, `${FIRST_ROW}-tile-3`);
  for (let n = 0; n < 3; n++) await page.keyboard.press('ArrowDown');
  await expectFocus(page, `${HOME_ROWS[3]}-tile-0`);
  for (let n = 0; n < 3; n++) await page.keyboard.press('ArrowUp');
  await expectFocus(page, `${FIRST_ROW}-tile-3`);
  await expectFocusInView(page);

  // Key repeat from a held arrow is still held back: one move per 100 ms at
  // most. Six presses from tile 9 stay in the row, however slow the runner.
  for (let n = 0; n < 6; n++) await page.keyboard.press('ArrowRight');
  await expectFocus(page, `${FIRST_ROW}-tile-9`);
  await page.waitForTimeout(150);
  const started = Date.now();
  for (let n = 0; n < 6; n++) await page.keyboard.down('ArrowLeft');
  const held = Date.now() - started;
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(200);
  const key = await page.locator('[data-focused="true"]').getAttribute('data-focus-key');
  const moved = 9 - Number(/-tile-(\d+)$/.exec(key ?? '')?.[1]);
  expect(moved).toBeGreaterThanOrEqual(1);
  expect(moved).toBeLessThanOrEqual(Math.min(6, 1 + Math.floor(held / 100)));
  if (held < 500) expect(moved).toBeLessThan(6);
});

test('going up to the hero after quick presses shows, and opens, the title focus was on', async ({
  page,
}) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('section[aria-label="Elephants Dream"]:visible')).toBeVisible();
  await page.waitForTimeout(1000);
  // Quick presses hold the hero back, so it still shows the first title...
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, `${FIRST_ROW}-tile-2`);
  await expect(page.locator('section[aria-label="Elephants Dream"]:visible')).toBeVisible();
  // ...until focus goes up to it, which shows the title focus left at once.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'details-watch');
  await expect(page.locator('section[aria-label="Sintel"]:visible')).toBeVisible();
  await expect(page.locator('section[aria-label="Elephants Dream"]:visible')).toHaveCount(0);
  await pressBack(page);
  await expectFocus(page, 'home-hero-details');
  await expect(page.locator('section[aria-label="Sintel"]:visible')).toBeVisible();
});

test('the hero follows a row that loads under focus without the quick-press wait', async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/catalog\/series\/top\.json$/, async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.waitForTimeout(1500);
  // One press after a rest, onto a row still loading.
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await page.waitForTimeout(300);
  release();
  await expectFocusLabel(page, 'Morevna Project, 2016–');
  // The catalog arriving is not another press: the hero waits 250 ms, not 800.
  await expect(page.locator('section[aria-label="Morevna Project"]:visible')).toBeVisible({
    timeout: 600,
  });
});

test('on a TV, Back on the root screen calls platformBack', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { platformBackCalls?: number };
    w.platformBackCalls = 0;
    w.PalmSystem = {
      deviceInfo: JSON.stringify({ modelName: 'TEST', platformVersion: '04.60.91' }),
      platformBack: () => (w.platformBackCalls = (w.platformBackCalls ?? 0) + 1),
    };
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await pressBack(page);
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { platformBackCalls?: number }).platformBackCalls),
    )
    .toBe(1);
});

test('the Magic Remote pointer moves focus by hovering', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const tile = page.locator(`[data-focus-key="${FIRST_ROW}-tile-4"]`);
  const box = await tile.boundingBox();
  if (!box) throw new Error('tile 4 is not on screen');
  await page.mouse.move(10, 10);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await expectFocus(page, `${FIRST_ROW}-tile-4`);
  await expect(page.locator('html')).toHaveClass(/pointer-mode/);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).not.toHaveClass(/pointer-mode/);
});

test('one pointer move straight from 5-way mode focuses the tile under it', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await page.mouse.move(10, 10);
  // The arrow hides the pointer, as on the TV.
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await expect(page.locator('html')).not.toHaveClass(/pointer-mode/);
  await page.waitForTimeout(300); // the row finishes sliding

  const box = await page.locator(`[data-focus-key="${FIRST_ROW}-tile-3"]`).boundingBox();
  if (!box) throw new Error('tile 3 is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expectFocus(page, `${FIRST_ROW}-tile-3`);
});

test('a pointer click opens details, and Back returns to the clicked tile', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  // A click with no hover before it, which the Magic Remote can send.
  await page.locator(`[data-focus-key="${SERIES_ROW}-tile-2"]`).dispatchEvent('click');
  await expectFocus(page, 'details-episodes-0');

  await pressBack(page);
  await expectFocus(page, `${SERIES_ROW}-tile-2`);
});

test('pointer arrows page through a row', async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  const row = page.locator(`[data-row-key="${FIRST_ROW}"]`);
  const next = row.getByRole('button', { name: 'More titles' });
  // Hidden in 5-way mode.
  await expect(next).toBeHidden();

  const box = await page.locator(`[data-focus-key="${FIRST_ROW}-tile-2"]`).boundingBox();
  if (!box) throw new Error('tile 2 is not on screen');
  await page.mouse.move(10, 10);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await expectFocus(page, `${FIRST_ROW}-tile-2`);
  await next.click();
  // One page is the six tiles that were in full view.
  await expectFocus(page, `${FIRST_ROW}-tile-6`);
  await expect(row.getByRole('button', { name: 'Previous titles' })).toBeVisible();
});
