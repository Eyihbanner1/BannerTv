import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, png, SERIES_ROW } from './addons';
import { mockPlayback, seedStreamAddon } from './play';
import { APP_URL, expectFocus, openSection, press, pressBack } from './tv';

/**
 * The switches the TV comparisons of the first walk down Home tried (see
 * src/platform/tuning.ts): decoding ahead, Home's rows box on its own layer,
 * the hero without its fade, small wide art, and timing marks. Decoding
 * ahead and the hero without its fade are the defaults. Then the second
 * round's: getting art ready by drawing it under the rail.
 */

/** Home's first rows from the mock Cinemeta, top to bottom. Featured rows have wide tiles. */
const FEATURED_MOVIES = 'home-0-movie-imdbrating';
const FEATURED_SERIES = 'home-0-series-imdbrating';
const ACTION = 'home-0-movie-top-genre-action';
const CRIME = 'home-0-series-top-genre-crime';
const COMEDY = 'home-0-movie-top-genre-comedy';

test.beforeEach(async ({ page }) => {
  await mockAddons(page);
});

async function tune(page: Page, value: object): Promise<void> {
  await page.addInitScript(
    (stored) => localStorage.setItem('bannertv.tuning', stored),
    JSON.stringify(value),
  );
}

interface Call {
  row: string;
  tile: string;
  src: string;
  /** When it was asked (performance.now()). */
  at: number;
  /** The same address was asked before. */
  again: boolean;
}

interface Decodes {
  calls: Call[];
  /** Decodes asked and not settled yet, and the most there ever were at once. */
  pending: number;
  mostPending: number;
}

/** Records every decode() asked of loaded tile artwork, by row and tile, and how many are in flight. */
async function recordDecodes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: Decodes = { calls: [], pending: 0, mostPending: 0 };
    const seen = new Set<string>();
    (window as unknown as { decodes: Decodes }).decodes = record;
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function decode(this: HTMLImageElement) {
      const row = this.closest('[data-row-key]');
      const tile = this.closest('[data-focus-key]');
      // Artwork itself decodes an image that finished with no size, to tell an SVG from a failure.
      if (!row || !tile || this.naturalWidth === 0) return original.call(this);
      const src = this.getAttribute('src')!;
      record.calls.push({
        row: row.getAttribute('data-row-key')!,
        tile: tile.getAttribute('data-focus-key')!,
        src,
        at: performance.now(),
        again: seen.has(src),
      });
      seen.add(src);
      record.pending++;
      record.mostPending = Math.max(record.mostPending, record.pending);
      const settle = () => {
        record.pending--;
      };
      const done = original.call(this);
      done.then(settle, settle);
      return done;
    };
  });
}

const decodes = (page: Page) =>
  page.evaluate(() => (window as unknown as { decodes: Decodes }).decodes);
const allDecodes = async (page: Page) => (await decodes(page)).calls;

/** The tiles of `row` whose art was decoded ahead, optionally of one kind (poster, logo, background). */
async function decodedTiles(page: Page, row: string, kind?: string): Promise<number[]> {
  return (await allDecodes(page))
    .filter((call) => call.row === row && (!kind || call.src.split('/')[3] === kind))
    .map((call) => Number(call.tile.split('-tile-')[1]))
    .sort((a, b) => a - b);
}

const marks = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('mark')
      .map((entry) => ({ name: entry.name, at: entry.startTime })),
  );
const markNames = async (page: Page) => (await marks(page)).map((entry) => entry.name);

interface DrawnArt {
  src: string;
  /** Its drawn size in CSS px, to a tenth. */
  size: [number, number];
}

/** The art drawn ahead under the rail, with the aheadMode raster switch, oldest first. */
const warmArt = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-warm-ahead] img'), (image): DrawnArt => {
      const box = image.getBoundingClientRect();
      const tenth = (value: number) => Math.round(value * 10) / 10;
      return { src: image.getAttribute('src')!, size: [tenth(box.width), tenth(box.height)] };
    }),
  );

/** The same for the art of some tiles of a row, tile by tile. */
const tileArt = (page: Page, row: string, tiles: number[]) =>
  page.evaluate(
    ({ row, tiles }) =>
      tiles.flatMap((n) =>
        Array.from(
          document.querySelectorAll(`[data-focus-key="${row}-tile-${n}"] img`),
          (image): DrawnArt => {
            const box = image.getBoundingClientRect();
            const tenth = (value: number) => Math.round(value * 10) / 10;
            return { src: image.getAttribute('src')!, size: [tenth(box.width), tenth(box.height)] };
          },
        ),
      ),
    { row, tiles },
  );

