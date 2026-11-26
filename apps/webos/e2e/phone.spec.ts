import { expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { readKv } from './play';
import { heardApart, openTiming, playForMatching, seekVideo, video } from './player';
import { APP_URL, expectFocus, press } from './tv';

// A phone held sideways, as the Android app runs on one: 2340x1080 pixels, three to each CSS pixel.
test.use({ viewport: { width: 780, height: 360 }, deviceScaleFactor: 3, isMobile: true });

/** Where the UI sits on the phone's screen, and how far the page could pan. */
function layout(page: Page) {
  return page.evaluate(() => {
    const box = document.getElementById('root')!.getBoundingClientRect();
    const html = document.documentElement;
    return {
      left: Math.round(box.left),
      top: Math.round(box.top),
      width: Math.round(box.width),
      height: Math.round(box.height),
      pageWidth: html.scrollWidth,
      pageHeight: html.scrollHeight,
      shown: Math.round(window.visualViewport!.width),
    };
  });
}

test('on a phone the whole TV layout fits the screen, in the middle, and the page never pans', async ({
  page,
}) => {
  await mockAddons(page, { firstRun: true });
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  // 1920x1080 at a third is 640x360: the full height, with 70 pixels either side.
  expect(await layout(page)).toEqual({
    left: 70,
    top: 0,
    width: 640,
    height: 360,
    pageWidth: 780,
    pageHeight: 360,
    shown: 780,
  });

  await press(page, 'Enter', `${FIRST_ROW}-tile-0`);
  expect(await layout(page)).toMatchObject({ left: 70, width: 640, pageWidth: 780, shown: 780 });
});

test('tap the line you just heard on the phone', async ({ page }) => {
  test.setTimeout(90000);
  await playForMatching(page, 'matchLate');
  await seekVideo(page, 30);
  await openTiming(page);
  // A tap this soon after OK would be taken as the same press.
  await page.waitForTimeout(500);
  await page.locator('[data-focus-key="player-tracks-timing-match"]').click();

  // A line still to be heard, tapped the moment it is, plus the 0.3 s a viewer takes.
  const row = page.locator('[data-focus-key^="player-tracks-match-"]');
  let heard = 0;
  let target = '';
  await expect
    .poll(
      async () => {
        const now = (await video(page)).time;
        const rows = await row.evaluateAll((elements) =>
          elements.map((element) => ({
            key: element.getAttribute('data-focus-key') ?? '',
            text: element.textContent ?? '',
          })),
        );
        const next = rows.find((found) => {
          const n = Number(/Test line (\d+)/.exec(found.text)?.[1]);
          return n > 0 && heardApart(n) > now + 1.5;
        });
        if (!next) return false;
        target = next.key;
        heard = heardApart(Number(/Test line (\d+)/.exec(next.text)![1]));
        return true;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await page.waitForFunction(
    (at) => document.querySelector<HTMLVideoElement>('video:not([aria-hidden])')!.currentTime >= at,
    heard + 0.3,
    { polling: 'raf', timeout: 30000 },
  );
  await page.locator(`[data-focus-key="${target}"]`).click();

  // The file is 2 s late: the line tapped shows when it was heard.
  await expect
    .poll(async () => ((await readKv(page, 'subtitleOffsets')) ?? []) as unknown[])
    .toHaveLength(1);
  const [kept] = (await readKv(page, 'subtitleOffsets')) as [{ offset: number }];
  expect(Math.abs(kept.offset + 2)).toBeLessThanOrEqual(0.5);
  await expect(page.getByText(/^Lined up to that line: /)).toBeVisible();

  // Undo puts back the timing there was: none.
  await page.locator('[data-focus-key="player-tracks-timing-undo"]').click();
  await expect.poll(async () => readKv(page, 'subtitleOffsets')).toEqual([]);
  await expect(page.locator('[data-focus-key="player-tracks-timing-undo"]')).toHaveCount(0);
});
