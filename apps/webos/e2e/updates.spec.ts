import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { ANDROID_URL, openAsAndroid } from './android';
import {
  HOMEBREW_CHANNEL_ID,
  HOMEBREW_REPO_URL,
  launches,
  mockHomebrewRepo,
  openAsLgTv,
  repoWith,
} from './homebrew';
import {
  APP_URL,
  expectFocus,
  expectFocusLabel,
  openSection,
  press,
  pressBack,
  watchErrors,
} from './tv';

const ADD_LIST = {
  id: HOMEBREW_CHANNEL_ID,
  params: { launchMode: 'addRepository', url: HOMEBREW_REPO_URL },
};
const JUST_OPEN = { id: HOMEBREW_CHANNEL_ID };

/** Settings' Updates part. */
const updates = (page: Page) => page.getByRole('region', { name: 'Updates' });
const installed = (page: Page) => updates(page).getByText('BannerTV 0.1.0 is on this TV.');
/** The line under it: what Homebrew Channel has, or why it didn't open. */
const status = (page: Page) => updates(page).getByRole('status');

/** From Home's first tile to Settings, then across to the Updates button. */
async function openUpdates(page: Page): Promise<void> {
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-homebrew');
  await expectFocusLabel(page, 'Get updates in Homebrew Channel');
}

test('on an LG TV, Settings says a newer build is ready and opens Homebrew Channel on BannerTV’s repository', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const repo = await mockHomebrewRepo(page, { json: repoWith('0.2.0') });
  await openAsLgTv(page);
  await page.goto(APP_URL);
  await openUpdates(page);

  await expect(updates(page)).toBeVisible();
  await expect(installed(page)).toBeVisible();
  await expect(status(page)).toHaveText('BannerTV 0.2.0 is ready in Homebrew Channel.');
  // A plain GET with no headers of its own, so the TV sends no preflight from file://.
  expect(repo.requests).toHaveLength(1);
  expect(repo.requests[0]!.method()).toBe('GET');
  expect(repo.requests[0]!.headers()['content-type']).toBeUndefined();

  // The first press opens its Add repository dialog with the list filled in.
  await page.keyboard.press('Enter');
  await expect.poll(() => launches(page)).toEqual([ADD_LIST]);
  await expectFocus(page, 'settings-homebrew');

  // Confirming that dialog again would add the list twice, so now the button asks first.
  await press(page, 'Enter', 'settings-homebrew-menu-0');
  await expectFocusLabel(page, 'Open Homebrew Channel');
  await press(page, 'Enter', 'settings-homebrew');
  await expect.poll(() => launches(page)).toEqual([ADD_LIST, JUST_OPEN]);

  await press(page, 'Enter', 'settings-homebrew-menu-0');
  await press(page, 'ArrowDown', 'settings-homebrew-menu-1');
  await expectFocusLabel(page, "Add BannerTV's repository again");
  await press(page, 'Enter', 'settings-homebrew');
  await expect.poll(() => launches(page)).toEqual([ADD_LIST, JUST_OPEN, ADD_LIST]);

  // Back closes the question and opens nothing.
  await press(page, 'Enter', 'settings-homebrew-menu-0');
  await pressBack(page);
  await expectFocus(page, 'settings-homebrew');
  expect(await launches(page)).toHaveLength(3);

  // One read for the visit, through a screen opened from Settings and back.
  await press(page, 'ArrowUp', 'settings-home-rows');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Home rows' })).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'settings-home-rows');
  expect(repo.requests).toHaveLength(1);

  // A new visit to Settings reads it again.
  await press(page, 'ArrowUp', 'settings-profiles');
  await press(page, 'ArrowLeft', 'settings-stream-choice');
  await press(page, 'ArrowLeft', 'rail-settings');
  for (const item of ['addons', 'library', 'discover', 'search', 'home']) {
    await press(page, 'ArrowUp', `rail-${item}`);
  }
  await page.keyboard.press('Enter');
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(updates(page)).toHaveCount(0);
  repo.answer = { json: repoWith('0.1.0') };
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await expect(status(page)).toHaveText('You have the latest build.');
  expect(repo.requests).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('with the same build, an empty list, junk or no answer, Settings stays calm', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const repo = await mockHomebrewRepo(page, { json: repoWith('0.1.0') });
  await openAsLgTv(page);
  await page.goto(APP_URL);
  await openUpdates(page);
  await expect(installed(page)).toBeVisible();
  await expect(status(page)).toHaveText('You have the latest build.');

  // Each launch is a new visit to Settings, which reads the list again.
  const calm: { answer: typeof repo.answer; what: string }[] = [
    { answer: { json: { packages: [] } }, what: 'nothing published yet' },
    { answer: { json: { packages: [{ id: 'com.bannertv.app' }] } }, what: 'no manifest' },
    { answer: { json: repoWith('0.2') }, what: 'a version out of form' },
    { answer: { text: '<!doctype html><title>Oops</title>' }, what: 'not JSON' },
    { answer: { text: '{"error":"storage"}', status: 503 }, what: 'an error status' },
    { answer: 'no answer', what: 'no answer at all' },
  ];
  for (const { answer, what } of calm) {
    repo.answer = answer;
    const before = repo.requests.length;
    await page.reload();
    await openUpdates(page);
    await expect.poll(() => repo.requests.length, what).toBe(before + 1);
    await expect(installed(page), what).toBeVisible();
    await expect(status(page), what).toHaveText('');
  }
  // A list newer than this build, as one installed by hand can be.
  repo.answer = { json: repoWith('0.0.9') };
  await page.reload();
  await openUpdates(page);
  await expect(status(page)).toHaveText("This build is newer than Homebrew Channel's 0.0.9.");
  // The browser itself reports the failed loads; the app says nothing of them.
  expect(errors.filter((error) => !error.startsWith('Failed to load resource'))).toEqual([]);
});

test('without Homebrew Channel on the TV, the button says so instead of failing', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await mockHomebrewRepo(page, { json: repoWith('0.2.0') });
  await openAsLgTv(page, { missing: [HOMEBREW_CHANNEL_ID] });
  await page.goto(APP_URL);
  await openUpdates(page);
  await expect(status(page)).toHaveText('BannerTV 0.2.0 is ready in Homebrew Channel.');

  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText("Homebrew Channel didn't open. Is it installed?");
  await expectFocus(page, 'settings-homebrew');
  // Nothing was added, so the next press tries the Add repository dialog again, not the question.
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await launches(page)).length).toBe(2);
  expect(await launches(page)).toEqual([ADD_LIST, ADD_LIST]);
  await expectFocus(page, 'settings-homebrew');
  expect(errors).toEqual([]);
});

test('Updates show only on an LG TV: not in a browser, and not in the Android app', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const repo = await mockHomebrewRepo(page, { json: repoWith('0.2.0') });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await expect(page.getByRole('heading', { name: 'Profiles and Home' })).toBeVisible();
  await expect(updates(page)).toHaveCount(0);
  await expect(page.locator('[data-focus-key="settings-homebrew"]')).toHaveCount(0);

  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await expect(page.getByRole('heading', { name: 'Profiles and Home' })).toBeVisible();
  await expect(updates(page)).toHaveCount(0);
  await expect(page.locator('[data-focus-key="settings-homebrew"]')).toHaveCount(0);

  // Neither asked the updates Worker for anything.
  expect(repo.requests).toHaveLength(0);
  expect(errors).toEqual([]);
});