/** Presses a key and waits for focus to land anywhere in `row`. */
async function pressToRow(page: Page, key: string, row: string): Promise<void> {
  await page.keyboard.press(key);
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
    'data-focus-key',
    new RegExp(`^${row}-tile-`),
  );
  await page.waitForTimeout(120);
}

test.describe('on a 4K TV', () => {
  test.use({ deviceScaleFactor: 2 });

  test('decoding ahead takes the posters and logos across the screen of the row the next press shows, never wide art', async ({
    page,
  }) => {
    // Metahub's sizes: medium posters 500 wide, drawn at 440 device px; logos
    // drawn at 476; wide art 1920, drawn at 768.
    const art = { poster: png(500, 750), logo: png(500, 150), background: png(1920, 1080) };
    await page.route(/^https:\/\/images\.metahub\.space\/(poster|logo|background)\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: art[new URL(route.request().url()).pathname.split('/')[1] as keyof typeof art],
      }),
    );
    await tune(page, { decodeAhead: true });
    await recordDecodes(page);
    await page.goto(APP_URL);
    await expectFocus(page, `${FIRST_ROW}-tile-0`);

    // From the first row, the row after next is Featured: the logos of the
    // tiles across the screen, never its wide art.
    await expect.poll(() => decodedTiles(page, FEATURED_MOVIES, 'logo')).toEqual([0, 1, 2, 3, 4]);
    await page.waitForTimeout(300);
    expect(await decodedTiles(page, FEATURED_MOVIES, 'background')).toEqual([]);
    // Not the row with focus, nor the next one, whose top already shows.
    expect(await decodedTiles(page, FIRST_ROW)).toEqual([]);
    expect(await decodedTiles(page, SERIES_ROW)).toEqual([]);
    for (let n = 1; n <= 3; n++) await press(page, 'ArrowRight', `${FIRST_ROW}-tile-${n}`);

    await pressToRow(page, 'ArrowDown', SERIES_ROW);
    await expect.poll(() => decodedTiles(page, FEATURED_SERIES, 'logo')).toEqual([0, 1, 2, 3, 4]);
    await pressToRow(page, 'ArrowDown', FEATURED_MOVIES);
    // Exactly the seven posters across the screen, not the ones drawn past its right edge.
    await expect.poll(() => decodedTiles(page, ACTION)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await pressToRow(page, 'ArrowDown', FEATURED_SERIES);
    // A series row: five titles.
    await expect.poll(() => decodedTiles(page, CRIME)).toEqual([0, 1, 2, 3, 4]);
    // Going down, the rows above were never asked: they have been on show.
    expect(await decodedTiles(page, FIRST_ROW)).toEqual([]);

    // After an Up, the row above too. The series row shows the crime row's
    // titles again, whose art was just decoded, so nothing is asked.
    await pressToRow(page, 'ArrowUp', FEATURED_MOVIES);
    await page.waitForTimeout(400);
    expect(await decodedTiles(page, SERIES_ROW)).toEqual([]);
    // The first row, moved on to tile 3: tile 1 is past the left edge. Tiles
    // 7 to 9 show the action row's titles (it lists them in reverse), already
    // decoded, and from tile 10 on they are past the right edge.
    await pressToRow(page, 'ArrowUp', SERIES_ROW);
    await expect.poll(() => decodedTiles(page, FIRST_ROW)).toEqual([2, 3, 4, 5, 6]);
    await page.waitForTimeout(300);
    expect(await decodedTiles(page, FIRST_ROW)).toEqual([2, 3, 4, 5, 6]);

    // Back down over rows already asked: nothing is asked twice, and never two at once.
    await pressToRow(page, 'ArrowDown', FEATURED_MOVIES);
    await pressToRow(page, 'ArrowDown', FEATURED_SERIES);
    await page.waitForTimeout(400);
    const record = await decodes(page);
    expect(record.calls.filter((call) => call.again)).toEqual([]);
    expect(record.mostPending).toBe(1);
  });

  test('aheadMode raster draws the art of the row the next press shows under the rail, wide art too, and goes with the rail', async ({
    page,
  }) => {
    const art = { poster: png(500, 750), logo: png(500, 150), background: png(1920, 1080) };
    await page.route(/^https:\/\/images\.metahub\.space\/(poster|logo|background)\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: art[new URL(route.request().url()).pathname.split('/')[1] as keyof typeof art],
      }),
    );
    await seedStreamAddon(page);
    await mockPlayback(page);
    await tune(page, { aheadMode: 'raster', marks: true });
    await recordDecodes(page);
    await page.goto(APP_URL);
    await expectFocus(page, `${FIRST_ROW}-tile-0`);

    // From the first row, the Featured row's wide art and logos across the
    // screen, each at the size its tile draws it, and none of it decoded.
    const across = [0, 1, 2, 3, 4];
    await expect.poll(async () => (await tileArt(page, FEATURED_MOVIES, across)).length).toBe(10);
    const featured = await tileArt(page, FEATURED_MOVIES, across);
    expect(featured.map((drawn) => drawn.size[0])).toContain(384);
    await expect.poll(() => warmArt(page)).toEqual(featured);
    expect(await allDecodes(page)).toEqual([]);
    // Drawn under the rail, which covers it: nothing shows.
    const covered = await page.evaluate(() => {
      const box = document.querySelector('[data-warm-ahead]')!;
      const rect = box.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left, rect.top);
      return {
        rect: [rect.left, rect.top, rect.width, rect.height],
        byRail: !!top && !!top.closest('nav') && !box.contains(top),
      };
    });
    expect(covered).toEqual({ rect: [0, 1079, 1, 1], byRail: true });
    // One image at a time, never two drawn in the same frame.
    const own = (await markNames(page)).filter((name) => /^ahead(-done)?:/.test(name));
    expect(own.slice(0, 4)).toEqual([
      `ahead:${FEATURED_MOVIES}`,
      `ahead-done:${FEATURED_MOVIES}`,
      `ahead:${FEATURED_MOVIES}`,
      `ahead-done:${FEATURED_MOVIES}`,
    ]);

    // Moving on, at most ten are kept drawn, and the newest are the next row's.
    await pressToRow(page, 'ArrowDown', SERIES_ROW);
    await expect.poll(async () => (await tileArt(page, FEATURED_SERIES, across)).length).toBe(10);
    const seriesFeatured = await tileArt(page, FEATURED_SERIES, across);
    await expect.poll(async () => (await warmArt(page)).slice(-10)).toEqual(seriesFeatured);
    expect(await warmArt(page)).toHaveLength(10);
    await pressToRow(page, 'ArrowDown', FEATURED_MOVIES);
    const posters = [0, 1, 2, 3, 4, 5, 6];
    await expect.poll(async () => (await tileArt(page, ACTION, posters)).length).toBe(7);
    const action = await tileArt(page, ACTION, posters);
    await expect.poll(async () => (await warmArt(page)).slice(-7)).toEqual(action);
    expect((await warmArt(page)).length).toBeLessThanOrEqual(10);
    expect(await allDecodes(page)).toEqual([]);

    // The player takes the whole screen, rail and all: the box goes, with its art.
    await pressToRow(page, 'ArrowUp', SERIES_ROW);
    await pressToRow(page, 'ArrowUp', FIRST_ROW);
    await press(page, 'Enter', 'details-watch');
    await press(page, 'Enter', 'player-surface');
    await expect(page.locator('[data-warm-ahead]')).toHaveCount(0);
    await expect(page.locator('nav')).toHaveCount(0);
    // Back to the title: the rail is back, and the box with it.
    await pressBack(page);
    await expectFocus(page, 'details-watch');
    await expect(page.locator('[data-warm-ahead]')).toHaveCount(1);
  });

  test('with small wide art, decoding ahead takes the Featured row’s art too', async ({ page }) => {
    const art = { poster: png(500, 750), logo: png(500, 150), background: png(480, 270) };
    await page.route(/^https:\/\/images\.metahub\.space\/(poster|logo|background)\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: art[new URL(route.request().url()).pathname.split('/')[1] as keyof typeof art],
      }),
    );
    await tune(page, { decodeAhead: true, wideArt: 'small' });
    await recordDecodes(page);
    await page.goto(APP_URL);
    await expectFocus(page, `${FIRST_ROW}-tile-0`);
    await expect
      .poll(() => decodedTiles(page, FEATURED_MOVIES, 'background'))
      .toEqual([0, 1, 2, 3, 4]);
    await expect.poll(() => decodedTiles(page, FEATURED_MOVIES, 'logo')).toEqual([0, 1, 2, 3, 4]);
    expect((await decodes(page)).mostPending).toBe(1);
  });
});

