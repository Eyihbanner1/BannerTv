import { expect, test, type Locator, type Page } from '@playwright/test';
import { EXTRA_ADDON_URL, mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback, seedStreamAddon } from '../../webos/e2e/play.ts';
import { mockSports, seedSports, SPORTS_NOW } from '../../webos/e2e/sports.ts';

/*
 * The phone at its narrowest common width, 360 wide. React Native, and react-native-web with
 * it, lets a horizontal ScrollView shrink by default: on Search the results list squeezed the
 * Films and series / Films / Series row once results came in, cutting the pills in half (seen
 * on a phone). These check the pills keep their full height with a long list under them, that
 * a sideways row keeps its chosen pill on screen, and that larger text cuts nothing off.
 */
test.use({ viewport: { width: 360, height: 780 } });

const KINDS = ['Films and series', 'Films', 'Series'];
/** touch.chip in the design tokens. */
const CHIP_HEIGHT = 40;
/** How wide ChipRow's fade is at an end with more pills past it. */
const FADE = 28;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** The pill's height, and how much of it shows inside everything around it that clips. */
function shown(target: Locator): Promise<{ height: number; visible: number }> {
  return target.evaluate((element) => {
    const own = element.getBoundingClientRect();
    let top = own.top;
    let bottom = own.bottom;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowY === 'visible') continue;
      const box = parent.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
    return { height: own.height, visible: Math.max(0, bottom - top) };
  });
}

async function expectWhole(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const pill = page.getByRole('button', { name, exact: true });
    await expect(pill).toBeVisible();
    const { height, visible } = await shown(pill);
    expect(height, `${name} is ${height} high`).toBeGreaterThanOrEqual(CHIP_HEIGHT);
    expect(visible, `${name} shows ${visible} of ${height}`).toBeGreaterThanOrEqual(height - 0.5);
  }
}

interface RowState {
  offset: number;
  /** The furthest the row scrolls. */
  end: number;
  fadeBefore: boolean;
  fadeAfter: boolean;
}

/** How far a sideways row has scrolled, and which of its ends are faded. */
function rowState(row: Locator): Promise<RowState> {
  return row.evaluate((element) => {
    const box = element.getBoundingClientRect();
    // The fades sit beside the row's ScrollView, at its start and its end.
    const fades = Array.from(element.parentElement?.children ?? [])
      .filter((sibling) => sibling !== element)
      .map((sibling) => sibling.getBoundingClientRect());
    return {
      offset: element.scrollLeft,
      end: element.scrollWidth - element.clientWidth,
      fadeBefore: fades.some((fade) => Math.abs(fade.left - box.left) < 1),
      fadeAfter: fades.some((fade) => Math.abs(fade.right - box.right) < 1),
    };
  });
}

/** The pill shows whole in its row, clear of a fade at either end. */
async function expectInView(row: Locator, pill: Locator): Promise<RowState> {
  const state = await rowState(row);
  const shownBox = await row.boundingBox();
  const own = await pill.boundingBox();
  if (!shownBox || !own) throw new Error('The row or its pill is not on the page');
  const start = shownBox.x + (state.fadeBefore ? FADE : 0);
  const end = shownBox.x + shownBox.width - (state.fadeAfter ? FADE : 0);
  expect(own.x, 'the pill starts in view').toBeGreaterThanOrEqual(start - 1);
  expect(own.x + own.width, 'the pill ends in view').toBeLessThanOrEqual(end + 1);
  return state;
}

/**
 * Text drawn larger, as on a phone set to a bigger font size. react-native-web writes each
 * text size into its style sheet in pixels as a style is first used, so they are scaled on the
 * way in; a size set outside a StyleSheet stays as it is. The web build ignores
 * maxFontSizeMultiplier, so the bottom tabs' cap of 1.3 can only be checked on a phone.
 */
async function largerText(page: Page, scale: number): Promise<void> {
  await page.addInitScript((by) => {
    const insert = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function (this: CSSStyleSheet, rule, index) {
      const scaled = rule.replace(
        /(font-size|line-height):\s*([\d.]+)px/g,
        (_, name: string, size: string) => `${name}:${Number(size) * by}px`,
      );
      return insert.call(this, scaled, index);
    };
  }, scale);
}

/** All of the text shows: none of it past its line limit, and none of it off the screen. */
async function expectAllShown(text: Locator): Promise<void> {
  await expect(text).toBeVisible();
  const fit = await text.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      words: element.textContent,
      wider: element.scrollWidth - element.clientWidth,
      taller: element.scrollHeight - element.clientHeight,
      left: box.left,
      right: box.right,
      screen: document.documentElement.clientWidth,
    };
  });
  expect(fit.wider, `"${fit.words}" loses its end`).toBeLessThanOrEqual(1);
  expect(fit.taller, `"${fit.words}" loses a line`).toBeLessThanOrEqual(1);
  expect(fit.left, `"${fit.words}" starts off the screen`).toBeGreaterThanOrEqual(0);
  expect(fit.right, `"${fit.words}" runs off the screen`).toBeLessThanOrEqual(fit.screen);
}

