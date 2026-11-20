import { expect, type Locator, test } from '@playwright/test';
import { creditSentence, FILMS } from '../../../services/demo/src/addon';
import { DEMO_ROW, FIRST_ROW, mockAddons } from './addons';
import { readKv } from './play';
import { APP_URL, expectFocus, press, pressBack } from './tv';

test('the first launch welcomes the user once, then opens Home', async ({ page }) => {
  await mockAddons(page, { firstRun: true });
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  const welcome = page.getByRole('dialog', { name: 'Welcome to BannerTV' });
  await expect(
    welcome.getByText("BannerTV doesn't host or provide any films or series."),
  ).toBeVisible();
  // The account's service does not answer, so the welcome offers no account.
  await page.waitForTimeout(500);
  await expect(welcome.getByRole('region')).toHaveCount(0);

  // Focus stays on the welcome: the rail and Home wait underneath.
  await press(page, 'ArrowLeft', 'welcome-start');
  await press(page, 'ArrowRight', 'welcome-add');
  await press(page, 'ArrowLeft', 'welcome-start');
  await page.keyboard.press('Enter');
  await expect(welcome).toHaveCount(0);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await page.reload();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a new TV starts on Cinemeta’s rows, with no Blender open movies', async ({ page }) => {
  await mockAddons(page, { firstRun: true });
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  await expect(
    page.getByText('Cinemeta is already added, so Home is ready to browse.', { exact: false }),
  ).toBeVisible();
  await press(page, 'Enter', `${FIRST_ROW}-tile-0`);
  const titles = page.locator('[data-row-key] h2');
  await expect(titles.nth(0)).toHaveText('PopularMovies');
  await expect(page.getByText('Blender open movies')).toHaveCount(0);
  expect(
    ((await readKv(page, 'addons')) as { transportUrl: string }[]).map((a) => a.transportUrl),
  ).toEqual([
    'https://v3-cinemeta.strem.io/manifest.json',
    'https://opensubtitles-v3.strem.io/manifest.json',
  ]);
});

test('BannerTV Demo installed by an earlier build is taken away at launch', async ({ page }) => {
  await mockAddons(page, { demo: 'preinstalled' });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator('[data-row-key] h2').nth(0)).toHaveText('PopularMovies');
  await expect(page.getByText('Blender open movies')).toHaveCount(0);
  await expect
    .poll(async () =>
      ((await readKv(page, 'addons')) as { transportUrl: string }[]).map((a) => a.transportUrl),
    )
    .not.toContain('https://demo.bannertv.workers.dev/manifest.json');
});

test('BannerTV Demo added by its address leads Home with its films, credited on Details', async ({
  page,
}) => {
  await mockAddons(page, { firstRun: true, demo: 'added' });
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  await press(page, 'Enter', `${DEMO_ROW}-tile-0`);

  // The Demo's row leads Home and fills the hero; Cinemeta's rows follow.
  const titles = page.locator('[data-row-key] h2');
  await expect(titles.nth(0)).toHaveText('Blender open moviesMovies');
  await expect(titles.nth(1)).toHaveText('PopularMovies');
  await expect(page.locator(`[data-focus-key="${DEMO_ROW}-tile-0"]`)).toHaveAttribute(
    'aria-label',
    'Big Buck Bunny, 2008',
  );
  await expect(
    page.locator(
      'section[aria-label="Big Buck Bunny"] h1, section[aria-label="Big Buck Bunny"] img',
    ),
  ).not.toHaveCount(0);

  await press(page, 'Enter', 'details-watch');
  await expect(page.getByText('Licensed under CC BY 3.0', { exact: false })).toBeVisible();
  await pressBack(page);
  await expectFocus(page, `${DEMO_ROW}-tile-0`);
});

test('if BannerTV Demo, added first, cannot be reached, Cinemeta’s first title fills the hero', async ({
  page,
}) => {
  await mockAddons(page, { firstRun: true, demo: 'added' });
  await page.route(/^https:\/\/demo\.bannertv\.workers\.dev\//, (route) => route.abort());
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  await press(page, 'Enter', `${DEMO_ROW}-tile-0`);
  await expect(
    page.getByText('BannerTV Demo could not be reached', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('section[aria-label="Elephants Dream"]')).toBeVisible();
  // Down goes on to Cinemeta's row as usual.
  await press(page, 'ArrowDown', 'home-1-movie-top-tile-0');
});

/** How many pixels of a clamped paragraph's text are hidden. */
const hiddenPixels = (paragraph: Locator) =>
  paragraph.evaluate((p) => p.scrollHeight - p.clientHeight);

test('every BannerTV Demo film’s text fits the hero and Details, credit and licence included', async ({
  page,
}) => {
  await mockAddons(page, { firstRun: true, demo: 'added' });
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  await press(page, 'Enter', `${DEMO_ROW}-tile-0`);
  for (const [index, film] of FILMS.entries()) {
    if (index > 0) await press(page, 'ArrowRight', `${DEMO_ROW}-tile-${index}`);
    // The hero clamps the description to three lines.
    const hero = page.getByText(film.description, { exact: true });
    await expect(hero).toBeVisible();
    expect(await hiddenPixels(hero)).toBeLessThanOrEqual(1);

    // Details clamps it to six, with the credit and the licence's address at the end.
    await press(page, 'Enter', 'details-watch');
    const details = page.locator('p:visible', { hasText: creditSentence(film) });
    await expect(details).toBeVisible();
    expect(await hiddenPixels(details)).toBeLessThanOrEqual(1);
    await pressBack(page);
    await expectFocus(page, `${DEMO_ROW}-tile-${index}`);
  }
});

test('Add an addon on the welcome opens Addons with the dialog showing', async ({ page }) => {
  await mockAddons(page, { firstRun: true });
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  await press(page, 'ArrowRight', 'welcome-add');
  await press(page, 'Enter', 'install-field');
  await expect(page.getByRole('dialog', { name: 'Add an addon' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Addons', level: 1 })).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'addons-add');
});