test('art that loads after its row was reached is decoded as it arrives', async ({ page }) => {
  // The first four posters of the action row are new to the page: hold them.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const poster = png(16, 9);
  await page.route(/\/poster\/[^/]+\/tt90000(11|12|13|14)\/img$/, async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: 'image/png', body: poster });
  });
  await tune(page, { decodeAhead: true, marks: true });
  await recordDecodes(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${FEATURED_MOVIES}-tile-0`);
  // The posters already loaded are taken...
  await expect.poll(() => decodedTiles(page, ACTION)).toEqual([4, 5, 6]);
  await page.waitForTimeout(200);
  const releasedAt = await page.evaluate(() => performance.now());
  release();
  // ...and the held ones as they arrive.
  await expect.poll(() => decodedTiles(page, ACTION)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  const late = (await marks(page))
    .filter((entry) => entry.at >= releasedAt && entry.name === `ahead:${ACTION}`)
    .map((entry) => entry.name);
  expect(late).toHaveLength(4);
  expect((await decodes(page)).mostPending).toBe(1);
});

test('with rowsAround 3, the row after next is drawn early and decoded one image at a time once it is next', async ({
  page,
}) => {
  await tune(page, { decodeAhead: true, rowsAround: 3, marks: true });
  await recordDecodes(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  // Three rows down is drawn and loaded already, but not decoded yet.
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const images = Array.from(document.querySelectorAll(`[data-row-key="${key}"] img`));
        return images.length >= 7 && images.every((image) => (image as HTMLImageElement).complete);
      }, ACTION),
    )
    .toBe(true);
  await page.waitForTimeout(300);
  expect(await decodedTiles(page, ACTION)).toEqual([]);

  await press(page, 'ArrowDown', `${FEATURED_MOVIES}-tile-0`);
  const ownMarks = async () =>
    (await markNames(page)).filter(
      (name) => name === `ahead:${ACTION}` || name === `ahead-done:${ACTION}`,
    );
  await expect.poll(async () => (await ownMarks()).length).toBe(14);
  // Each decode starts only once the one before it is done.
  expect(await ownMarks()).toEqual(
    Array.from({ length: 14 }, (_, n) => (n % 2 ? `ahead-done:${ACTION}` : `ahead:${ACTION}`)),
  );
  // Marks name rows, never an address.
  expect((await markNames(page)).filter((name) => /https?:|\/\//.test(name))).toEqual([]);
});

test('quick presses decode nothing until the remote is still, and going back to the top asks nothing twice', async ({
  page,
}) => {
  await tune(page, { decodeAhead: true });
  await recordDecodes(page);
  await page.addInitScript(() => {
    const keys: number[] = [];
    (window as unknown as { keys: number[] }).keys = keys;
    window.addEventListener('keydown', () => keys.push(performance.now()), true);
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => decodedTiles(page, FEATURED_MOVIES, 'logo')).toEqual([0, 1, 2, 3, 4]);
  await page.waitForTimeout(300);

  // Presses 80 ms apart: each moves on before the remote counts as still.
  for (let n = 0; n < 4; n++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
  }
  await expectFocus(page, `${ACTION}-tile-0`);
  // No decode starts until the remote has been still for a while, so none
  // between presses that came quicker than that.
  const keys = await page.evaluate(() => (window as unknown as { keys: number[] }).keys);
  expect(keys).toHaveLength(4);
  for (const call of await allDecodes(page)) {
    const before = keys.filter((at) => at <= call.at);
    if (before.length > 0) expect(call.at - before[before.length - 1]!).toBeGreaterThanOrEqual(140);
  }
  // Once it is, the art of the row the next Down shows is decoded: there, or
  // in the action row, which shows the same titles, if a press came late.
  const comedyArt = await page
    .locator(`[data-focus-key="${COMEDY}-tile-0"] img`)
    .first()
    .getAttribute('src');
  await expect
    .poll(async () => (await allDecodes(page)).some((call) => call.src === comedyArt))
    .toBe(true);

  // Back to the top and down again draws the action row again, as new
  // elements: it shows the comedy row's titles, whose art was decoded
  // moments ago, so nothing is asked twice.
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${FEATURED_MOVIES}-tile-0`);
  await page.waitForTimeout(600);
  const record = await decodes(page);
  expect(record.calls.filter((call) => call.again)).toEqual([]);
  expect(record.mostPending).toBe(1);
});

