import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import {
  openAsSamsung,
  pressSamsung,
  SAMSUNG_YOUTUBE,
  samsungCalls,
  SamsungKey,
  TIZEN_50_UA,
} from './samsung';
import { APP_URL, expectFocus, openSection, press, watchErrors } from './tv';

test.use({ userAgent: TIZEN_50_UA });

test.beforeEach(async ({ page }) => {
  await mockAddons(page);
  await openAsSamsung(page);
});

test("the build runs on a 2019 Samsung TV's engine, with no AbortController", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  // Every row came from the addons, through the stand-in AbortController's fetch.
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.locator(`[data-focus-key="${FIRST_ROW}-tile-0"] img`)).toHaveJSProperty(
    'complete',
    true,
  );
  await expect(page.locator('#unsupported')).toBeHidden();
  expect(await page.evaluate(() => typeof window.AbortController)).toBe('function');
  // 2019 sets get the low-power look.
  expect(await page.evaluate(() => document.documentElement.classList.contains('low-power'))).toBe(
    true,
  );
  // The media, colour and digit keys were asked for.
  const { registered } = await samsungCalls(page);
  expect(registered).toEqual(expect.arrayContaining(['MediaPlayPause', 'ColorF0Red', '0', '9']));
  expect(errors).toEqual([]);
});

test('rows move by transform alone, though focus() would scroll on that engine', async ({
  page,
}) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  for (let i = 1; i <= 5; i++) await press(page, 'ArrowRight', `${FIRST_ROW}-tile-${i}`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  const scrolled = await page.evaluate(() => {
    const moved: string[] = [];
    for (let node = document.activeElement; node; node = node.parentElement) {
      if (node.scrollLeft !== 0 || node.scrollTop !== 0) moved.push(node.tagName);
    }
    return { moved, page: [window.pageXOffset, window.pageYOffset] };
  });
  expect(scrolled).toEqual({ moved: [], page: [0, 0] });
});

test("Samsung's Back closes Details, and on Home's first row leaves the app", async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await press(page, 'Enter', 'details-watch');
  await pressSamsung(page, SamsungKey.Back);
  await expectFocus(page, `${FIRST_ROW}-tile-1`);
  expect((await samsungCalls(page)).exits).toBe(0);
  await pressSamsung(page, SamsungKey.Back);
  await expect.poll(async () => (await samsungCalls(page)).exits).toBe(1);
});

test("the keyboard's Done finishes typing in Search", async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'search');
  await expectFocus(page, 'search-field');
  const input = page.locator('input[aria-label="Search"]');
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.type('sintel');
  await pressSamsung(page, SamsungKey.Done);
  await expect(input).not.toBeFocused();
  await expect(input).toHaveValue('sintel');
  await expectFocus(page, 'search-field');
});

test("Trailer opens Samsung's YouTube app with the video", async ({ page }) => {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-1`);
  await press(page, 'ArrowRight', `${FIRST_ROW}-tile-2`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'ArrowRight', 'details-trailer');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await samsungCalls(page)).launched)
    .toEqual([
      {
        appId: SAMSUNG_YOUTUBE,
        operation: 'http://tizen.org/appcontrol/operation/view',
        data: [{ key: 'PAYLOAD', value: ['{"values":"v=eRsGyueVLvQ"}'] }],
      },
    ]);
});
