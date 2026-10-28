import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, png, SERIES_ROW } from './addons';
import { APP_URL, expectFocus, openSection, press } from './tv';

/**
 * The switches the TV comparison of the first walk down Home tries (see
 * src/platform/tuning.ts): decoding ahead, Home's rows box on its own layer,
 * the hero without its fade, and timing marks. All are off by default.
 */

/** Home's first rows from the mock Cinemeta, top to bottom. Featured rows have wide tiles. */
const FEATURED_MOVIES = 'home-0-movie-imdbrating';
const ACTION = 'home-0-movie-top-genre-action';

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
  /** The same element was asked before. */
  again: boolean;
}

/** Records every decode() asked of tile artwork, by row and tile. */
async function recordDecodes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: Call[] = [];
    const seen = new WeakSet<HTMLImageElement>();
    (window as unknown as { decodes: Call[] }).decodes = calls;
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function decode(this: HTMLImageElement) {
      const row = this.closest('[data-row-key]');
      const tile = this.closest('[data-focus-key]');
      if (row && tile) {
        calls.push({
          row: row.getAttribute('data-row-key')!,
          tile: tile.getAttribute('data-focus-key')!,
          src: this.getAttribute('src')!,
          again: seen.has(this),
        });
        seen.add(this);
      }
      return original.call(this);
    };
  });
}

const allDecodes = (page: Page) =>
  page.evaluate(() => (window as unknown as { decodes: Call[] }).decodes);

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

test.describe('on a 4K TV', () => {
  test.use({ deviceScaleFactor: 2 });

  test('decoding ahead takes the posters and logos across the screen of the rows a Down or Up shows next, never wide art', async ({
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

    await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
    // The row above, for Up: its posters across the screen.
    await expect.poll(() => decodedTiles(page, FIRST_ROW)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (let n = 1; n <= 3; n++) await press(page, 'ArrowRight', `${SERIES_ROW}-tile-${n}`);

    await press(page, 'ArrowDown', `${FEATURED_MOVIES}-tile-0`);
    // The row after next: exactly the seven posters across the screen, not
    // the ones drawn past its right edge.
    await expect.poll(() => decodedTiles(page, ACTION)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // The row above, moved on to tile 3: tile 1 is past the left edge.
    await expect.poll(() => decodedTiles(page, SERIES_ROW)).toEqual([2, 3, 4]);

    // Back to rows still drawn: nothing asked already is asked again.
    await press(page, 'ArrowUp', `${SERIES_ROW}-tile-3`);
    await press(page, 'ArrowDown', `${FEATURED_MOVIES}-tile-0`);
    await page.waitForTimeout(400);
    expect((await allDecodes(page)).filter((call) => call.again)).toEqual([]);
  });
});

test('art that loads after its row was decoded ahead is decoded as it arrives', async ({
  page,
}) => {
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
  // ...and the held ones one at a time as each arrives.
  await expect.poll(() => decodedTiles(page, ACTION)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  const late = (await marks(page))
    .filter((entry) => entry.at >= releasedAt && entry.name.indexOf(`ahead:${ACTION}:`) === 0)
    .map((entry) => entry.name);
  expect(late).toEqual(Array(4).fill(`ahead:${ACTION}:1`));
});

test('with rowsAround 3, the row after next is drawn early and decoded in one go once it is next', async ({
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
  await expect.poll(() => markNames(page)).toContain(`ahead:${ACTION}:7`);
  await expect.poll(() => markNames(page)).toContain(`ahead-done:${ACTION}`);
  // Marks name rows, never an address.
  expect((await markNames(page)).filter((name) => /https?:|\/\//.test(name))).toEqual([]);
});

test("Home's rows box can be a layer of its own, and the hero can change without its fade", async ({
  page,
}) => {
  await tune(page, { homeLayer: true, heroFade: false, marks: true });
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
  // The old backdrop goes as the new one shows, not 400 ms later.
  await expect
    .poll(async () => {
      const list = await marks(page);
      const shown = list.filter((entry) => entry.name === 'backdrop:shown').pop();
      const settled = list.filter((entry) => entry.name === 'backdrop:settled').pop();
      return shown && settled && settled.at >= shown.at ? settled.at - shown.at : null;
    })
    .toBeLessThan(150);

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

test('by default nothing is decoded ahead or marked, the rows box has no layer, and the hero fades', async ({
  page,
}) => {
  await recordDecodes(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(
    page.locator('section[aria-label="Elephants Dream"] img[src*="/background/"]').first(),
  ).toHaveCSS('transition-duration', '0.4s');
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${FEATURED_MOVIES}-tile-0`);
  await page.waitForTimeout(500);
  expect(await allDecodes(page)).toEqual([]);
  expect(await page.evaluate(() => performance.getEntriesByType('mark').length)).toBe(0);
  await expect(page.locator('[data-row-key]').first().locator('xpath=..')).toHaveCSS(
    'will-change',
    'auto',
  );
});