test('while frames run long, nothing is decoded, even once the remote is still', async ({
  page,
}) => {
  // Animation frames 80 ms apart, as on a TV still drawing a press.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let next = 1e6;
    window.requestAnimationFrame = (callback) => {
      if (!(window as unknown as { slowFrames?: boolean }).slowFrames) return raf(callback);
      setTimeout(() => raf(callback), 80);
      return ++next;
    };
  });
  await tune(page, { decodeAhead: true });
  await recordDecodes(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => decodedTiles(page, FEATURED_MOVIES, 'logo')).toEqual([0, 1, 2, 3, 4]);
  await page.waitForTimeout(300);

  const slowFrom = await page.evaluate(() => {
    (window as unknown as { slowFrames: boolean }).slowFrames = true;
    return performance.now();
  });
  await pressToRow(page, 'ArrowDown', SERIES_ROW);
  // Well past the quiet time: the next Featured row's logos wait for frames to flow.
  await page.waitForTimeout(600);
  expect((await allDecodes(page)).filter((call) => call.at > slowFrom)).toEqual([]);

  const flowingFrom = await page.evaluate(() => {
    (window as unknown as { slowFrames: boolean }).slowFrames = false;
    return performance.now();
  });
  await expect.poll(() => decodedTiles(page, FEATURED_SERIES, 'logo')).toEqual([0, 1, 2, 3, 4]);
  const series = (await allDecodes(page)).filter((call) => call.row === FEATURED_SERIES);
  expect(series.every((call) => call.at > flowingFrom)).toBe(true);
});

