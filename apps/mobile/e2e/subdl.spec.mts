import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { DEFAULT_STREAMS, mockPlayback, readKv, seedStreamAddon } from '../../webos/e2e/play.ts';
import { KIDS_ID, main, seedProfiles } from '../../webos/e2e/profiles.ts';
import { FAKE_SUBDL_KEY, standInSubdl, SUBDL_FILM_RELEASE } from '../../webos/e2e/subdl.ts';

/*
 * SubDL on the phone's web build, against the TV journeys' stand-in for SubDL (webos/e2e/
 * subdl.ts). The key is obviously fake.
 */

/** Tears of Steel, Cinemeta's copy, which the test stream addon answers for. */
const FILM = 'tt2285752';

/** Opens the app. The fake addons refuse every other address, so the app's own is let through. */
async function openApp(page: Page): Promise<void> {
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
}

/** Everything the page logs and every address it asks, to look for the key in. */
function watchLeaks(page: Page) {
  const seen = { lines: [] as string[], urls: [] as string[] };
  page.on('console', (message) => seen.lines.push(message.text()));
  page.on('request', (request) => seen.urls.push(request.url()));
  return seen;
}

test('a SubDL key pasted on the phone is checked and kept, and never logged or sent in an address', async ({
  page,
}) => {
  const leaks = watchLeaks(page);
  await mockAddons(page);
  const subdl = await standInSubdl(page, 'films');
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('Services', { exact: true })).toBeVisible();
  await page.getByText('SubDL subtitles: Off', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open subdl.com' })).toBeVisible();

  const field = page.getByLabel('Your SubDL key');
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill(FAKE_SUBDL_KEY);
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('Your key works. BannerTV will look on SubDL too.')).toBeVisible();
  await expect(field).toHaveValue('');
  await expect
    .poll(() => readKv(page, 'subdl/key'))
    .toEqual({ key: FAKE_SUBDL_KEY, state: 'works' });
  expect(subdl.meChecks).toBe(1);

  await page.getByLabel('Back').first().click();
  await expect(page.getByText('SubDL subtitles: On', { exact: true })).toBeVisible();
  for (const line of leaks.lines) expect(line).not.toContain(FAKE_SUBDL_KEY);
  for (const url of leaks.urls) expect(url).not.toContain(FAKE_SUBDL_KEY);
  expect(subdl.keyInUrl).toBe(false);
});

test("the player's English versions list SubDL's file", async ({ page }) => {
  const leaks = watchLeaks(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    preferences: { subtitleLanguage: 'eng' },
    kv: { 'subdl/key': { key: FAKE_SUBDL_KEY, state: 'works' } },
  });
  await mockPlayback(page, {
    streams: { [FILM]: [{ ...DEFAULT_STREAMS[0]!, filename: `${SUBDL_FILM_RELEASE}.mkv` }] },
  });
  const subdl = await standInSubdl(page, 'films');
  await openApp(page);

  await page
    .getByLabel(/Tears of Steel/)
    .last()
    .click();
  await page.getByRole('button', { name: /All streams/ }).click();
  await page
    .getByText(/Open Movie 1080p/)
    .first()
    .click();
  const pause = page.getByLabel('Pause', { exact: true }).first();
  await expect(pause).toBeVisible();
  // The browser waits for a tap before it plays; the phone does not.
  await pause.click();
  await page.getByLabel('Play', { exact: true }).first().click();
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();

  const panelButton = page.getByRole('button', { name: 'Audio and subtitles' });
  if (!(await panelButton.isVisible())) await page.mouse.click(120, 160);
  await panelButton.click();
  await page.getByRole('button', { name: /^English, \d versions?$/ }).click();
  // One step in, one SubDL file is listed under its source alone, with the release it was made
  // for.
  await expect(
    page.getByRole('button', { name: `SubDL, Same release, ${SUBDL_FILM_RELEASE}` }),
  ).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  for (const line of leaks.lines) expect(line).not.toContain(FAKE_SUBDL_KEY);
  for (const url of leaks.urls) expect(url).not.toContain(FAKE_SUBDL_KEY);
});

test('a kids profile has no SubDL row', async ({ page }) => {
  await mockAddons(page);
  const subdl = await standInSubdl(page, 'films');
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Robin', colour: 3, kids: 'PG' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  // A kids profile's Settings hold only the note, so wait for it before looking for the row.
  await expect(
    page.getByText('Grown-ups can change the settings from their own profile.'),
  ).toBeVisible();
  await expect(page.getByText(/^SubDL subtitles/)).toHaveCount(0);
  expect(subdl.meChecks).toBe(0);
});