/** The button is wholly on the screen, from side to side. */
async function expectOnScreen(page: Page, name: string): Promise<void> {
  const target = page.getByRole('button', { name, exact: true });
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  const screen = page.viewportSize();
  if (!box || !screen) throw new Error(`${name} has nothing to measure`);
  expect(box.x, `${name} starts on the screen`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${name} ends on the screen`).toBeLessThanOrEqual(screen.width);
}

test('at 360 wide, the kind pills keep their height once Search and My List fill up', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  // A long My List, so its grid runs well past the screen too.
  await seedStreamAddon(page, {
    kv: {
      library: {
        items: [
          ['tt0807840', 'Elephants Dream'],
          ['tt1254207', 'Big Buck Bunny'],
          ['tt1727587', 'Sintel'],
          ['tt2285752', 'Tears of Steel'],
          ['tt9000005', 'Caminandes'],
          ['tt9000006', 'Cosmos Laundromat'],
          ['tt9000007', 'Glass Half'],
          ['tt9000008', 'Agent 327'],
          ['tt9000009', 'Hero'],
          ['tt9000010', 'Spring'],
          ['tt9000011', 'Coffee Run'],
          ['tt9000012', 'Sprite Fright'],
        ].map(([id, name], index) => ({ id, type: 'movie', name, addedAt: 1000 + index })),
        outbox: [],
        synced: [],
      },
    },
  });
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');

  // "er" finds Hero among the films and two series. With each addon's own results unfolded
  // under Top results, the list runs well past the bottom of the screen.
  await page.getByRole('tab', { name: 'Search' }).click();
  await page.getByPlaceholder('Search for a film or series').fill('er');
  await expect(page.getByText('Top results', { exact: true })).toBeVisible();
  const hero = page.getByRole('button', { name: 'Hero, 2018' });
  await expect(hero).toHaveCount(1);
  await expectWhole(page, KINDS);
  await page.getByRole('button', { name: 'Results from each addon' }).click();
  await expect(hero).toHaveCount(2);
  await expectWhole(page, KINDS);

  await page.getByRole('tab', { name: 'My List' }).click();
  await expect(page.getByRole('button', { name: 'Sprite Fright, 2021' })).toBeVisible();
  await expectWhole(page, ['My List', 'History', 'Calendar', ...KINDS]);
  expect(errors).toEqual([]);
});

test('at 360 wide, Browse opens on the genre chosen last, and stays where scrolled', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const requests = await mockAddons(page);
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
  await page.getByRole('button', { name: 'Discover' }).click();
  const genres = page.getByLabel('Genre', { exact: true });
  await expect(genres.getByRole('button', { name: 'All genres' })).toBeVisible();
  // The genres run on past the screen, and only the end says so.
  await expect
    .poll(() => rowState(genres))
    .toMatchObject({ offset: 0, fadeBefore: false, fadeAfter: true });

  // Drama is the ninth pill of twenty, far past the screen's edge at first.
  const drama = genres.getByRole('button', { name: 'Drama', exact: true });
  await drama.click();
  await expect.poll(() => requests.catalogs).toContain('movie/top/genre=Drama');
  // A new genre is a new grid, and its row opens on Drama with more pills either side.
  await expect(async () => {
    expect(await expectInView(genres, drama)).toMatchObject({ fadeBefore: true, fadeAfter: true });
  }).toPass({ timeout: 5_000 });

  // Browse remembers it, and opens on it again.
  await page.getByLabel('Back').first().click();
  await page.getByRole('button', { name: 'Discover' }).click();
  await expect(drama).toBeVisible();
  await expect(async () => {
    const state = await expectInView(genres, drama);
    expect(state.offset).toBeGreaterThan(0);
  }).toPass({ timeout: 5_000 });

  // Scrolled back by hand, the row stays there: it does not jump to Drama again as the fades
  // change, and the start's fade goes.
  await genres.hover();
  await page.mouse.wheel(-3000, 0);
  await expect
    .poll(() => rowState(genres))
    .toMatchObject({ offset: 0, fadeBefore: false, fadeAfter: true });
  await page.waitForTimeout(500);
  expect((await rowState(genres)).offset).toBe(0);
  // At the far end only the start fades.
  await page.mouse.wheel(5000, 0);
  await expect
    .poll(async () => {
      const { offset, end, fadeBefore, fadeAfter } = await rowState(genres);
      return { atEnd: offset >= end - 1, fadeBefore, fadeAfter };
    })
    .toEqual({ atEnd: true, fadeBefore: true, fadeAfter: false });
  expect(errors).toEqual([]);
});

test('at 360 wide, a Sports day under the fade slides into view when tapped', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.install({ time: SPORTS_NOW });
  await mockAddons(page);
  await seedSports(page);
  await mockSports(page);
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
  await page.getByRole('tab', { name: 'Sports' }).click();
  const strip = page.getByRole('tablist').filter({ has: page.getByRole('tab', { name: 'Today' }) });
  const today = strip.getByRole('tab', { name: 'Today' });
  await expect(today).toBeVisible();
  await expect
    .poll(() => rowState(strip))
    .toMatchObject({ offset: 0, fadeBefore: false, fadeAfter: true });
  const chosenColour = await today.evaluate((tab) => getComputedStyle(tab).backgroundColor);

  // The first day the end's fade covers, tapped on the part of it that shows. A real tap: a
  // locator's click would scroll it into view first.
  const covered = await strip.evaluate((element, fade) => {
    const end = element.getBoundingClientRect().right;
    const tabs = Array.from(element.querySelectorAll('[role="tab"]'));
    const index = tabs.findIndex((tab) => tab.getBoundingClientRect().right > end - fade);
    const box = tabs[index]!.getBoundingClientRect();
    return {
      index,
      x: box.left + Math.min(12, (end - box.left) / 2),
      y: box.top + box.height / 2,
    };
  }, FADE);
  expect(covered.index).toBeGreaterThan(1);
  const day = strip.getByRole('tab').nth(covered.index);
  await page.mouse.click(covered.x, covered.y);
  await expect
    .poll(() => day.evaluate((tab) => getComputedStyle(tab).backgroundColor))
    .toBe(chosenColour);
  await expect(async () => {
    const state = await expectInView(strip, day);
    expect(state.offset).toBeGreaterThan(0);
    expect(state.fadeBefore).toBe(true);
  }).toPass({ timeout: 5_000 });
  expect(errors).toEqual([]);
});

test('at 360 wide with larger text, buttons, rows and lines keep all their words', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // Twice the size, as far as Android's font size setting goes. Before these screens wrapped,
  // each of the four below failed at it; at 1.3 times only two did.
  await largerText(page, 2);
  await mockAddons(page);
  // Sintel part watched, so it has Start over, and with no stream found for it.
  await seedStreamAddon(page, {
    progress: [
      { metaId: 'tt1727587', type: 'movie', videoId: 'tt1727587', position: 300, duration: 888 },
    ],
  });
  await mockPlayback(page, { streams: { tt1727587: [] } });
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');

  // A title's line under Play and its buttons take two lines rather than lose their ends.
  await page
    .getByLabel(/^Sintel/)
    .first()
    .click();
  await expectAllShown(
    page.getByText('No stream found yet. All streams has the full list.', { exact: true }),
  );
  for (const [button, label] of [
    ['Start over', 'Start over'],
    ['Add Sintel to My List', 'My List'],
    ['Mark Sintel as watched', 'Watched'],
    ['Trailer', 'Trailer'],
    ['All streams', 'All streams'],
  ] as const) {
    await expectAllShown(
      page.getByRole('button', { name: button, exact: true }).getByText(label, { exact: true }),
    );
  }
  await page.getByLabel('Back').first().click();

  // My List, History and Calendar go onto a second line rather than off the screen.
  await page.getByRole('tab', { name: 'My List' }).click();
  for (const name of ['My List', 'History', 'Calendar']) {
    await expectOnScreen(page, name);
  }

  // A long value takes two lines beside the title, which keeps close to half the row.
  await page.getByRole('tab', { name: 'Settings' }).click();
  const row = page.getByRole('button', { name: /^Highest picture/ });
  await expect(row).toBeVisible();
  const fit = await row.evaluate((element) => {
    const find = (words: string) =>
      Array.from(element.querySelectorAll('*')).find(
        (node) => node.children.length === 0 && node.textContent === words,
      )!;
    const title = find('Highest picture');
    const value = find('As high as the phone shows');
    const style = getComputedStyle(element);
    const inside =
      element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const valueBox = value.getBoundingClientRect();
    return {
      title: title.parentElement!.getBoundingClientRect().width / inside,
      lines: valueBox.height / parseFloat(getComputedStyle(value).lineHeight),
      overRow: valueBox.right - element.getBoundingClientRect().right,
    };
  });
  expect(fit.title, 'the title keeps close to half the row').toBeGreaterThanOrEqual(0.44);
  expect(fit.lines, 'the value takes two lines at most').toBeLessThanOrEqual(2.05);
  expect(fit.overRow, 'the value stays in the row').toBeLessThanOrEqual(0);

  // An addon with settings: Settings and Remove go under its arrows rather than off the card.
  await page.getByText('Addons', { exact: true }).click();
  await page.getByRole('button', { name: 'Add an addon' }).last().click();
  await page.getByLabel('Addon address').fill(EXTRA_ADDON_URL);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Added Open Shorts.', { exact: false })).toBeVisible();
  for (const name of ['Settings for Open Shorts', 'Remove Open Shorts', 'Remove Cinemeta']) {
    await expectOnScreen(page, name);
  }
  expect(errors).toEqual([]);
});