test("Home's rows box can be a layer of its own, and the hero can change without its fade", async ({
  page,
}) => {
  await tune(page, { homeLayer: true, heroFade: false, marks: true });
  // For each backdrop dropped: whether it went in the same render as the new
  // one showed, before any other task could run, and so before any frame.
  await page.addInitScript(() => {
    const sameRender: boolean[] = [];
    (window as unknown as { sameRender: boolean[] }).sameRender = sameRender;
    let shownNow = false;
    const original = performance.mark.bind(performance);
    performance.mark = ((name: string, options?: PerformanceMarkOptions) => {
      if (name === 'backdrop:shown') {
        shownNow = true;
        queueMicrotask(() => (shownNow = false));
      } else if (name === 'backdrop:settled') sameRender.push(shownNow);
      return original(name, options);
    }) as typeof performance.mark;
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('html')).toHaveClass(/tune-home-layer/);
  await expect(page.locator('html')).toHaveClass(/tune-no-hero-fade/);
  // Home's track only, not each row's own track.
  await expect(page.locator('[data-row-key]').first().locator('xpath=..')).toHaveCSS(
    'will-change',
    'transform',
  );
  await expect(page.locator('[data-row-key] > div > div').first()).toHaveCSS('will-change', 'auto');

  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await expect(page.locator('section[aria-label="Big Buck Bunny"]:visible')).toBeVisible();
  // The newest backdrop is drawn last; the old one can still be under it.
  await expect(
    page.locator('section[aria-label="Big Buck Bunny"] img[src*="/background/"]').last(),
  ).toHaveCSS('transition-duration', '0s');
  // The old backdrop goes in the same render as the new one shows, so no
  // frame draws both and none draws the hero twice.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { sameRender: boolean[] }).sameRender))
    .toEqual([true]);

  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await expect(page.locator('[data-focused="true"]')).toBeInViewport({ ratio: 0.9 });
});

test('timing marks name the remote keys, slides, rows and hero changes, and nothing typed', async ({
  page,
}) => {
  await tune(page, { marks: true });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await expect(page.locator('section[aria-label="Big Buck Bunny"]:visible')).toBeVisible();
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await expect.poll(() => markNames(page)).toContain('backdrop:settled');
  const names = await markNames(page);
  for (const name of ['key:ArrowRight', 'key:ArrowDown', `slide:${SERIES_ROW}`, 'hero:set']) {
    expect(names).toContain(name);
  }
  expect(names).toContain('backdrop:shown');
  expect(names.some((name) => name.indexOf(`row:${FIRST_ROW}:`) === 0)).toBe(true);

  // Typing marks only "other", so the marks can never spell out what was typed.
  await press(page, 'ArrowUp', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowLeft', `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await page.keyboard.press('Enter');
  await expect(page.locator('input[aria-label="Search"]')).toBeFocused();
  await page.keyboard.type('sintel');
  await expect(page.locator('input[aria-label="Search"]')).toHaveValue('sintel');
  const keys = (await markNames(page)).filter((name) => name.indexOf('key:') === 0);
  expect(keys.filter((name) => name === 'key:other')).toHaveLength(6);
  expect(
    keys.filter(
      (name) =>
        [
          'key:ArrowUp',
          'key:ArrowDown',
          'key:ArrowLeft',
          'key:ArrowRight',
          'key:Enter',
          'key:Back',
          'key:other',
        ].indexOf(name) < 0,
    ),
  ).toEqual([]);
});

interface BootReport {
  launch: string;
  steps: Record<string, number>;
}

const readBoot = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bannertvBoot: () => BootReport }).__bannertvBoot());

test('launch marks follow the start to Home’s first focus and rows, and say whether it was a reload', async ({
  page,
}) => {
  await tune(page, { marks: true });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  // A first launch has nothing cached: the first rows come from the addons.
  await expect.poll(() => markNames(page)).toContain('boot:first-row-network');
  const first = await readBoot(page);
  expect(first.launch).toBe('cold');
  const steps = Object.keys(first.steps);
  for (const step of [
    'nav:domInteractive',
    'boot:script',
    'boot:start-end',
    'boot:idb-open',
    'boot:addons-read',
    'boot:layout-read',
    'boot:continue-read',
    'boot:first-focus',
  ]) {
    expect(steps).toContain(step);
  }
  expect(steps.indexOf('boot:script')).toBeLessThan(steps.indexOf('boot:start-end'));
  expect(steps.indexOf('boot:layout-read')).toBeLessThan(steps.indexOf('boot:first-focus'));
  expect(steps.filter((step) => step.indexOf('boot:first-row-cached') === 0)).toEqual([]);
  // Only launch steps and the page's own: no key presses, rows or addresses.
  expect(steps.filter((step) => !/^(?:nav|paint|boot|matcher):/.test(step))).toEqual([]);
  expect(steps.filter((step) => /https?:|\/\//.test(step))).toEqual([]);

  // Starting again, as a profile switch does: the first rows come from the cache now.
  await page.reload();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => markNames(page)).toContain('boot:first-row-cached');
  expect((await readBoot(page)).launch).toBe('reload');
});

test('with the cache trimmed later and written without waiting, Home’s rows still come back from it', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await tune(page, { idbPrune: 'later', idbRelaxed: true, marks: true });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => markNames(page)).toContain('boot:first-row-network');
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await page.reload();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => markNames(page)).toContain('boot:first-row-cached');
  expect(errors).toEqual([]);
});

test('by default art is decoded ahead, nothing is marked, the rows box has no layer, and the hero does not fade', async ({
  page,
}) => {
  await recordDecodes(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('html')).toHaveClass(/tune-no-hero-fade/);
  await expect(
    page.locator('section[aria-label="Elephants Dream"] img[src*="/background/"]').first(),
  ).toHaveCSS('transition-duration', '0s');
  await expect.poll(() => decodedTiles(page, FEATURED_MOVIES, 'logo')).toEqual([0, 1, 2, 3, 4]);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${FEATURED_MOVIES}-tile-0`);
  await expect.poll(() => decodedTiles(page, ACTION)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect((await decodes(page)).mostPending).toBe(1);
  // Nothing is drawn under the rail.
  await expect(page.locator('[data-warm-ahead]')).toHaveCount(0);
  expect(await page.evaluate(() => performance.getEntriesByType('mark').length)).toBe(0);
  await expect(page.locator('[data-row-key]').first().locator('xpath=..')).toHaveCSS(
    'will-change',
    'auto',
  );
});

test('decodeAhead false decodes nothing ahead', async ({ page }) => {
  await tune(page, { decodeAhead: false });
  await recordDecodes(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${FEATURED_MOVIES}-tile-0`);
  await page.waitForTimeout(500);
  expect(await allDecodes(page)).toEqual([]);
});

test('the hero fade comes back with heroFade true', async ({ page }) => {
  await tune(page, { heroFade: true });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('html')).not.toHaveClass(/tune-no-hero-fade/);
  await expect(
    page.locator('section[aria-label="Elephants Dream"] img[src*="/background/"]').first(),
  ).toHaveCSS('transition-duration', '0.4s');
});
